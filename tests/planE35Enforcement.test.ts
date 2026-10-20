/**
 * E-35 — the deterministic skill layer is connected to the plan path.
 *
 * The finding was not that the logic was wrong; it was that
 * `applyNotebookSkillsToAnalysis` had ten test call sites and zero production
 * ones, `VetoLedgerService.recordVeto` was read and never written, and the
 * predicate gate's `ceiling` was computed and dropped. These tests drive the
 * REAL presenter, so the only way to pass is for the production path to call
 * all three.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const USER = 'e35-user';
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'e35-user',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));
vi.mock('../utils/skillHoldout', () => ({ shouldSkillHoldout: () => false }));

const vetoMock = vi.hoisted(() => ({ recordVeto: vi.fn(async (_params: Record<string, unknown>) => null) }));
vi.mock('../services/ui/VetoLedgerService', () => ({ VetoLedgerService: vetoMock }));

const gateMock = vi.hoisted(() => ({
    fetchGateInputData: vi.fn(async () => null as unknown),
    runProgrammaticGate: vi.fn(() => ({ confidenceCap: 1, pass: true, warnings: [], reason: 'ok' })),
}));
vi.mock('../services/validation/GateKeeperService', () => gateMock);

const predicateMock = vi.hoisted(() => ({
    evaluateSkillPredicates: vi.fn(async () => ({
        fired: [] as Array<{ name: string; kind: string; predicate: string; timeframe: string }>,
        judged: 0, inconclusive: 0, note: '', ceiling: undefined as number | undefined,
    })),
}));
vi.mock('../services/learning/skillPredicateGate', () => predicateMock);

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { buildProposedTradeAnalysis } from '../services/trade/proposedTrade';
import { runPresentTrade, type PresentTradeContext, type PresentTradeSink } from '../services/trade/presentTradeTool';
import type { DeskToolCall } from '../services/analysis/DeskToolsService';
import type { TradeProposal } from '../services/trade/proposedTrade';

const seedSkill = async (
    name: string,
    status: 'confirmed' | 'candidate',
    wins: number,
    losses: number,
): Promise<void> => {
    await initMemoryFiles(USER);
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, name, `---
status: ${status}
kind: avoid
coin: BTCUSDT
direction: Short
wins: ${wins}
losses: ${losses}
approvedBy: grandfathered
ifCondition: BTC fails at resistance
thenAction: skip the short
---

# Avoid BTC short

**When:** BTC fails at resistance
**What I do:** skip.
`, USER, true);
};

const call = (over: Record<string, unknown> = {}): DeskToolCall => ({
    id: 'call-1',
    name: 'present_trade',
    arguments: {
        symbol: 'BTCUSDT', direction: 'Short', entry: 100, stopLoss: 105,
        takeProfits: [90], confidence: 'High', ...over,
    },
});

const present = (toolCall: DeskToolCall = call()): {
    result: ReturnType<typeof runPresentTrade>;
    proposals: TradeProposal[];
    gates: NonNullable<TradeProposal['gate']>[];
} => {
    const proposals: TradeProposal[] = [];
    const gates: NonNullable<TradeProposal['gate']>[] = [];
    const ctx: PresentTradeContext = {
        call: toolCall,
        symbol: 'BTCUSDT',
        trades: [],
        drawnPrice: null,
        crossCanvas: false,
        watchable: false,
        canvasNote: '',
    };
    const sink: PresentTradeSink = {
        setProposal: p => { proposals.push(p); },
        setGate: g => { gates.push(g); },
    };
    const result = runPresentTrade(ctx, sink);
    return { result, proposals, gates };
};

beforeEach(async () => {
    store = {};
    localStorage.clear();
    vetoMock.recordVeto.mockClear();
    gateMock.fetchGateInputData.mockReset();
    gateMock.fetchGateInputData.mockResolvedValue(null);
    gateMock.runProgrammaticGate.mockReset();
    gateMock.runProgrammaticGate.mockReturnValue({ confidenceCap: 1, pass: true, warnings: [], reason: 'ok' });
    predicateMock.evaluateSkillPredicates.mockReset();
    predicateMock.evaluateSkillPredicates.mockResolvedValue({
        fired: [], judged: 0, inconclusive: 0, note: '', ceiling: undefined,
    });
    await initMemoryFiles(USER);
});

describe('a confirmed AVOID skill refuses the plan and writes the ledger', () => {
    it('refuses presentation, names the rule and records the veto', async () => {
        await seedSkill('btc-short-avoid.md', 'confirmed', 12, 3);
        const { result, proposals } = present();

        expect(result.ok).toBe(false);
        expect(result.content).toMatch(/present_trade refused/i);
        expect(result.content).toMatch(/NOTEBOOK SKILL VETO/i);
        expect(proposals).toEqual([]);
        expect(vetoMock.recordVeto).toHaveBeenCalledTimes(1);
        expect(vetoMock.recordVeto.mock.calls[0][0]).toMatchObject({
            coinName: 'BTCUSDT',
            direction: 'Short',
            entryPrice: 100,
            stopLoss: 105,
        });
    });

    it('does NOT refuse a plan the skill does not scope', async () => {
        await seedSkill('btc-short-avoid.md', 'confirmed', 12, 3);
        // Same skill, opposite side: direction is not a match, and a coin-only
        // match is enough in the strict matcher — so use another coin.
        const { result } = present(call({ symbol: 'ETHUSDT' }));
        expect(result.ok).toBe(true);
        expect(vetoMock.recordVeto).not.toHaveBeenCalled();
    });
});

describe('a candidate AVOID with enough evidence sizes the plan down', () => {
    it('caps High to Low without refusing it', async () => {
        await seedSkill('btc-short-candidate.md', 'candidate', 5, 5); // sample 10 = floor
        const { result, proposals } = present();
        expect(result.ok).toBe(true);
        expect(proposals).toHaveLength(1);
        expect(proposals[0].confidence).toBe('Low');
        expect(vetoMock.recordVeto).not.toHaveBeenCalled();
    });

    it('a candidate below the raised floor changes nothing', async () => {
        await seedSkill('btc-short-thin.md', 'candidate', 4, 5); // sample 9
        const { proposals } = present();
        expect(proposals[0].confidence).toBe('High');
    });
});

describe('a fired code-checked predicate caps the recorded probability', () => {
    it('folds the ceiling into the ONE stamp and the analysis names it', async () => {
        predicateMock.evaluateSkillPredicates.mockResolvedValue({
            fired: [{ name: 'BTC short exhaustion', kind: 'avoid', predicate: 'rsi > 70', timeframe: '1h' }],
            judged: 1,
            inconclusive: 0,
            note: 'CODE-CHECKED TRIGGERS',
            ceiling: 0.40,
        });
        const { proposals, gates } = present();

        await vi.waitFor(() => expect(gates).toHaveLength(1));
        expect(gates[0].skillCeiling).toBe(0.40);
        expect(gates[0].skillNote).toMatch(/BTC short exhaustion/);

        const stamped = buildProposedTradeAnalysis({ ...proposals[0], gate: gates[0] });
        expect(stamped.probability).toBe(40);
        expect(stamped.confidence).toBe('Low');
        expect(stamped.validationWarnings?.join(' ')).toMatch(/Code-checked skill ceiling 40%/);
        expect(stamped.validationWarnings?.join(' ')).toMatch(/BTC short exhaustion/);
    });

    it('takes the LOWER of the market gate and the skill ceiling', async () => {
        gateMock.fetchGateInputData.mockResolvedValue({ any: 'input' });
        gateMock.runProgrammaticGate.mockReturnValue({ confidenceCap: 0.90, pass: true, warnings: [], reason: 'ok' });
        predicateMock.evaluateSkillPredicates.mockResolvedValue({
            fired: [{ name: 'BTC short exhaustion', kind: 'avoid', predicate: 'rsi > 70', timeframe: '1h' }],
            judged: 1, inconclusive: 0, note: '', ceiling: 0.40,
        });
        const { gates } = present();
        await vi.waitFor(() => expect(gates).toHaveLength(1));
        expect(gates[0].status).toBe('evaluated');
        expect(gates[0].confidenceCap).toBe(0.40);
        expect(gates[0].skillCeiling).toBe(0.40);
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Decision-bias closure (Phase 6):
 *   1. PROVIDER FITNESS — rolling win rate, cold streak and preflight pass
 *      rate combine into one 0..1 score; thin evidence stays neutral (0.5);
 *      auto-roster selection drops non-neutral underperformers but never
 *      empties the roster.
 *   2. CROSS-REGIME STAMP — counted evidence earned OUTSIDE a skill's scope
 *      regime is recorded in crossRegimeIds (parse + serialize round-trip).
 *   3. ENFORCEMENT TELEMETRY — code-side skill enforcement (veto / size-down
 *      / repeat warning) records a skills/<file> injection so attribution
 *      sees the decision; veto-ledger entries record veto/<file> injections.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

// Controllable rolling-window stats per provider.
const perfStats = new Map<string, {
    last20WinRate: number;
    last20Total: number;
    last20Wins: number;
    coldStreakCount: number;
    hotStreakCount: number;
    isDemoted: boolean;
}>();
vi.mock('../services/backtesting/ModelPerformanceService', () => ({
    getRollingWindowStats: vi.fn((provider: string) => perfStats.get(provider) ?? {
        last20WinRate: 0,
        last20Total: 0,
        last20Wins: 0,
        coldStreakCount: 0,
        hotStreakCount: 0,
        isDemoted: false,
    }),
}));

vi.mock('../services/ui/PriceAlertService', () => ({
    PriceAlertService: {
        normalizeSymbol: vi.fn((s: string) => s.toUpperCase().replace(/USDT?$/, '')),
        trackSymbol: vi.fn(),
        untrackSymbol: vi.fn(),
        getCurrentPrice: vi.fn(() => null),
        acquireMonitor: vi.fn(() => () => {}),
        subscribePrices: vi.fn(() => () => {}),
    },
}));

// No memory model configured — refinement LLM phases are skipped.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import {
    getProviderFitness,
    getPreflightPassRate,
    recordPreflightResult,
    filterUnfitProviders,
    sortByFitness,
    MIN_FITNESS_SAMPLES,
    FITNESS_FILTER_THRESHOLD,
} from '../services/learning/providerFitness';
import {
    applySkillEvidence,
    applyNotebookSkillsToAnalysis,
    parseSkillMarkdown,
    serializeSkill,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { getRecentMemoryInjections } from '../services/learning/MemoryInjectionService';
import { VetoLedgerService } from '../services/ui/VetoLedgerService';
import { TradeOutcome } from '../types/enums';
import type { LoggedTrade, TradeAnalysis } from '../types';

const USER = 'phase6-user';

/** Let fire-and-forget promise chains settle. */
const flush = async (): Promise<void> => {
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
};

const setPerf = (provider: string, winRate: number, total: number, coldStreak = 0): void => {
    perfStats.set(provider, {
        last20WinRate: winRate * 100,
        last20Total: total,
        last20Wins: Math.round(winRate * total),
        coldStreakCount: coldStreak,
        hotStreakCount: 0,
        isDemoted: coldStreak >= 3,
    });
};

beforeEach(() => {
    store = {};
    perfStats.clear();
});

describe('provider fitness', () => {
    it('scores neutral 0.5 under the minimum sample count', async () => {
        setPerf('thin', 0.0, MIN_FITNESS_SAMPLES - 1);
        const f = await getProviderFitness('thin', USER);
        expect(f.neutral).toBe(true);
        expect(f.score).toBe(0.5);

        perfStats.delete('thin'); // no data at all is also neutral
        const g = await getProviderFitness('thin', USER);
        expect(g.neutral).toBe(true);
        expect(g.score).toBe(0.5);
    });

    it('blends win rate and preflight quality (0.7 / 0.3)', async () => {
        setPerf('strong', 0.8, 10);
        const noPreflight = await getProviderFitness('strong', USER);
        // 0.7 * 0.8 + 0.3 * 0.5 (neutral process) = 0.71
        expect(noPreflight.score).toBeCloseTo(0.71, 5);
        expect(noPreflight.neutral).toBe(false);

        await recordPreflightResult(USER, 'strong', true);
        await recordPreflightResult(USER, 'strong', true);
        const withPreflight = await getProviderFitness('strong', USER);
        // 0.7 * 0.8 + 0.3 * 1.0 = 0.86
        expect(withPreflight.score).toBeCloseTo(0.86, 5);
        expect(withPreflight.components.preflightPassRate).toBe(1);
    });

    it('penalizes cold streaks on the outcome component', async () => {
        setPerf('cold', 0.4, 10, 3);
        await recordPreflightResult(USER, 'cold', false);
        const f = await getProviderFitness('cold', USER);
        // outcome = 0.4 - 3*0.05 = 0.25; score = 0.7*0.25 + 0.3*0 = 0.175
        expect(f.score).toBeCloseTo(0.175, 5);
        expect(f.score).toBeLessThanOrEqual(FITNESS_FILTER_THRESHOLD);
    });

    it('records and reads preflight pass rates per provider', async () => {
        await recordPreflightResult(USER, 'a', true);
        await recordPreflightResult(USER, 'a', false);
        await recordPreflightResult(USER, 'b', true);
        const a = await getPreflightPassRate(USER, 'a');
        expect(a.total).toBe(2);
        expect(a.rate).toBeCloseTo(0.5, 5);
        const b = await getPreflightPassRate(USER, 'b');
        expect(b.rate).toBe(1);
        const unknown = await getPreflightPassRate(USER, 'ghost');
        expect(unknown.rate).toBeNull();
        expect(unknown.total).toBe(0);
    });

    it('filterUnfitProviders drops proven underperformers but never empties the roster', async () => {
        setPerf('fit', 0.8, 10);
        setPerf('unfit', 0.2, 10, 3);
        setPerf('thin', 0.0, 2);
        const providers = [{ id: 'fit' }, { id: 'unfit' }, { id: 'thin' }];
        const { kept, dropped } = await filterUnfitProviders(providers, USER);
        expect(kept.map(p => p.id)).toEqual(['fit', 'thin']);
        expect(dropped.map(p => p.id)).toEqual(['unfit']);

        // Everyone unfit → fail-open keeps the original order.
        setPerf('fit', 0.1, 10, 4);
        setPerf('thin', 0.1, 10, 4);
        const all = await filterUnfitProviders(providers, USER);
        expect(all.kept.map(p => p.id)).toEqual(['fit', 'unfit', 'thin']);
        expect(all.dropped).toEqual([]);
    });

    it('sortByFitness orders fittest first', async () => {
        setPerf('mid', 0.55, 10);
        setPerf('top', 0.9, 10);
        setPerf('bad', 0.2, 10, 3);
        const sorted = await sortByFitness([{ id: 'bad' }, { id: 'mid' }, { id: 'top' }], USER);
        expect(sorted.map(p => p.id)).toEqual(['top', 'mid', 'bad']);
    });
});

describe('cross-regime evidence stamp', () => {
    const makeTrade = (id: string, outcome: TradeOutcome, regime?: LoggedTrade['marketRegime']): LoggedTrade => ({
        id,
        analysis: {
            coinName: 'BTCUSDT',
            direction: 'Short',
            detectedPatternFamily: 'Family A',
        } as unknown as TradeAnalysis,
        outcome,
        marketRegime: regime,
        timestamp: new Date(Date.now() - 5000).toISOString(),
    });

    const seedSkill = async (name: string, extra: string): Promise<string> => {
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const file = await createMemoryFile(skills.id, name, `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 2
losses: 2
${extra}ifCondition: BTC short setup
thenAction: skip the short
---

# Skill under test
`, USER, true);
        return file.id;
    };

    const readMeta = (fileId: string): SkillMeta =>
        parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;

    it('stamps crossRegimeIds when counted evidence comes from a foreign regime', async () => {
        const fileId = await seedSkill('btc-short-avoid.md', 'regime: trending\n');
        await applySkillEvidence(makeTrade('t-cross', TradeOutcome.WIN, 'ranging'), USER);
        const meta = readMeta(fileId);
        expect(meta.tradeIds).toContain('t-cross');
        expect(meta.crossRegimeIds).toEqual(['t-cross']);
        // The scope regime itself is never re-scoped by foreign evidence.
        expect(meta.regime).toBe('trending');
    });

    it('does not stamp when the trade regime matches the skill scope', async () => {
        const fileId = await seedSkill('btc-short-avoid.md', 'regime: trending\n');
        await applySkillEvidence(makeTrade('t-same', TradeOutcome.WIN, 'trending'), USER);
        const meta = readMeta(fileId);
        expect(meta.tradeIds).toContain('t-same');
        expect(meta.crossRegimeIds).toBeUndefined();
    });

    it('round-trips crossRegimeIds through serialize + parse', () => {
        const meta = parseSkillMarkdown(`---
status: confirmed
kind: avoid
wins: 3
losses: 1
crossRegimeIds: t1,t2,t3
---

# x
`)!;
        expect(meta.crossRegimeIds).toEqual(['t1', 't2', 't3']);
        const reserialized = parseSkillMarkdown(serializeSkill(meta, 'x'))!;
        expect(reserialized.crossRegimeIds).toEqual(['t1', 't2', 't3']);
    });
});

describe('enforcement telemetry', () => {
    const seedConfirmedAvoid = async (): Promise<void> => {
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 4
losses: 1
ifCondition: BTC short setup
thenAction: skip the short
---

# Avoid BTC short
`, USER, true);
    };

    const analysis = () => ({
        coinName: 'BTCUSDT',
        direction: 'Short' as const,
        confidence: 'High',
        probability: 70,
    });

    it('records a skills/<file> injection when enforcement vetoes the card', async () => {
        await seedConfirmedAvoid();
        const out = applyNotebookSkillsToAnalysis(analysis(), { username: USER });
        expect(out.confidence).toBe('Avoid');
        await flush();
        const recs = await getRecentMemoryInjections(USER);
        expect(recs.length).toBeGreaterThan(0);
        const rec = recs[0];
        expect(rec.stage).toBe('verdict');
        expect(rec.audience).toBe('moderator');
        expect(rec.sources.some(s => s.path === 'skills/btc-short-avoid.md' && s.kind === 'skill')).toBe(true);
    });

    it('stays silent without a username (tests and synthetic paths)', async () => {
        await seedConfirmedAvoid();
        const out = applyNotebookSkillsToAnalysis(analysis());
        expect(out.confidence).toBe('Avoid');
        await flush();
        const recs = await getRecentMemoryInjections(USER);
        expect(recs).toEqual([]);
    });

    it('veto-ledger entries record a veto/<file> injection', async () => {
        const rec = await VetoLedgerService.recordVeto({
            username: USER,
            skill: { kind: 'avoid', status: 'confirmed' } as SkillMeta,
            skillName: 'btc-short-avoid.md',
            coinName: 'BTCUSDT',
            direction: 'Short',
            entryPrice: 100,
            takeProfits: [{ price: 90 }],
            stopLoss: 105,
        });
        expect(rec).not.toBeNull();
        await flush();
        const recs = await getRecentMemoryInjections(USER);
        expect(recs.some(r =>
            r.stage === 'verdict'
            && r.audience === 'moderator'
            && r.sources.some(s => s.path === 'veto/btc-short-avoid.md' && s.kind === 'veto')
        )).toBe(true);
    });
});

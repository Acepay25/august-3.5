import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseSkillMarkdown,
    serializeSkill,
    SkillMeta,
    applySkillEvidence,
    refineSkillNow,
} from '../services/learning/SkillMemoryService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { LoggedTrade, TradeOutcome } from '../types';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

// A "ready" memory model, so the evidence path's refinement gate reaches the
// LLM phase — which we then drive through a DELAYED fake transport.
const fakeConfig = {
    id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm',
};
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => fakeConfig),
}));

let refineDelayMs = 0;
let refineResolvedAt = 0;
const quickResponseMock = vi.fn(async (_a?: unknown, _b?: unknown, _c?: unknown): Promise<string> => {
    if (refineDelayMs > 0) await new Promise(r => setTimeout(r, refineDelayMs));
    refineResolvedAt = Date.now();
    return JSON.stringify({
        name: 'Tightened BTC short guard',
        kind: 'avoid',
        when: 'BTC short in Family A without a reclaim and rising volume',
        inputs: ['price'],
        steps: ['Wait for the reclaim', 'Skip otherwise'],
        validate: 'Reclaim candle closes above the swept level',
        output: 'Skip the short',
        approval: 'Never auto-enter',
        ifCondition: 'BTC short without a 15m reclaim and rising volume',
        thenAction: 'skip the short until the reclaim candle closes',
    });
});
vi.mock('../services/providers/GenericProviderService', () => ({
    getQuickResponse: (a: unknown, b: unknown, c: unknown) => quickResponseMock(a, b, c),
}));

const USER = 'refine-lock-user';

const makeTrade = (id: string, timestamp: string, outcome: TradeOutcome = TradeOutcome.LOSS): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        strategy: 'mean reversion fade',
    } as never,
    outcome,
    timestamp,
    postMortem: '**Key Lesson:** Wait for the 15m reclaim before entering.',
} as LoggedTrade);

const day = 86_400_000;

/** Confirmed avoid at 2W/2L with a 2-loss streak; `allTrades` carries the
 *  losing history that spans >48h so the refinement gate fires on the third
 *  consecutive loss. */
const seedRefineReadySkill = async (): Promise<void> => {
    await initMemoryFiles(USER);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const meta: SkillMeta = {
        status: 'confirmed',
        kind: 'avoid',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        wins: 2,
        losses: 2,
        consecutiveLosses: 2,
        tradeIds: ['l1', 'l2'],
        ifCondition: 'BTC short in Family A',
        thenAction: 'skip the short',
        lastEvidenceAt: new Date().toISOString(),
        body: '**Procedure:** skip without a reclaim.',
    };
    await createMemoryFile(folder.id, 'refine-me.md', serializeSkill(meta, 'Avoid BTC short'), USER, true);
};

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * day).toISOString();

describe('refinement runs OUTSIDE the notebook write lock', () => {
    beforeEach(() => {
        store = {};
        quickResponseMock.mockClear();
        refineDelayMs = 0;
        refineResolvedAt = 0;
    });

    it('a concurrent notebook writer is not stalled by the in-flight LLM round-trip', async () => {
        await seedRefineReadySkill();
        refineDelayMs = 250; // fake LLM latency
        const arriving = makeTrade('l3', iso(0));
        const allTrades = [makeTrade('l1', iso(3)), makeTrade('l2', iso(2)), arriving];

        const evidence = applySkillEvidence(arriving, USER, allTrades);
        // Let the evidence pass finish and RELEASE the lock, then race an
        // ordinary notebook write against the (still pending) refinement.
        await new Promise(r => setTimeout(r, 15));
        let writerResolvedAt = 0;
        const folder = getMemoryFiles().folders.find(f => f.name === 'profile')!;
        await createMemoryFile(folder.id, 'racer.md', '# raced while refining', USER, true);
        writerResolvedAt = Date.now();

        expect(refineResolvedAt).toBe(0); // the LLM is still in flight
        await evidence;

        // The refinement DID land (shadow entered) after the lock freed up.
        expect(quickResponseMock).toHaveBeenCalledTimes(1);
        expect(refineResolvedAt).toBeGreaterThan(writerResolvedAt);
        const file = getMemoryFiles().files.find(f => f.name === 'refine-me.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        expect(meta.shadow?.ifCondition).toBe('BTC short without a 15m reclaim and rising volume');
    });

    it('refineSkillNow keeps the read-craft-locked-write split (regression pin)', async () => {
        await seedRefineReadySkill();
        refineDelayMs = 5;
        const allTrades = [makeTrade('l1', iso(3)), makeTrade('l2', iso(2))];
        const file = getMemoryFiles().files.find(f => f.name === 'refine-me.md')!;
        const ok = await refineSkillNow(file.id, allTrades, USER);
        expect(ok).toBe(true);
        const after = parseSkillMarkdown(
            getMemoryFiles().files.find(f => f.name === 'refine-me.md')!.content,
        )!;
        expect(after.shadow?.thenAction).toBe('skip the short until the reclaim candle closes');
    });
});

const baseMeta = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'avoid',
    coin: 'BTC',
    direction: 'Long',
    wins: 3,
    losses: 4,
    consecutiveLosses: 0,
    tradeIds: ['t1', 't2'],
    ifCondition: 'price is extended above the 1h 200EMA',
    thenAction: 'wait for a reclaim before entering',
    body: '**Trigger:** BTC Long\n**Procedure:** wait for reclaim',
    ...overrides,
});

describe('skill refinement evidence (previousVersion round-trip)', () => {
    it('serializes and re-parses refinedAt + previousVersion', () => {
        const meta = baseMeta({
            refinedAt: '2026-08-18T10:00:00.000Z',
            previousVersion: {
                kind: 'avoid',
                ifCondition: 'price is extended',
                thenAction: 'skip the trade',
            },
        });
        const content = serializeSkill(meta, 'Avoid BTC Long');
        expect(content).toContain('refinedAt: 2026-08-18T10:00:00.000Z');
        expect(content).toContain('previousVersion:');

        const parsed = parseSkillMarkdown(content);
        expect(parsed).not.toBeNull();
        expect(parsed?.refinedAt).toBe('2026-08-18T10:00:00.000Z');
        expect(parsed?.previousVersion?.kind).toBe('avoid');
        expect(parsed?.previousVersion?.ifCondition).toBe('price is extended');
        expect(parsed?.previousVersion?.thenAction).toBe('skip the trade');
        // Current clauses survive alongside the snapshot.
        expect(parsed?.ifCondition).toBe('price is extended above the 1h 200EMA');
        expect(parsed?.thenAction).toBe('wait for a reclaim before entering');
    });

    it('omits the fields when the skill was never refined', () => {
        const content = serializeSkill(baseMeta(), 'Avoid BTC Long');
        expect(content).not.toContain('refinedAt');
        expect(content).not.toContain('previousVersion');
        const parsed = parseSkillMarkdown(content);
        expect(parsed?.refinedAt).toBeUndefined();
        expect(parsed?.previousVersion).toBeUndefined();
    });

    it('tolerates a corrupt previousVersion JSON blob', () => {
        const content = [
            '---',
            'status: confirmed',
            'kind: avoid',
            'wins: 1',
            'losses: 1',
            'previousVersion: {not-json',
            'tradeIds: t1',
            '---',
            '',
            '# Skill',
            'body',
        ].join('\n');
        const parsed = parseSkillMarkdown(content);
        expect(parsed).not.toBeNull();
        expect(parsed?.previousVersion).toBeUndefined();
        expect(parsed?.status).toBe('confirmed');
    });
});

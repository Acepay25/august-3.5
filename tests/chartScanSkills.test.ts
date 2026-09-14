/**
 * chartScanSkills — the eighth draft source: the model reads a digest of the
 * FULL candle history and crafts IF/THEN skills that must pass the same
 * shared gates as every other learner before they queue. The transport, the
 * kline source and the worth gate are mocked; the deterministic tier, the
 * draft store and the historical detector (scanHistorySetups) are real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(),
}));
vi.mock('../services/providers/GenericProviderService', () => ({
    getQuickResponse: vi.fn(),
    sendChatRequest: vi.fn(),
}));
vi.mock('../services/learning/skillWorthGate', () => ({
    evaluateSkillWorth: vi.fn(),
    validateCraftedSkill: vi.fn(() => null),
    skillClusterExists: vi.fn(() => false),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
    skillMatchesSetup: vi.fn(() => false),
    maybeMergeSkill: vi.fn(async () => true),
}));
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));
vi.mock('../services/learning/skillSupervisor', () => ({
    getSessionModel: vi.fn(() => null),
}));

import { fetchKlines } from '../services/analysis/KlineService';
import { getQuickResponse } from '../services/providers/GenericProviderService';
import { evaluateSkillWorth } from '../services/learning/skillWorthGate';
import { maybeMergeSkill, listSkills } from '../services/learning/SkillMemoryService';
import { scanChartForSkills, scanChartAcrossIntervals, buildChartDigest } from '../services/learning/chartScanSkills';
import { listSkillDrafts } from '../utils/skillDrafts';
import type { ProviderConfig } from '../types/provider';

const USER = 'alice';
const cfg = {
    id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm',
} as ProviderConfig;

const bar = (t: number, open: number, high: number, low: number, close: number) =>
    ({ time: t * 900_000, open, high, low, close, volume: 10 });

/** Six pin-bar cycles where the tape rewards the pin (1.5×ATR first-touch
 *  win before the 12-bar horizon) — gives the evidence tier real hits. */
interface TestBar { time: number; open: number; high: number; low: number; close: number; volume: number }
const tape = (): TestBar[] => {
    const c: TestBar[] = [];
    for (let i = 0; i < 6; i += 1) c.push(bar(i, 100, 101, 99, 100));
    for (let k = 0; k < 6; k += 1) {
        const t0 = c.length;
        c.push(
            bar(t0, 100, 101, 99, 100),
            bar(t0 + 1, 100, 101, 99, 100),
            bar(t0 + 2, 100, 101, 99, 100),
            bar(t0 + 3, 100, 101, 99, 100),
            bar(t0 + 4, 99.2, 99.4, 95, 99.3),
            bar(t0 + 5, 100, 101, 99, 100),
            bar(t0 + 6, 100, 101, 99, 100),
            bar(t0 + 7, 99.5, 102, 99.5, 101.5),
            bar(t0 + 8, 101.5, 104.5, 101, 104),
        );
    }
    return c;
};

const pinCraft = (name = 'BTC 15m: buy the pin-bar reclaim') => ({
    name,
    kind: 'repeat',
    description: 'Pin bar rejection at the local low on BTC 15m — reach for it when a wick tags the swing low',
    when: 'A bullish pin bar prints at the local low and price reclaims it (scan: repeated hits, strong first-touch win rate)',
    inputs: ['15m candles', 'swing lows'],
    steps: ['Wait for the pin close', 'Enter on the reclaim'],
    validate: 'The reclaim candle closes back above the pin body',
    output: 'A long entry with a wick-below stop and 1.5×ATR target',
    approval: 'Pending human approval in the Inbox before it can ever be applied',
    ifCondition: 'A bullish pin bar forms at the local low and the next close reclaims the wick',
    thenAction: 'Go long on the reclaim close, stop below the pin low, target 1.5x ATR',
});

beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchKlines).mockReset();
    vi.mocked(getQuickResponse).mockReset();
    vi.mocked(evaluateSkillWorth).mockReset();
    vi.mocked(evaluateSkillWorth).mockResolvedValue(null as never);
    vi.mocked(maybeMergeSkill).mockClear();
    vi.mocked(listSkills).mockReturnValue([]);
    vi.mocked(fetchKlines).mockResolvedValue(tape());
});

const run = () => scanChartForSkills({ symbol: 'BTCUSDT', interval: '15m', username: USER, config: cfg });

describe('scanChartForSkills', () => {
    it('pulls the full chart history (1000 bars) and feeds the digest to the model', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([pinCraft()]));
        const r = await run();
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '15m', 1000);
        const [configArg, userPrompt, systemPrompt] = vi.mocked(getQuickResponse).mock.calls[0];
        expect(configArg).toBe(cfg);
        expect(systemPrompt).toContain('trading-pattern researcher');
        expect(userPrompt).toContain('SETUP BEHAVIOR ACROSS ALL HISTORY');
        expect(userPrompt).toContain('Bullish pin bar at the local low');
        expect(userPrompt).toContain('LAST 40 CANDLES');
        expect(r.error).toBeUndefined();
    });

    it('evidence-scores the craft and queues a prediction-bearing draft with a scan: tradeId', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([pinCraft()]));
        const r = await run();
        expect(r.candidates).toBe(1);
        expect(r.queued).toBe(1);
        expect(r.outcomes[0]).toMatchObject({ action: 'queued' });
        expect(r.outcomes[0].detail).toContain('scored hit');
        const drafts = listSkillDrafts(USER);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].tradeId).toBe('scan:BTC:15m:btc-15m-buy-the-pin-bar-reclaim');
        expect(drafts[0].coin).toBe('BTC');
        expect(drafts[0].crafted.prediction).toBeTruthy();
        // Provenance stamp: the scan records the timeframe it was earned on.
        expect(drafts[0].crafted.timeframe).toBe('15m');
        expect(drafts[0].crafted.source).toBe('scan');
        expect(r.receipt).toContain('CHART SKILL SCAN BTCUSDT 15m');
        expect(r.receipt).toContain('QUEUED');
    });

    it('routes a merge verdict to the existing skill instead of queueing a twin', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([pinCraft()]));
        vi.mocked(evaluateSkillWorth).mockResolvedValue({
            verdict: 'merge', mergeTarget: 'btc-pin-reclaim', reason: 'same trigger',
        } as never);
        const r = await run();
        expect(r.outcomes[0].action).toBe('merged');
        expect(maybeMergeSkill).toHaveBeenCalled();
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('skips a second candidate whose trigger is already pending', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([
            pinCraft('BTC 15m: buy the pin-bar reclaim'),
            pinCraft('BTC 15m: pin-bar reclaim, rephrased'),
        ]));
        const r = await run();
        expect(r.candidates).toBe(2);
        expect(r.queued).toBe(1);
        expect(r.outcomes[1].action).toBe('skipped');
        expect(r.outcomes[1].detail).toContain('identical draft');
    });

    it('falls back to the deterministic tier when the worth gate is silent (no provider verdict)', async () => {
        // evaluateSkillWorth → null (default mock) IS the "silent gate" path:
        // the evidence tier must still land the draft via the deterministic
        // bar rather than dropping it.
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([pinCraft()]));
        const r = await run();
        expect(r.queued).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.prediction).toBeTruthy();
    });

    it('an unmatchable craft (no detector hit) still clears the deterministic bar', async () => {
        const foreign = {
            ...pinCraft('BTC 15m: fade the 3am funding wick'),
            description: 'Reach for it when funding and a candle clock wick coincide — nothing else covers it',
            when: 'Funding flips positive right as a 03:00 UTC wick prints — a behavior no detector in the digest tracks',
            ifCondition: 'A wick prints exactly at 03:00 UTC while funding flips positive',
            thenAction: 'Fade the first green close after the wick with a tight stop above it',
        };
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([foreign]));
        const r = await run();
        expect(r.queued).toBe(1);
        expect(r.outcomes[0].detail).toContain('no matching detector hits');
    });

    it('returns a clean zero-queue receipt when the model answers with junk', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue('I could not find any patterns today!');
        const r = await run();
        expect(r.candidates).toBe(0);
        expect(r.queued).toBe(0);
        expect(r.receipt).toContain('drafted no skill');
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('surfaces DATA_UNAVAILABLE when the kline source returns a stub', async () => {
        vi.mocked(fetchKlines).mockResolvedValue([] as never);
        const r = await run();
        expect(r.error ?? r.receipt).toContain('DATA_UNAVAILABLE');
        expect(r.candidates).toBe(0);
        expect(getQuickResponse).not.toHaveBeenCalled();
    });

    it('refuses to craft without a model, and does not hit the transport', async () => {
        const r = await scanChartForSkills({ symbol: 'BTCUSDT', interval: '15m', username: USER });
        expect(r.candidates).toBe(0);
        expect(r.receipt).toContain('no ready AI provider');
        expect(getQuickResponse).not.toHaveBeenCalled();
    });

    it('honors the max_skills cap on the parsed candidates', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([
            pinCraft('BTC 15m: buy the pin-bar reclaim'),
            { ...pinCraft('BTC 15m: dodge the failed-break trap'), ifCondition: 'A break above the 30-bar high fails and closes back inside within a bar', thenAction: 'Skip longs and fade the re-entry with the prior high as invalidation' },
        ]));
        const r = await scanChartForSkills({ symbol: 'BTCUSDT', interval: '15m', username: USER, config: cfg, maxSkills: 1 });
        expect(r.candidates).toBe(1);
    });
});

describe('scanChartAcrossIntervals', () => {
    it('scans each timeframe and merges, tagging drafts with their interval', async () => {
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify([pinCraft()]));
        const r = await scanChartAcrossIntervals({
            symbol: 'BTCUSDT', intervals: ['15m', '1h'], username: USER, config: cfg,
        });
        // One model call per interval, each fetching that interval's history.
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '15m', 1000);
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '1h', 1000);
        expect(r.interval).toBe('15m,1h');
        expect(r.candidates).toBeGreaterThanOrEqual(2);
        expect(r.queued).toBeGreaterThanOrEqual(1);
        // The merged outcomes carry their interval in the name.
        expect(r.outcomes.some(o => /\(15m\)$/.test(o.name) || /\(1h\)$/.test(o.name))).toBe(true);
        expect(r.receipt).toContain('across 15m, 1h');
    });

    it('empty interval list is a clean no-op, not a crash', async () => {
        const r = await scanChartAcrossIntervals({
            symbol: 'BTCUSDT', intervals: [], username: USER, config: cfg,
        });
        expect(r.error).toContain('no intervals');
        expect(getQuickResponse).not.toHaveBeenCalled();
    });
});

describe('buildChartDigest', () => {
    it('carries the tape story: regime, swings, setup behavior and the tail', () => {
        const { digest, stats } = buildChartDigest(tape(), 'BTCUSDT', '15m');
        expect(digest).toContain('15m candles of BTCUSDT');
        expect(digest).toContain('REGIME segments');
        expect(digest).toContain('SWING PIVOTS');
        expect(digest).toContain('RSI(14)');
        expect(digest).toContain('SETUP BEHAVIOR ACROSS ALL HISTORY');
        expect(digest).toContain('LAST 40 CANDLES');
        const ids = stats.map(s => s.id);
        expect(ids).toContain('pin-bar-buy');
    });
});

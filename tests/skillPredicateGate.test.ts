import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gate decides whether a skill's own trigger is LIVE on the current bar.
// Its two failure modes matter more than its happy path: a fetch that dies
// must never read as "conditions clear", and a coin mismatch must never judge
// one market's tape for another.

vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(),
}));

import { fetchKlines } from '../services/analysis/KlineService';
import {
    evaluateSkillPredicates,
    predicateBearingSkills,
    AVOID_PREDICATE_CEILING,
} from '../services/learning/skillPredicateGate';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

const fetchMock = vi.mocked(fetchKlines);

const skill = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'avoid',
    wins: 4,
    losses: 1,
    consecutiveLosses: 0,
    tradeIds: [],
    body: 'x',
    ifCondition: 'some prose trigger',
    ...over,
} as SkillMeta);

/** 60 steadily rising bars: close > sma20 and rsi14 > 50 both hold at the end. */
const rising = () => Array.from({ length: 60 }, (_, i) => ({
    time: i * 3_600_000, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000,
}));

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(rising() as never);
});

describe('predicateBearingSkills', () => {
    it('keeps only skills that carry a predicate, and honors coin scope', () => {
        const pool = [
            skill({ coin: 'BTC', predicate: 'rsi14 > 70' }),
            skill({ coin: 'ETH', predicate: 'rsi14 > 70' }),
            skill({ coin: 'BTCUSDT' }),                      // no predicate
            skill({ coin: undefined, predicate: 'close > 1' }), // coin-less: applies
        ];
        const kept = predicateBearingSkills(pool, 'BTCUSDT');
        expect(kept).toHaveLength(2);
        expect(kept.some(s => s.coin === 'ETH')).toBe(false);
    });

    it('treats a whitespace-only predicate as absent', () => {
        expect(predicateBearingSkills([skill({ predicate: '   ' })], 'BTC')).toEqual([]);
    });
});

describe('evaluateSkillPredicates', () => {
    it('says nothing and fetches nothing when no skill carries a predicate', async () => {
        const res = await evaluateSkillPredicates({ coin: 'BTCUSDT', skills: [skill()] });
        expect(res).toEqual({ fired: [], judged: 0, inconclusive: 0, note: '' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a live AVOID trigger and implies the ceiling', async () => {
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', kind: 'avoid', predicate: 'close > sma20 and rsi14 > 50' })],
        });
        expect(res.fired).toHaveLength(1);
        expect(res.ceiling).toBe(AVOID_PREDICATE_CEILING);
        expect(res.note).toContain('AVOID condition is LIVE');
        expect(res.note).toContain(`${Math.round(AVOID_PREDICATE_CEILING * 100)}%`);
    });

    it('leaves the ceiling undefined when only a repeat trigger is live', async () => {
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', kind: 'repeat', predicate: 'close > sma20' })],
        });
        expect(res.fired).toHaveLength(1);
        expect(res.ceiling).toBeUndefined();
        expect(res.note).toContain('repeat condition is LIVE');
    });

    it('does not fire on a condition the tape does not satisfy', async () => {
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', predicate: 'close < sma20' })],
        });
        expect(res.fired).toEqual([]);
        expect(res.ceiling).toBeUndefined();
        expect(res.note).toBe('');
        expect(res.judged).toBe(1);
        expect(res.inconclusive).toBe(0);
    });

    it('a failed fetch is inconclusive, never "conditions clear"', async () => {
        fetchMock.mockRejectedValue(new Error('rate limited'));
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', predicate: 'close > sma20' })],
        });
        expect(res.judged).toBe(1);
        expect(res.inconclusive).toBe(1);
        expect(res.fired).toEqual([]);
        expect(res.ceiling).toBeUndefined();
        expect(res.note).toBe('');
    });

    it('judges each skill on the timeframe it was earned on', async () => {
        await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [
                skill({ coin: 'BTC', predicate: 'close > sma20', timeframe: '15m' }),
                skill({ coin: 'BTC', predicate: 'rsi14 > 50', timeframe: '4h' }),
                skill({ coin: 'BTC', predicate: 'volume > 1' }),
            ],
        });
        const timespanArgs = fetchMock.mock.calls.map(c => `${c[0]} ${c[1]}`).sort();
        expect(timespanArgs).toEqual(['BTCUSDT 15m', 'BTCUSDT 1h', 'BTCUSDT 4h']);
    });

    it('counts an unwarmed indicator as inconclusive instead of quiet', async () => {
        // Only 10 bars: rsi14 (14-period) has no value, so nothing is provable.
        fetchMock.mockResolvedValue(rising().slice(0, 10) as never);
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', predicate: 'rsi14 > 50' })],
        });
        expect(res.fired).toEqual([]);
        expect(res.inconclusive).toBe(1);
    });
});

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
    MAX_NOTE_LINES,
} from '../services/learning/skillPredicateGate';
import type { SkillMeta } from '../services/learning/SkillMemoryService';
import { shouldSkillHoldout } from '../utils/skillHoldout';

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

/**
 * The gate CLAMPS a live verdict, so the question that matters is which skills
 * are allowed to reach it. It must not act on anything retrieval would have
 * withheld from the model.
 */
describe('predicate gate — clamp eligibility', () => {
    const firing = { predicate: 'close > sma20' };

    it('drops retired and superseded skills', () => {
        const kept = predicateBearingSkills([
            skill({ ...firing, status: 'retired' }),
            skill({ ...firing, supersededBy: 'newer-skill' }),
            skill(firing),
        ], 'BTC');
        expect(kept).toHaveLength(1);
    });

    it('holds a candidate AVOID back until it earns a record, but never a repeat', () => {
        const thin = skill({ ...firing, status: 'candidate', wins: 0, losses: 1 });
        const proven = skill({ ...firing, status: 'candidate', wins: 1, losses: 1 });
        const freshRepeat = skill({ ...firing, kind: 'repeat', status: 'candidate', wins: 0, losses: 0 });
        expect(predicateBearingSkills([thin], 'BTC')).toHaveLength(0);
        expect(predicateBearingSkills([proven], 'BTC')).toHaveLength(1);
        expect(predicateBearingSkills([freshRepeat], 'BTC')).toHaveLength(1);
    });

    it('fails closed on direction — opposite side out, and an unknown side keeps one-sided skills out too', () => {
        const longOnly = [skill({ ...firing, direction: 'Long' })];
        expect(predicateBearingSkills(longOnly, 'BTC', 'Short')).toHaveLength(0);
        expect(predicateBearingSkills(longOnly, 'BTC', 'Long')).toHaveLength(1);
        expect(predicateBearingSkills(longOnly, 'BTC')).toHaveLength(0);
        // An unscoped skill still applies everywhere.
        expect(predicateBearingSkills([skill(firing)], 'BTC')).toHaveLength(1);
    });

    it('a retired avoid skill cannot cap a live verdict', async () => {
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', kind: 'avoid', status: 'retired', predicate: 'close > sma20' })],
        });
        expect(res.fired).toEqual([]);
        expect(res.ceiling).toBeUndefined();
        expect(res.note).toBe('');
        // Never entered the pool — so it is not even owed an inconclusive.
        expect(res.judged).toBe(0);
    });

    it('will not judge a bar that had not closed at the replay cutoff', async () => {
        // The cutoff lands inside the first three bars, so there is no series
        // long enough to judge — and the honest answer is inconclusive, never
        // "conditions clear".
        const res = await evaluateSkillPredicates({
            coin: 'BTCUSDT',
            skills: [skill({ coin: 'BTC', predicate: 'close > sma20' })],
            asOfMs: 2 * 3_600_000,
        });
        expect(res.fired).toEqual([]);
        expect(res.inconclusive).toBe(1);
        expect(res.ceiling).toBeUndefined();
    });

    it('renders avoid triggers first and caps the block, naming what it hid', async () => {
        const many = [
            ...Array.from({ length: 7 }, (_, i) => skill({
                kind: 'repeat', coin: 'BTC', predicate: `close > sma20 and close > ${100 + i}`,
            })),
            skill({ kind: 'avoid', coin: 'BTC', predicate: 'close > sma20' }),
        ];
        const res = await evaluateSkillPredicates({ coin: 'BTCUSDT', skills: many });
        expect(res.fired).toHaveLength(8);
        const lines = res.note.split('\n');
        expect(lines.filter(l => l.startsWith('- '))).toHaveLength(MAX_NOTE_LINES);
        expect(lines[1]).toContain('avoid');
        expect(res.note).toContain('2 more fired');
    });
    /** A ~10% slice of run ids are holdout controls. Both sides are DERIVED
     *  here so the test cannot quietly stop being an example of the hash. */
    const findRunId = (wantHoldout: boolean): string => {
        for (let i = 0; i < 500; i++) {
            const id = `run-${i}`;
            if (shouldSkillHoldout(id) === wantHoldout) return id;
        }
        throw new Error(`no run id found for holdout=${String(wantHoldout)}`);
    };

    it('stands down completely on an ε-holdout control run', async () => {
        const skills = [skill({ coin: 'BTC', kind: 'avoid', predicate: 'close > sma20' })];
        const control = await evaluateSkillPredicates({ coin: 'BTCUSDT', skills, runId: findRunId(true) });
        expect(control).toEqual({ fired: [], judged: 0, inconclusive: 0, note: '' });
        expect(fetchMock).not.toHaveBeenCalled();
        // The same skills DO clamp a treated run — proof the call below is the
        // only difference, not an empty fixture.
        const treated = await evaluateSkillPredicates({ coin: 'BTCUSDT', skills, runId: findRunId(false) });
        expect(treated.ceiling).toBe(AVOID_PREDICATE_CEILING);
    });
});

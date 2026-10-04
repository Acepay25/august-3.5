import { describe, it, expect } from 'vitest';

// HTF bar-state engine — every case below is a two-candle window whose answer
// is derivable by eye from the previous bar's high/low. Values are pinned, not
// finiteness: a state machine that returns a plausible-looking code for the
// wrong reason passes a "never n/a" test and misleads every seat that reads it.

import {
    classifyBar,
    formatHtfPhaseBlock,
    htfPhaseAgreement,
    HTF_PHASE_LABELS,
    phaseDirection,
    type HtfPhaseEntry,
} from '../utils/htfPhase';
import { Kline } from '../types';

const bar = (i: number, o: Partial<Kline> = {}): Kline => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 95, high: 96, low: 94, close: 95, volume: 100,
    ...o,
});

/** Previous CLOSED bar H=100 L=90, then the bar being classified. */
const window = (live: Partial<Kline>): Kline[] => [
    bar(0, { open: 92, high: 100, low: 90, close: 98 }),
    bar(1, live),
];

describe('classifyBar — the nine states', () => {
    it('takes the high and closes above it → Expansion ▲', () => {
        const p = classifyBar(window({ high: 105, low: 92, close: 101 }));
        expect(p).toEqual({ code: 1, label: 'Expansion ▲', dir: 1 });
    });

    it('takes the high but closes back inside it → High swept ▼', () => {
        const p = classifyBar(window({ high: 105, low: 92, close: 98 }));
        expect(p).toEqual({ code: 5, label: 'High swept ▼', dir: -1 });
    });

    it('takes the low and closes below it → Expansion ▼', () => {
        const p = classifyBar(window({ high: 95, low: 85, close: 85 }));
        expect(p).toEqual({ code: 4, label: 'Expansion ▼', dir: -1 });
    });

    it('takes the low but closes back inside it → Low swept ▲', () => {
        const p = classifyBar(window({ high: 95, low: 85, close: 92 }));
        expect(p).toEqual({ code: 2, label: 'Low swept ▲', dir: 1 });
    });

    it('takes both extremes and holds the top → Outside ▲', () => {
        const p = classifyBar(window({ high: 105, low: 85, close: 101 }));
        expect(p).toEqual({ code: 3, label: 'Outside ▲', dir: 1 });
    });

    it('takes both extremes and holds the bottom → Outside ▼', () => {
        const p = classifyBar(window({ high: 105, low: 85, close: 85 }));
        expect(p).toEqual({ code: 6, label: 'Outside ▼', dir: -1 });
    });

    it('takes both extremes and closes in the middle → Outside ·', () => {
        const p = classifyBar(window({ high: 105, low: 85, close: 95 }));
        expect(p).toEqual({ code: 8, label: 'Outside ·', dir: 0 });
    });

    it('takes neither extreme → Inside ·', () => {
        const p = classifyBar(window({ high: 98, low: 92, close: 94 }));
        expect(p).toEqual({ code: 7, label: 'Inside ·', dir: 0 });
    });

    it('ties are not takes: equal high and equal low read Inside ·, not Outside', () => {
        // The strict inequality on each side is the whole difference between
        // "the market revisitied the level" and "the market took liquidity".
        const p = classifyBar(window({ high: 100, low: 90, close: 100 }));
        expect(p.code).toBe(7);
        expect(p.dir).toBe(0);
    });
});

describe('classifyBar — the acceptance buffer', () => {
    it('buffer 0 clears the extreme by any margin', () => {
        expect(classifyBar(window({ high: 105, low: 85, close: 100.5 }), { bufferPct: 0 }).code).toBe(3);
    });

    it('a 1% buffer refuses to call a 0.5% clearance acceptance', () => {
        // prev.high 100, px 100.5 → buf = 1% of 100.5 = 1.005, so acceptance
        // needs px > 101.005. It is not there: the bar still took both extremes
        // but neither side was ACCEPTED.
        const p = classifyBar(window({ high: 105, low: 85, close: 100.5 }), { bufferPct: 1 });
        expect(p.code).toBe(8);
        expect(p.dir).toBe(0);
    });

    it('the same price with a buffer wide enough to cover it drops to the neutral state', () => {
        // buf is a percent OF PRICE, so at px 103 a 2% buffer is 2.06 and the
        // 100 + 2.06 = 102.06 acceptance line is still cleared. It takes more
        // than 3% here to refuse the bar.
        expect(classifyBar(window({ high: 105, low: 85, close: 103 }), { bufferPct: 2 }).code).toBe(3);
        expect(classifyBar(window({ high: 105, low: 85, close: 103 }), { bufferPct: 4 }).code).toBe(8);
        expect(classifyBar(window({ high: 105, low: 85, close: 103 }), { bufferPct: 0.5 }).code).toBe(3);
    });
});

describe('classifyBar — totality', () => {
    it('empty, single-bar and flat windows never invent a state', () => {
        expect(classifyBar([]).code).toBe(9);
        expect(classifyBar([bar(0)]).code).toBe(9);
        expect(classifyBar(undefined as unknown as Kline[]).code).toBe(9);
        // A truly flat market is INSIDE, which is a real reading — not n/a.
        expect(classifyBar(window({ high: 96, low: 94, close: 95 }).slice(0, 2)).code).toBe(7);
    });

    it('non-finite extremes read n/a instead of producing a direction', () => {
        expect(classifyBar(window({ high: NaN, low: 92, close: 98 })).code).toBe(9);
        expect(classifyBar(window({ high: 105, low: Infinity, close: 98 })).code).toBe(9);
    });

    it('an unusable live price falls back to the forming close, and a hopeless window is n/a', () => {
        expect(classifyBar(window({ high: 105, low: 85, close: 101 }), { price: 0 }).code).toBe(3);
        expect(classifyBar(window({ high: 105, low: 85, close: NaN }), { price: -1 }).code).toBe(9);
    });

    it('every code has a label and a consistent direction', () => {
        for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
            expect(typeof HTF_PHASE_LABELS[code]).toBe('string');
            expect(phaseDirection(code)).toBe(code <= 3 && code >= 1 ? 1 : code <= 6 ? -1 : 0);
        }
    });
});

/** Build a frame from a previous bar + a live bar, so each row is hand-readable. */
const frame = (
    timeframe: string,
    prev: [number, number],
    live: [number, number, number],
    weight?: number,
): HtfPhaseEntry => ({
    timeframe,
    bars: [
        bar(0, { high: prev[0], low: prev[1], close: 95 }),
        bar(1, { high: live[0], low: live[1], close: live[2] }),
    ],
    ...(weight === undefined ? {} : { weight }),
});

// Reused shorthands: expanding up, expanding down, doing nothing.
const UP: [number, number, number] = [105, 92, 101];
const DOWN: [number, number, number] = [95, 85, 85];
const INSIDE: [number, number, number] = [98, 92, 94];

describe('htfPhaseAgreement — the weighting carries the answer', () => {
    it('two bullish frames and one inside frame weight to 3/6 with a bullish net', () => {
        const r = htfPhaseAgreement([
            frame('15m', [100, 90], UP),
            frame('1h', [100, 90], UP),
            frame('4h', [100, 90], INSIDE),
        ]);
        expect(r.score).toBe(1 * 1 + 2 * 1 + 3 * 0);
        expect(r.weightSum).toBe(6);
        expect(r.agreementPct).toBeCloseTo(50, 10);
        expect(r.bias).toBe('bullish');
        expect(r.bullish).toBe(2);
        expect(r.bearish).toBe(0);
        expect(r.usable).toBe(true);
    });

    it('the slowest frame outvotes two faster ones — order is load-bearing', () => {
        // 15m bearish(w1) + 1h inside(w2) + 4h bullish(w3) = -1 + 0 + 3 = +2.
        const r = htfPhaseAgreement([
            frame('15m', [100, 90], DOWN),
            frame('1h', [100, 90], INSIDE),
            frame('4h', [100, 90], UP),
        ]);
        expect(r.score).toBe(2);
        expect(r.bias).toBe('bullish');
        expect(r.bullish).toBe(1);
        expect(r.bearish).toBe(1);
        expect(r.agreementPct).toBeCloseTo(100 * 2 / 6, 10);

        // The same three states in the wrong order flip the verdict, which is
        // why the ascending-timeframe contract is documented, not assumed.
        const flipped = htfPhaseAgreement([
            frame('4h', [100, 90], UP),
            frame('1h', [100, 90], INSIDE),
            frame('15m', [100, 90], DOWN),
        ]);
        expect(flipped.score).toBe(-2);
        expect(flipped.bias).toBe('bearish');
    });

    it('a perfect tie between bull and bear is CONFLICT, not neutral', () => {
        const r = htfPhaseAgreement([
            frame('15m', [100, 90], UP, 2),
            frame('1h', [100, 90], DOWN, 2),
        ]);
        expect(r.score).toBe(0);
        expect(r.bias).toBe('conflict');
        expect(r.agreementPct).toBe(0);
    });

    it('no directional vote at all is neutral', () => {
        const r = htfPhaseAgreement([
            frame('15m', [100, 90], INSIDE),
            frame('1h', [100, 90], INSIDE),
        ]);
        expect(r.bias).toBe('neutral');
        expect(r.usable).toBe(true);
    });

    it('one answering frame is INSUFFICIENT — it is not a 100% agreement', () => {
        const short: HtfPhaseEntry = { timeframe: '1d', bars: [bar(0)] };
        const r = htfPhaseAgreement([frame('15m', [100, 90], UP), short, short]);
        expect(r.active).toBe(1);
        expect(r.usable).toBe(false);
        expect(r.bias).toBe('insufficient');
        // The n/a frames must not spend weight: only the answering frame counts.
        expect(r.weightSum).toBe(1);
        expect(r.rows[1].code).toBe(9);
    });

    it('zero frames weight to nothing and never divide by zero', () => {
        const r = htfPhaseAgreement([]);
        expect(r.weightSum).toBe(0);
        expect(r.agreementPct).toBe(null);
        expect(r.bias).toBe('insufficient');
        expect(() => htfPhaseAgreement(undefined as unknown as HtfPhaseEntry[])).not.toThrow();
    });

    it('an explicit weight of 0 mutes a frame out of both score and weight', () => {
        const r = htfPhaseAgreement([
            frame('15m', [100, 90], UP, 0),
            frame('1h', [100, 90], DOWN, 0),
        ]);
        expect(r.weightSum).toBe(0);
        expect(r.score).toBe(0);
        expect(r.bias).toBe('insufficient');
    });

    it('baseWeight shifts every positional weight', () => {
        const r = htfPhaseAgreement(
            [frame('15m', [100, 90], UP), frame('1h', [100, 90], UP)],
            { baseWeight: 3 },
        );
        expect(r.rows.map(x => x.weight)).toEqual([3, 4]);
        expect(r.score).toBe(7);
    });

    it('the buffer reaches the agreement layer', () => {
        const without = htfPhaseAgreement([frame('15m', [100, 90], [105, 85, 100.5]), frame('1h', [100, 90], INSIDE)]);
        const withBuf = htfPhaseAgreement(
            [frame('15m', [100, 90], [105, 85, 100.5]), frame('1h', [100, 90], INSIDE)],
            { bufferPct: 1 },
        );
        expect(without.rows[0].code).toBe(3);
        expect(withBuf.rows[0].code).toBe(8);
        expect(withBuf.bias).toBe('neutral');
    });
});

describe('formatHtfPhaseBlock', () => {
    it('names each frame, its state and its weight, then the net', () => {
        const line = formatHtfPhaseBlock(htfPhaseAgreement([
            frame('15m', [100, 90], UP),
            frame('1h', [100, 90], UP),
            frame('4h', [100, 90], INSIDE),
        ]));
        expect(line).toContain('15m Expansion ▲(w1)');
        expect(line).toContain('4h Inside ·(w3)');
        expect(line).toContain('net BULLISH');
        expect(line).toContain('agreement 50%');
        expect(line).toContain('2 bull vs 0 bear');
    });

    it('says BIAS UNUSABLE rather than dressing a missing frame up as neutral', () => {
        const line = formatHtfPhaseBlock(htfPhaseAgreement([{ timeframe: '1d', bars: [bar(0)] }]));
        expect(line).toContain('BIAS UNUSABLE');
        expect(line).not.toMatch(/net NEUTRAL/);
    });

    it('handles an empty frame list without throwing', () => {
        expect(formatHtfPhaseBlock(htfPhaseAgreement([]))).toBe('HTF bar state: no frames supplied.');
    });
});

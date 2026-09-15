/**
 * setupScan — the strategy-book detectors. Each test builds a small candle
 * window that should (or should not) trigger one setup, so the IF-clauses the
 * book drafts encode are actually enforced by code, not prose.
 */

import { describe, it, expect } from 'vitest';
import {
    scanSetups, scanHistorySetups, classifyGaps, rsiSeries, bollinger, type ScanCandle,
} from '../services/trade/setupScan';

const bar = (time: number, open: number, high: number, low: number, close: number): ScanCandle =>
    ({ time, open, high, low, close });

/** A flat-ish base then a breakout close above the range high with a body. */
const breakoutUp = (): ScanCandle[] => {
    const c: ScanCandle[] = [];
    for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));   // tight base
    c.push(bar(30, 100, 104, 100, 103.5));                                // breakout, full body
    return c;
};

describe('range breakout / fade', () => {
    it('flags a full-bodied close above the 30-bar high as a long breakout', () => {
        const setups = scanSetups(breakoutUp());
        const b = setups.find(s => s.id === 'range-breakout-up');
        expect(b).toBeTruthy();
        expect(b!.side).toBe('long');
        expect(b!.keywords).toContain('breakout');
    });

    it('does NOT flag a breakout on a tiny-bodied bar', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(30, 100, 104, 99.9, 100.1)); // long wick, tiny body
        expect(scanSetups(c).find(s => s.id === 'range-breakout-up')).toBeUndefined();
    });

    it('measures the breakout against the PRIOR 30-bar high — the trigger bar is excluded (item 15)', () => {
        // Base range high = 101. The breakout bar spikes to a high of 108 and
        // closes at 104. Including the current bar made hi30 = 108, so the
        // evidence claimed "close 104 beyond range high 108" — a number the
        // bar itself printed. The quoted range high must now be the PRIOR
        // one (101), which the close genuinely exceeds.
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(30, 100, 108.2, 99.9, 107.8)); // wick to 108.2, full-bodied close at 107.8
        const b = scanSetups(c).find(s => s.id === 'range-breakout-up');
        expect(b).toBeTruthy();
        const evidence = b!.evidence.join(' ');
        expect(evidence).toContain('beyond range high 101');
        expect(evidence).not.toMatch(/beyond range high 108/);
    });

    it('does NOT flag a big green bar that stays under the prior range high', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 110, 99, 100)); // prior high 110
        c.push(bar(30, 100, 109, 99.9, 108)); // wide-bodied bar INSIDE the range
        expect(scanSetups(c).find(s => s.id === 'range-breakout-up')).toBeUndefined();
    });

    it('flags a rejection wick at the range top as a short fade', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(30, 100.5, 104, 100.2, 100.6)); // long upper wick, small body at top
        expect(scanSetups(c).find(s => s.id === 'range-fade-top')).toBeTruthy();
    });
});

describe('pin bars', () => {
    it('flags a bullish pin bar (long lower wick) at the local low', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(30, 99.2, 99.4, 95, 99.3)); // lower wick ~4.3, body ~0.1
        const pin = scanSetups(c).find(s => s.id === 'pin-bar-buy');
        expect(pin).toBeTruthy();
        expect(pin!.side).toBe('long');
    });
});

describe('inside-bar resolution', () => {
    it('flags an inside bar that resolves up beyond the mother high', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(30, 99, 103, 98, 102));   // mother (wide)
        c.push(bar(31, 101, 102, 100, 101)); // inside
        c.push(bar(32, 101.5, 105, 101, 104.5)); // break close above mother
        expect(scanSetups(c).find(s => s.id === 'inside-break-up')).toBeTruthy();
    });
});

describe('gaps', () => {
    it('classifies an unfilled gap after a stretched run as exhaustion', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 10; i += 1) c.push(bar(i, 100, 101, 99, 100));
        // three rising bull bars then a gap up on a big range
        c.push(bar(10, 100, 102, 100, 101.9));
        c.push(bar(11, 101.9, 103.8, 101.8, 103.7));
        c.push(bar(12, 103.7, 105.5, 103.6, 105.4));
        c.push(bar(13, 110, 112, 109.8, 111.9)); // gap up (open 110 > prior high 105.5), big range
        const gaps = classifyGaps(c);
        const g = gaps[gaps.length - 1];
        expect(g).toBeTruthy();
        expect(g.side).toBe('up');
        expect(g.filled).toBe(false);
        expect(['exhaustion', 'runaway']).toContain(g.kind);
    });

    it('marks a gap filled once price trades back through it', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 6; i += 1) c.push(bar(i, 100, 101, 99, 100));
        c.push(bar(6, 106, 108, 105.8, 107)); // gap up
        c.push(bar(7, 106, 106.5, 100.5, 101)); // trades back through the gap origin (101)
        const g = classifyGaps(c).find(x => x.side === 'up');
        expect(g?.filled).toBe(true);
    });
});

describe('indicators', () => {
    it('rsiSeries is bounded and NaN until the seed period', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 30; i += 1) c.push(bar(i, 100 + i, 101 + i, 99 + i, 100.5 + i)); // steady up
        const r = rsiSeries(c);
        expect(Number.isNaN(r[10])).toBe(true);
        expect(r[29]).toBeGreaterThan(50); // rising closes → high RSI
        expect(r[29]).toBeLessThanOrEqual(100);
    });

    it('bollinger bands bracket the mid', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 25; i += 1) c.push(bar(i, 100, 102, 98, 100 + (i % 3)));
        const bb = bollinger(c);
        const i = c.length - 1;
        expect(bb.upper[i]).toBeGreaterThan(bb.mid[i]);
        expect(bb.lower[i]).toBeLessThan(bb.mid[i]);
    });
});

describe('scanSetups guardrails', () => {
    it('returns nothing on too few candles', () => {
        expect(scanSetups(breakoutUp().slice(0, 10))).toEqual([]);
    });
    it('returns nothing on a quiet flat tape', () => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 40; i += 1) c.push(bar(i, 100, 100.4, 99.6, 100));
        // flat, no extremes, no gaps, no divergence — expect no live setups
        expect(scanSetups(c)).toEqual([]);
    });
});

describe('scanHistorySetups — the whole-tape aggregate', () => {
    /** One cycle: a short flat base, a bullish pin bar at the lows, then a
     *  two-bar thrust up that turns the pin into a first-touch WIN
     *  (1.5×ATR target ≈ +3.1 from ~99.3 before the 12-bar horizon ends). */
    const pinWinCycle = (t0: number): ScanCandle[] => [
        bar(t0, 100, 101, 99, 100),
        bar(t0 + 1, 100, 101, 99, 100),
        bar(t0 + 2, 100, 101, 99, 100),
        bar(t0 + 3, 100, 101, 99, 100),
        bar(t0 + 4, 99.2, 99.4, 95, 99.3),   // pin: wick 4.2, body 0.1
        bar(t0 + 5, 100, 101, 99, 100),
        bar(t0 + 6, 100, 101, 99, 100),
        bar(t0 + 7, 99.5, 102, 99.5, 101.5),
        bar(t0 + 8, 101.5, 104.5, 101, 104),
    ];

    const tape = (): ScanCandle[] => {
        const c: ScanCandle[] = [];
        for (let i = 0; i < 6; i += 1) c.push(bar(i, 100, 101, 99, 100));
        for (let k = 0; k < 6; k += 1) c.push(...pinWinCycle(c.length));
        return c;
    };

    it('returns nothing on too short a history', () => {
        expect(scanHistorySetups(tape().slice(0, 39))).toEqual([]);
    });

    it('aggregates every pin-bar occurrence across the tape with outcomes', () => {
        const stats = scanHistorySetups(tape());
        const pin = stats.find(s => s.id === 'pin-bar-buy');
        expect(pin).toBeTruthy();
        expect(pin!.side).toBe('long');
        // Cycles start late enough that ≥3 pins are visible to the scan, and
        // the (id @ trigger-bar) dedupe keeps each pin counted exactly once.
        expect(pin!.hits).toBeGreaterThanOrEqual(3);
        expect(pin!.hits).toBeLessThanOrEqual(6);
        expect(pin!.wins).toBeGreaterThanOrEqual(2);
        expect(pin!.winRate).not.toBeNull();
        expect(pin!.winRate!).toBeGreaterThan(0.5);
        expect(pin!.keywords).toContain('pin bar');
    });

    it('records per-hit excursions as entry fractions, newest examples first', () => {
        const stats = scanHistorySetups(tape());
        const pin = stats.find(s => s.id === 'pin-bar-buy')!;
        expect(pin.examples.length).toBeGreaterThan(0);
        expect(pin.examples.length).toBeLessThanOrEqual(8);
        for (const h of pin.examples) {
            expect(h.entry).toBeGreaterThan(0);
            expect(h.mae).toBeLessThanOrEqual(0);
            expect(h.mfe).toBeGreaterThanOrEqual(0);
            expect(['win', 'loss', 'open']).toContain(h.outcome);
        }
        const idx = pin.examples.map(e => e.index);
        expect([...idx].sort((a, b) => b - a)).toEqual(idx); // newest first
        expect(pin.avgMfe).toBeGreaterThan(0);
    });
});

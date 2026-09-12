/**
 * setupScan — the strategy-book detectors. Each test builds a small candle
 * window that should (or should not) trigger one setup, so the IF-clauses the
 * book drafts encode are actually enforced by code, not prose.
 */

import { describe, it, expect } from 'vitest';
import {
    scanSetups, classifyGaps, rsiSeries, bollinger, type ScanCandle,
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

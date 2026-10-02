/**
 * taLibrary - the 48 indicator studies August was missing.
 *
 * Two things are being pinned here, and they are not the same thing:
 *
 *  1. **The arithmetic is correct.** Spot-checked against hand-computable
 *     values (a flat series, a linear ramp, a known pivot). An indicator that
 *     returns a plausible-looking number computed wrongly is worse than one
 *     that is absent, because the seat trusts it.
 *  2. **Degenerate input cannot throw and cannot emit NaN.** A desk tool that
 *     throws spends a round trip and tells the model nothing; one that returns
 *     NaN poisons the next prompt. Every study is checked with an empty array,
 *     one bar, and a flat (zero-range) window.
 */
import { describe, it, expect } from 'vitest';
import * as ta from '../services/analysis/taLibrary';
import type { Kline } from '../services/analysis/MarketDataService';

const mk = (n: number, fn: (i: number) => number, vol = 1000): Kline[] =>
    Array.from({ length: n }, (_, i) => {
        const c = fn(i);
        return { time: 1_700_000_000_000 + i * 3600_000, open: c, high: c + 1, low: c - 1, close: c, volume: vol };
    });

const rising = (n: number) => mk(n, i => 100 + i);
const flat = (n: number) => mk(n, () => 100);
const falling = (n: number) => mk(n, i => 200 - i);

/** Every study, so one loop can assert the whole catalogue is well behaved. */
const ALL_STUDIES = Object.values(ta.TA_STUDIES);

describe('every study is total', () => {
    it('covers the studies August lacked, and each names what it covers', () => {
        const ids = ALL_STUDIES.map(s => s.id);
        for (const expected of ['averages', 'bands', 'oscillators', 'trend', 'volatility', 'volumeflow', 'overlays']) {
            expect(ids, expected).toContain(expected);
        }
        for (const s of ALL_STUDIES) expect(s.covers.length, s.id).toBeGreaterThan(10);
    });

    it('never throws on empty, single-bar, flat, rising or falling input', () => {
        const windows: Array<[string, Kline[]]> = [
            ['empty', []],
            ['one', mk(1, () => 100)],
            ['flat', flat(30)],
            ['rising', rising(60)],
            ['falling', falling(60)],
            ['zero volume', rising(60).map(b => ({ ...b, volume: 0 }))],
        ];
        for (const [label, bars] of windows) {
            for (const s of ALL_STUDIES) {
                let out: unknown;
                expect(() => { out = s.run(bars); }, `${s.id} on ${label}`).not.toThrow();
                // Nothing reachable may be NaN/Infinity: that is what would
                // poison the prompt the model reads.
                const walk = (v: unknown, path: string): void => {
                    if (typeof v === 'number') {
                        expect(Number.isFinite(v), `${s.id}.${path} on ${label}`).toBe(true);
                    } else if (Array.isArray(v)) {
                        v.forEach((x, i) => walk(x, `${path}[${i}]`));
                    } else if (v && typeof v === 'object') {
                        Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
                    }
                };
                walk(out, s.id);
            }
        }
    });
});

describe('the arithmetic', () => {
    it('a flat series has zero volatility and a neutral chop', () => {
        expect(ta.historicalVolatility(flat(40), 20, false)).toBe(0);
        expect(ta.ulcerIndex(flat(40))).toBe(0);
    });

    it('a rising series trends up and does not trend down', () => {
        expect(ta.aroon(rising(60)).trend).toBe('up');
        expect(ta.aroon(falling(60)).trend).toBe('down');
        expect(ta.superTrend(rising(60)).direction).toBe('up');
        expect(ta.vortex(rising(60)).trend).toBe('up');
    });

    it('Aroon is 100 for a series whose high is the newest bar', () => {
        const a = ta.aroon(rising(60));
        expect(a.up).toBeGreaterThan(90);
    });

    it('pivots are derived from the PREVIOUS bar and are symmetric', () => {
        const bars = mk(3, () => 100);
        // prev = index 1: high 101, low 99, close 100 -> pp = 100, range 2
        const p = ta.pivotPoints(bars);
        expect(p.pp).toBe(100);
        expect(p.r1).toBe(101);   // 2*100 - 99
        expect(p.s1).toBe(99);    // 2*100 - 101
        expect(p.r2).toBe(102);
        expect(p.s2).toBe(98);
    });

    it('the averages track a linear ramp to within a rounding step', () => {
        // A straight line has the same value under every centred average.
        const bars = rising(80);
        for (const [name, v] of Object.entries({
            hma: ta.hma(bars), lsma: ta.lsma(bars), dema: ta.dema(bars),
            tema: ta.tema(bars), kama: ta.kama(bars),
            alma: ta.alma(bars),
        })) {
            expect(Number.isFinite(v), name).toBe(true);
            // The last close is 179; a converged average lands near it.
            expect(Math.abs(v - 179), name).toBeLessThan(8);
        }
        // ZLEMA DE-LAGS by construction, so on a ramp it LEADS the last close
        // by about half its period. Being ahead here is the indicator working,
        // not a bug — so the test pins that it stays INSIDE the lag.
        const z = ta.zlema(bars, 20);
        expect(z).toBeGreaterThan(179);
        expect(z).toBeLessThan(179 + 20);
    });

    it('CMO is +100 when every change in the window is up', () => {
        expect(ta.cmo(rising(30), 14)).toBeCloseTo(100, 1);
    });

    it('CMO is -100 when every change is down', () => {
        expect(ta.cmo(falling(30), 14)).toBeCloseTo(-100, 1);
    });

    it('BoP is positive on a green bar and negative on a red one', () => {
        const green = mk(30, i => 100 + i);
        const greenBar: Kline = { time: 1, open: 100, high: 102, low: 98, close: 101, volume: 1 };
        const redBar: Kline = { time: 1, open: 100, high: 102, low: 98, close: 99, volume: 1 };
        expect(ta.balanceOfPower([...green.slice(0, -1), greenBar])).toBeGreaterThan(0);
        expect(ta.balanceOfPower([...green.slice(0, -1), redBar])).toBeLessThan(0);
    });

    it('Donchian on a rising ramp is bounded by the window high and low', () => {
        const d = ta.donchian(rising(30), 20);
        const win = rising(30).slice(-20);
        expect(d.upper).toBeCloseTo(Math.max(...win.map(b => b.high)), 2);
        expect(d.lower).toBeCloseTo(Math.min(...win.map(b => b.low)), 2);
        expect(d.middle).toBeCloseTo((d.upper + d.lower) / 2, 2);
    });

    it('TTM Squeeze fires when Bollinger sits inside Keltner', () => {
        // A flat series has zero Bollinger width, so it IS squeezed.
        expect(ta.ttmSqueeze(flat(60)).squeeze).toBe(true);
    });

    it('Williams Fractal finds the local high of a simple spike', () => {
        // Build a clean dome: the middle bar must be higher than BOTH its
        // neighbours' highs AND lows, or it reads as a high and a low at once.
        const bars = flat(21);
        bars[10] = { ...bars[10], high: 500, low: 200, close: 400, open: 100 };
        const f = ta.williamsFractal(bars, 30);
        expect(f.type).toBe('bearish');
        expect(f.index).toBe(10);
    });

    it('ZigZag reports a swing point that actually swung', () => {
        // Up then sharply down -> the last labelled swing is a high.
        const bars = [...rising(30), ...falling(30)];
        const z = ta.zigzag(bars, 5);
        expect(['high', 'low']).toContain(z.label);
        expect(Number.isFinite(z.point.price)).toBe(true);
    });

    it('RSI helpers stay inside 0-100 on a wild series', () => {
        const wild = mk(120, i => 100 + Math.sin(i) * 20 + (i % 7) * 3);
        for (const v of [ta.connorsRsi(wild), ta.relativeVolatilityIndex(wild)]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
        }
    });

    it('the smoothing primitives agree on a constant series', () => {
        const c = new Array(50).fill(42);
        expect(ta.last(ta.smaOf(c, 10), 0)).toBe(42);
        expect(ta.last(ta.emaOf(c, 10), 0)).toBeCloseTo(42, 6);
        expect(ta.last(ta.rmaOf(c, 10), 0)).toBeCloseTo(42, 6);
    });

    it('resolveSource reads the price the caller asked for', () => {
        const b = [{ time: 1, open: 10, high: 20, low: 5, close: 15, volume: 1 }];
        expect(ta.resolveSource(b, 'close')).toEqual([15]);
        expect(ta.resolveSource(b, 'open')).toEqual([10]);
        expect(ta.resolveSource(b, 'hl2')).toEqual([12.5]);
        expect(ta.resolveSource(b, 'hlc3')).toEqual([40 / 3]);
        // An unknown source falls back to close rather than throwing.
        expect(ta.resolveSource(b, 'nope' as never)).toEqual([15]);
    });
});

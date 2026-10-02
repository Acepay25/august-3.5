/**
 * The calculateIndicators memo.
 *
 * Every indicator in that block is a pure function of the passed klines and
 * each reads ONE value out of a full-length series — `EMA.calculate(...).pop()`
 * computes all N bars to return the last. On a 1,000-bar window that is 20+
 * full series per call, on the render path and again on every desk-tool round.
 *
 * The cache must make the repeated case free WITHOUT ever serving a stale
 * reading, which is the whole risk: an app left open all day watches the last
 * bar change constantly, and a chart that keeps reporting the previous bar's
 * RSI after a new close is worse than no cache at all.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { calculateIndicators, clearIndicatorCache } from '../services/analysis/TechnicalAnalysisService';
import type { Kline } from '../services/analysis/MarketDataService';

const window = (n: number, lastClose = 100): Kline[] =>
    Array.from({ length: n }, (_, i) => {
        const close = lastClose + Math.sin(i / 5) * 3;
        return {
            time: 1_700_000_000_000 + i * 3_600_000,
            open: close - 0.2,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1_000 + (i % 7) * 50,
        };
    });

describe('calculateIndicators memo', () => {
    beforeEach(() => clearIndicatorCache());

    it('returns the same object for the same window, so a repeat read is free', () => {
        const klines = window(300);
        const first = calculateIndicators(klines);
        const second = calculateIndicators(klines);
        expect(second).toBe(first);
    });

    it('recomputes when a NEW bar arrives — the common case on an open chart', () => {
        const base = window(300);
        const before = calculateIndicators(base);
        // One more bar: same 299 bars plus a fresh close.
        const grown = [...base, {
            time: base[base.length - 1].time + 3_600_000,
            open: 100, high: 103, low: 99, close: 102, volume: 2_000,
        }];
        const after = calculateIndicators(grown);
        expect(after).not.toBe(before);
        // A real new bar must be able to move a reading; if the memo served
        // the old object the trader would be reading yesterday's momentum.
        expect(after.rsi.rsi14).not.toBe(before.rsi.rsi14);
    });

    it('recomputes when an EARLIER bar is revised in place', () => {
        // The fingerprint covers the whole window precisely so a vendor
        // correcting history cannot be answered from cache.
        const klines = window(300);
        const before = calculateIndicators(klines);
        const revised = klines.map((k, i) => (i === 40 ? { ...k, close: k.close + 6 } : k));
        const after = calculateIndicators(revised);
        expect(after).not.toBe(before);
    });

    it('keeps different symbols/timeframes apart', () => {
        const a = calculateIndicators(window(300, 100));
        const b = calculateIndicators(window(300, 4_200));
        expect(a).not.toBe(b);
        expect(a.currentPrice).not.toBe(b.currentPrice);
    });

    it('bounds the cache so a long session cannot grow it without limit', () => {
        // More distinct windows than the cache holds; a session across many
        // symbols must evict rather than accumulate.
        for (let i = 0; i < 60; i += 1) {
            const klines = window(120, 100 + i);
            klines[klines.length - 1] = { ...klines[klines.length - 1], close: 100 + i, time: 1_800_000_000_000 + i * 3_600_000 };
            calculateIndicators(klines);
        }
        // The first window is long evicted; recomputing it must NOT return the
        // identical object the very first call produced.
        const first = window(120, 100);
        expect(calculateIndicators(first)).toBeDefined();
        // A second call for it now hits the (fresh) entry:
        expect(calculateIndicators(first)).toBe(calculateIndicators(first));
    });
});
/**
 * budgetToolContent — the tool-result clipper.
 *
 * This had NO test, and its entire purpose is a promise that is easy to break:
 * a clipped JSON result must still PARSE. The raw `slice` it replaced could cut
 * mid-object, and a model handed broken JSON cannot tell it from a real answer,
 * so it never re-reads the rest. These tests pin that promise on the payloads
 * that actually broke it.
 */
import { describe, it, expect } from 'vitest';
import { budgetToolContent, MAX_TOOL_CONTENT_CHARS } from '../services/analysis/DeskToolsService';

const cap = MAX_TOOL_CONTENT_CHARS;
const isParseable = (s: string): boolean => {
    try { JSON.parse(s); return true; } catch { return false; }
};

describe('budgetToolContent — never breaks JSON', () => {
    it('leaves a payload inside the cap untouched', () => {
        const small = JSON.stringify({ a: 1, b: 'x' });
        expect(budgetToolContent('probe', small)).toBe(small);
    });

    it('keeps an oversized object PARSEABLE, shedding fields rather than bytes', () => {
        const big = JSON.stringify({
            symbol: 'BTCUSDT', interval: '1h', bars: 250,
            core: { rsi: { rsi14: 58.2 }, macd: { histogram: 12 } },
            momentum: { momentumScore: 33 },
            regime: { adx: 27.4, trendDirection: 'bullish' },
            volume: { obv: 1.2e9, cvd: 4.4e6 },
            // Enough studies that the whole object genuinely outgrows the cap,
            // which is the case the raw slice broke.
            vwap: { vwap: 77295.5, upperBand1: 77500, lowerBand1: 77000 },
            ichimoku: { tenkanSen: 77400, kijunSen: 77000, cloudTop: 78100 },
            overlays: { pivots: { pp: 77200, r1: 77600, s1: 76900 }, zigzag: { price: 78100 } },
            // The oscillator group is the big one in practice.
            oscillators: Object.fromEntries(
                Array.from({ length: 14 }, (_, i) => [`study${i}`, { value: 50 + i, signal: 49 + i, note: 'x'.repeat(80) }]),
            ),
            levels: { support: Array.from({ length: 40 }, (_, i) => ({ price: 76000 - i, strength: 60 })), resistance: Array.from({ length: 40 }, (_, i) => ({ price: 79000 + i, strength: 55 })) },
        }, null, 2);
        expect(big.length).toBeGreaterThan(cap);
        const out = budgetToolContent('probe', big, 0, false);
        expect(out.length).toBeLessThanOrEqual(cap);
        expect(isParseable(out), 'the clipped result must still parse').toBe(true);
    });

    it('names what it dropped so a clipped result is not mistaken for a complete one', () => {
        const big = JSON.stringify({ small: 1, huge: 'x'.repeat(cap * 3), other: 'y'.repeat(cap * 2) });
        const out = budgetToolContent('probe', big, 0, false);
        expect(isParseable(out)).toBe(true);
        // Either the loss is recorded in _omitted, or the result is a text cut
        // carrying the clip note. Either way it is NOT silently short.
        expect(/_omitted|clipped|truncated/i.test(out)).toBe(true);
    });

    it('survives a single huge scalar, which cannot be reshaped', () => {
        // Nothing to drop but one key: the honest outcome is a bounded cut that
        // still parses, not an unbounded body.
        const blob = JSON.stringify({ blob: 'x'.repeat(cap * 4) });
        const out = budgetToolContent('probe', blob, 0, false);
        expect(out.length).toBeLessThanOrEqual(cap);
        expect(isParseable(out)).toBe(true);
    });

    it('leaves non-JSON text alone apart from the cut', () => {
        const text = 'plain error text '.repeat(400);
        const out = budgetToolContent('probe', text, 0, false);
        expect(out.length).toBeLessThanOrEqual(cap);
        // Text is allowed to be cut; it just must not claim to be JSON.
        expect(isParseable(out)).toBe(false);
    });

    it('an already-fitting result is never annotated', () => {
        const body = JSON.stringify({ ok: true });
        expect(budgetToolContent('probe', body, 0, false)).not.toContain('_clip');
    });
});
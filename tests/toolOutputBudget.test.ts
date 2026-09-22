/**
 * Tool-result budgeting.
 *
 * `budgetToolContent` is the last gate before market data reaches a model, and
 * it had NO test. Two distinct failures live here and they pull in opposite
 * directions:
 *
 *   · too little trimming -> the payload passes the cap, the hard slice fires
 *     mid-structure, and the model is handed BROKEN JSON;
 *   · too much trimming, silently -> 8 of 100 book levels reads as "the book is
 *     thin", and the model never re-calls for the rest.
 *
 * The fix for the second is `_omitted` + a clipping notice. This file pins that
 * both are true at once, and pins the down-samples themselves so removing one
 * cannot slip back in unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { budgetToolContent, MAX_TOOL_CONTENT_CHARS } from '../services/analysis/DeskToolsService';

const level = (price: number, usdValue: number) => ({ price, amount: 1, usdValue });

const book = (bidCount: number, askCount: number, wallCount: number) => JSON.stringify({
    bids: Array.from({ length: bidCount }, (_, i) => level(100 - i * 0.01, 1000 - i)),
    asks: Array.from({ length: askCount }, (_, i) => level(101 + i * 0.01, 1000 - i)),
    buyWalls: Array.from({ length: wallCount }, (_, i) => ({ price: 90 + i, usdValue: i * 10 })),
    sellWalls: Array.from({ length: wallCount }, (_, i) => ({ price: 110 + i, usdValue: i * 10 })),
});

describe('budgetToolContent — order book down-sampling', () => {
    it('keeps the 8 nearest levels of each ladder and records what was dropped', () => {
        const out = budgetToolContent('get_order_book', book(100, 100, 0));
        const parsed = JSON.parse(out);

        expect(parsed.bids).toHaveLength(8);
        expect(parsed.asks).toHaveLength(8);
        expect(parsed._omitted).toMatchObject({ bids: 92, asks: 92 });
    });

    it('keeps only the top-5 walls BY NOTIONAL, not by insertion order', () => {
        const out = budgetToolContent('get_order_book', book(2, 2, 12));
        const parsed = JSON.parse(out);

        expect(parsed.buyWalls).toHaveLength(5);
        // Highest usdValue first: the largest wall was authored last.
        expect(parsed.buyWalls[0].usdValue).toBe(110);
        expect(parsed._omitted).toMatchObject({ buyWalls: 7, sellWalls: 7 });
    });

    it('records nothing as omitted when nothing was dropped', () => {
        const out = budgetToolContent('get_order_book', book(3, 3, 2));
        const parsed = JSON.parse(out);

        expect(parsed.bids).toHaveLength(3);
        expect(parsed._omitted).toBeUndefined();
    });

    it('stays valid JSON inside its own budget — the reason the slice is 8, not 12', () => {
        // A full 100-level book at 12 levels each measured 2413 chars against
        // the 2400 cap and used to be hard-sliced into broken JSON.
        const out = budgetToolContent('get_order_book', book(100, 100, 30));
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        expect(() => JSON.parse(out)).not.toThrow();
    });
});

describe('budgetToolContent — liquidations', () => {
    it('caps recentEvents at 10 and says how many were cut', () => {
        const content = JSON.stringify({
            recentEvents: Array.from({ length: 40 }, (_, i) => ({ id: i, side: 'long' })),
        });
        const parsed = JSON.parse(budgetToolContent('get_liquidations', content));

        expect(parsed.recentEvents).toHaveLength(10);
        expect(parsed._omitted).toEqual({ recentEvents: 30 });
    });
});

describe('budgetToolContent — the hard character cap', () => {
    it('names the tool and both lengths, so a clip is not mistaken for the truth', () => {
        const giant = JSON.stringify({ blob: 'x'.repeat(MAX_TOOL_CONTENT_CHARS * 3) });
        const out = budgetToolContent('get_funding', giant);

        expect(out).toContain('…[truncated get_funding:');
        expect(out).toContain(`of ${giant.length} chars`);
        expect(out).toContain('MISSING, not absent');
    });

    it('keeps the WHOLE result inside the cap — the notice is carved out of it, not appended', () => {
        // Callers size `tailReserve` so their own stamps survive INSIDE the
        // budget. A trailer that overflowed the cap would defeat exactly that,
        // which is the regression this guards.
        const giant = JSON.stringify({ blob: 'x'.repeat(MAX_TOOL_CONTENT_CHARS * 3) });
        expect(budgetToolContent('get_funding', giant).length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        expect(budgetToolContent('get_all_timeframes', giant).length).toBeLessThanOrEqual(8000);
    });

    it('shrinks the visible body to make room for the notice under a tail reserve', () => {
        const giant = JSON.stringify({ blob: 'y'.repeat(MAX_TOOL_CONTENT_CHARS * 2) });
        const out = budgetToolContent('get_funding', giant, 500);

        expect(out).toContain('…[truncated get_funding: first ');
        expect(out).toMatch(/first \d+ of \d+ chars/);
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS - 500);
    });

    it('falls through to the cap when the payload is not JSON at all', () => {
        // Error text from a failed fetch must still be bounded, not crash the
        // budgeting pass because it will not parse.
        const plain = 'upstream 502 bad gateway '.repeat(300);
        const out = budgetToolContent('web_search', plain);

        expect(out.length).toBeLessThan(plain.length);
        expect(out).toContain('…[truncated web_search:');
    });

    it('leaves content it did not need to trim semantically unchanged', () => {
        const small = JSON.stringify({ bids: [level(100, 5)] });
        const out = budgetToolContent('get_order_book', small);

        // These two tools re-serialize pretty-printed whenever they parse, so
        // BYTES are not preserved — the data is. Asserting byte-equality here
        // would encode an accident of formatting as a requirement.
        expect(JSON.parse(out)).toEqual(JSON.parse(small));
        expect(out).not.toContain('clipped');
    });

    it('is byte-identical for a tool with no array down-sampling and a short body', () => {
        const short = JSON.stringify({ funding: 0.0001 });
        expect(budgetToolContent('get_funding', short)).toBe(short);
    });
});

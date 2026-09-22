/**
 * Recoverable clipping. Two things must both stay true, and they are in tension:
 * a clipped result must tell the model the rest is reachable, and the string the
 * model is handed must still fit the budget the caller reserved for its own
 * live-price tail. A notice appended AFTER the cap satisfies the first and
 * breaks the second — a bug this repo has already been bitten by once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    budgetToolContent,
    clearDeskToolCache,
    executeDeskTool,
    READ_PAGE_CHARS,
    MAX_TOOL_CONTENT_CHARS,
    spillReceiptAllowed,
} from '../services/analysis/DeskToolsService';
import {
    RECEIPT_CHARS,
    artifactCount,
    clearToolArtifacts,
    readToolArtifact,
    storeToolArtifact,
} from '../services/analysis/toolArtifactStore';

const giant = (n: number, seed = 'x'): string => seed.repeat(n);
const RECEIPT_RE = /\[clipped: full result is id "(ta-[0-9a-z]+)"/;

beforeEach(() => {
    clearDeskToolCache();
    clearToolArtifacts();
});

describe('the size promise survives the receipt', () => {
    it('fits the plain cap', () => {
        const out = budgetToolContent('get_funding', giant(MAX_TOOL_CONTENT_CHARS * 3));
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        expect(out).toMatch(RECEIPT_RE);
    });

    it('fits when a caller reserved tail room, which is the whole point', () => {
        const tailReserve = 500;
        const out = budgetToolContent('get_funding', giant(40_000), tailReserve);
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        // Room for the caller's stamp is not eaten by the receipt.
        expect(out.length + tailReserve).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS + tailReserve);
    });

    it('degrades to a bare marker when the budget is smaller than the notice', () => {
        const out = budgetToolContent('get_funding', giant(9000), MAX_TOOL_CONTENT_CHARS);
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
    });

    it('reports the receipt width as the constant the cap arithmetic uses', () => {
        const out = budgetToolContent('get_funding', giant(9000));
        const line = out.slice(out.search(RECEIPT_RE) - 1);
        expect(line.length).toBeLessThanOrEqual(RECEIPT_CHARS);
    });

    it('leaves an unclipped result completely alone', () => {
        const short = 'funding 0.0031, next in 6h';
        expect(budgetToolContent('get_funding', short)).toBe(short);
        expect(artifactCount()).toBe(0);
    });
});

/** Distinguishable filler. `seed.repeat(n)` would make every slice a substring
 *  of every other, so "the model was not shown this" proves nothing. */
const indexed = (n: number, marker = 'zz'): string =>
    Array.from({ length: n }, (_, i) => `${i}:${marker}${i}`).join(',');

describe('the clipped bytes come back', () => {
    it('serves the missing tail by the id it named', () => {
        // 500 entries ≈ 5.5 KB: past the 2400-char cap (so it clips) but inside
        // one 8000-char page (so the whole thing comes back at once).
        const full = indexed(500);
        const out = budgetToolContent('get_funding', full);
        const id = out.match(RECEIPT_RE)?.[1];
        expect(id).toBeTruthy();

        // A marker that only exists past the clip is invisible in the result…
        const tailMarker = `480:zz480`;
        expect(out).not.toContain(tailMarker);
        // …and retrievable by id.
        const page = readToolArtifact(id!, 0, 8000);
        expect(page.ok && page.content).toBe(full);
        expect(page.ok && page.content).toContain(tailMarker);
    });

    it('pages to the end and says so, rather than looping', () => {
        const full = giant(9000, 'w');
        const id = budgetToolContent('get_funding', full).match(RECEIPT_RE)![1];

        const first = readToolArtifact(id, 0, 2000);
        expect(first.ok && first.nextOffset).toBe(2000);
        const second = readToolArtifact(id, 2000, 2000);
        expect(second.ok && second.nextOffset).toBe(4000);

        const last = readToolArtifact(id, 8000, 2000);
        expect(last.ok && last.nextOffset).toBeNull();
        expect(last.ok && last.content.length).toBe(1000);

        const past = readToolArtifact(id, 99_999, 2000);
        expect(past.ok).toBe(true);
        expect(past.content).toMatch(/\[end of /);
    });

    it('calls a stale id a missing thing, not a failure to retry', () => {
        const miss = readToolArtifact('ta-9999', 0, 100);
        expect(miss.ok).toBe(false);
        expect(miss.content).toMatch(/^DATA_UNAVAILABLE:/);
        expect(miss.content).toMatch(/do not retry/i);
    });

    it('never clips the read-back tool itself', () => {
        // A receipt inside a paged artifact would point at another receipt and
        // the seat would page forever.
        const out = budgetToolContent('read_tool_output', giant(9000, 'r'));
        expect(out).toMatch(/truncated/);
        expect(out).not.toMatch(RECEIPT_RE);
        expect(artifactCount()).toBe(0);
    });

    it('keeps an order book recoverable down to the level it dropped', () => {
        const levels = (n: number, side: string) => Array.from({ length: n }, (_, i) => ({
            price: 100 + i, qty: 5, usdValue: 500 + i,
        })).map(l => ({ ...l, side }));
        const book = JSON.stringify({
            bids: levels(100, 'bid'), asks: levels(100, 'ask'),
            buyWalls: levels(20, 'bid'), sellWalls: levels(20, 'ask'),
            bestBid: 100, bestAsk: 101,
        }, null, 2);

        const out = budgetToolContent('get_order_book', book);
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        const id = out.match(RECEIPT_RE)?.[1];
        expect(id).toBeTruthy();

        // The clipped view is smaller than the ladder it came from, and the
        // far level is genuinely absent from it. What the seat was NOT shown is
        // one call away — and unlike the clipped view, the stored payload is
        // still whole, because it is what the desk produced before budgeting.
        // A page is a slice, not a document — this book is ~20 KB, so proving
        // recoverability means walking the pages and reassembling them. That is
        // also the property that matters: paging is lossless and terminates.
        let recovered = '';
        let offset = 0;
        for (let hop = 0; hop < 40; hop++) {
            const page = readToolArtifact(id!, offset, 8000);
            expect(page.ok).toBe(true);
            if (!page.ok) break;
            recovered += page.content;
            if (page.nextOffset === null) break;
            offset = page.nextOffset;
        }
        expect(recovered).toBe(book);
        expect(JSON.parse(recovered).bids).toHaveLength(100);
        expect(recovered).toContain('"price": 199');
        // The clipped view the seat was handed is smaller and lacks that level.
        expect(out).not.toContain('"price": 199');
    });
});

describe('the receipt is only offered to a seat that can redeem it', () => {
    it('allows an unrestricted surface and one that lists the read tool', () => {
        expect(spillReceiptAllowed(undefined)).toBe(true);
        expect(spillReceiptAllowed([])).toBe(true);
        expect(spillReceiptAllowed(['get_order_book', 'read_tool_output'])).toBe(true);
    });

    it('stays silent for a filtered seat that was never given the tool', () => {
        expect(spillReceiptAllowed(['get_order_book', 'recall'])).toBe(false);
        // The clipped line still names the loss — it just makes no promise.
        const out = budgetToolContent('get_order_book', giant(9000, 'b'), 0, false);
        expect(out).toMatch(/MISSING, not absent/);
        expect(out).not.toMatch(RECEIPT_RE);
        expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS);
        expect(artifactCount()).toBe(0);
    });
});

describe('the store is a window, not an archive', () => {
    it('bounds how many payloads stay addressable, oldest first', () => {
        for (let i = 0; i < 60; i++) budgetToolContent('get_funding', giant(9000, `a${i}`));
        expect(artifactCount()).toBeLessThanOrEqual(40);
        // The very first id has been evicted; the newest still resolves.
        expect(readToolArtifact('ta-0001', 0, 10).ok).toBe(false);
    });

    it('empties with the cache it belongs to', () => {
        const out = budgetToolContent('get_funding', giant(9000));
        const id = out.match(RECEIPT_RE)![1];
        expect(readToolArtifact(id, 0, 10).ok).toBe(true);
        clearDeskToolCache();
        expect(artifactCount()).toBe(0);
        expect(readToolArtifact(id, 0, 10).ok).toBe(false);
    });

    it('refuses a payload too large to be worth keeping', () => {
        const out = budgetToolContent('get_funding', giant(600_000));
        expect(out).toMatch(/truncated/);
        expect(out).not.toMatch(RECEIPT_RE);
        expect(artifactCount()).toBe(0);
    });
});

describe('paging keeps its own continuation pointer', () => {
    it('a page larger than the cap is clamped, and still points at the rest', async () => {
        // Two bugs in one shape. The pointer used to be concatenated into the
        // body BEFORE budgeting, so a clipped page lost the only line saying an
        // offset exists; and with `limit` advertised to 8000 against a 2400
        // budget, the page reported no remainder while the budget had just
        // withheld 3800 characters — so the seat was told "nothing further to
        // read" about content that was still sitting in the store.
        const id = storeToolArtifact('get_market_packet', 'x'.repeat(6000), 100);
        expect(id).toBeTruthy();
        const res = await executeDeskTool({
            id: 'call-1', name: 'read_tool_output', arguments: { id, offset: 0, limit: 8000 },
        });
        expect(res.ok).toBe(true);
        expect(res.content).toContain(`[next offset ${READ_PAGE_CHARS} of 6000`);
        expect(res.content).not.toMatch(/nothing further to read/);
        expect(res.content).not.toMatch(/truncated/);
    });

    it('only the final page says there is nothing further', async () => {
        const id = storeToolArtifact('get_market_packet', 'y'.repeat(2500), 100);
        expect(id).toBeTruthy();
        const last = await executeDeskTool({
            id: 'call-2', name: 'read_tool_output', arguments: { id, offset: READ_PAGE_CHARS, limit: 8000 },
        });
        expect(last.content).toContain('nothing further to read');
        expect(last.content).not.toMatch(/truncated/);
    });
});

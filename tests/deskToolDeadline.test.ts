/**
 * One desk-tool call gets its own clock, and a Stop gets its answer.
 *
 * The tool loop already bounds ROUNDS (`MAX_DESK_TOOL_ROUNDS`), the whole TURN
 * (`DESK_TURN_BUDGET_MS`) and a seat's REPETITION (`STALL_REPEAT_LIMIT`). What
 * none of them bounds is a single call that never returns: a hung fetch leaves
 * the transcript sitting on "calling…" with the round awaiting it, and a Stop
 * click does nothing until the socket gives up by itself. Stage 20's chat turns
 * put that loop in front of a human watching a live bubble, so a stuck tool is
 * no longer a slow answer — it is an app that looks broken.
 *
 * Both exits must keep the assistant/tool pairing intact, so neither throws past
 * the batch: the timeout hands the seat a `DATA_UNAVAILABLE:` receipt (the one
 * voice this app uses for withheld data — `utils/harnessMarks.ts`), and the stop
 * hands it a stopped receipt and lets the loop's round-top abort check settle the
 * turn as interrupted.
 */

import { describe, it, expect } from 'vitest';
import {
    withinToolDeadline,
    DESK_TOOL_TIMEOUT_MS,
    type DeskToolCall,
    type DeskToolResult,
} from '../services/analysis/DeskToolsService';
import { DATA_UNAVAILABLE_PREFIX } from '../utils/harnessMarks';

const call = (name = 'get_market_packet'): DeskToolCall => ({ id: `c-${name}`, name, arguments: {} });

/** A call that answers. */
const ok: DeskToolResult = { toolCallId: 'c-get_market_packet', name: 'get_market_packet', ok: true, content: 'BTC 85,000' };

const never = (): Promise<DeskToolResult> => new Promise<DeskToolResult>(() => { /* never settles */ });

describe('withinToolDeadline', () => {
    it('passes a call that answers in time straight through', async () => {
        const r = await withinToolDeadline(call(), () => Promise.resolve(ok), undefined, 50);
        expect(r).toBe(ok);
    });

    it('ends a call that never returns with the unavailability sentinel, not a hang', async () => {
        const started = Date.now();
        const r = await withinToolDeadline(call('get_market_packet'), never, undefined, 30);
        expect(r.ok).toBe(false);
        expect(r.content.startsWith(DATA_UNAVAILABLE_PREFIX)).toBe(true);
        expect(r.content).toMatch(/did not answer/);
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('a Stop answers the pending call at once instead of waiting for its deadline', async () => {
        let resolveLate!: (r: DeskToolResult) => void;
        const late = new Promise<DeskToolResult>(res => { resolveLate = res; });
        const controller = new AbortController();
        const started = Date.now();
        const pending = withinToolDeadline(call(), () => late, controller.signal, 60_000);
        setTimeout(() => {
            controller.abort();
            // The abandoned call lands AFTER the stop was answered, so the race
            // must already be settled — a late result is dropped, not repainted.
            resolveLate(ok);
        }, 20);
        const r = await pending;
        expect(r.ok).toBe(false);
        expect(r.content.startsWith(DATA_UNAVAILABLE_PREFIX)).toBe(true);
        // The point of the race: the 60s deadline never had to expire.
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("keeps the call's identity on the receipt the seat reads back", async () => {
        const r = await withinToolDeadline(call('get_order_book'), never, undefined, 20);
        expect(r.toolCallId).toBe('c-get_order_book');
        expect(r.name).toBe('get_order_book');
    });

    it('the production deadline is shorter than the turn budget it sits inside', () => {
        // A per-call cap above the turn cap would let one fetch eat the whole
        // budget, so the wrap-up notice would arrive after the seat had already
        // spent everything on a single lookup.
        expect(DESK_TOOL_TIMEOUT_MS).toBeLessThan(180_000);
        expect(DESK_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    });
});

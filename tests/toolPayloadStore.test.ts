import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The tool row must expand onto the REAL output, and the store behind it must
 * REFUSE growth rather than evict.
 *
 * Both halves are load-bearing. An expander that opens onto nothing is a dead
 * control, which is the exact defect this project rejects. And a store that
 * evicts silently loses bytes nothing can regenerate — an order book from an
 * hour ago is not re-fetchable as the same fact — so the ceiling must refuse the
 * NEWEST payload and keep everything already saved.
 */

const USER = 'payload-user';

const payload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    toolCallId: 'c-1',
    name: 'get_order_book',
    label: 'order book · buy wall at 88k',
    ok: true,
    artifact: null,
    text: 'real order book output',
    ...over,
});

const keyFor = (u: string): string => `trade_tool_payloads_v1_${u}`;

describe('the payload store round-trips', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('last_active_user', USER);
        vi.resetModules();
    });

    it('keeps a payload and reads it back by its call id', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        expect(store.saveToolPayload(payload() as never)).toBe(true);
        const back = store.readToolPayload('c-1');
        expect(back?.text).toBe('real order book output');
        expect(back?.label).toBe('order book · buy wall at 88k');
    });

    it('replaces in place when the same call id is written twice', async () => {
        // A retried call has ONE payload, not two — otherwise the store grows on
        // every retry and the budget is spent on duplicates.
        const store = await import('../services/trade/toolPayloadStore');
        store.saveToolPayload(payload() as never);
        store.saveToolPayload(payload({ text: 'the retry, superseding' }) as never);
        expect(store.listToolPayloads()).toHaveLength(1);
        expect(store.readToolPayload('c-1')?.text).toBe('the retry, superseding');
    });

    it('caps a single payload at the page ceiling', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        store.saveToolPayload(payload({ text: 'x'.repeat(20_000) }) as never);
        const back = store.readToolPayload('c-1');
        // MAX_PAYLOAD_CHARS matches readToolArtifact's page limit, so one row
        // expands onto the same slice a seat would have paged.
        expect(back?.text.length).toBe(store.MAX_PAYLOAD_CHARS);
    });

    it('returns null for a call id that was never kept', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        expect(store.readToolPayload('nope')).toBeNull();
    });
});

describe('at the ceiling it refuses, it does not evict', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('last_active_user', USER);
        vi.resetModules();
    });

    it('keeps every byte already saved and refuses the newest payload', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        const size = store.MAX_PAYLOAD_TOTAL_CHARS;
        const clamp = store.MAX_PAYLOAD_CHARS;
        // Each write is clamped to `clamp` chars, so the budget is filled with
        // many payloads rather than one huge one — which is exactly how a real
        // session reaches the ceiling.
        let i = 0;
        while (store.payloadStoreSize() + clamp <= size) {
            expect(store.saveToolPayload(payload({ toolCallId: `p${i++}`, text: 'a'.repeat(clamp) }) as never)).toBe(true);
        }
        const filled = store.payloadStoreSize();
        const savedCount = store.listToolPayloads().length;
        // Less than one more clamped payload fits.
        expect(size - filled).toBeLessThan(clamp);

        // The next payload is REFUSED.
        expect(store.saveToolPayload(payload({ toolCallId: 'refused', text: 'r'.repeat(clamp) }) as never)).toBe(false);

        // THE RULE: nothing already saved was touched — same count, same bytes —
        // and the refusal is RECORDED rather than logged and forgotten.
        expect(store.payloadStoreSize()).toBe(filled);
        expect(store.listToolPayloads()).toHaveLength(savedCount);
        expect(store.readToolPayload('p0')?.text).toHaveLength(clamp);
        expect(store.readToolPayload('refused')).toBeNull();
        expect(store.getPayloadWriteFailure()?.kind).toBe('budget');
    });

    it('the failure record survives until a later write succeeds', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        const size = store.MAX_PAYLOAD_TOTAL_CHARS;
        const clamp = store.MAX_PAYLOAD_CHARS;
        let i = 0;
        while (store.payloadStoreSize() + clamp <= size) {
            store.saveToolPayload(payload({ toolCallId: `f${i++}`, text: 'f'.repeat(clamp) }) as never);
        }
        expect(store.saveToolPayload(payload({ toolCallId: 'refused', text: 'y'.repeat(clamp) }) as never)).toBe(false);
        expect(store.getPayloadWriteFailure()).not.toBeNull();

        // A later write under the ceiling clears it — the sticky record exists so
        // a UI can say "the last N results were not kept", not to stick forever.
        store.clearToolPayloads();
        expect(store.saveToolPayload(payload({ toolCallId: 'ok' }) as never)).toBe(true);
        expect(store.getPayloadWriteFailure()).toBeNull();
    });

    it('does not start deleting when the stored set is already over budget', async () => {
        // A store that refuses at high-water must not then evict: the bytes are
        // there, and trimming them would be the silent loss the rule forbids.
        const store = await import('../services/trade/toolPayloadStore');
        localStorage.setItem(keyFor(USER), JSON.stringify([
            { ...payload({ toolCallId: 'old' }), at: 1, text: 'o'.repeat(store.MAX_PAYLOAD_TOTAL_CHARS + 5000) },
        ]));
        expect(store.saveToolPayload(payload({ toolCallId: 'new' }) as never)).toBe(false);
        expect(store.readToolPayload('old')?.text).toHaveLength(store.MAX_PAYLOAD_TOTAL_CHARS + 5000);
        expect(store.readToolPayload('new')).toBeNull();
    });
});

describe('a storage failure is recorded, not swallowed', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('last_active_user', USER);
        vi.resetModules();
    });

    it('rethrows a quota error so the caller can decide, after recording it', async () => {
        const store = await import('../services/trade/toolPayloadStore');
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        try {
            expect(() => store.saveToolPayload(payload() as never)).toThrow(/QuotaExceededError/);
            expect(store.getPayloadWriteFailure()?.kind).toBe('quota');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('the payload id is the join key, never the position', () => {
    it('a payload stores its toolCallId, which is what the row pairs on', async () => {
        // `results` inside the desk loop is [...replays, ...extra, ...forged,
        // ...core] — its order does not match the `calling…` lines rendered.
        // Pairing by index would attach the wrong payload to a row; the id cannot.
        const store = await import('../services/trade/toolPayloadStore');
        store.saveToolPayload(payload({ toolCallId: 'call_zzz', name: 'get_indicators' }) as never);
        const found = store.listToolPayloads().find(p => p.toolCallId === 'call_zzz');
        expect(found?.name).toBe('get_indicators');
    });
});

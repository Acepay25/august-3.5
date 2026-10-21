/**
 * Automatic compaction of the outbound message array.
 *
 * The invariant that matters is not "it got smaller" — it is WHAT it gave up. A
 * compactor that drops an assistant tool-call without its `tool` replies makes
 * every OpenAI-compatible gateway 400 the whole transcript, which turns "the
 * history was too long" into "the model never replied": the exact symptom this
 * exists to remove. So the pairing rule and the protected tail get pinned
 * harder than the arithmetic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    compactForWire,
    compactMessages,
    estimateMessagesTokens,
    estimateMessageTokens,
    turnGroups,
    type CompactAction,
} from '../services/providers/contextCompact';
import type { ChatMessage } from '../services/providers/GenericProviderService';
import {
    WIRE_FRAMING_SAFETY_TOKENS,
    recordMeasuredContextWindow,
    resetMeasuredContextWindows,
} from '../utils/contextWindow';
import type { ProviderConfig } from '../types/provider';

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1',
    name: 'Provider One',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['model-a'],
    selectedModel: 'model-a',
    ...over,
});

/** `tokens` worth of prose: the estimator counts chars/4 plus 4 framing per call. */
const pad = (tokens: number): string => 'x'.repeat(Math.max(0, (tokens - 4) * 4));

const toolRound = (name: string, tokens: number): ChatMessage[] => [
    {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: `call-${name}`, name, content: pad(tokens) },
];

/**
 * A desk turn with room OUTSIDE the protected tail to cut: mandate, question,
 * one long assistant paragraph, five tool rounds, the follow-up question.
 * 14 messages, so `MIN_KEEP_MESSAGES` shields the last six and leaves the first
 * three rounds available.
 */
const history = (): ChatMessage[] => [
    { role: 'system', content: 'the mandate' },
    { role: 'user', content: 'read the tape' },
    { role: 'assistant', content: pad(3_000) },
    ...toolRound('get_order_book', 4_000),
    ...toolRound('get_liquidations', 4_000),
    ...toolRound('recall', 4_000),
    ...toolRound('get_funding_rate', 4_000),
    ...toolRound('get_candles', 4_000),
    { role: 'user', content: 'and now?' },
];

/** The protocol rule every gateway validates: no announced call without its
 *  reply, and no reply whose call has vanished. */
const isPairingValid = (messages: ChatMessage[]): boolean => messages.every((m, i) => {
    if (m.role !== 'assistant' || !(m.tool_calls?.length)) return true;
    return m.tool_calls.every(call => messages.slice(i + 1).some(next =>
        next.role === 'tool' && next.tool_call_id === call.id));
});

beforeEach(() => { resetMeasuredContextWindows(); });

describe('estimateMessageTokens', () => {
    it('counts tool-call arguments, not just the content field', () => {
        const bare = estimateMessageTokens({ role: 'assistant', content: '' });
        const withCall = estimateMessageTokens({
            role: 'assistant',
            content: '',
            tool_calls: [{ id: '1', type: 'function', function: { name: 'run_monte_carlo', arguments: '{"symbol":"BTCUSDT","horizon":96}' } }],
        });
        expect(withCall).toBeGreaterThan(bare + 10);
    });

    it('counts an image part, which has no text to measure', () => {
        const withImage = estimateMessageTokens({
            role: 'user',
            content: [
                { type: 'text', text: 'look at this' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg' } },
            ],
        });
        const textOnly = estimateMessageTokens({ role: 'user', content: 'look at this' });
        expect(withImage).toBeGreaterThan(textOnly + 1_000);
    });

    it('flattens a content-parts array instead of measuring the object', () => {
        const parts: ChatMessage = { role: 'user', content: [{ type: 'text', text: pad(500) }] };
        expect(estimateMessagesTokens([parts])).toBeGreaterThanOrEqual(500);
    });
});

describe('turnGroups', () => {
    it('binds an assistant tool-call to every reply that follows it', () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'mandate' },
            { role: 'user', content: 'q' },
            ...toolRound('get_order_book', 10),
            ...toolRound('get_funding_rate', 10),
            { role: 'assistant', content: 'a' },
        ];
        expect(turnGroups(messages).map(g => g.length)).toEqual([1, 1, 2, 2, 1]);
    });

    it('keeps a harness continuation as its own group', () => {
        // Dropping the pointer is cheap; dropping the pair is a protocol error.
        const messages: ChatMessage[] = [
            { role: 'user', content: 'q' },
            ...toolRound('get_price_snapshot', 10),
            { role: 'user', content: 'Continue. Write your reply now.' },
        ];
        expect(turnGroups(messages).map(g => g.length)).toEqual([1, 2, 1]);
    });

    it('does not leave a lone tool reply ungrouped', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'called' },
            { role: 'tool', tool_call_id: 'x', content: 'payload' },
        ];
        expect(turnGroups(messages).map(g => g.length)).toEqual([1, 2]);
    });
});

describe('compactMessages — the no-op case', () => {
    it('sends an array that fits completely untouched', () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'mandate' },
            { role: 'user', content: 'what is BTC doing' },
            ...toolRound('get_price_snapshot', 200),
        ];
        const r = compactMessages({ messages, ceilingTokens: 100_000 });
        expect(r.changed).toBe(false);
        expect(r.actions).toEqual([]);
        expect(r.notice).toBe('');
        expect(r.messages).toEqual(messages);
    });

    it('does not mutate the caller\'s array', () => {
        const messages = history();
        const before = messages.map(m => (typeof m.content === 'string' ? m.content.length : -1));
        compactMessages({ messages, ceilingTokens: 100 });
        expect(messages.map(m => (typeof m.content === 'string' ? m.content.length : -1))).toEqual(before);
    });
});

describe('compactMessages — what it gives up', () => {
    it('shortens the OLDEST tool payloads first and marks them as truncated', () => {
        const r = compactMessages({ messages: history(), ceilingTokens: 20_000 });
        expect(r.changed).toBe(true);
        expect(r.actions[0]).toMatchObject({ kind: 'tool-payload', name: 'get_order_book' });
        const stub = String(r.messages.find(m => m.role === 'tool')!.content);
        // The app's own dialect, not an invented one: a seat reads this as
        // "withheld", never as "the book was empty".
        expect(stub).toMatch(/…\[truncated get_order_book: first \d+ of 15984 chars\./);
        expect(stub).toMatch(/MISSING, not absent/);
        expect(stub).toMatch(/call the tool again/);
    });

    it('spends a payload before it spends a paragraph', () => {
        // Both are outside the tail, and the order is the whole policy: a market
        // payload is bulkier and less load-bearing than the seat's own prose.
        const r = compactMessages({ messages: history(), ceilingTokens: 12_000 });
        const kinds = r.actions.map(a => a.kind);
        expect(kinds[0]).toBe('tool-payload');
        expect(kinds).toContain('tool-payload');
        expect(kinds).toContain('assistant-text');
        const firstProse = kinds.indexOf('assistant-text');
        const lastPayload = kinds.lastIndexOf('tool-payload');
        expect(firstProse).toBeGreaterThan(lastPayload);
    });

    it('names the read-back id when the spilled payload is still paged', () => {
        const messages = history();
        const firstTool = messages.findIndex(m => m.role === 'tool');
        messages[firstTool] = {
            ...messages[firstTool],
            content: `${pad(4_000)}\n…[clipped: full result is id "ta-0007"; call read_tool_output with this id to page through it]`,
        };
        const r = compactMessages({ messages, ceilingTokens: 20_000 });
        const stub = r.messages.find(m => m.role === 'tool' && String(m.content).includes('ta-0007'));
        expect(String(stub?.content)).toMatch(/read_tool_output with id "ta-0007"/);
    });

    it('drops whole tool rounds atomically when shortening cannot reach the ceiling', () => {
        const r = compactMessages({ messages: history(), ceilingTokens: 6_000 });
        expect(isPairingValid(r.messages)).toBe(true);
        expect(r.messages.filter(m => m.role === 'tool').length)
            .toBeLessThan(history().filter(m => m.role === 'tool').length);
        // Every surviving `tool` reply still belongs to an announced call.
        for (const m of r.messages.filter(x => x.role === 'tool')) {
            expect(r.messages.some(x => x.tool_calls?.some(c => c.id === m.tool_call_id))).toBe(true);
        }
    });

    it('never rewrites the mandate or the turn being answered', () => {
        const messages = history();
        const r = compactMessages({ messages, ceilingTokens: 1 });
        expect(r.messages[0].content).toBe('the mandate');
        // The protected tail is relative to the array as it stands, so rounds
        // can be dropped OUT OF it as the array shrinks — but the last two
        // messages (the newest round and the follow-up question) never are.
        expect(r.messages.slice(-2).map(m => m.content))
            .toEqual(messages.slice(-2).map(m => m.content));
        expect(isPairingValid(r.messages)).toBe(true);
        expect(r.messages.filter(m => m.role === 'tool').length)
            .toBeLessThan(history().filter(m => m.role === 'tool').length);
    });

    it('reports what was lost as measurements of this run', () => {
        const r = compactMessages({ messages: history(), ceilingTokens: 6_000 });
        expect(r.notice).toMatch(/COMPACTED FOR THE CONTEXT WINDOW/);
        expect(r.notice).toMatch(/old tool result/);
        expect(r.notice).toMatch(/earlier turn/);
        expect(r.notice).toMatch(/missing from THIS request, not from your journal/);
        expect(r.notice).toContain(r.beforeTokens.toLocaleString());
        expect(r.notice).toContain(r.afterTokens.toLocaleString());
    });

    it('says so when even the protected minimum does not fit', () => {
        const huge: ChatMessage[] = [
            { role: 'system', content: 'mandate' },
            { role: 'user', content: pad(9_000) },
            { role: 'user', content: 'q' },
        ];
        const r = compactMessages({ messages: huge, ceilingTokens: 1_024 });
        expect(r.stillOver).toBeGreaterThan(0);
        expect(r.notice).toMatch(/CONTEXT FULL/);
    });

    it('leaves a payload alone when cutting it would save nothing', () => {
        // 14 messages puts a 300-token round outside the tail; a 400-char head
        // would be LONGER than the payload it replaces.
        const messages = history().map(m => (m.role === 'tool' ? { ...m, content: pad(300) } : m));
        const r = compactMessages({ messages, ceilingTokens: 1 });
        expect(r.actions.filter(a => a.kind === 'tool-payload')).toEqual([]);
        expect(r.actions.some(a => a.kind === 'turn-drop')).toBe(true);
    });

    it('honours a caller\'s wider keep rule', () => {
        const messages = history();
        const r = compactMessages({ messages, ceilingTokens: 1, keepAtLeast: 12 });
        // Nothing outside the tail but the mandate and the first two messages.
        expect(r.messages.filter(m => m.role === 'tool').length).toBe(5);
        expect(isPairingValid(r.messages)).toBe(true);
    });
});

describe('compactForWire', () => {
    it('holds the array to the window this config resolves to', () => {
        const messages = history();
        const r = compactForWire(config({ contextWindowTokens: 24_000 }), messages, { outputReserveTokens: 8_192 });
        expect(r.windowSource).toBe('user');
        expect(r.ceilingTokens).toBe(24_000 - 8_192 - WIRE_FRAMING_SAFETY_TOKENS);
        expect(r.afterTokens).toBeLessThanOrEqual(r.ceilingTokens);
        expect(r.changed).toBe(true);
    });

    it('assumes 1M and therefore does nothing at all to an ordinary turn', () => {
        // The honest consequence of the optimistic default: no compaction is
        // visible until a window is known. Pinned so nobody later "fixes" this
        // by compacting eagerly.
        const r = compactForWire(config(), history(), { outputReserveTokens: 8_192 });
        expect(r.windowSource).toBe('default');
        expect(r.changed).toBe(false);
    });

    it('accepts a measured limit as the ceiling for the retry', () => {
        recordMeasuredContextWindow('p1', 'model-a', 128_000);
        const r = compactForWire(config(), history(), { windowTokens: 32_000, outputReserveTokens: 8_192 });
        expect(r.windowTokens).toBe(32_000);
        expect(r.windowSource).toBe('measured');
        expect(r.afterTokens).toBeLessThanOrEqual(r.ceilingTokens);
    });

    it('shrinks a long conversation that no provider would accept', () => {
        const messages: ChatMessage[] = [{ role: 'system', content: 'mandate' }];
        for (let i = 0; i < 40; i++) {
            messages.push({ role: 'user', content: pad(900) });
            messages.push({ role: 'assistant', content: pad(900) });
        }
        messages.push({ role: 'user', content: 'the question I actually want answered' });
        const before = estimateMessagesTokens(messages);
        const r = compactForWire(config({ contextWindowTokens: 32_000 }), messages, { outputReserveTokens: 8_192 });
        expect(before).toBeGreaterThan(30_000);
        expect(r.afterTokens).toBeLessThan(before);
        expect(String(r.messages[r.messages.length - 1].content))
            .toBe('the question I actually want answered');
    });

    it('records one action per kind of cut it makes', () => {
        const kinds = new Set<CompactAction['kind']>();
        compactForWire(config({ contextWindowTokens: 16_000 }), history(), { outputReserveTokens: 8_192 })
            .actions.forEach(a => kinds.add(a.kind));
        expect(kinds.has('tool-payload')).toBe(true);
    });

    it('never drops the last USER question, even after tool rounds push it out of the tail', () => {
        // The question is at the START of a desk turn; every round appends
        // AFTER it. By round four it is outside the protected tail, and the
        // first droppable group is the question itself. Dropping it leaves the
        // seat with tool results and no question to answer.
        const messages: ChatMessage[] = [
            { role: 'system', content: 'mandate' },
            { role: 'user', content: 'read the tape' },
            ...Array.from({ length: 8 }, (_, i) => toolRound(`get_order_book_${i}`, 2_000)).flat(),
        ];
        const r = compactMessages({ messages, ceilingTokens: 600 });
        expect(r.messages.some(m => m.role === 'user' && m.content === 'read the tape')).toBe(true);
    });
});

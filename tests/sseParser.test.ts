/**
 * sseParser — the pure delta parser behind desktop streaming (electron/
 * sseParser.cjs, required by main.cjs). Pins the wire behavior the bridge
 * depends on: per-format text/reasoning extraction, native tool-call
 * fragment accumulation, usage capture, [DONE]/completed termination,
 * partial-line buffering, and the sawData:false signal that tells main.cjs
 * the provider ignored stream:true (fall back to the buffered parse).
 */

import { describe, it, expect } from 'vitest';
import { createSseParser } from '../electron/sseParser.cjs';

// The CJS module is untyped; shape it locally so the suite stays strict.
type Parser = {
    push(text: string): { events: Array<{ type: string; delta: string }>; done: boolean };
    finish(): { events: Array<{ type: string; delta: string }>; done: boolean; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; usage: unknown; sawData: boolean };
};
const make = (format: string): Parser => (createSseParser as unknown as (f: string) => Parser)(format);

describe('chat_completions', () => {
    it('extracts content and reasoning_content deltas', () => {
        const p = make('chat_completions');
        const feed = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
        let out = p.push(feed({ choices: [{ delta: { reasoning_content: 'thinking…' } }] }));
        expect(out.events).toEqual([{ type: 'reasoning', delta: 'thinking…' }]);
        out = p.push(feed({ choices: [{ delta: { content: 'Hello' } }] }));
        expect(out.events).toEqual([{ type: 'text', delta: 'Hello' }]);
        out = p.push('data: [DONE]\n\n');
        expect(out.done).toBe(true);
        const fin = p.finish();
        expect(fin.sawData).toBe(true);
        expect(fin.toolCalls).toEqual([]);
    });

    it('accumulates index-keyed tool_call fragments and parses arguments', () => {
        const p = make('chat_completions');
        const feed = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
        p.push(feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'get_mar' } }] } }] }));
        p.push(feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'ket_packet', arguments: '{"sym' } }] } }] }));
        p.push(feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'bol":"ETHUSDT"}' } }] } }] }));
        p.push(feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
        const fin = p.finish();
        expect(fin.toolCalls).toHaveLength(1);
        expect(fin.toolCalls[0].id).toBe('call_9');
        expect(fin.toolCalls[0].name).toBe('get_market_packet');
        expect(fin.toolCalls[0].arguments).toEqual({ symbol: 'ETHUSDT' });
        expect(fin.usage).toMatchObject({ prompt_tokens: 5 });
    });

    it('buffers a partial line across pushes', () => {
        const p = make('chat_completions');
        const whole = 'data: {"choices":[{"delta":{"content":"split me"}}]}\n\n';
        let out = p.push(whole.slice(0, 20));
        expect(out.events).toHaveLength(0);
        out = p.push(whole.slice(20));
        expect(out.events).toEqual([{ type: 'text', delta: 'split me' }]);
    });

    it('a plain JSON body (stream ignored) yields no deltas and sawData=false', () => {
        const p = make('chat_completions');
        const out = p.push('{"choices":[{"message":{"content":"buffered"}}]}');
        expect(out.events).toHaveLength(0);
        const fin = p.finish();
        expect(fin.sawData).toBe(false);
    });
});

describe('messages (Anthropic)', () => {
    it('streams text_delta and thinking_delta, accumulates tool input_json', () => {
        const p = make('messages');
        const feed = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
        let out = p.push(`event: content_block_delta\n${feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } })}`);
        expect(out.events).toEqual([{ type: 'reasoning', delta: 'hmm' }]);
        out = p.push(feed({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } }));
        expect(out.events).toEqual([{ type: 'text', delta: 'Hi' }]);
        p.push(feed({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'web_search' } }));
        p.push(feed({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query":"fed"}' } }));
        const fin = p.finish();
        expect(fin.toolCalls).toHaveLength(1);
        expect(fin.toolCalls[0]).toMatchObject({ id: 'toolu_1', name: 'web_search', arguments: { query: 'fed' } });
    });
});

describe('responses (OpenAI)', () => {
    it('streams output text and reasoning summaries, accumulates function calls, ends on completed', () => {
        const p = make('responses');
        const feed = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
        let out = p.push(feed({ type: 'response.reasoning_summary_text.delta', delta: 'plan:' }));
        expect(out.events).toEqual([{ type: 'reasoning', delta: 'plan:' }]);
        out = p.push(feed({ type: 'response.output_text.delta', delta: 'done' }));
        expect(out.events).toEqual([{ type: 'text', delta: 'done' }]);
        p.push(feed({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call_7', name: 'recall' } }));
        p.push(feed({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"topic":"BTC"}' }));
        out = p.push(feed({ type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 4 } } }));
        expect(out.done).toBe(true);
        const fin = p.finish();
        expect(fin.toolCalls).toEqual([{ id: 'call_7', name: 'recall', arguments: { topic: 'BTC' } }]);
        expect(fin.usage).toMatchObject({ input_tokens: 3 });
    });
});

describe('robustness', () => {
    it('ignores malformed JSON lines and non-data lines without throwing', () => {
        const p = make('chat_completions');
        const out = p.push('event: ping\n\ndata: {not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
        expect(out.events).toEqual([{ type: 'text', delta: 'ok' }]);
    });

    it('finish flushes an unterminated trailing data line', () => {
        const p = make('chat_completions');
        p.push('data: {"choices":[{"delta":{"content":"tail"}}]}');
        const fin = p.finish();
        expect(fin.events).toEqual([{ type: 'text', delta: 'tail' }]);
    });
});

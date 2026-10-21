/**
 * The "it never replied" bug, and the three changes that close it.
 *
 * A tool round at `high` thinking used to get 4096 output tokens — and on a
 * reasoning route thinking counts inside that number, so the round could spend
 * all of it mid-thought and come back with NO tool call and NO text. The loop
 * read that shape as "the seat chose not to call a tool", the transport read it
 * as a finished turn, and the trader saw an empty bubble wearing the
 * "THE PROVIDER STOPPED EARLY" line. Nothing re-asked, nothing recovered.
 *
 * Pinned here: the bigger round budget, the one re-ask at a lower tier, the
 * continuation that must not repeat the tier that just failed, and the fact
 * that all of it is measured off the wire's own stop signal rather than guessed
 * from a missing regex.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import type { ChatMessage } from '../services/providers/GenericProviderService';

// Plain `vi.fn()`s, not `as Mock<(...args: any[]) => any>` casts: the mock's
// call log is read through explicit `as` casts in each test, so the loose
// generic bought nothing and cost nine lint warnings.
const { streamMock, sendMock } = vi.hoisted(() => ({ streamMock: vi.fn(), sendMock: vi.fn() }));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: (...args: unknown[]) => streamMock(...args),
    sendChatRequest: vi.fn(),
    sendChatTurn: (...args: unknown[]) => sendMock(...args),
}));

vi.mock('../services/analysis/MarketDataService', () => ({
    extractSymbolFromPrompt: vi.fn(() => 'BTCUSDT'),
    normalizeSymbol: vi.fn((s: unknown) => (typeof s === 'string' && s ? s : 'BTCUSDT')),
    fetchMarketData: vi.fn(async () => ({ symbol: 'BTCUSDT', currentPrice: 100.5, volume24h: 1e9, priceChangePercent24h: 1.2 })),
    fetchMarkIndex: vi.fn(async () => ({ markPrice: 100.4, indexPrice: 100.3, lastFundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, available: true })),
    fetchFundingRate: vi.fn(async () => ({ fundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, available: true })),
    fetchDerivativesData: vi.fn(async () => ({ openInterestValue: 2.9e8, available: true })),
    fetchOHLCV: vi.fn(async () => []),
    fetchOrderBookDepth: vi.fn(async () => ({
        bestBid: 100.4, bestAsk: 100.6, spread: 0.2, spreadPercent: 0.199,
        bids: [{ price: 100.4, qty: 10 }], asks: [{ price: 100.6, qty: 7 }],
        bidDepth: 1000, askDepth: 700, depthImbalance: 0.1,
        buyWalls: [], sellWalls: [], dominantSide: 'balanced', wallDistance: {}, available: true,
    })),
    fetchRecentLiquidations: vi.fn(async () => ({ recentEvents: [], available: true })),
}));
vi.mock('../services/infrastructure/SessionService', () => ({ getSessionContext: vi.fn(async () => '') }));
vi.mock('../services/learning/MemoryRetrievalService', () => ({ handleRecallTool: vi.fn(async () => 'No relevant notebook memory.') }));
vi.mock('../services/learning/EvidencePackService', () => ({ computeSetupClusterStats: vi.fn(async () => null) }));
vi.mock('../services/analysis/CorrelationRiskService', () => ({ calculateCorrelationRisk: vi.fn(async () => 'n/a') }));
vi.mock('../services/tools/toolForge', () => ({
    executeForgedTool: vi.fn(async () => null),
    confirmedForgedToolDefinitions: vi.fn(() => []),
}));

import {
    runDeskToolLoop,
    streamChatWithDeskTools,
    clearDeskToolCache,
    MAX_DESK_TOOL_ROUNDS,
    DESK_ROUND_MAX_TOKENS,
} from '../services/analysis/DeskToolsService';

const config: ProviderConfig = {
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: true,
    models: ['model-a'],
    selectedModel: 'model-a',
};

interface ScriptRound {
    text?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    /** What the wire said stopped this message. 'length' = the token ceiling. */
    finish?: string;
}

/** Script the streaming transport the way the real one behaves: it yields text
 *  deltas, forwards the stop signal, and delivers native tool calls at the end. */
const scriptStream = (rounds: ScriptRound[]): void => {
    streamMock.mockImplementation(async function* (
        _c: unknown,
        _m: unknown,
        options?: { onStreamToolCalls?: (calls: unknown) => void; onFinishReason?: (r: string) => void },
    ) {
        const round = rounds.shift() ?? { text: '' };
        if (round.text) yield round.text;
        if (round.finish) options?.onFinishReason?.(round.finish);
        if (round.toolCalls?.length) options?.onStreamToolCalls?.(round.toolCalls);
    });
};

const baseMessages = [{ role: 'user', content: 'read this tape' }];

beforeEach(() => {
    streamMock.mockReset();
    sendMock.mockReset();
    clearDeskToolCache();
});

describe('the round budget a thinking model needs', () => {
    it('is 8192, not the 4096 the chain of thought used to eat', async () => {
        scriptStream([{ text: 'No lookup needed.' }]);
        await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 16_384 },
        });
        const sent = streamMock.mock.calls[0][2] as { maxTokens: number };
        expect(sent.maxTokens).toBe(DESK_ROUND_MAX_TOKENS);
        expect(DESK_ROUND_MAX_TOKENS).toBe(8_192);
    });

    it('still obeys a SMALLER caller budget — a clarification turn stays cheap', async () => {
        scriptStream([{ text: 'Short answer.' }]);
        await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 512 },
        });
        expect((streamMock.mock.calls[0][2] as { maxTokens: number }).maxTokens).toBe(512);
    });
});

describe('a round that thinks itself out of budget', () => {
    it('re-asks once at a lower tier instead of returning nothing', async () => {
        scriptStream([
            // The bug, as the wire actually shows it: no content, no calls, and
            // a stop signal that says the ceiling was reached.
            { text: '', finish: 'length' },
            { text: 'BTC is pinned under the 100.6 ask; no plan.' },
        ]);
        const events: string[] = [];
        const loop = await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192, reasoningEffort: 'high' },
        });

        expect(streamMock).toHaveBeenCalledTimes(2);
        // The re-ask is the tier BELOW the one that just failed.
        const repair = streamMock.mock.calls[1][2] as { reasoningEffort?: string };
        expect(repair.reasoningEffort).toBe('medium');
        // And it is the harness speaking, not a phantom trader turn.
        const sent = streamMock.mock.calls[1][1] as Array<{ role: string; content: string }>;
        const notice = sent[sent.length - 1];
        expect(notice.role).toBe('user');
        expect(notice.content).toMatch(/HARNESS NOTE/);
        expect(notice.content).toMatch(/CUT OFF before you finished thinking/);
        expect(events.join('\n')).toMatch(/thinking hit the round's token ceiling/);
        expect(loop.finalText).toBe('BTC is pinned under the 100.6 ask; no plan.');
        expect(loop.endedWithToolCalls).toBe(false);
    });

    it('re-asks only ONCE — a second is a retry of the same failure', async () => {
        scriptStream([
            { text: '', finish: 'length' },
            { text: '', finish: 'length' },
            { text: '', finish: 'length' },
        ]);
        const loop = await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 8_192, reasoningEffort: 'high' },
        });
        expect(streamMock).toHaveBeenCalledTimes(2);
        expect(loop.finalText).toBe('');
    });

    it('counts a MISSING stop signal as "did not finish cleanly"', async () => {
        // `finishReason: 'unknown'` means the gateway sent no signal at all —
        // documented as NOT a clean stop. Treating silence as success is how
        // this bug hid: an empty message ended the turn quietly.
        scriptStream([
            { text: '' },
            { text: 'Recovered answer.' },
        ]);
        await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 8_192, reasoningEffort: 'max' },
        });
        expect(streamMock).toHaveBeenCalledTimes(2);
        expect((streamMock.mock.calls[1][2] as { reasoningEffort: string }).reasoningEffort).toBe('high');
    });

    it('does NOT re-ask when the seat simply chose not to call a tool', async () => {
        scriptStream([{ text: 'An answer with no lookup.', finish: 'stop' }]);
        const events: string[] = [];
        const loop = await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192, reasoningEffort: 'high' },
        });
        expect(streamMock).toHaveBeenCalledTimes(1);
        expect(loop.finalText).toBe('An answer with no lookup.');
        expect(events.join('\n')).not.toMatch(/token ceiling/);
    });
});

describe('the continuation after a turn that produced nothing', () => {
    it('steps the thinking down and asks for prose, once', async () => {
        scriptStream([
            { text: '', finish: 'length' },
            { text: '', finish: 'length' },
            { text: 'The reply, written after the repair.' },
        ]);
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(config, [...baseMessages], {
            enabled: true,
            defaultSymbol: 'BTCUSDT',
            reasoningEffort: 'high',
            maxTokens: 8_192,
        })) {
            chunks.push(c);
        }
        // round 0 (cut) → repair round (cut) → continuation.
        expect(streamMock).toHaveBeenCalledTimes(3);
        const continuation = streamMock.mock.calls[2];
        const sent = continuation[1] as Array<{ role: string; content: string }>;
        expect(sent[sent.length - 1].content).toMatch(/Answer in prose now/);
        expect((continuation[2] as { reasoningEffort: string }).reasoningEffort).toBe('medium');
        expect(chunks.join('')).toBe('The reply, written after the repair.');
    });

    it('leaves a turn that already answered alone', async () => {
        scriptStream([
            { text: 'Look. ', toolCalls: [{ id: 'c1', name: 'get_price_snapshot', arguments: { symbol: 'BTCUSDT' } }] },
            { text: 'BTC prints $100.5.' },
        ]);
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(config, [...baseMessages], {
            enabled: true, defaultSymbol: 'BTCUSDT', reasoningEffort: 'high', maxTokens: 8_192,
        })) {
            chunks.push(c);
        }
        expect(chunks.join('')).toBe('Look. BTC prints $100.5.');
        // Two rounds, no third call: the clean in-loop answer already streamed.
        expect(streamMock).toHaveBeenCalledTimes(2);
    });
});

describe('proactive compaction inside the tool loop', () => {
    const smallWindow: ProviderConfig = { ...config, contextWindowTokens: 20_000 };
    const pad = (tokens: number): string => 'x'.repeat((tokens - 4) * 4);

    /** A Chat-surface conversation long enough that the oldest turns are NOT in
     *  the protected tail. 20k window − 8192 output − 4096 framing = a 7712-token
     *  ceiling, and this history is roughly 8100. */
    const longHistory = () => ([
        { role: 'system', content: 'the mandate' },
        { role: 'user', content: 'what did I miss?' },
        { role: 'assistant', content: pad(2_000) },
        { role: 'user', content: 'and the book?' },
        { role: 'assistant', content: pad(2_000) },
        { role: 'user', content: 'funding?' },
        { role: 'assistant', content: pad(2_000) },
        { role: 'user', content: 'any liquidations?' },
        { role: 'assistant', content: pad(2_000) },
        { role: 'user', content: 'read this tape' },
    ] as ChatMessage[]);

    it('shortens the oldest prose before the first round is even sent', async () => {
        scriptStream([{ text: 'Book is thin; no plan.' }]);
        const events: string[] = [];
        await runDeskToolLoop({
            config: smallWindow,
            messages: longHistory(),
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192 },
        });
        const sent = streamMock.mock.calls[0][1] as Array<{ role: string; content: unknown }>;
        const stubbed = sent.filter(m => String(m.content).includes('…[truncated earlier reply'));
        expect(stubbed.length).toBeGreaterThan(0);
        // The seat is told the bytes were withheld, not that the answer was short.
        expect(String(stubbed[0].content)).toMatch(/MISSING, not absent/);
        expect(events.join('\n')).toMatch(/COMPACTED FOR THE CONTEXT WINDOW/);
        expect(events.join('\n')).toMatch(/missing from THIS request, not from your journal/);
        // The newest turn — the question being answered — is never rewritten.
        expect(String(sent[sent.length - 1].content)).toBe('read this tape');
    });

    it('shortens an old tool payload once enough turns have pushed it out of the tail', async () => {
        // Four PRIOR rounds are in the array, so the oldest payload is no
        // longer part of the protected tail when this turn adds a fifth.
        const seeded = [
            { role: 'system', content: 'the mandate' },
            { role: 'user', content: 'read this tape' },
            ...[0, 1, 2, 3].flatMap(i => ([
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: [{ id: `old${i}`, type: 'function' as const, function: { name: 'get_order_book', arguments: '{}' } }],
                },
                { role: 'tool', tool_call_id: `old${i}`, name: 'get_order_book', content: pad(2_000) },
            ] as ChatMessage[])),
        ];
        scriptStream([
            { text: '', toolCalls: [{ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } }] },
            { text: 'Book is thin; no plan.' },
        ]);
        const events: string[] = [];
        await runDeskToolLoop({
            config: smallWindow,
            messages: seeded,
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192 },
        });
        const secondCall = streamMock.mock.calls[1][1] as Array<{ role: string; content: unknown }>;
        const cutTool = secondCall.find(m => m.role === 'tool' && String(m.content).includes('…[truncated get_order_book'));
        expect(cutTool).toBeTruthy();
        expect(String(cutTool?.content)).toMatch(/MISSING, not absent/);
        expect(events.join('\n')).toMatch(/COMPACTED FOR THE CONTEXT WINDOW/);
    });

    it('does nothing to a turn inside the assumed window', async () => {
        scriptStream([
            { text: '', toolCalls: [{ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } }] },
            { text: 'Book is thin; no plan.' },
        ]);
        const events: string[] = [];
        await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192 },
        });
        expect(events.join('\n')).not.toMatch(/COMPACTED/);
    });

    it('clamps the output budget to what the window has left', async () => {
        // The prompt fits after compaction, but 8192 output tokens would push
        // the whole request past a 12k window. The wire must receive what is
        // left, not the round's default.
        scriptStream([{ text: 'Book is thin; no plan.' }]);
        await runDeskToolLoop({
            config: { ...config, contextWindowTokens: 12_000 },
            messages: longHistory(),
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 8_192 },
        });
        const sent = streamMock.mock.calls[0][2] as { maxTokens: number };
        expect(sent.maxTokens).toBeGreaterThan(0);
        expect(sent.maxTokens).toBeLessThan(8_192);
    });

    it('refuses a request the window cannot hold instead of sending it', async () => {
        // 2000 tokens with an 8192 output budget leaves a ceiling of 1024, and
        // the desk mandate alone is bigger. The prompt fits nothing, and the
        // output budget cannot be clamped into the window either. Sending it
        // anyway is what the trader experiences as "it never replied"; the
        // turn must say why before it refuses.
        scriptStream([{ text: 'An answer.' }]);
        const events: string[] = [];
        await expect(runDeskToolLoop({
            config: { ...config, contextWindowTokens: 2_000 },
            messages: longHistory(),
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            onToolEvent: line => events.push(line),
            options: { maxTokens: 8_192 },
        })).rejects.toThrow(/CONTEXT WINDOW TOO SMALL/);
        expect(events.join('\n')).toMatch(/CONTEXT WINDOW TOO SMALL/);
        // No provider request was made with an impossible budget.
        expect(streamMock).not.toHaveBeenCalled();
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('never sends a call whose replies it dropped', async () => {
        // An assistant tool_calls row with no matching tool reply 400s the whole
        // transcript at every OpenAI-compatible gateway: the compactor must not
        // create that shape while freeing room.
        scriptStream(Array.from({ length: MAX_DESK_TOOL_ROUNDS }, (_, i) => ({
            text: '',
            toolCalls: [{ id: `c${i}`, name: 'get_price_snapshot', arguments: { symbol: `S${i}USDT` } }],
        })));
        await runDeskToolLoop({
            config: { ...config, contextWindowTokens: 12_000 },
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            nativeTools: true,
            options: { maxTokens: 4_096 },
        });
        for (const call of streamMock.mock.calls) {
            const sent = call[1] as Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
            for (const [index, m] of sent.entries()) {
                for (const announced of m.tool_calls ?? []) {
                    const answered = sent.slice(index + 1).some(n => n.tool_call_id === announced.id);
                    expect(answered).toBe(true);
                }
            }
        }
    });
});

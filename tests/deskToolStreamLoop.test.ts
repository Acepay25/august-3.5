import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ProviderConfig } from '../types/provider';

// The desk tool loop's LIVE path: rounds stream through streamChatRequest
// (text deltas forwarded via onTextDelta, native tool calls delivered via
// onStreamToolCalls at end-of-stream) instead of the old non-streaming
// sendTurn, so chat answers render while tool rounds run.

const { streamMock, sendMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
    sendMock: vi.fn() as Mock<(...args: any[]) => Promise<any>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
    sendChatRequest: vi.fn() as any,
    sendChatTurn: ((...args: any[]) => sendMock(...args)) as any,
}));

// Network/memory backends behind the desk tools — canned, no I/O.
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
vi.mock('../services/infrastructure/SessionService', () => ({
    getSessionContext: vi.fn(async () => ''),
}));
vi.mock('../services/learning/MemoryRetrievalService', () => ({
    handleRecallTool: vi.fn(async () => 'No relevant notebook memory.'),
}));
vi.mock('../services/learning/EvidencePackService', () => ({
    computeSetupClusterStats: vi.fn(async () => null),
}));
vi.mock('../services/analysis/CorrelationRiskService', () => ({
    calculateCorrelationRisk: vi.fn(async () => 'n/a'),
}));
vi.mock('../services/tools/toolForge', () => ({
    executeForgedTool: vi.fn(async () => null),
    confirmedForgedToolDefinitions: vi.fn(() => []),
}));

import { runDeskToolLoop, streamChatWithDeskTools, clearDeskToolCache, budgetToolContent } from '../services/analysis/DeskToolsService';

/** Drain an async generator into an array. */
const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
    const out: string[] = [];
    for await (const c of gen) out.push(c);
    return out;
};

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
}

/** Script the streaming transport: per call, yield text then deliver tool calls. */
const scriptStream = (rounds: ScriptRound[]): void => {
    streamMock.mockImplementation(async function* (_config: unknown, _messages: unknown, options?: { onStreamToolCalls?: (c: unknown) => void }) {
        const round = rounds.shift() ?? { text: '' };
        if (round.text) yield round.text;
        if (round.toolCalls?.length) options?.onStreamToolCalls?.(round.toolCalls);
    });
};

const baseMessages = [{ role: 'user', content: 'read this tape' }];

describe('desk tool loop — live streaming rounds', () => {
    beforeEach(() => {
        streamMock.mockReset();
        sendMock.mockReset();
        clearDeskToolCache();
    });

    it('forwards text deltas live and loops on native streamed tool calls', async () => {
        scriptStream([
            { text: 'Checking the tape. ', toolCalls: [{ id: 'c1', name: 'get_price_snapshot', arguments: {} }] },
            { text: 'BTC prints $100.5 with bid support.' },
        ]);
        const deltas: string[] = [];
        const events: string[] = [];
        const loop = await runDeskToolLoop({
            config,
            messages: [...baseMessages],
            sendTurn: sendMock,
            streamTurn: streamMock,
            onTextDelta: d => deltas.push(d),
            nativeTools: true,
            options: { maxTokens: 512 },
            onToolEvent: e => events.push(e),
        });

        // The answer streamed DURING the loop, not after it.
        expect(deltas.join('')).toBe('Checking the tape. BTC prints $100.5 with bid support.');
        // The tool actually executed through the desk executor.
        expect(loop.usedTools).toEqual(['get_price_snapshot']);
        expect(loop.endedWithToolCalls).toBe(false);
        // Tool results went back as a native tool message for the next round.
        expect(loop.messages.some(m => m.role === 'tool')).toBe(true);
        expect(events.some(e => e.includes('price snapshot'))).toBe(true);
        // The streaming path replaced the non-streaming turn entirely.
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('does not re-ask after a clean in-loop answer (no duplicate continuation)', async () => {
        scriptStream([
            { text: 'Look. ', toolCalls: [{ id: 'c1', name: 'get_price_snapshot', arguments: {} }] },
            { text: 'Final answer from round 1.' },
        ]);
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(config, [...baseMessages], { enabled: true, defaultSymbol: 'BTCUSDT' })) {
            chunks.push(c);
        }
        expect(chunks.join('')).toBe('Look. Final answer from round 1.');
        // Exactly the two loop rounds — no third "continue" call.
        expect(streamMock).toHaveBeenCalledTimes(2);
    });

    it('streams a final continuation when the loop exhausts rounds on tools', async () => {
        scriptStream([
            { text: 'R0 ', toolCalls: [{ id: 'c1', name: 'get_price_snapshot', arguments: {} }] },
            { text: 'R1 ', toolCalls: [{ id: 'c2', name: 'get_order_book', arguments: {} }] },
            { text: 'R2 ', toolCalls: [{ id: 'c3', name: 'get_price_snapshot', arguments: {} }] },
            { text: 'Final read after the findings.' },
        ]);
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(config, [...baseMessages], { enabled: true, defaultSymbol: 'BTCUSDT' })) {
            chunks.push(c);
        }
        expect(chunks.join('')).toBe('R0 R1 R2 Final read after the findings.');
        // 3 loop rounds + the continuation.
        expect(streamMock).toHaveBeenCalledTimes(4);
        // The continuation carries the tool results and the nudge.
        const continuationMessages = streamMock.mock.calls[3][1] as Array<{ role: string; content: string }>;
        const last = continuationMessages[continuationMessages.length - 1];
        expect(last.role).toBe('user');
        expect(last.content).toContain('Continue your Floor turn');
    });

    it('keeps the legacy non-streaming shape for non-native formats', async () => {
        // messages/responses formats: no streamTurn — collect, parse text tags,
        // then the final continuation streams. Text arrives as ONE chunk.
        sendMock.mockResolvedValue({
            text: 'Plain answer without tools.',
            reasoning: '',
            toolCalls: [],
        });
        scriptStream([{ text: 'Plain answer without tools.' }]);
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(
            { ...config, apiFormat: 'messages' },
            [...baseMessages],
            { enabled: true, defaultSymbol: 'BTCUSDT' },
        )) {
            chunks.push(c);
        }
        expect(chunks.join('')).toBe('Plain answer without tools.');
        expect(sendMock).toHaveBeenCalled();
    });
});

describe('desk tool loop — model chart actions', () => {
    beforeEach(() => {
        streamMock.mockReset();
        sendMock.mockReset();
        clearDeskToolCache();
    });

    it('routes draw_on_chart to the panel executor and feeds its receipt back', async () => {
        scriptStream([
            { text: 'Marking the range. ', toolCalls: [{ id: 'c1', name: 'draw_on_chart', arguments: { kind: 'hline', prices: [60_000], label: 'range high' } }] },
            { text: 'Done — the line is on your chart.' },
        ]);
        const panelCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
        const chunks: string[] = [];
        for await (const c of streamChatWithDeskTools(config, [...baseMessages], {
            enabled: true,
            defaultSymbol: 'BTCUSDT',
            executePanelTool: async call => {
                panelCalls.push({ name: call.name, arguments: call.arguments });
                return { toolCallId: call.id, name: call.name, ok: true, content: 'Drew hline "range high" at 60000.' };
            },
        })) {
            chunks.push(c);
        }
        expect(panelCalls).toEqual([{ name: 'draw_on_chart', arguments: { kind: 'hline', prices: [60_000], label: 'range high' } }]);
        // The chart-action receipt became a tool message the next round saw.
        const secondRoundMessages = streamMock.mock.calls[1][1] as Array<{ role: string; content: string }>;
        expect(secondRoundMessages.some(m => m.role === 'tool' && m.content.includes('range high'))).toBe(true);
        expect(chunks.join('')).toBe('Marking the range. Done — the line is on your chart.');
    });

    it('offers the chart-action definitions only when an executor is wired', async () => {
        scriptStream([{ text: 'no tools needed here.' }]);
        // No executePanelTool → draw_on_chart is NOT among the offered tools.
        await collect(streamChatWithDeskTools(config, [...baseMessages], { enabled: true, defaultSymbol: 'BTCUSDT', allowedTools: ['get_price_snapshot'] }));
        const offered = (streamMock.mock.calls[0][2] as { tools?: Array<{ function: { name: string } }> }).tools ?? [];
        expect(offered.map(t => t.function.name)).not.toContain('draw_on_chart');

        streamMock.mockClear();
        scriptStream([{ text: 'no tools needed here.' }]);
        await collect(streamChatWithDeskTools(config, [...baseMessages], {
            enabled: true, defaultSymbol: 'BTCUSDT', allowedTools: ['get_price_snapshot'],
            executePanelTool: async () => null,
        }));
        const offeredWithPanel = (streamMock.mock.calls[0][2] as { tools?: Array<{ function: { name: string } }> }).tools ?? [];
        expect(offeredWithPanel.map(t => t.function.name)).toContain('draw_on_chart');
    });
});

describe('tool-result budget', () => {
    it('gives the compendium tools a larger cap than the default', () => {
        const long = 'x'.repeat(9000);
        expect(budgetToolContent('get_all_timeframes', long).length).toBeGreaterThan(2400);
        expect(budgetToolContent('get_market_packet', long).length).toBeGreaterThan(2400);
        // A generic tool still truncates at the 2400 default.
        expect(budgetToolContent('get_price_snapshot', long).length).toBeLessThan(2500);
    });
});

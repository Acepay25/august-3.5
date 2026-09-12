/**
 * Tool-call SELF-HEAL: when a model emits a malformed tool-call block
 * (e.g. <tool_call><function=name></function></tool_call>), the loop no
 * longer ends the turn with raw markup in the answer — it bounces a
 * syntax-error correction back so the model fixes its own tool calling,
 * bounded by the same round budget. Streaming callers get onStreamReset so
 * the discarded attempt never stays painted in the bubble.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ProviderConfig } from '../types/provider';

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
    fetchMarketData: vi.fn(async () => ({ symbol: 'BTCUSDT', currentPrice: 100.5 })),
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
    stripTextToolCalls,
    malformedToolCallReason,
} from '../services/analysis/DeskToolsService';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

const MALFORMED = '<tool_call>\n<function=get_all_timeframes>\n</function>\n</tool_call>';

/** Drain an async generator into an array. */
const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
    const out: string[] = [];
    for await (const c of gen) out.push(c);
    return out;
};

beforeEach(() => {
    clearDeskToolCache();
    streamMock.mockReset();
    sendMock.mockReset();
});

describe('malformedToolCallReason', () => {
    it('recognizes the <function=…> syntax the user reported', () => {
        expect(malformedToolCallReason(MALFORMED)).toMatch(/<function/);
    });

    it('recognizes a name-less and an unclosed tool_call block', () => {
        expect(malformedToolCallReason('<tool_call>{"a":1}</tool_call>')).toMatch(/name attribute/);
        expect(malformedToolCallReason('<tool_call name="scan_setups">{"symbol":"ETHUSDT"}')).toMatch(/unclosed/);
    });

    it('leaves clean answers alone', () => {
        expect(malformedToolCallReason('All timeframes look ranging.')).toBeNull();
        expect(malformedToolCallReason('')).toBeNull();
    });
});

describe('stripTextToolCalls (self-heal remnants)', () => {
    it('removes malformed tool-call blocks and orphan tags', () => {
        expect(stripTextToolCalls(`Let me check.${MALFORMED} Done`)).toBe('Let me check. Done');
        expect(stripTextToolCalls('<tool_call name="scan_setups">{"symbol":"ETH"}</tool_call>ok')).toBe('ok');
        expect(stripTextToolCalls('dangling </tool_call> tag')).toBe('dangling  tag');
    });
});

describe('runDeskToolLoop self-heal', () => {
    it('bounces the syntax error back, then executes the corrected call', async () => {
        const events: string[] = [];
        const resets = vi.fn();
        sendMock
            .mockImplementationOnce(async () => ({ text: MALFORMED, reasoning: '', toolCalls: [] }))
            // Self-healed attempt: proper protocol, but a tool the desk doesn't
            // know — its "Unknown tool" result feeds back WITHOUT any network.
            .mockImplementationOnce(async () => ({ text: '<tool_call name="bogus_tool">{}</tool_call>', reasoning: '', toolCalls: [] }))
            .mockImplementationOnce(async () => ({ text: 'All timeframes look ranging.', reasoning: '', toolCalls: [] }));

        const result = await runDeskToolLoop({
            config,
            messages: [{ role: 'user', content: 'scan eth all timeframes' }],
            sendTurn: sendMock as any,
            options: {},
            defaultSymbol: 'BTCUSDT',
            nativeTools: false,
            allowedTools: ['get_all_timeframes', 'scan_setups'],
            onToolEvent: (l: string) => events.push(l),
            onStreamReset: resets,
        });

        // The corrective turn rode the conversation…
        const errTurn = result.messages.find(m => m.role === 'user' && String(m.content).includes('TOOL CALL ERROR'));
        expect(errTurn).toBeTruthy();
        expect(String(errTurn?.content)).toContain('<tool_call name="TOOL_NAME">{"arg":"value"}</tool_call>');
        // …the transcript saw the self-heal and the per-call rows…
        expect(events.some(e => e.includes('self-healing'))).toBe(true);
        expect(events.some(e => e.startsWith('calling bogus tool'))).toBe(true);
        expect(events.some(e => e.startsWith('bogus tool · failed'))).toBe(true);
        // …the reset fired exactly once, before the corrected round…
        expect(resets).toHaveBeenCalledTimes(1);
        // …and the clean answer ended the loop.
        expect(sendMock).toHaveBeenCalledTimes(3);
        expect(result.finalText).toBe('All timeframes look ranging.');
        expect(result.endedWithToolCalls).toBe(false);
    });

    it('gives up gracefully on the last round — malformed markup is stripped, not shown', async () => {
        sendMock.mockImplementation(async () => ({ text: `Trying...${MALFORMED}`, reasoning: '', toolCalls: [] }));
        const result = await runDeskToolLoop({
            config,
            messages: [{ role: 'user', content: 'go' }],
            sendTurn: sendMock as any,
            options: {},
            defaultSymbol: 'BTCUSDT',
            nativeTools: false,
        });
        // Every round bounced; the budget ran out and the final text carries
        // NO raw markup.
        expect(sendMock).toHaveBeenCalledTimes(3);
        expect(result.finalText).toBe('Trying...');
        expect(result.finalText).not.toContain('<');
    });
});

describe('streamChatWithDeskTools live-path reset', () => {
    it('fires onStreamReset between the discarded attempt and the corrected round', async () => {
        const order: string[] = [];
        streamMock
            .mockImplementationOnce(async function* (_cfg: unknown, _msgs: unknown, opts: { onStreamToolCalls?: (c: unknown[]) => void }) {
                yield '<tool_call>';
                yield '<function=scan_setups>';
                yield '</function></tool_call>';
                opts?.onStreamToolCalls?.([]);
            })
            .mockImplementationOnce(async function* (_cfg: unknown, _msgs: unknown, opts: { onStreamToolCalls?: (c: unknown[]) => void }) {
                order.push('round2-start');
                yield 'Clean answer.';
                opts?.onStreamToolCalls?.([]);
            });

        const deltas = await collect(streamChatWithDeskTools(config, [{ role: 'user', content: 'scan' }], {
            onStreamReset: () => { order.push('reset'); },
        }));

        // Both rounds streamed (the bubble repaints from the reset)…
        expect(deltas.join('')).toContain('Clean answer.');
        // …and the reset fired BEFORE the corrected round started.
        expect(order).toEqual(['reset', 'round2-start']);
    });
});

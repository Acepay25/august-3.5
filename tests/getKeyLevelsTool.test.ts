/**
 * get_key_levels — the feeder for the Key Levels card.
 *
 * The card protocol existed with nothing computing its numbers: the prompt
 * asked the model to end with a `key-levels` fence, and the only sources were
 * whatever the hybrid packet happened to print or a `get_indicators(structure)`
 * result the model had to retype. These tests pin the missing half — that the
 * tool is offered, computes from real candles for the asked symbol/timeframe,
 * and hands back a fence that the CARD's own parser accepts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from '../types/provider';

const { streamMock, ohlcvMock } = vi.hoisted(() => ({
    streamMock: vi.fn(),
    ohlcvMock: vi.fn(),
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: streamMock,
    sendChatRequest: vi.fn(),
    sendChatTurn: vi.fn(),
}));

const candles = Array.from({ length: 200 }, (_, i) => {
    const close = 100 + Math.sin(i / 6) * 4 + i * 0.05;
    return {
        time: 1_700_000_000_000 + i * 3_600_000,
        open: close - 0.3,
        high: close + 1.2,
        low: close - 1.1,
        close,
        volume: 1_000 + (i % 11) * 90,
    };
});

vi.mock('../services/analysis/MarketDataService', () => ({
    extractSymbolFromPrompt: vi.fn(() => 'BTCUSDT'),
    normalizeSymbol: vi.fn((s: unknown) => (typeof s === 'string' && s ? s : 'BTCUSDT')),
    fetchFuturesOHLCV: ohlcvMock,
    fetchFuturesTicker24h: vi.fn(async () => ({ currentPrice: 100, priceChangePercent24h: 0 })),
    fetchOHLCV: vi.fn(async () => []),
    fetchMarketData: vi.fn(async () => ({ symbol: 'BTCUSDT', currentPrice: 100 })),
    fetchMarkIndex: vi.fn(async () => null),
    fetchOrderBookDepth: vi.fn(async () => null),
    fetchDerivativesData: vi.fn(async () => ({ openInterestValue: 1e8, available: true })),
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

import { runDeskToolLoop, toAnthropicTools, toolLabel, clearDeskToolCache } from '../services/analysis/DeskToolsService';
import { parseKeyLevels } from '../services/trade/keyLevels';

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

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
    let toolResult = '';
    let call = 0;
    streamMock.mockImplementation(async function* (
        _cfg: unknown,
        messages: unknown,
        options?: { onStreamToolCalls?: (c: unknown) => void },
    ) {
        call += 1;
        if (call === 1) {
            options?.onStreamToolCalls?.([{ id: 't1', name, arguments: args }]);
            return;
        }
        for (const m of (messages as Array<{ role: string; content: unknown }>)) {
            if (m.role === 'tool' && typeof m.content === 'string') toolResult = m.content;
        }
        yield 'done';
    });
    const loop = await runDeskToolLoop({
        config,
        messages: [{ role: 'user', content: 'key levels?' }],
        sendTurn: vi.fn(),
        streamTurn: streamMock,
        onTextDelta: () => {},
        nativeTools: true,
        options: { maxTokens: 512, defaultSymbol: 'BTCUSDT', enabled: true },
    } as never);
    expect(loop.usedTools).toContain(name);
    return toolResult;
}

function parseToolResult(raw: string): Record<string, unknown> {
    return JSON.parse(raw.split('\n…[')[0].trim()) as Record<string, unknown>;
}

describe('get_key_levels', () => {
    beforeEach(() => {
        streamMock.mockReset();
        ohlcvMock.mockReset();
        ohlcvMock.mockImplementation(async () => candles);
        clearDeskToolCache();
    });

    it('is offered to the model as a callable tool, with a human label', () => {
        const names = (toAnthropicTools() as Array<{ name: string }>).map(t => t.name);
        expect(names).toContain('get_key_levels');
        expect(toolLabel('get_key_levels')).toBe('key levels');
    });

    it('computes the levels for the asked symbol and timeframe', async () => {
        const parsed = parseToolResult(await callTool('get_key_levels', { symbol: 'ETHUSDT', interval: '4h' }));
        expect(parsed.symbol).toBe('ETHUSDT');
        expect(parsed.interval).toBe('4h');
        expect(ohlcvMock).toHaveBeenCalledWith('ETHUSDT', '4h', 250);
        expect(Array.isArray(parsed.support)).toBe(true);
        expect(Array.isArray(parsed.resistance)).toBe(true);
        expect((parsed.support as unknown[]).length).toBeGreaterThan(0);
        expect((parsed.resistance as unknown[]).length).toBeGreaterThan(0);
        expect(parsed.pivots).toBeTruthy();
    });

    it('hands back a key-levels fence the card parser ACCEPTS', async () => {
        const parsed = parseToolResult(await callTool('get_key_levels', { interval: '1h' }));
        const block = String(parsed.keyLevelsBlock ?? '');
        expect(block.startsWith('```key-levels')).toBe(true);
        expect(block.endsWith('```')).toBe(true);
        const card = parseKeyLevels(block);
        expect(card.hadBlock).toBe(true);
        expect(card.levels.length).toBeGreaterThan(0);
        // The card classifies from the label — the tool must emit R/S/VWAP
        // labels, not arbitrary prose, or every line paints as "level".
        expect(card.levels.some(l => l.kind === 'resistance' || l.kind === 'support' || l.kind === 'vwap')).toBe(true);
        expect(String(parsed.publish)).toContain('VERBATIM');
    });

    it('never duplicates one price as two published levels', async () => {
        const parsed = parseToolResult(await callTool('get_key_levels', {}));
        const card = parseKeyLevels(String(parsed.keyLevelsBlock ?? ''));
        const prices = card.levels.map(l => l.price);
        expect(new Set(prices).size).toBe(prices.length);
        // 4 resistance + VWAP + 4 support is the published ceiling.
        expect(card.levels.length).toBeLessThanOrEqual(9);
    });

    it('says the scan was empty instead of publishing an invented fence', async () => {
        ohlcvMock.mockImplementation(async () => []);
        const parsed = parseToolResult(await callTool('get_key_levels', {}));
        expect(String(parsed.error)).toContain('not enough candles');
        expect(parsed.keyLevelsBlock).toBeUndefined();
    });
});

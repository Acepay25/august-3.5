/**
 * get_indicators — the on-demand technical-study tool.
 *
 * It exists because every function it calls was already implemented and
 * unit-tested in TechnicalAnalysisService, yet none of them was CALLABLE: the
 * model could only read the studies the hybrid packet happened to carry, so it
 * could never ask "is OBV diverging?" or "what does Ichimoku say here?".
 *
 * These tests pin the wiring, not the maths: that the tool is offered, that
 * each study group routes to the right function, and that a bad request gets
 * the menu back instead of an exception.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from '../types/provider';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

import { runDeskToolLoop, toAnthropicTools, clearDeskToolCache } from '../services/analysis/DeskToolsService';

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

/**
 * Script one tool-calling round, then a clean final round, and return the tool
 * result content the executor handed back to the model.
 */
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
        // The executor's result is appended as a tool-role message.
        for (const m of (messages as Array<{ role: string; content: unknown }>)) {
            if (m.role === 'tool' && typeof m.content === 'string') toolResult = m.content;
        }
        yield 'done';
    });
    const loop = await runDeskToolLoop({
        config,
        messages: [{ role: 'user', content: 'read it' }],
        sendTurn: vi.fn(),
        streamTurn: streamMock,
        onTextDelta: () => {},
        nativeTools: true,
        options: { maxTokens: 512, defaultSymbol: 'BTCUSDT', enabled: true },
    } as never);
    expect(loop.usedTools).toContain(name);
    return toolResult;
}

/**
 * The tool result as the app itself reads it back: the JSON body, minus any
 * spill receipt / clip note trailer (both are deliberately appended AFTER the
 * payload so a clipped result names what it lost without hiding the bytes).
 * `pick` walks into it so assertions stay typed instead of casting to `any`.
 */
function parseToolResult(raw: string): Record<string, unknown> {
    const body = raw.split('\n…[')[0].trim();
    return JSON.parse(body) as Record<string, unknown>;
}

const pick = (obj: Record<string, unknown>, path: string): unknown => {
    let node: unknown = obj;
    for (const key of path.split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[key];
    }
    return node;
};

const expectNumber = (value: unknown, label: string): void => {
    expect(typeof value, label).toBe('number');
};

describe('get_indicators', () => {
    beforeEach(() => {
        streamMock.mockReset();
        ohlcvMock.mockReset();
        ohlcvMock.mockImplementation(async () => candles);
        clearDeskToolCache();
    });

    it('is offered to the model as a callable tool', () => {
        const names = (toAnthropicTools() as Array<{ name: string }>).map(t => t.name);
        expect(names).toContain('get_indicators');
    });

    it('returns the requested study groups for the asked symbol and timeframe', async () => {
        const parsed = parseToolResult(await callTool('get_indicators', { symbol: 'ETHUSDT', interval: '4h', studies: ['core', 'ichimoku'] }));
        expect(parsed.symbol).toBe('ETHUSDT');
        expect(parsed.interval).toBe('4h');
        expect(pick(parsed, 'core.rsi')).toBeDefined();
        expectNumber(pick(parsed, 'ichimoku.cloudTop'), 'ichimoku.cloudTop');
        expect(ohlcvMock).toHaveBeenCalledWith('ETHUSDT', '4h', 250);
    });

    it('routes each study group to its own function', async () => {
        // One group per call is how the model will actually ask, and each
        // result must fit the tool-result budget on its own — which is why the
        // runner also bounds a single call to three studies.
        for (const [study, key] of [
            ['momentum', 'momentumScore'],
            ['regime', 'adx'],
            ['vwap', 'vwap'],
        ] as const) {
            const parsed = parseToolResult(await callTool('get_indicators', { studies: [study] }));
            expectNumber(pick(parsed, `${study}.${key}`), `${study}.${key}`);
        }
        const volume = parseToolResult(await callTool('get_indicators', { studies: ['volume'] }));
        expect(pick(volume, 'volume.obvTrend')).toBeDefined();
        const structure = parseToolResult(await callTool('get_indicators', { studies: ['structure'] }));
        expect((pick(structure, 'structure.support') as unknown[]).length).toBeGreaterThan(0);
        expect(pick(structure, 'structure.pivots')).toBeDefined();
    });

    it('bounds a too-large request instead of answering with a mangled payload', async () => {
        const raw = await callTool('get_indicators', {
            studies: ['core', 'momentum', 'regime', 'volume', 'vwap', 'ichimoku', 'structure'],
        });
        // The whole point: a result that outgrows the budget must still be
        // PARSEABLE. The old path did `slice(0, visible)` on the raw string,
        // which cut mid-object — the model got broken JSON, could not tell it
        // from a real answer, and never re-read the rest. The request is now
        // bounded instead, so the extra studies are named rather than dropped.
        expect(() => parseToolResult(raw)).not.toThrow();
        expect(raw.length).toBeLessThanOrEqual(2400);
        const parsed = parseToolResult(raw);
        expect(Object.keys(parsed)).toEqual(
            expect.arrayContaining(['core', 'momentum', 'regime', 'notRun']),
        );
        expect(pick(parsed, 'notRun.studies')).toEqual(['volume', 'vwap', 'ichimoku', 'structure']);
    });

    it('answers an unknown study with the menu instead of throwing', async () => {
        const parsed = parseToolResult(await callTool('get_indicators', { studies: ['nonsense'] }));
        expect(parsed.error).toBeTruthy();
        expect((pick(parsed, 'available') as Array<{ id: string }>).map(a => a.id)).toContain('ichimoku');
    });

    it('refuses to compute off too little history', async () => {
        ohlcvMock.mockImplementation(async () => candles.slice(0, 5));
        const parsed = parseToolResult(await callTool('get_indicators', { studies: ['core'] }));
        expect(parsed.error).toMatch(/not enough candles/);
    });
});

describe('the wider study catalogue reaches the model', () => {
    // This block needs its own setup: the describe above resets ohlcvMock in
    // its beforeEach, and without one here the tool fetches nothing.
    beforeEach(() => {
        streamMock.mockReset();
        ohlcvMock.mockReset();
        ohlcvMock.mockImplementation(async () => candles);
        clearDeskToolCache();
    });

    it('a ta* group returns its studies', async () => {
        const parsed = parseToolResult(await callTool('get_indicators', { studies: ['taTrend'] }));
        expect(pick(parsed, 'taTrend.aroon.up')).toBeTypeOf('number');
        expect(pick(parsed, 'taTrend.vortex.viPlus')).toBeTypeOf('number');
    });

    it('the ta* groups are advertised, so the model knows they exist', () => {
        // A group the tool never names is a group the model never asks for.
        const src = readFileSync(resolve(__dirname, '../services/analysis/DeskToolsService.ts'), 'utf8');
        for (const g of ['taAverages', 'taBands', 'taOscillators', 'taTrend', 'taVolatility', 'taVolumeFlow', 'taOverlays']) {
            expect(src, g).toContain(g);
        }
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// AITrendlineService's JSON boundary (perf/cleanup pass): the hand-rolled
// fence-only extractor failed on any response that wrapped its JSON in extra
// prose ("Sure! Here is the analysis: {…}") — the canonical boundary parser
// (extractAndParseJson) handles fenced blocks, bare JSON, and leading junk.
// These tests lock that contract through the provider transport mock.

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => []),
    getReadyProviders: vi.fn((configs: unknown[]) => configs),
}));
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
}));

import { analyzeWithAI } from '../services/analysis/AITrendlineService';
import { loadProviderConfigs, getReadyProviders } from '../services/infrastructure/ProviderConfigService';
import { sendChatRequest } from '../services/providers/GenericProviderService';

const provider = {
    id: 'p1', name: 'Test', apiKey: 'k', baseUrl: 'https://x', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: false, models: ['m'], selectedModel: 'm',
};

const candles = Array.from({ length: 5 }, (_, i) => ({
    time: i as never, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10,
}));

const payload = JSON.stringify({
    trendlines: [{ startIndex: 0, endIndex: 4, startPrice: 100, endPrice: 104, type: 'resistance', strength: 0.8, touches: 2 }],
    marketBias: 'bullish',
    keyLevels: [{ price: 104, type: 'resistance', strength: 0.8, significance: 'test' }],
    summary: 'Higher highs.',
    insights: { situation: 'Up.', observations: ['a'], potentialMoves: { bullish: 'x', bearish: 'y' }, riskFactors: ['z'] },
});

beforeEach(() => {
    vi.mocked(loadProviderConfigs).mockResolvedValue([provider] as never);
    vi.mocked(getReadyProviders).mockImplementation((c: unknown) => c as never);
    vi.mocked(sendChatRequest).mockReset();
});

describe('AITrendlineService JSON boundary', () => {
    it('parses a fenced json block', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue('```json\n' + payload + '\n```');
        const r = await analyzeWithAI(candles as never, 'BTCUSDT', '1h');
        expect(r.summary).toBe('Higher highs.');
    });

    it('parses bare JSON with no fence at all', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue(payload);
        const r = await analyzeWithAI(candles as never, 'BTCUSDT', '1h');
        expect(r.marketBias).toBe('bullish');
    });

    it('parses JSON wrapped in leading prose (the old extractor failed here)', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue('Sure! Here is the analysis: ' + payload);
        const r = await analyzeWithAI(candles as never, 'BTCUSDT', '1h');
        expect(r.summary).toBe('Higher highs.');
        expect(r.trendlines.length).toBe(1);
    });

    it('falls through to the next provider when one returns unparseable junk', async () => {
        const provider2 = { ...provider, id: 'p2', name: 'Test2' };
        vi.mocked(loadProviderConfigs).mockResolvedValue([provider, provider2] as never);
        vi.mocked(sendChatRequest)
            .mockResolvedValueOnce('no json here at all')
            .mockResolvedValueOnce(payload);
        const r = await analyzeWithAI(candles as never, 'BTCUSDT', '1h');
        expect(r.summary).toBe('Higher highs.');
        expect(sendChatRequest).toHaveBeenCalledTimes(2);
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Market-data fetchers are mocked; only the web_search HTTP layer and the
// throwing fetcher matter for sentinel behavior.
const { fetchMarketDataMock } = vi.hoisted(() => ({
  fetchMarketDataMock: vi.fn(),
}));
vi.mock('../services/analysis/MarketDataService', () => ({
  extractSymbolFromPrompt: vi.fn(() => 'BTCUSDT'),
  fetchDerivativesData: vi.fn(async () => ({})),
  fetchFundingRate: vi.fn(async () => 0),
  fetchMarketData: ((...args: unknown[]) => fetchMarketDataMock(...args)) as never,
  fetchOHLCV: vi.fn(async () => []),
  fetchOrderBookDepth: vi.fn(async () => ({})),
  fetchRecentLiquidations: vi.fn(async () => ({ recentEvents: [] })),
  normalizeSymbol: vi.fn((s: string) => s),
}));

import {
  executeDeskTool,
  clearDeskToolCache,
  DATA_UNAVAILABLE_PREFIX,
  isDataUnavailable,
} from '../services/analysis/DeskToolsService';

const htmlWithResults =
  '<div><a class="result__a" href="https://ex.co/a">BTC ETF inflows surge</a></div>';

describe('desk-tool DATA_UNAVAILABLE sentinels', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMarketDataMock.mockReset();
    clearDeskToolCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collapses a total web_search failure to one machine-readable sentinel', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await executeDeskTool({ id: 'w1', name: 'web_search', arguments: { query: 'btc fomc' } });
    expect(isDataUnavailable(res.content)).toBe(true);
    expect(res.content).toContain('UNKNOWN');
    // Not prose a model could read as "there was no news".
    expect(res.content).not.toMatch(/no useful results|proceed with chart data/i);
  });

  it('never caches a sentinel: an outage must not freeze into the TTL', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await executeDeskTool({ id: 'w1', name: 'web_search', arguments: { query: 'btc fomc' } });
    await executeDeskTool({ id: 'w2', name: 'web_search', arguments: { query: 'btc fomc' } });
    // Each failed call attempts both sources — 4 fetches, not 2.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps partial failure honest: real headlines plus a per-source sentinel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('api.duckduckgo.com')) throw new Error('json api down');
      return { ok: true, text: async () => htmlWithResults, json: async () => ({}) };
    });
    const res = await executeDeskTool({ id: 'w1', name: 'web_search', arguments: { query: 'btc etf' } });
    expect(res.content).toContain('Headlines:');
    expect(res.content).toContain('BTC ETF inflows surge');
    expect(res.content).toContain(`${DATA_UNAVAILABLE_PREFIX} web_search:instant-answer`);
    // Substantive content IS cacheable — the second call must not re-fetch.
    await executeDeskTool({ id: 'w2', name: 'web_search', arguments: { query: 'btc etf' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a throwing data tool returns ok:false with the sentinel, not raw failure prose', async () => {
    fetchMarketDataMock.mockRejectedValue(new Error('binance unreachable'));
    const res = await executeDeskTool({ id: 'd1', name: 'get_derivatives', arguments: { symbol: 'BTCUSDT' } });
    expect(res.ok).toBe(false);
    expect(isDataUnavailable(res.content)).toBe(true);
  });
});

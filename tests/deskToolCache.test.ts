import { describe, it, expect, vi, beforeEach } from 'vitest';

// Market data fetchers are mocked so the cache behavior is observable
// without network calls.
const { orderBookMock, liquidationsMock, hybridMock, injectionMock } = vi.hoisted(() => ({
  orderBookMock: vi.fn(),
  liquidationsMock: vi.fn(),
  hybridMock: vi.fn(),
  injectionMock: vi.fn(),
}));
vi.mock('../services/analysis/MarketDataService', () => ({
  extractSymbolFromPrompt: vi.fn(() => 'BTCUSDT'),
  fetchDerivativesData: vi.fn(async () => ({})),
  fetchFundingRate: vi.fn(async () => ({})),
  fetchMarketData: vi.fn(async () => ({})),
  fetchOHLCV: vi.fn(async () => []),
  fetchOrderBookDepth: ((...args: unknown[]) => orderBookMock(...args)) as never,
  fetchRecentLiquidations: ((...args: unknown[]) => liquidationsMock(...args)) as never,
  normalizeSymbol: vi.fn((s: string) => s),
}));
// The hybrid packet behind get_market_packet — the CACHE must hold the
// pre-stamp base, so this returns a fixed markdown body per call.
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
  fetchHybridData: ((...args: unknown[]) => hybridMock(...args)) as never,
  generateHybridPromptInjection: ((...args: unknown[]) => injectionMock(...args)) as never,
}));

import {
  executeDeskTool,
  clearDeskToolCache,
  budgetToolContent,
  MAX_TOOL_CONTENT_CHARS,
  TOOL_CACHE_TTL_MS,
} from '../services/analysis/DeskToolsService';
import { formatLiveMarkStamp } from '../services/trade/tradeChatContext';

const bigBook = () => ({
  symbol: 'BTCUSDT',
  buyWalls: Array.from({ length: 12 }, (_, i) => ({ price: 95000 - i * 10, usdValue: (i + 1) * 1000 })),
  sellWalls: Array.from({ length: 12 }, (_, i) => ({ price: 96000 + i * 10, usdValue: (12 - i) * 1000 })),
  spread: 1000,
});

describe('Desk tool cache + result budget', () => {
  beforeEach(() => {
    vi.useRealTimers();
    orderBookMock.mockReset();
    liquidationsMock.mockReset();
    // These two were never reset, so an implementation set by one test leaked
    // into the next — the packet tests only passed while they ran first.
    hybridMock.mockReset();
    injectionMock.mockReset();
    clearDeskToolCache();
  });

  it('serves repeat calls within the TTL from cache (one fetch)', async () => {
    orderBookMock.mockResolvedValue(bigBook());
    const first = await executeDeskTool({ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    const second = await executeDeskTool({ id: 'c2', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    expect(orderBookMock).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(true);
    // Same payload — but marked as a replay. A cache hit that is
    // byte-identical to a fresh read is how a model ends up "confirming" a
    // price move with the very snapshot it was trying to confirm.
    expect(second.content.startsWith('[DESK CACHE')).toBe(true);
    expect(second.content.endsWith(first.content)).toBe(true);
  });

  it('keys the cache by name + arguments', async () => {
    orderBookMock.mockResolvedValue(bigBook());
    await executeDeskTool({ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    await executeDeskTool({ id: 'c2', name: 'get_order_book', arguments: { symbol: 'ETHUSDT' } });
    expect(orderBookMock).toHaveBeenCalledTimes(2);
  });

  it('does not serve one chart packet to another chart', async () => {
    // Argument-less calls used to collide as `get_market_packet:{}`, so an ETH
    // dock asking the same question within the TTL got BTC's tape — wrong
    // symbol, not merely stale, and no stamp on the payload gives it away.
    const asked: string[] = [];
    hybridMock.mockImplementation(async (sym: string) => {
      asked.push(sym);
      return { symbol: sym };
    });
    injectionMock.mockImplementation((packet: { symbol?: string }) => `PACKET ${packet?.symbol}`);
    const onBtc = await executeDeskTool(
      { id: 's1', name: 'get_market_packet', arguments: {} },
      { defaultSymbol: 'BTCUSDT' },
    );
    const onEth = await executeDeskTool(
      { id: 's2', name: 'get_market_packet', arguments: {} },
      { defaultSymbol: 'ETHUSDT' },
    );
    expect(asked).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(onBtc.content).toBe('PACKET BTCUSDT');
    // Pre-fix this read 'PACKET BTCUSDT' — the ETH dock served BTC's tape.
    expect(onEth.content).toBe('PACKET ETHUSDT');
  });

  it('stamps a packet with the CURRENT mark when the surface offers a reader', async () => {
    // The frozen `liveMarkPrice` is captured when a seat TURN starts. On the
    // third desk round of a long turn that value is the opening tick — so a
    // surface that can read the feed passes a getter, and it must win.
    hybridMock.mockResolvedValue({} as never);
    injectionMock.mockReturnValue('PACKET BODY');
    const res = await executeDeskTool(
      { id: 'g1', name: 'get_market_packet', arguments: { symbol: 'BTCUSDT' } },
      { defaultSymbol: 'BTCUSDT', liveMarkPrice: 100, getLiveMarkPrice: () => 250 },
    );
    expect(res.content).toContain('$250.00');
    expect(res.content).not.toContain('$100.00');
  });

  it('re-fetches after the TTL expires', async () => {
    vi.useFakeTimers();
    orderBookMock.mockResolvedValue(bigBook());
    await executeDeskTool({ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    vi.advanceTimersByTime(TOOL_CACHE_TTL_MS + 1);
    await executeDeskTool({ id: 'c2', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    expect(orderBookMock).toHaveBeenCalledTimes(2);
  });

  it('clearDeskToolCache forces a fresh fetch', async () => {
    orderBookMock.mockResolvedValue(bigBook());
    await executeDeskTool({ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    clearDeskToolCache();
    await executeDeskTool({ id: 'c2', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    expect(orderBookMock).toHaveBeenCalledTimes(2);
  });

  it('budgets order-book walls to the top 5 by usdValue', () => {
    const budgeted = budgetToolContent('get_order_book', JSON.stringify(bigBook()));
    const parsed = JSON.parse(budgeted) as { buyWalls: unknown[]; sellWalls: unknown[] };
    expect(parsed.buyWalls).toHaveLength(5);
    expect(parsed.sellWalls).toHaveLength(5);
    // Biggest walls survive the cut.
    expect(JSON.stringify(parsed.buyWalls)).toContain('12000');
    expect(JSON.stringify(parsed.sellWalls)).toContain('12000');
  });

  it('budgets liquidations to the 10 most recent events', () => {
    const liq = { recentEvents: Array.from({ length: 40 }, (_, i) => ({ id: i, usdValue: 100 })) };
    const budgeted = budgetToolContent('get_liquidations', JSON.stringify(liq));
    const parsed = JSON.parse(budgeted) as { recentEvents: unknown[] };
    expect(parsed.recentEvents).toHaveLength(10);
  });

  it('hard-caps oversized tool output', () => {
    const huge = `x`.repeat(MAX_TOOL_CONTENT_CHARS * 3);
    const budgeted = budgetToolContent('web_search', huge);
    expect(budgeted.length).toBeLessThanOrEqual(MAX_TOOL_CONTENT_CHARS + 20);
    // Marker names the tool and both lengths: a clipped result must not read
    // as a complete one. Still inside the cap — the note is carved out of it.
    expect(budgeted).toContain('…[truncated web_search:');
  });

  it('applies the budget to live tool results before caching', async () => {
    orderBookMock.mockResolvedValue(bigBook());
    const result = await executeDeskTool({ id: 'c1', name: 'get_order_book', arguments: { symbol: 'BTCUSDT' } });
    const parsed = JSON.parse(result.content) as { buyWalls: unknown[] };
    expect(parsed.buyWalls).toHaveLength(5);
  });

  it('get_market_packet caches the PRE-STAMP base and re-stamps a hit with the CURRENT mark', async () => {
    hybridMock.mockResolvedValue({});
    injectionMock.mockReturnValue('## packet body');
    const first = await executeDeskTool(
      { id: 'p1', name: 'get_market_packet', arguments: {} },
      { defaultSymbol: 'BTCUSDT', liveMarkPrice: 100 },
    );
    expect(first.ok).toBe(true);
    expect(first.content).toContain(formatLiveMarkStamp(100));
    // Second call, SAME args (→ cache hit, one fetch only) but a NEW mark:
    // the stamp must be THIS call's — never a replay of the 100 "now".
    const second = await executeDeskTool(
      { id: 'p2', name: 'get_market_packet', arguments: {} },
      { defaultSymbol: 'BTCUSDT', liveMarkPrice: 220 },
    );
    expect(hybridMock).toHaveBeenCalledTimes(1);
    expect(second.content).toContain(formatLiveMarkStamp(220));
    expect(second.content).not.toContain(formatLiveMarkStamp(100));
  });

  it('a full-size packet is truncated to make ROOM for its stamps (they survive the budget)', async () => {
    hybridMock.mockResolvedValue({});
    injectionMock.mockReturnValue('P'.repeat(9000)); // over the 6000-char packet budget
    const result = await executeDeskTool(
      { id: 'p3', name: 'get_market_packet', arguments: {} },
      { defaultSymbol: 'BTCUSDT', liveMarkPrice: 330 },
    );
    const stamp = formatLiveMarkStamp(330);
    expect(result.content).toContain(stamp);
    // Truncated base + tail fit inside the tool's own budget (stamps were
    // sliced off before — the whole "this is now" line could vanish).
    // +24 for the truncation marker (same tolerance as the cap test above).
    expect(result.content.length).toBeLessThanOrEqual(6000 + 24);
    expect(result.content).toContain('…[truncated get_market_packet:');
  });
});

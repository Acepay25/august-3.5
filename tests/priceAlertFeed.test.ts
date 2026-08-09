import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceAlertService } from '../services/ui/PriceAlertService';

/**
 * Regression coverage for the watch-feed gap (F2-1): the price feed used to
 * stream ONLY alert symbols, so "watch this setup" on a symbol without a
 * pre-existing price alert never received ticks (and the live-price refresh
 * cache stayed empty for it). trackSymbol/untrackSymbol register non-alert
 * consumers with the feed.
 */
describe('PriceAlertService feed tracking', () => {
  const fetchMock = vi.fn();
  // TS `private` members are compile-time only — reachable for test isolation.
  const svc = PriceAlertService as unknown as {
    trackedSymbols: Set<string>;
    prices: Map<string, number>;
    pollingInterval: ReturnType<typeof setInterval> | null;
    stopMonitoring(): void;
    trackSymbol(symbol: string): boolean;
    untrackSymbol(symbol: string): boolean;
    getCurrentPrice(symbol: string): number | undefined;
    subscribePrices(cb: (symbol: string, price: number) => void): () => void;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ json: async () => ({ symbol: 'BTCUSDT', price: '100.5' }) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    svc.trackedSymbols.clear();
    svc.prices.clear();
    svc.stopMonitoring();
  });

  afterEach(() => {
    svc.stopMonitoring();
    vi.useRealTimers();
  });

  it('polls a tracked symbol even with zero alerts and delivers ticks to subscribers', async () => {
    const ticks: Array<[string, number]> = [];
    const unsubscribe = svc.subscribePrices((symbol, price) => ticks.push([symbol, price]));

    expect(svc.trackSymbol('BTC')).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);

    // The polling loop hit the normalized symbol (BTC → BTCUSDT) with no
    // alerts registered anywhere.
    expect(fetchMock).toHaveBeenCalledWith('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    // The tick populated the shared price cache AND fanned out to subscribers
    // (SetupWatchService.handlePriceTick → watch evaluation).
    expect(svc.getCurrentPrice('BTCUSDT')).toBe(100.5);
    expect(ticks).toEqual([['BTCUSDT', 100.5]]);
    unsubscribe();
  });

  it('stops the polling loop when the last tracked symbol is removed', () => {
    expect(svc.trackSymbol('BTC')).toBe(true);
    expect(svc.pollingInterval).not.toBeNull();

    expect(svc.untrackSymbol('BTC')).toBe(true);
    expect(svc.pollingInterval).toBeNull();
  });
});

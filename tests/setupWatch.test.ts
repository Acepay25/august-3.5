import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory Preferences store (avoids Capacitor / localStorage in tests).
let store: unknown = null;
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async () => store),
  setPreferenceObject: vi.fn(async (_key: string, value: unknown) => {
    store = value;
  }),
  PREF_KEYS: { SETUP_WATCHES: 'setup_watches' },
}));

// Captured price-feed callbacks — tests drive ticks directly instead of
// hitting a real WebSocket. normalizeSymbol mirrors the real Binance rule.
const feed = vi.hoisted(() => ({
  tickCallbacks: [] as Array<(symbol: string, price: number) => void>,
}));

vi.mock('../services/ui/PriceAlertService', () => ({
  PriceAlertService: {
    acquireMonitor: vi.fn(() => () => {}),
    subscribePrices: vi.fn((cb: (symbol: string, price: number) => void) => {
      feed.tickCallbacks.push(cb);
      return () => {
        const i = feed.tickCallbacks.indexOf(cb);
        if (i >= 0) feed.tickCallbacks.splice(i, 1);
      };
    }),
    getCurrentPrice: vi.fn(() => undefined),
    trackSymbol: vi.fn(() => true),
    untrackSymbol: vi.fn(() => true),
    normalizeSymbol: (name: string) => {
      const cleaned = name.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return cleaned.includes('USDT') ? cleaned : `${cleaned}USDT`;
    },
  },
}));

import { SetupWatchService, describeWatchTrigger } from '../services/ui/SetupWatchService';
import type { CreateSetupWatchParams } from '../services/ui/SetupWatchService';
import { PriceAlertService } from '../services/ui/PriceAlertService';

const tick = (symbol: string, price: number) => {
  feed.tickCallbacks.forEach(cb => cb(symbol, price));
};

const makeParams = (overrides: Partial<CreateSetupWatchParams> = {}): CreateSetupWatchParams => ({
  messageId: 'ensemble-1',
  coinName: 'BTC',
  triggerType: 'PRICE_ABOVE',
  priceLevel: 100,
  percent: undefined,
  referencePrice: 95,
  ...overrides,
});

describe('SetupWatchService', () => {
  beforeEach(() => {
    store = null;
    feed.tickCallbacks.length = 0;
    SetupWatchService.resetForTest();
  });

  describe('trigger evaluation', () => {
    it('fires PRICE_ABOVE only when price crosses the level', () => {
      const fires: Array<{ symbol: string; price: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ symbol: t.watch.symbol, price: t.currentPrice }));
      SetupWatchService.createWatch(makeParams());

      tick('BTCUSDT', 99.99);
      expect(fires).toHaveLength(0);

      tick('BTCUSDT', 100);
      expect(fires).toHaveLength(1);
      expect(fires[0]).toEqual({ symbol: 'BTCUSDT', price: 100 });
      const watch = SetupWatchService.getWatchForMessage('ensemble-1');
      expect(watch?.status).toBe('TRIGGERED');
      expect(watch?.triggerCount).toBe(1);
      expect(watch?.triggeredAt).toBeDefined();
    });

    it('is fire-once — later ticks do not re-fire', () => {
      const fires: Array<{ price: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ price: t.currentPrice }));
      SetupWatchService.createWatch(makeParams());

      tick('BTCUSDT', 100);
      tick('BTCUSDT', 150);
      tick('BTCUSDT', 200);

      expect(fires).toHaveLength(1);
      expect(SetupWatchService.getWatchForMessage('ensemble-1')?.triggerCount).toBe(1);
    });

    it('fires PRICE_BELOW at the boundary (price <= level)', () => {
      const fires: Array<{ price: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ price: t.currentPrice }));
      SetupWatchService.createWatch(makeParams({ triggerType: 'PRICE_BELOW', priceLevel: 50, referencePrice: 60 }));

      tick('BTCUSDT', 50.01);
      expect(fires).toHaveLength(0);
      tick('BTCUSDT', 50);
      expect(fires).toHaveLength(1);
      expect(fires[0].price).toBe(50);
    });

    it('fires PCT_MOVE at the exact ±percent boundary', () => {
      const fires: Array<{ price: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ price: t.currentPrice }));
      SetupWatchService.createWatch(makeParams({ triggerType: 'PCT_MOVE', percent: 2, priceLevel: undefined, referencePrice: 100 }));

      tick('BTCUSDT', 101.9);
      expect(fires).toHaveLength(0);
      tick('BTCUSDT', 102); // +2% exactly
      expect(fires).toHaveLength(1);
      tick('BTCUSDT', 90); // after trigger, no re-fire
      expect(fires).toHaveLength(1);

      // Opposite direction also counts.
      SetupWatchService.resetForTest();
      SetupWatchService.createWatch(makeParams({ triggerType: 'PCT_MOVE', percent: 2, priceLevel: undefined, referencePrice: 100 }));
      tick('BTCUSDT', 98);
      expect(SetupWatchService.getWatchForMessage('ensemble-1')?.status).toBe('TRIGGERED');
    });

    it('ignores ticks for unrelated symbols', () => {
      const fires: Array<{ price: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ price: t.currentPrice }));
      SetupWatchService.createWatch(makeParams());

      tick('ETHUSDT', 5000);
      tick('BTCUSDT', 99);
      expect(fires).toHaveLength(0);
    });

    it('rejects invalid configs and never fires them', () => {
      expect(SetupWatchService.createWatch(makeParams({ priceLevel: 0 }))).toBeNull();
      expect(SetupWatchService.createWatch(makeParams({ triggerType: 'PCT_MOVE', percent: 0, priceLevel: undefined }))).toBeNull();
      expect(SetupWatchService.createWatch(makeParams({ triggerType: 'PCT_MOVE', percent: 2, priceLevel: undefined, referencePrice: 0 }))).toBeNull();

      tick('BTCUSDT', 200);
      expect(SetupWatchService.getWatchForMessage('ensemble-1')).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('cancelWatch removes the watch and stops firing', () => {
      const fires: unknown[] = [];
      SetupWatchService.subscribe(t => fires.push(t));
      const watch = SetupWatchService.createWatch(makeParams());
      expect(watch).not.toBeNull();

      expect(SetupWatchService.cancelWatch(watch!.id)).toBe(true);
      expect(SetupWatchService.getWatchForMessage('ensemble-1')).toBeUndefined();

      tick('BTCUSDT', 200);
      expect(fires).toHaveLength(0);
    });

    it('rearmWatch lets a triggered watch fire again', () => {
      const fires: Array<{ count: number }> = [];
      SetupWatchService.subscribe(t => fires.push({ count: t.watch.triggerCount }));
      const watch = SetupWatchService.createWatch(makeParams());

      tick('BTCUSDT', 100);
      // Re-fetch: watches are immutable-by-replacement, the pre-tick object
      // reference still reads ARMED.
      expect(SetupWatchService.getWatchForMessage('ensemble-1')?.status).toBe('TRIGGERED');
      expect(SetupWatchService.rearmWatch(watch!.id)).toBe(true);

      tick('BTCUSDT', 101);
      expect(SetupWatchService.getWatchForMessage('ensemble-1')?.status).toBe('TRIGGERED');
      expect(SetupWatchService.getWatchForMessage('ensemble-1')?.triggerCount).toBe(2);
    });

    it('dedupes — one ARMED watch per message', () => {
      const first = SetupWatchService.createWatch(makeParams());
      const second = SetupWatchService.createWatch(makeParams({ priceLevel: 200 }));
      expect(second?.id).toBe(first?.id);
      expect(second?.priceLevel).toBe(100); // existing watch wins
    });

    it('notifies change subscribers on create/cancel/trigger', () => {
      const changes: string[] = [];
      SetupWatchService.subscribeChanges(() => changes.push('change'));
      const watch = SetupWatchService.createWatch(makeParams());
      tick('BTCUSDT', 100);
      SetupWatchService.cancelWatch(watch!.id);
      expect(changes.length).toBe(3);
    });
  });

  describe('feed symbol registration', () => {
    it('registers the watch symbol with the shared price feed on create', () => {
      const trackSymbol = vi.mocked(PriceAlertService.trackSymbol);
      SetupWatchService.createWatch(makeParams());
      expect(trackSymbol).toHaveBeenCalledWith('BTCUSDT');
    });

    it('unregisters the symbol when the last watch for it is canceled', () => {
      const untrackSymbol = vi.mocked(PriceAlertService.untrackSymbol);
      const watch = SetupWatchService.createWatch(makeParams());
      untrackSymbol.mockClear();
      expect(SetupWatchService.cancelWatch(watch!.id)).toBe(true);
      expect(untrackSymbol).toHaveBeenCalledWith('BTCUSDT');
    });

    it('keeps the symbol registered while another watch still uses it', () => {
      const untrackSymbol = vi.mocked(PriceAlertService.untrackSymbol);
      const first = SetupWatchService.createWatch(makeParams());
      const second = SetupWatchService.createWatch(makeParams({ messageId: 'ensemble-2' }));
      expect(second).not.toBeNull();
      untrackSymbol.mockClear();
      SetupWatchService.cancelWatch(first!.id);
      expect(untrackSymbol).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('saves on create and rehydrates armed watches after restart', async () => {
      SetupWatchService.createWatch(makeParams());
      // Writes are serialized through a promise chain (each save takes a
      // microtask hop), so drain the queue before asserting the store.
      await new Promise(r => setTimeout(r, 0));
      expect(store).not.toBeNull();

      // "Restart": wipe memory, re-init from the persisted store.
      SetupWatchService.resetForTest();
      await SetupWatchService.init();

      const watch = SetupWatchService.getWatchForMessage('ensemble-1');
      expect(watch?.status).toBe('ARMED');
      expect(watch?.symbol).toBe('BTCUSDT');

      // The restored watch fires on a fresh tick.
      const fires: unknown[] = [];
      SetupWatchService.subscribe(t => fires.push(t));
      tick('BTCUSDT', 100);
      expect(fires).toHaveLength(1);
    });

    it('drops CANCELED watches during hydration', async () => {
      const keep: CreateSetupWatchParams = makeParams();
      const cancel: CreateSetupWatchParams = makeParams({ messageId: 'ensemble-2', coinName: 'ETH' });
      const keepWatch = SetupWatchService.createWatch(keep);
      const cancelWatch = SetupWatchService.createWatch(cancel);
      SetupWatchService.cancelWatch(cancelWatch!.id);
      // Persist what we have, then restart. setTimeout drains the serialized
      // write chain (a bare Promise.resolve() can read mid-chain).
      await new Promise(r => setTimeout(r, 0));

      SetupWatchService.resetForTest();
      await SetupWatchService.init();

      expect(SetupWatchService.getWatchForMessage('ensemble-1')).toBeDefined();
      expect(SetupWatchService.getWatchForMessage('ensemble-2')).toBeUndefined();
      void keepWatch;
    });

    it('cancel persists the removal', async () => {
      const watch = SetupWatchService.createWatch(makeParams());
      SetupWatchService.cancelWatch(watch!.id);
      // Drain the serialized write chain so the cancel actually lands.
      await new Promise(r => setTimeout(r, 0));

      SetupWatchService.resetForTest();
      await SetupWatchService.init();
      expect(SetupWatchService.getWatchForMessage('ensemble-1')).toBeUndefined();
    });
  });

  describe('describeWatchTrigger', () => {
    it('renders human-readable trigger descriptions', () => {
      expect(describeWatchTrigger({ triggerType: 'PRICE_ABOVE', priceLevel: 69420, percent: undefined, referencePrice: 60000 })).toBe('price breaks above $69,420');
      expect(describeWatchTrigger({ triggerType: 'PRICE_BELOW', priceLevel: 123.45, percent: undefined, referencePrice: 130 })).toBe('price drops below $123.45');
      expect(describeWatchTrigger({ triggerType: 'PCT_MOVE', priceLevel: undefined, percent: 2, referencePrice: 50000 })).toBe('price moves ±2% from $50,000');
    });
  });
});

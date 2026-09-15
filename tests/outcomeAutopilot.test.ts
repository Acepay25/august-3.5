import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeOutcome } from '../types';
import type { TradeAnalysis } from '../types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

const prefStore: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  PREF_KEYS: { OUTCOME_AUTOPILOT_STATE: 'outcome_autopilot_state' },
  getPreferenceObject: vi.fn(async (key: string) => (prefStore[key] ?? null)),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    prefStore[key] = value;
  }),
}));

vi.mock('../services/ui/AutoCaptureService', () => ({
  verifyHistoricalOutcome: vi.fn(),
  extractSymbolFromAnalysis: vi.fn(() => 'BTCUSDT'),
}));

vi.mock('../services/backtesting/StopLossOptimizerService', () => ({
  trackSLOutcome: vi.fn(() => ({
    slWasTouched: true,
    extendedZoneBreached: false,
    missedWinDueToTightSL: false,
    maxAdverseExcursion: 1.2,
    atrMultiplierUsed: 1.5,
  })),
}));

// The registration path now holds the shared price feed (acquireSymbol) so
// autopilot-only coins actually receive ticks. Keep it a no-op here; the
// hold/release itself is asserted below via the mock.
const priceFeed = vi.hoisted(() => ({
  acquired: [] as string[],
  releases: [] as Array<() => void>,
}));
vi.mock('../services/ui/PriceAlertService', () => ({
  PriceAlertService: {
    acquireSymbol: vi.fn((symbol: string) => {
      priceFeed.acquired.push(symbol);
      const release = vi.fn(() => {
        const i = priceFeed.acquired.indexOf(symbol);
        if (i >= 0) priceFeed.acquired.splice(i, 1);
      });
      priceFeed.releases.push(release);
      return release;
    }),
    trackSymbol: vi.fn(() => true),
    untrackSymbol: vi.fn(() => true),
    getCurrentPrice: vi.fn(() => undefined),
    normalizeSymbol: (s: string) => s,
  },
}));

import { OutcomeAutopilotService, AutopilotResolution } from '../services/ui/OutcomeAutopilotService';
import { verifyHistoricalOutcome } from '../services/ui/AutoCaptureService';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const analysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'High',
  probability: 80,
  strategy: 'Breakout',
  activeStrategies: [],
  entryPoints: [{ price: '95000', description: 'entry' }],
  stopLoss: '94000',
  stopLossPercentage: '-100.0%',
  takeProfit: [
    { price: '96000', percentage: '+100.0%' },
    { price: '97000', percentage: '+200.0%' },
  ],
  marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
  historicalCorrelation: '',
  createdAt: new Date().toISOString(),
  validityDurationMinutes: 330,
  ...overrides,
});

const mockVerify = vi.mocked(verifyHistoricalOutcome);

let idCounter = 0;
const nextId = () => `msg-${Date.now()}-${idCounter++}`;

beforeEach(async () => {
  priceFeed.acquired.length = 0;
  priceFeed.releases.length = 0;
  await OutcomeAutopilotService.init();
  mockVerify.mockReset();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OutcomeAutopilotService', () => {
  it('resolves TP_HIT as WIN with leveraged PnL and notifies listeners', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({
      verified: true,
      outcome: 'TP_HIT',
      hitTarget: 'TP1',
      priceAtHit: 96000,
      timeToOutcome: '2h 15m',
      tpHits: [{ level: 'TP1', price: 96000, candleIndex: 5, candleTime: '', timeAfterAnalysis: '2h 15m' }],
      verificationDetails: '',
    } as any);

    const events: Array<{ messageId: string; resolution: AutopilotResolution }> = [];
    const unsub = OutcomeAutopilotService.subscribe((messageId, resolution) => events.push({ messageId, resolution }));

    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();

    const resolution = OutcomeAutopilotService.getResolution(id);
    expect(resolution?.outcome).toBe(TradeOutcome.WIN);
    // Recomputed from the hit price (96000) vs entry (95000) at 100x:
    // (1000/95000)*100*100 = 105.3 — the fixture's stored '+100.0%' was a
    // rounded analysis-time value.
    expect(resolution?.pnlPercent).toBe(105.3);
    expect(resolution?.hitTarget).toBe('TP1');
    expect(resolution?.detail).toContain('TP1 hit');
    expect(resolution?.slOptimizationData).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0].messageId).toBe(id);

    unsub();
    OutcomeAutopilotService.markProcessed(id);
  });

  it('resolves SL_HIT as LOSS with negative PnL', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({
      verified: true,
      outcome: 'SL_HIT',
      hitTarget: 'SL',
      priceAtHit: 94000,
      slHit: { price: 94000, candleIndex: 3, candleTime: '', timeAfterAnalysis: '45m' },
      timeToOutcome: '45m',
      verificationDetails: '',
    } as any);

    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();

    const resolution = OutcomeAutopilotService.getResolution(id);
    expect(resolution?.outcome).toBe(TradeOutcome.LOSS);
    expect(resolution?.pnlPercent).toBe(-105.3);
    expect(resolution?.hitLevel).toBe('94000');

    OutcomeAutopilotService.markProcessed(id);
  });

  it('resolves expired ENTRY_NOT_TRIGGERED as ENTRY_NOT_HIT', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({ verified: true, outcome: 'ENTRY_NOT_TRIGGERED', verificationDetails: '' } as any);

    const expired = analysis({
      createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      validityDurationMinutes: 60, // expired 5h ago
    });
    OutcomeAutopilotService.register(id, expired, 100);
    await OutcomeAutopilotService.checkNow();

    const resolution = OutcomeAutopilotService.getResolution(id);
    expect(resolution?.outcome).toBe(TradeOutcome.ENTRY_NOT_HIT);
    expect(resolution?.expiredOpen).toBe(false);

    OutcomeAutopilotService.markProcessed(id);
  });

  it('keeps watching while STILL_OPEN inside the validity window', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);

    OutcomeAutopilotService.register(id, analysis({ validityDurationMinutes: 330 }), 100);
    await OutcomeAutopilotService.checkNow();

    expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();
    OutcomeAutopilotService.unregister(id);
  });

  it('flags expired STILL_OPEN as expiredOpen (manual decision)', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);

    const expired = analysis({
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      validityDurationMinutes: 60,
    });
    OutcomeAutopilotService.register(id, expired, 100);
    await OutcomeAutopilotService.checkNow();

    const resolution = OutcomeAutopilotService.getResolution(id);
    expect(resolution?.expiredOpen).toBe(true);

    OutcomeAutopilotService.dismiss(id);
  });

  it('never re-detects processed messages', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({ verified: true, outcome: 'TP_HIT', hitTarget: 'TP1', priceAtHit: 96000, verificationDetails: '' } as any);

    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();
    expect(OutcomeAutopilotService.getResolution(id)).toBeDefined();
    OutcomeAutopilotService.markProcessed(id);

    // Re-registering a processed message is a no-op
    mockVerify.mockClear();
    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();
  });

  it('dismiss hides the resolution and stops tracking', async () => {
    const id = nextId();
    mockVerify.mockResolvedValue({ verified: true, outcome: 'SL_HIT', priceAtHit: 94000, verificationDetails: '' } as any);

    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();
    expect(OutcomeAutopilotService.getResolution(id)).toBeDefined();

    OutcomeAutopilotService.dismiss(id);
    expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();

    // Dismissed messages are not re-registered
    mockVerify.mockClear();
    OutcomeAutopilotService.register(id, analysis(), 100);
    await OutcomeAutopilotService.checkNow();
    expect(mockVerify).not.toHaveBeenCalled();
  });

    it('skips Avoid / Neutral setups (no trade to watch)', async () => {
        const id = nextId();
        OutcomeAutopilotService.register(id, analysis({ direction: 'Neutral', confidence: 'Avoid' }), 100);
        await OutcomeAutopilotService.checkNow();
        expect(mockVerify).not.toHaveBeenCalled();
        expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();
    });

    it('verifies immediately on register and accepts missing createdAt', async () => {
        const id = nextId();
        mockVerify.mockResolvedValue({
            verified: true,
            outcome: 'TP_HIT',
            hitTarget: 'TP1',
            priceAtHit: 96000,
            tpHits: [{ level: 'TP1', price: 96000, candleIndex: 5, candleTime: '', timeAfterAnalysis: '1h' }],
            verificationDetails: '',
        } as any);
        OutcomeAutopilotService.register(id, analysis({ createdAt: undefined }), 100);
        await vi.waitFor(() => expect(mockVerify).toHaveBeenCalled());
        expect(OutcomeAutopilotService.getResolution(id)?.outcome).toBe(TradeOutcome.WIN);
        OutcomeAutopilotService.markProcessed(id);
    });

    it('skips analyses without a symbol', async () => {
        const { extractSymbolFromAnalysis } = await import('../services/ui/AutoCaptureService');
        vi.mocked(extractSymbolFromAnalysis).mockReturnValueOnce('');
        const id = nextId();
        OutcomeAutopilotService.register(id, analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();
        vi.mocked(extractSymbolFromAnalysis).mockReturnValue('BTCUSDT');
    });

    it('holds the shared price feed while registered and releases it on removal', async () => {
        mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);
        const id = nextId();
        OutcomeAutopilotService.register(id, analysis(), 100);
        expect(priceFeed.acquired).toContain('BTCUSDT');

        OutcomeAutopilotService.unregister(id);
        expect(priceFeed.releases.at(-1)).toHaveBeenCalledOnce();
        expect(priceFeed.acquired).not.toContain('BTCUSDT');
    });

    it('re-register with a changed leverage UPDATES the authoritative registration', async () => {
        // useWatchAndAutopilot re-registers everything when the conversation
        // leverage changes; the old register() early-returned on an existing
        // id, so every later resolution graded PnL with the STALE leverage.
        mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);
        const id = nextId();
        OutcomeAutopilotService.register(id, analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(OutcomeAutopilotService.getResolution(id)).toBeUndefined();

        mockVerify.mockResolvedValue({
            verified: true, outcome: 'TP_HIT', hitTarget: 'TP1', priceAtHit: 96000,
            tpHits: [{ level: 'TP1', price: 96000, candleIndex: 5, candleTime: '', timeAfterAnalysis: '1h' }],
            verificationDetails: '',
        } as any);
        // Leverage 100 → 50: (1000/95000)*100*50 = 52.6, not the 100x 105.3.
        OutcomeAutopilotService.register(id, analysis(), 50);
        await OutcomeAutopilotService.checkNow();

        const resolution = OutcomeAutopilotService.getResolution(id);
        expect(resolution?.outcome).toBe(TradeOutcome.WIN);
        expect(resolution?.pnlPercent).toBe(52.6);
        OutcomeAutopilotService.markProcessed(id);
    });
});

// ── Profile isolation: per-username partitions ──────────────────────────────

describe('OutcomeAutopilotService per-user partitions', () => {
    const stateBlob = (): Record<string, { processed: string[]; dismissed: string[] }> & {
        processed?: string[]; dismissed?: string[];
    } => prefStore['outcome_autopilot_state'] as any;

    it('a legacy global blob migrates to the first loader (and stops being legacy)', async () => {
        OutcomeAutopilotService.reset();
        prefStore['outcome_autopilot_state'] = { processed: ['legacy-1'], dismissed: ['legacy-2'] };

        await OutcomeAutopilotService.init('carol');
        await vi.waitFor(() => {
            const blob = stateBlob();
            expect(blob.processed).toBeUndefined();
            expect(blob.carol?.processed).toContain('legacy-1');
            expect(blob.carol?.dismissed).toContain('legacy-2');
        });

        // The migrated ids suppress re-detection for carol…
        mockVerify.mockResolvedValue({ verified: true, outcome: 'TP_HIT', priceAtHit: 96000, verificationDetails: '' } as any);
        OutcomeAutopilotService.register('legacy-1', analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('partitions are isolated: bob does not inherit alice and alice reloads after bob', async () => {
        OutcomeAutopilotService.reset();
        prefStore['outcome_autopilot_state'] = {};

        await OutcomeAutopilotService.init('alice');
        OutcomeAutopilotService.markProcessed('a-1');
        await vi.waitFor(() => expect(stateBlob().alice?.processed).toContain('a-1'));

        // Direct cross-user init (no reset): must actually RELOAD, not
        // early-return on `initialized` — bob starts with nothing…
        await OutcomeAutopilotService.init('bob');
        mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);
        OutcomeAutopilotService.register('a-1', analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(mockVerify).toHaveBeenCalled(); // alice's processed never silenced bob
        OutcomeAutopilotService.unregister('a-1');

        // …and bob's writes never wipe alice's partition (the old reset()
        // persisted empty arrays to the shared key on every switch).
        OutcomeAutopilotService.markProcessed('b-1');
        await vi.waitFor(() => expect(stateBlob().bob?.processed).toContain('b-1'));
        expect(stateBlob().alice?.processed).toContain('a-1');

        // Back to alice: her partition survives bob's session.
        await OutcomeAutopilotService.init('alice');
        mockVerify.mockClear();
        OutcomeAutopilotService.register('a-1', analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('reset clears ONLY the outgoing user’s partition', async () => {
        prefStore['outcome_autopilot_state'] = {
            alice: { processed: ['a-1'], dismissed: [] },
            bob: { processed: ['b-1'], dismissed: ['b-2'] },
        };
        await OutcomeAutopilotService.init('alice');

        OutcomeAutopilotService.reset();
        await vi.waitFor(() => {
            const blob = stateBlob();
            expect(blob.alice).toBeUndefined();
            expect(blob.bob?.processed).toEqual(['b-1']);
            expect(blob.bob?.dismissed).toEqual(['b-2']);
        });

        // After the switch, alice's ids re-detect for the next session…
        await OutcomeAutopilotService.init('alice');
        mockVerify.mockResolvedValue({ verified: true, outcome: 'STILL_OPEN', verificationDetails: '' } as any);
        OutcomeAutopilotService.register('a-1', analysis(), 100);
        await OutcomeAutopilotService.checkNow();
        expect(mockVerify).toHaveBeenCalled();
        OutcomeAutopilotService.unregister('a-1');
    });
});

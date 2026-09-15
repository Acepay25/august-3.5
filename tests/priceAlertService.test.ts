/**
 * PriceAlertService — the fix-batch regression suite (audit Tier-0 #5 +
 * Tier-1 trading-surface bullets):
 *  - the combined stream REBUILDS when the tracked set changes while the
 *    socket is OPEN (symbols armed mid-session used to never receive ticks),
 *  - a replaced socket's handlers are DETACHED (a stale onclose must never
 *    flap or double-reconnect the healthy replacement),
 *  - the onclose reconnect guard includes externalMonitorHolders,
 *  - direction-aware level latching: gap-through prints latch (approach-only
 *    read "never approached" on a blown stop),
 *  - acquireSymbol is a ref-counted hold with an idempotent release,
 *  - reset() + per-user alert storage (audit §2.5: the service was global).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import type { PriceAlert } from '../services/ui/PriceAlertService';

// ── Controllable WebSocket ───────────────────────────────────────────────────

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        // Real sockets fire onclose asynchronously — our code nulls the
        // handlers BEFORE close(), so nothing may re-enter here.
    }
}

/** Test-visible slice of the class (TS privates are compile-time only). */
interface SvcInternals {
    alerts: Map<string, PriceAlert>;
    trackedSymbols: Map<string, number>;
    externalMonitorHolders: number;
    ws: FakeWebSocket | null;
    streamSymbols: Set<string>;
    wsReconnectAttempts: number;
    wsReconnectTimer: ReturnType<typeof setTimeout> | null;
    checkAlerts(symbol: string, price: number): void;
    trackSymbol(symbol: string): boolean;
    untrackSymbol(symbol: string): boolean;
    acquireMonitor(): () => void;
}
const svc = PriceAlertService as unknown as SvcInternals;

const makeAlert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: `alert-${Math.random().toString(36).slice(2)}`,
    tradeId: 't1',
    coinName: 'BTC',
    symbol: 'BTCUSDT',
    direction: 'Long',
    entryPrice: 0,
    stopLoss: 0,
    takeProfits: [],
    thresholdPercent: 0.5,
    enabled: true,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    triggeredLevels: new Set<string>(),
    ...over,
});

beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    // Keep the web-notification path inert (permission denied → no-op).
    vi.stubGlobal('Notification', { permission: 'denied' });
    localStorage.clear();
    PriceAlertService.reset();
});

afterEach(() => {
    PriceAlertService.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// ── Tier-0 #5: combined-stream rebuild on set change while OPEN ─────────────

describe('combined-stream rebuild (Tier-0 #5)', () => {
    it('rebuilds the stream when a new symbol is tracked while the socket is OPEN', () => {
        svc.trackSymbol('BTC');
        const ws0 = FakeWebSocket.instances.at(-1)!;
        expect(ws0.url).toContain('btcusdt@ticker');
        ws0.readyState = FakeWebSocket.OPEN;
        ws0.onopen?.();

        // Mid-session arming of a fresh coin: the URL was baked at connect
        // time, so only a rebuild can ever deliver ETH ticks.
        svc.trackSymbol('ETH');
        expect(FakeWebSocket.instances).toHaveLength(2);
        const ws1 = FakeWebSocket.instances.at(-1)!;
        expect(ws1.url).toContain('btcusdt@ticker');
        expect(ws1.url).toContain('ethusdt@ticker');
    });

    it('detaches the replaced socket handlers so a stale onclose cannot flap the replacement', () => {
        svc.trackSymbol('BTC');
        const ws0 = FakeWebSocket.instances.at(-1)!;
        ws0.readyState = FakeWebSocket.OPEN;
        ws0.onopen?.();

        svc.trackSymbol('ETH');
        const ws1 = FakeWebSocket.instances.at(-1)!;

        // The old socket is fully muted: no handlers, socket closed.
        expect(ws0.onclose).toBeNull();
        expect(ws0.onmessage).toBeNull();
        expect(ws0.onopen).toBeNull();
        expect(ws0.readyState).toBe(FakeWebSocket.CLOSED);
        expect(svc.ws).toBe(ws1);

        // Even if the platform STILL fires the old socket's close event via
        // some lingering reference, nothing is attached — and the attempts
        // counter proves no second reconnect was scheduled by the ghost.
        const attemptsBefore = svc.wsReconnectAttempts;
        ws0.onclose?.();
        expect(svc.wsReconnectAttempts).toBe(attemptsBefore);
        expect(svc.ws).toBe(ws1);
    });

    it('does NOT churn the socket when symbols are only removed', () => {
        svc.trackSymbol('BTC');
        const ws0 = FakeWebSocket.instances.at(-1)!;
        ws0.readyState = FakeWebSocket.OPEN;
        svc.trackSymbol('ETH');
        const n = FakeWebSocket.instances.length;
        svc.untrackSymbol('ETH');
        expect(FakeWebSocket.instances).toHaveLength(n); // extra stream is harmless
    });

    it('onclose schedules a reconnect for external monitor holders with zero alerts/tracked symbols', () => {
        const releaseMonitor = svc.acquireMonitor();
        svc.trackSymbol('BTC');
        const ws0 = FakeWebSocket.instances.at(-1)!;
        ws0.readyState = FakeWebSocket.OPEN;
        ws0.onopen?.();
        // Back to holder-only: the OLD guard (alerts||tracked) would never
        // recover a flapped socket in this state.
        svc.untrackSymbol('BTC');
        expect(svc.alerts.size).toBe(0);
        expect(svc.trackedSymbols.size).toBe(0);
        expect(svc.externalMonitorHolders).toBe(1);

        ws0.onclose?.();
        expect(svc.wsReconnectAttempts).toBe(1);
        expect(svc.wsReconnectTimer).not.toBeNull();
        releaseMonitor();
    });
});

// ── Direction-aware crossing latch (Tier-1 :536) ────────────────────────────

describe('gap-through level latching', () => {
    const triggersFor = (alert: PriceAlert, prices: number[]): string[] => {
        svc.alerts.clear();
        svc.alerts.set(alert.id, alert);
        const seen: string[] = [];
        const unsub = PriceAlertService.subscribe(t => seen.push(`${t.type}${t.tpIndex ? `_${t.tpIndex}` : ''}`));
        for (const p of prices) svc.checkAlerts(alert.symbol, p);
        unsub();
        return seen;
    };

    it('a Long stop blown straight through (gap 3% BELOW) latches — the old approach-only test missed it', () => {
        expect(triggersFor(makeAlert({ direction: 'Long', stopLoss: 100 }), [97]))
            .toEqual(['STOP_LOSS']);
    });

    it('a Long price far ABOVE its stop stays silent', () => {
        expect(triggersFor(makeAlert({ direction: 'Long', stopLoss: 100 }), [108]))
            .toEqual([]);
    });

    it('a Long target gapped through (price above TP) latches; below the band stays silent', () => {
        expect(triggersFor(makeAlert({ direction: 'Long', takeProfits: [110] }), [113]))
            .toEqual(['TAKE_PROFIT_1']);
        expect(triggersFor(makeAlert({ direction: 'Long', takeProfits: [110] }), [100]))
            .toEqual([]);
    });

    it('a Short stop above the market latches on an up-gap; the mirrored target too', () => {
        expect(triggersFor(makeAlert({ direction: 'Short', stopLoss: 110 }), [113]))
            .toEqual(['STOP_LOSS']);
        expect(triggersFor(makeAlert({ direction: 'Short', takeProfits: [100] }), [97]))
            .toEqual(['TAKE_PROFIT_1']);
        // A Short stop is not touched by a move DOWN…
        expect(triggersFor(makeAlert({ direction: 'Short', stopLoss: 110 }), [95]))
            .toEqual([]);
    });

    it('entry gapping through latches and each level fires exactly once', () => {
        const alert = makeAlert({ direction: 'Long', entryPrice: 105, stopLoss: 100 });
        // 101 is past ENTRY's band (gapped into it), 100.1 crosses the stop,
        // 99 re-prints inside both bands — the latch must not re-ping.
        expect(triggersFor(alert, [101, 100.1, 99]))
            .toEqual(['ENTRY', 'STOP_LOSS']);
    });

    it('Neutral keeps the symmetric approach band', () => {
        expect(triggersFor(makeAlert({ direction: 'Neutral', stopLoss: 100 }), [97]))
            .toEqual([]);
        expect(triggersFor(makeAlert({ direction: 'Neutral', stopLoss: 100 }), [100.2]))
            .toEqual(['STOP_LOSS']);
    });
});

// ── Ref-counted feed holds ───────────────────────────────────────────────────

describe('acquireSymbol (ref-counted hold + release fn)', () => {
    it('two holders, one release each, idempotent release fns', () => {
        const holdA = PriceAlertService.acquireSymbol('BTC');
        expect(svc.trackedSymbols.get('BTCUSDT')).toBe(1);
        const holdB = PriceAlertService.acquireSymbol('BTCUSDT');
        expect(svc.trackedSymbols.get('BTCUSDT')).toBe(2);

        holdA();
        holdA(); // double release must not eat the OTHER holder's count
        expect(svc.trackedSymbols.get('BTCUSDT')).toBe(1);
        holdB();
        expect(svc.trackedSymbols.has('BTCUSDT')).toBe(false);
    });
});

// ── reset() + per-user storage (audit §2.5) ─────────────────────────────────

describe('profile-scoped alert storage', () => {
    const legacyBlob = [
        {
            id: 'legacy-alert', tradeId: 't9', coinName: 'BTC', symbol: 'BTCUSDT',
            direction: 'Long', entryPrice: 100, stopLoss: 90, takeProfits: [110],
            thresholdPercent: 0.5, enabled: true,
            createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            triggeredLevels: ['ENTRY'],
        },
    ];

    it('reset() drops the outgoing profile alerts from memory (storage persists)', async () => {
        localStorage.setItem('price_alerts_v1_erin', JSON.stringify(legacyBlob));
        await PriceAlertService.init('erin');
        expect(PriceAlertService.getAllAlerts().map(a => a.id)).toEqual(['legacy-alert']);

        PriceAlertService.reset();
        expect(PriceAlertService.getAllAlerts()).toHaveLength(0);
        // The next profile loads nothing of Erin's…
        await PriceAlertService.init('finn');
        expect(PriceAlertService.getAllAlerts()).toHaveLength(0);
        // …and Erin gets her own back on return (triggeredLevels intact).
        await PriceAlertService.init('erin');
        expect(PriceAlertService.getAllAlerts().map(a => a.id)).toEqual(['legacy-alert']);
        expect(PriceAlertService.getAllAlerts()[0].triggeredLevels.has('ENTRY')).toBe(true);
    });

    it('a legacy GLOBAL blob migrates to the first loader and the shared key is retired', async () => {
        localStorage.setItem('price_alerts', JSON.stringify(legacyBlob));

        await PriceAlertService.init('erin');
        expect(PriceAlertService.getAllAlerts().map(a => a.id)).toEqual(['legacy-alert']);
        await vi.waitFor(() => {
            expect(localStorage.getItem('price_alerts_v1_erin')).toBeTruthy();
            expect(localStorage.getItem('price_alerts')).toBeNull();
        });

        // A different profile does NOT inherit Erin's alerts.
        PriceAlertService.reset();
        await PriceAlertService.init('finn');
        expect(PriceAlertService.getAllAlerts()).toHaveLength(0);
    });

    it('alerts created for the loaded user save under their per-user key', async () => {
        await PriceAlertService.init('gina');
        PriceAlertService.createAlert('trade-1', {
            coinName: 'BTC',
            direction: 'Long',
            confidence: 'High',
            entryPoints: [{ price: '100', description: '' }],
            stopLoss: '90',
            takeProfit: [{ price: '110', percentage: '+10%' }],
        } as never);
        await vi.waitFor(() => {
            const saved = JSON.parse(localStorage.getItem('price_alerts_v1_gina') ?? 'null');
            expect(Array.isArray(saved) && saved.length).toBe(1);
        });
        expect(localStorage.getItem('price_alerts')).toBeNull(); // never the global key
    });
});

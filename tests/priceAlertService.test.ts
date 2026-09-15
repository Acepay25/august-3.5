/**
 * PriceAlertService — the fix-batch regression suite (audit Tier-0 #5 +
 * Tier-1 trading-surface bullets):
 *  - the combined stream REBUILDS when the tracked set changes while the
 *    socket is OPEN (symbols armed mid-session used to never receive ticks),
 *  - a replaced socket's handlers are DETACHED (a stale onclose must never
 *    flap or double-reconnect the healthy replacement),
 *  - the onclose reconnect guard includes externalMonitorHolders,
 *  - acquireSymbol is a ref-counted hold with an idempotent release.
 *
 * The per-trade alert tests (gap-through level latching, per-user alert
 * storage) were removed together with the unreachable alert half of the
 * service (createAlert had zero production callers).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PriceAlertService } from '../services/ui/PriceAlertService';

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
    trackedSymbols: Map<string, number>;
    externalMonitorHolders: number;
    ws: FakeWebSocket | null;
    streamSymbols: Set<string>;
    wsReconnectAttempts: number;
    wsReconnectTimer: ReturnType<typeof setTimeout> | null;
    trackSymbol(symbol: string): boolean;
    untrackSymbol(symbol: string): boolean;
    acquireMonitor(): () => void;
}
const svc = PriceAlertService as unknown as SvcInternals;

beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
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

    it('onclose schedules a reconnect for external monitor holders with zero tracked symbols', () => {
        const releaseMonitor = svc.acquireMonitor();
        svc.trackSymbol('BTC');
        const ws0 = FakeWebSocket.instances.at(-1)!;
        ws0.readyState = FakeWebSocket.OPEN;
        ws0.onopen?.();
        // Back to holder-only: the OLD guard would never recover a flapped
        // socket in this state.
        svc.untrackSymbol('BTC');
        expect(svc.trackedSymbols.size).toBe(0);
        expect(svc.externalMonitorHolders).toBe(1);

        ws0.onclose?.();
        expect(svc.wsReconnectAttempts).toBe(1);
        expect(svc.wsReconnectTimer).not.toBeNull();
        releaseMonitor();
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

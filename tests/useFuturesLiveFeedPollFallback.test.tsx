/**
 * useFuturesLiveFeed REST polling fallback (logged-trade-and-rest-fallback).
 *
 * On a network where `wss://fstream.binance.com` completes the handshake but
 * the host silently drops every frame (the user's 2026-09-16 repro: even the
 * 1 Hz `btcusdt@markPrice@1s` control produces zero frames), the hook must
 * still keep `markIndex` and `ticker` updating via REST. These tests pin:
 *
 *   - The poll activates only after the combined feed has gone silent past
 *     the arming window (no fight with an alive-but-just-slow socket).
 *   - Once armed, mark + 24 h ticker refresh on the REST cadence.
 *   - Level-2 depth has no public REST equivalent — the poll must NOT touch
 *     it; it stays at whatever value it last held.
 *   - A single WS frame tears the poll down within one tick.
 *   - The poll is torn down on unmount / symbol change.
 *   - `depthLive` tracks the depth20 stream on its OWN terms. Gating the order
 *     book on `status === 'live'` instead meant that on this very network —
 *     markPrice@1s dropped, depth20@100ms flowing — a live ladder was discarded
 *     for the 5 s REST snapshot, which is what read as "the book stopped being
 *     realtime".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the REST endpoints the hook now reaches for. These are imported at
// module load time; vi.mock hoists above the import so the hook binds to
// the mocks automatically.
vi.mock('../services/analysis/MarketDataService', async () => {
    const actual = await vi.importActual<typeof import('../services/analysis/MarketDataService')>('../services/analysis/MarketDataService');
    return {
        ...actual,
        fetchMarkIndex: vi.fn(async () => ({
            markPrice: 50000.5,
            indexPrice: 50000.1,
            lastFundingRate: 0.0001,
            nextFundingTime: 1760025300000,
            available: true,
        })),
        fetchFuturesTicker24h: vi.fn(async () => ({
            symbol: 'BTCUSDT',
            currentPrice: 50000.5,
            price24hHigh: 50500,
            price24hLow: 49500,
            priceChange24h: 100,
            priceChangePercent24h: 0.2,
            volume24h: 1234567890.12,
            available: true,
        })),
    };
});

import { useFuturesLiveFeed } from '../hooks/useFuturesLiveFeed';
import { fetchMarkIndex, fetchFuturesTicker24h } from '../services/analysis/MarketDataService';

class FakeSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static instances: FakeSocket[] = [];
    url: string;
    readyState = FakeSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closeCalls = 0;
    /** If true, the socket never auto-closes when the connect timer fires —
     *  used to simulate the dead-WS-but-keep-handshake-open case. */
    staySilent = false;
    constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
    emitMarkPrice(p = '50000'): void {
        this.onmessage?.({ data: JSON.stringify({ data: { e: 'markPriceUpdate', p, i: p, P: '0.0001', T: '123' } }) });
    }
    emitTicker(c = '50000', P = '0'): void {
        this.onmessage?.({ data: JSON.stringify({ data: { e: '24hrTicker', c, P, q: '1000' } }) });
    }
    emitDepth(bids: string[][] = [['50000', '1']], asks: string[][] = [['50001', '1']]): void {
        this.onmessage?.({ data: JSON.stringify({ data: { e: 'depthUpdate', b: bids, a: asks } }) });
    }
    close(): void {
        this.closeCalls += 1;
        if (this.readyState === FakeSocket.OPEN) { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
    }
}

const combined = (): FakeSocket => FakeSocket.instances.find(s => s.url.includes('/stream?'))!;
const klineSocket = (): FakeSocket => FakeSocket.instances.find(s => s.url.includes('/ws/'))!;

const flushPromises = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
    FakeSocket.instances = [];
    // @ts-expect-error test double
    globalThis.WebSocket = FakeSocket;
    // @ts-expect-error test double
    window.WebSocket = FakeSocket;
    vi.useFakeTimers();
    vi.mocked(fetchMarkIndex).mockClear();
    vi.mocked(fetchFuturesTicker24h).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useFuturesLiveFeed REST polling fallback', () => {
    it('arms the poll after the silence window and refreshes mark + ticker', async () => {
        // Simulate the dead-WS case: the socket completes the handshake but
        // never delivers a frame, even after the connect timer tries to close
        // it. We achieve this by mocking the constructor to ignore the
        // connect-timer close — the socket stays "OPEN" in our fake.
        FakeSocket.prototype.close = function (): void {
            this.closeCalls += 1;
            // Don't fire onclose — emulates the half-open TCP the user
            // described (handshake done, frames dropped at network layer).
        };

        renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        // Before the arming window, no REST call has been made.
        expect(vi.mocked(fetchMarkIndex)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchFuturesTicker24h)).not.toHaveBeenCalled();

        // STALL_CHECK_MS=5000 cadence; arming window is STALL_MS*2 = 16000.
        // Advance past the arming window so the armTimer can fire once
        // armed. Each armTimer tick may arm + fire runPollOnce.
        await act(async () => { vi.advanceTimersByTime(25_000); });
        await flushPromises();

        expect(vi.mocked(fetchMarkIndex)).toHaveBeenCalled();
        expect(vi.mocked(fetchFuturesTicker24h)).toHaveBeenCalled();
    });

    it('markIndex + ticker update from REST when WS is dead', async () => {
        FakeSocket.prototype.close = function (): void {
            this.closeCalls += 1; /* no onclose — dead WS */
        };
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        await act(async () => { vi.advanceTimersByTime(25_000); });
        await flushPromises();

        expect(result.current.markIndex?.markPrice).toBe(50000.5);
        expect(result.current.markIndex?.indexPrice).toBe(50000.1);
        expect(result.current.ticker?.lastPrice).toBe(50000.5);
        expect(result.current.ticker?.quoteVolume24h).toBe(1234567890.12);
        expect(result.current.pollSource).toBe('rest');
    });

    it('does NOT touch depth — the REST poll leaves it untouched', async () => {
        FakeSocket.prototype.close = function (): void { this.closeCalls += 1; };

        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        // Advance past the arming window so the poll fires. With no WS
        // frames ever delivered, depth must remain null — the poll has no
        // public level-2 endpoint to call.
        await act(async () => { vi.advanceTimersByTime(25_000); });
        await flushPromises();

        expect(result.current.depth).toBeNull();
        // depthStaleSince gets stamped only on the first REST fallback tick
        // (since depth was never seen).
        expect(result.current.depthStaleSince).not.toBeNull();
    });

    it('a single WS frame tears down the running poll', async () => {
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        // Let the arming window pass and the poll mount.
        await act(async () => { vi.advanceTimersByTime(25_000); });
        await flushPromises();
        const callsAfterArm = vi.mocked(fetchMarkIndex).mock.calls.length;
        expect(callsAfterArm).toBeGreaterThan(0);

        // One WS mark-price frame lands — the strongest possible "WS healthy"
        // signal. The poll must clear its interval immediately, the source
        // flips to 'ws', and the depthStaleSince stamp clears.
        await act(async () => {
            combined().emitMarkPrice('51000');
        });

        expect(result.current.status).toBe('live');
        expect(result.current.pollSource).toBe('ws');
        expect(result.current.depthStaleSince).toBeNull();

        // Advance another full poll cycle: with the poll torn down, no
        // additional REST mark-index calls should fire.
        const before = vi.mocked(fetchMarkIndex).mock.calls.length;
        await act(async () => { vi.advanceTimersByTime(15_000); });
        await flushPromises();
        expect(vi.mocked(fetchMarkIndex).mock.calls.length).toBe(before);
    });

    it('marks depth live when only the depth20 stream flows', async () => {
        FakeSocket.prototype.close = function (): void { this.closeCalls += 1; };
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));
        const cs = combined();

        // depth20@100ms frames, zero mark/ticker frames — the condition this
        // file already documents for the user's network.
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { cs.emitDepth([['50000', '2']], [['50001', '1']]); });
            await act(async () => { vi.advanceTimersByTime(1000); });
        }

        expect(result.current.depth).not.toBeNull();
        // No mark frame ever landed, so the mark/ticker path is not live...
        expect(result.current.status).not.toBe('live');
        // ...but the ladder IS being pushed, and that is its own answer.
        expect(result.current.depthLive).toBe(true);
    });

    it('drops depthLive when the depth stream goes quiet', async () => {
        FakeSocket.prototype.close = function (): void { this.closeCalls += 1; };
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        await act(async () => { combined().emitDepth(); });
        expect(result.current.depthLive).toBe(true);

        // The freshness check rides the 5 s arming watcher, so one tick past
        // the 4 s window flips it off and the panel goes back to REST.
        await act(async () => { vi.advanceTimersByTime(6000); });
        expect(result.current.depthLive).toBe(false);
    });

    it('clears the poll on unmount', async () => {
        FakeSocket.prototype.close = function (): void { this.closeCalls += 1; };
        const { unmount } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));

        await act(async () => { vi.advanceTimersByTime(25_000); });
        await flushPromises();
        const callsBeforeUnmount = vi.mocked(fetchMarkIndex).mock.calls.length;
        expect(callsBeforeUnmount).toBeGreaterThan(0);

        unmount();

        // After unmount, advancing timers must not produce any further REST
        // calls. If the poll survived cleanup, fakeFetch would keep getting
        // called every POLL_INTERVAL_MS (5000).
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await flushPromises();
        expect(vi.mocked(fetchMarkIndex).mock.calls.length).toBe(callsBeforeUnmount);
    });

    it('does not arm the poll while the WS is producing recent frames', async () => {
        renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));
        const cs = combined();

        // Drive frames every 1 s for the whole window — a healthy feed must
        // never trigger the REST fallback (the armTimer's early-return path).
        for (let i = 0; i < 6; i += 1) {
            await act(async () => { cs.emitMarkPrice(String(50000 + i)); });
            await act(async () => { vi.advanceTimersByTime(5_000); });
        }

        expect(vi.mocked(fetchMarkIndex)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchFuturesTicker24h)).not.toHaveBeenCalled();
    });
});

/**
 * useFuturesLiveFeed phantom-live stall watchdog (A2).
 *
 * The combined feed streams markPrice@1s. A half-open TCP (laptop sleep,
 * Wi-Fi roam, NAT timeout) never fires onclose, so without a rolling check
 * `status` would stick at 'live' and every REST fallback stays gated off —
 * the strip freezes on the last frame forever (the "prices not realtime"
 * symptom). These tests pin: sustained silence forces a close → 'polling';
 * flowing traffic must NOT force a close.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFuturesLiveFeed } from '../hooks/useFuturesLiveFeed';

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
    constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
    emitMarkPrice(p = '50000'): void {
        this.onmessage?.({ data: JSON.stringify({ data: { e: 'markPriceUpdate', p, i: p, P: '0.0001', T: '123' } }) });
    }
    close(): void {
        this.closeCalls += 1;
        if (this.readyState === FakeSocket.OPEN) { this.readyState = FakeSocket.CLOSED; this.onclose?.(); }
    }
}

const combined = () => FakeSocket.instances.find(s => s.url.includes('/stream?'))!;

beforeEach(() => {
    FakeSocket.instances = [];
    // @ts-expect-error test double
    globalThis.WebSocket = FakeSocket;
    // @ts-expect-error test double
    window.WebSocket = FakeSocket;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('phantom-live stall watchdog', () => {
    it('force-closes a socket that streams once then goes silent', () => {
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));
        const cs = combined();
        act(() => { cs.emitMarkPrice(); });
        expect(result.current.status).toBe('live');

        // Silence past the 8 s stall threshold (checked every 5 s): the next
        // check after 10 s sees >8 s since the last frame and closes.
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(cs.closeCalls).toBeGreaterThan(0);
        // Closing routes onclose → scheduleRetry → status flips to 'polling'
        // so the REST fallbacks resume.
        expect(result.current.status).toBe('polling');
    });

    it('does NOT close while frames keep arriving', () => {
        const { result } = renderHook(() => useFuturesLiveFeed('BTCUSDT', '15m'));
        const cs = combined();
        act(() => { cs.emitMarkPrice(); });
        // A fresh 1s tick well inside every 8 s window.
        for (let i = 0; i < 6; i += 1) {
            act(() => { vi.advanceTimersByTime(5_000); });
            act(() => { cs.emitMarkPrice(String(50000 + i)); });
        }
        expect(cs.closeCalls).toBe(0);
        expect(result.current.status).toBe('live');
    });
});

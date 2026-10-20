/**
 * E-16 / E-26 — ONE shared ticker, not up to 400 per-row intervals.
 *
 * Every `AnalyzedRow` and every `ReasoningRow` used to run its OWN
 * `setInterval`, so a 200-message conversation held up to 400 live timers,
 * each re-rendering its own row once a second. The trade surface ran a
 * fifth, separate 1-second clock that re-rendered the WHOLE surface (chart,
 * order book, transcript) to move one funding countdown string.
 *
 * The fix is a single module-level store: one interval, started when the
 * first subscriber arrives and stopped when the last one leaves.
 *
 * This suite pins the claim behaviourally — the interval count is measured,
 * not read off a comment.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import AnalyzedRow from '../components/shared/AnalyzedRow';
import {
    subscribeSharedTicker,
    getSharedTickerNow,
    sharedTickerSubscriberCount,
    isSharedTickerRunning,
    SHARED_TICK_MS,
} from '../hooks/useSharedTicker';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('E-26 — the shared ticker is ONE interval', () => {
    it('200 subscribers share ONE interval, not 200', () => {
        const spy = vi.spyOn(globalThis, 'setInterval');
        const unsubscribes: Array<() => void> = [];
        for (let i = 0; i < 200; i++) unsubscribes.push(subscribeSharedTicker(() => { }));
        const tickCalls = spy.mock.calls.filter(([, ms]) => ms === SHARED_TICK_MS);
        expect(tickCalls.length).toBe(1);
        expect(sharedTickerSubscriberCount()).toBe(200);
        unsubscribes.forEach(u => u());
    });

    it('the interval STOPS when the last subscriber leaves', () => {
        const unsubA = subscribeSharedTicker(() => { });
        const unsubB = subscribeSharedTicker(() => { });
        expect(isSharedTickerRunning()).toBe(true);
        unsubA();
        expect(isSharedTickerRunning()).toBe(true);
        unsubB();
        expect(isSharedTickerRunning()).toBe(false);
        expect(sharedTickerSubscriberCount()).toBe(0);
    });

    it('unsubscribing twice is harmless (React StrictMode double-invoke safe)', () => {
        const unsub = subscribeSharedTicker(() => { });
        unsub();
        expect(() => unsub()).not.toThrow();
        expect(sharedTickerSubscriberCount()).toBe(0);
    });

    it('the published time moves on every tick', () => {
        vi.useFakeTimers();
        try {
            const seen: number[] = [];
            const unsub = subscribeSharedTicker(() => seen.push(getSharedTickerNow()));
            const first = getSharedTickerNow();
            vi.advanceTimersByTime(SHARED_TICK_MS * 3);
            expect(seen.length).toBe(3);
            expect(getSharedTickerNow()).toBeGreaterThanOrEqual(first);
            unsub();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('E-26 — 100 rendered rows still start ONE interval', () => {
    it('a hundred running rows cost one timer, not a hundred', () => {
        const spy = vi.spyOn(globalThis, 'setInterval');
        render(
            <>
                {Array.from({ length: 100 }, (_, i) => (
                    <AnalyzedRow key={i} running>work</AnalyzedRow>
                ))}
            </>,
        );
        const tickCalls = spy.mock.calls.filter(([, ms]) => ms === SHARED_TICK_MS);
        expect(tickCalls.length).toBe(1);
        expect(sharedTickerSubscriberCount()).toBe(100);
    });

    it('a SETTLED row subscribes to nothing at all', () => {
        const spy = vi.spyOn(globalThis, 'setInterval');
        render(
            <>
                {Array.from({ length: 100 }, (_, i) => (
                    <AnalyzedRow key={i}>work</AnalyzedRow>
                ))}
            </>,
        );
        const tickCalls = spy.mock.calls.filter(([, ms]) => ms === SHARED_TICK_MS);
        expect(tickCalls.length).toBe(0);
        expect(sharedTickerSubscriberCount()).toBe(0);
    });
});

describe('E-16 — the per-row files no longer own a timer', () => {
    it.each([
        'components/shared/AnalyzedRow.tsx',
        'components/shared/ReasoningRow.tsx',
    ])('%s runs no interval of its own', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/setInterval\s*\(/);
        expect(src).not.toMatch(/clearInterval\s*\(/);
        expect(src).toContain('subscribeSharedTicker');
    });

    it('the trade surface clock moved into a leaf, so the whole surface is not re-rendered', () => {
        const src = read('components/trade/TradeView.tsx');
        // The 1-second whole-surface clock is gone.
        expect(src).not.toMatch(/setNowMs/);
        expect(src).not.toMatch(/setInterval\([^)]*setNowMs/);
        // The leaf that owns the tick instead.
        expect(src).toContain('useSharedTicker');
        expect(src).toContain('FundingCountdown');
        // And the funding strip renders through the leaf.
        expect(src).toContain('<FundingCountdown');
    });

    it('the shared ticker is the single source of the tick', () => {
        const src = read('hooks/useSharedTicker.ts');
        expect(src).toContain('export const SHARED_TICK_MS = 1000');
        expect(src).toContain('export const subscribeSharedTicker');
        expect(src).toContain('export const useSharedTicker');
    });
});

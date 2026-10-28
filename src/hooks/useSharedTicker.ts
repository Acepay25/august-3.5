/**
 * ONE clock for the whole app.
 *
 * Why this exists
 * ---------------
 * Every `AnalyzedRow` and every `ReasoningRow` used to run its OWN
 * `setInterval` — one per row. A 200-message conversation therefore held up to
 * 400 live intervals, each re-rendering its own row once a second, and each
 * one a separate handle that could leak. The trade surface ran a fifth,
 * separate 1-second clock that re-rendered the WHOLE surface (chart, order
 * book and transcript) to move one funding countdown string.
 *
 * The fix is a single module-level store: ONE interval, started when the
 * first subscriber arrives and stopped when the last one leaves. Every row
 * and every clock subscribes to it, so the number of timers is the number of
 * SUBSCRIBERS TO THE TICKER — one — and not the number of rows.
 *
 * Two ways to use it
 * ------------------
 * · `subscribeSharedTicker(listener)` — a component that keeps its own state
 *   and wants to be told when the clock moved. The rows use this: their
 *   per-row API (a `liveSeconds` number) is unchanged.
 * · `useSharedTicker(enabled)` — a component that just wants the current
 *   time. The trade surface's countdown leaf uses this.
 *
 * The `enabled` flag matters: a SETTLED row must not re-render every second,
 * so it does not subscribe at all, and the interval stops entirely when the
 * last running row goes away.
 */

import { useEffect, useState } from 'react';

/** The tick period. One second — the resolution every caller here needs. */
export const SHARED_TICK_MS = 1000;

/** A subscriber is told "the clock moved"; it reads the time itself. */
export type SharedTickerListener = () => void;

const listeners = new Set<SharedTickerListener>();
let timer: ReturnType<typeof setInterval> | null = null;

/** The last published time. Module-level so every reader sees the same value. */
let nowMs = Date.now();

const stopTimer = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
};

const startTimer = (): void => {
    if (timer !== null) return;
    // Refresh on start: a subscriber that arrives after the interval was
    // stopped must not read a stale timestamp.
    nowMs = Date.now();
    timer = setInterval(() => {
        nowMs = Date.now();
        // Copy before iterating: a listener may unsubscribe while we are
        // notifying, and mutating the set mid-iteration would skip one.
        for (const listener of [...listeners]) listener();
    }, SHARED_TICK_MS);
};

/**
 * Subscribe to the shared clock. Returns the unsubscribe function.
 * The interval exists only while somebody is listening.
 */
export const subscribeSharedTicker = (listener: SharedTickerListener): (() => void) => {
    listeners.add(listener);
    startTimer();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopTimer();
    };
};

/** The current time, as last published by the ticker. */
export const getSharedTickerNow = (): number => nowMs;

/** How many components are listening right now. */
export const sharedTickerSubscriberCount = (): number => listeners.size;

/** Is the one shared interval running? */
export const isSharedTickerRunning = (): boolean => timer !== null;

/**
 * The shared clock as a React value. `enabled` false means "do not subscribe
 * and do not re-render" — the value stays at 0 and the component is left
 * alone, which is what a settled row wants.
 */
export const useSharedTicker = (enabled: boolean = true): number => {
    const [now, setNow] = useState<number>(() => (enabled ? getSharedTickerNow() : 0));

    useEffect(() => {
        if (!enabled) {
            setNow(0);
            return;
        }
        const update = (): void => setNow(getSharedTickerNow());
        update();
        return subscribeSharedTicker(update);
    }, [enabled]);

    return now;
};

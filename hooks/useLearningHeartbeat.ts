/**
 * useLearningHeartbeat — the learning loop's clock.
 *
 * The four scheduled passes (weekly rollup, weekly review, monthly report,
 * memory hygiene) were fired once each, from `useUserProfileLoader`'s profile
 * load. That made them BOOT passes: a trader who left the app open for a day
 * got one sweep at open and none after — even though what those passes maintain
 * (stale-skill demotions, belief challenges, contradiction sweeps) is exactly
 * what goes stale during a day of trading. Reopening the app fixed it, which is
 * a strange property for a loop that is supposed to be running.
 *
 * This is wiring only, deliberately. Every sibling already owns its due-check
 * — `*IfDue` re-reads the stored timestamp and returns null when not due — so
 * the tick can fire unconditionally and a wasted tick costs four early returns.
 * The alternative, teaching the loop to keep its own schedule, is a second
 * clock that can only ever drift from the one the Health tab reports against.
 *
 * Two wake-ups, because one is not enough:
 *   - a 15-minute interval, for a session left in the foreground;
 *   - `visibilitychange` → visible, because a backgrounded tab has its timers
 *     clamped and a backgrounded mobile WebView may not run them at all, so
 *     coming back to the tab is the moment the loop is guaranteed a chance.
 *
 * The first tick is deliberately NOT on mount: `useUserProfileLoader` has
 * already run all four at boot. The due-checks would make a second pass a no-op
 * anyway, but the log lines would double, and a loop log that overstates how
 * often the loop ran is worse than no log.
 */

import { useEffect, useRef } from 'react';
import type { LoggedTrade } from '../types';
import { runWeeklyRollupIfDue } from '../services/learning/weeklyRollup';
import { runWeeklyReviewIfDue } from '../services/learning/weeklyReview';
import { runMonthlyReportIfDue } from '../services/learning/monthlyReport';
import { runMemoryHygieneIfDue } from '../services/learning/memoryHygiene';

/** How often a foreground session wakes the loop. Frequent enough that a
 *  trader sees a stale-skill proposal inside the hour; rare enough that four
 *  early-returning due-checks are not worth minimising. */
export const LEARNING_HEARTBEAT_MS = 15 * 60 * 1000;

export const useLearningHeartbeat = (activeUsername: string | null, trades: LoggedTrade[] = []): void => {
    // A ref rather than a dependency: the sweeps measure over the trade log as
    // it is NOW, and listing `trades` in the deps would tear down and restart
    // the 15-minute timer on every settled trade — so the tick would never come.
    const tradesRef = useRef<LoggedTrade[]>(trades);
    tradesRef.current = trades;

    useEffect(() => {
        if (!activeUsername) return;
        // Captured, not read from the closure of a changing value: a sweep that
        // started under one profile must finish under that profile.
        const username = activeUsername;

        const sweep = (): void => {
            const log = tradesRef.current;
            void runWeeklyRollupIfDue(username)
                .then(res => { if (res) console.log('[WeeklyRollup] pass complete:', res); })
                .catch(e => console.warn('[WeeklyRollup] pass failed:', e instanceof Error ? e.message : e));
            void runWeeklyReviewIfDue(username, log)
                .then(res => { if (res) console.log('[WeeklyReview] digest generated:', res.impulse.slice(0, 80)); })
                .catch(e => console.warn('[WeeklyReview] pass failed:', e instanceof Error ? e.message : e));
            void runMonthlyReportIfDue(username, log)
                .then(res => { if (res) console.log('[MonthlyReport] card generated for period ending', res.generatedAt.slice(0, 10)); })
                .catch(e => console.warn('[MonthlyReport] pass failed:', e instanceof Error ? e.message : e));
            void runMemoryHygieneIfDue(username, undefined, log)
                .catch(e => console.warn('[MemoryHygiene] pass failed:', e instanceof Error ? e.message : e));
        };

        const timer = window.setInterval(sweep, LEARNING_HEARTBEAT_MS);
        const onVisibility = (): void => {
            if (document.visibilityState === 'visible') sweep();
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [activeUsername]);
};

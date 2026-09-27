/**
 * The learning loop's clock.
 *
 * The four scheduled passes were BOOT passes: fired once from the profile load,
 * so a session left open for a day swept once at open and never again — even
 * though stale skills, contradicted beliefs and unmaintained memory are what
 * a day of trading actually produces. These pin the two things that make the
 * heartbeat a clock rather than decoration:
 *
 *   - it fires all four passes, repeatedly, and on returning to a backgrounded
 *     tab (whose timers the platform may have stopped running entirely);
 *   - it does NOT fire on mount, because `useUserProfileLoader` already ran all
 *     four at boot and a doubled log would overstate how often the loop ran.
 *
 * The trade log is held in a ref on purpose. Listing it in the effect deps
 * would restart the interval on every settled trade, so the tick would never
 * arrive — a test that only checks "it fires" would not catch that, hence the
 * rerender case below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';

import type { LoggedTrade } from '../types';

vi.mock('../services/learning/weeklyRollup', () => ({ runWeeklyRollupIfDue: vi.fn(async () => null) }));
vi.mock('../services/learning/weeklyReview', () => ({ runWeeklyReviewIfDue: vi.fn(async () => null) }));
vi.mock('../services/learning/monthlyReport', () => ({ runMonthlyReportIfDue: vi.fn(async () => null) }));
vi.mock('../services/learning/memoryHygiene', () => ({ runMemoryHygieneIfDue: vi.fn(async () => null) }));

import { useLearningHeartbeat, LEARNING_HEARTBEAT_MS } from '../hooks/useLearningHeartbeat';
import { runWeeklyRollupIfDue } from '../services/learning/weeklyRollup';
import { runWeeklyReviewIfDue } from '../services/learning/weeklyReview';
import { runMonthlyReportIfDue } from '../services/learning/monthlyReport';
import { runMemoryHygieneIfDue } from '../services/learning/memoryHygiene';

const USER = 'heartbeat-user';

/** The heartbeat only ever forwards the list — nothing here reads a field of a
 *  trade — so the fixture is the smallest thing that is honestly a LoggedTrade. */
const trade = (id: string): LoggedTrade => ({ id } as unknown as LoggedTrade);

const Harness: React.FC<{ username: string | null; trades?: LoggedTrade[] }> = ({ username, trades = [] }) => {
    useLearningHeartbeat(username, trades);
    return null;
};

const setVisibility = (state: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisibility('visible');
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useLearningHeartbeat', () => {
    it('does not sweep on mount — the profile load already ran all four', () => {
        render(<Harness username={USER} />);
        for (const fn of [runWeeklyRollupIfDue, runWeeklyReviewIfDue, runMonthlyReportIfDue, runMemoryHygieneIfDue]) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it('sweeps all four passes once the interval elapses', () => {
        render(<Harness username={USER} />);
        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS); });

        expect(runWeeklyRollupIfDue).toHaveBeenCalledWith(USER);
        expect(runWeeklyReviewIfDue).toHaveBeenCalled();
        expect(runMonthlyReportIfDue).toHaveBeenCalled();
        expect(runMemoryHygieneIfDue).toHaveBeenCalled();
    });

    it('keeps sweeping on a long session', () => {
        render(<Harness username={USER} />);
        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS * 4); });
        expect(runWeeklyRollupIfDue).toHaveBeenCalledTimes(4);
    });

    it('sweeps when the trader comes back to a backgrounded tab', () => {
        render(<Harness username={USER} />);
        setVisibility('hidden');
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(runWeeklyRollupIfDue).not.toHaveBeenCalled();

        act(() => {
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(runWeeklyRollupIfDue).toHaveBeenCalledTimes(1);
    });

    it('measures over the trade log as it is NOW, without restarting the timer', () => {
        const first = [trade('t1')];
        const { rerender } = render(<Harness username={USER} trades={first} />);

        // A trade settling is the common case, and it must not defer the tick.
        const second = [...first, trade('t2')];
        rerender(<Harness username={USER} trades={second} />);
        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS); });

        // If `trades` were an effect dependency the rerender would have cleared
        // the interval, and this assertion would see zero calls instead.
        expect(runWeeklyReviewIfDue).toHaveBeenCalledTimes(1);
        expect(vi.mocked(runWeeklyReviewIfDue).mock.calls[0][1]).toHaveLength(2);
        expect(vi.mocked(runMemoryHygieneIfDue).mock.calls[0][2]).toHaveLength(2);
    });

    it('stays inert without an active profile', () => {
        render(<Harness username={null} />);
        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS * 2); });
        act(() => {
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        for (const fn of [runWeeklyRollupIfDue, runWeeklyReviewIfDue, runMonthlyReportIfDue, runMemoryHygieneIfDue]) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it('cleans up its interval and its listener on unmount', () => {
        const { unmount } = render(<Harness username={USER} />);
        unmount();

        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS * 3); });
        act(() => {
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(runWeeklyRollupIfDue).not.toHaveBeenCalled();
    });

    it('re-arms against the new profile on a user switch', () => {
        const { rerender } = render(<Harness username={USER} />);
        rerender(<Harness username="someone-else" />);
        act(() => { vi.advanceTimersByTime(LEARNING_HEARTBEAT_MS); });

        expect(runWeeklyRollupIfDue).toHaveBeenCalledWith('someone-else');
        expect(runWeeklyRollupIfDue).not.toHaveBeenCalledWith(USER);
    });
});

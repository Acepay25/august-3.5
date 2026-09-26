/**
 * Catch-up allocation is a policy, and this is where it is tested.
 *
 * The bug it guards: the budget used to be spent in ARRAY ORDER, so the first
 * few schedules in the list consumed all of it and an automation that was
 * twenty runs behind — and happened to sit below them — caught up nothing.
 * That is invisible from the outside: the total work was the same either way,
 * and the one user waiting to find out was the one whose schedule was last in
 * the array.
 *
 * It was also untestable, because the policy lived as a loop inside the
 * scheduler's mount effect, interleaved with the `await` that actually ran each
 * automation. Observing the allocation required letting a timer fire. Pulling
 * it into `planCatchUp` is what made any of this assertable.
 */

import { describe, it, expect } from 'vitest';

import { planCatchUp, MAX_TOTAL_CATCH_UP } from '../services/automation/catchUpPlanner';
import type { AutomationConfig } from '../types/automation';

const NOW = new Date(2026, 8, 26, 12, 0, 0, 0).getTime();
const HOUR = 3_600_000;

const automation = (id: string, over: Partial<AutomationConfig> = {}): AutomationConfig => ({
    id,
    name: id,
    enabled: true,
    schedule: { cron: '0 * * * *' },
    ...over,
} as AutomationConfig);

/** `lastSeen` far enough back that every hourly schedule missed ~6 ticks. */
const stale = (hoursAgo: number): number => NOW - hoursAgo * HOUR;

describe('planCatchUp', () => {
    it('owes nothing when the scheduler has never run', () => {
        const list = [automation('a'), automation('b'), automation('c')];
        expect(planCatchUp(list, { lastSeen: null, now: NOW })).toEqual([]);
    });

    it('owes nothing when the last checkpoint is at or after now', () => {
        // A short close is NOT necessarily zero — the window is (since, now]
        // and a cron boundary inside it still counts, which is the behaviour
        // `countMissedRuns` is written to have. "Caught up" is the honest
        // zero case.
        const list = [automation('a')];
        expect(planCatchUp(list, { lastSeen: NOW, now: NOW })).toEqual([]);
        expect(planCatchUp(list, { lastSeen: NOW + 1, now: NOW })).toEqual([]);
    });

    it('hands the budget out ROUND ROBIN, not in array order', () => {
        // The regression. Four overdue schedules, a budget of 3. Spent in
        // order, 'd' gets nothing — which is the entire point of the fix.
        const list = [automation('a'), automation('b'), automation('c'), automation('d')];
        const plan = planCatchUp(list, { lastSeen: stale(6), now: NOW });
        expect(plan).toEqual(['a', 'b', 'c']);
        expect(plan, 'the last automation in the array must not be starved')
            .toContain('a');
    });

    it('lets a heavily-behind schedule take a second turn only after everyone has had one', () => {
        // Budget 5, three schedules all overdue: a, b, c get one each, then the
        // next pass starts from the top of the list again.
        const list = [automation('a'), automation('b'), automation('c')];
        const plan = planCatchUp(list, { lastSeen: stale(10), now: NOW, budget: 5 });
        expect(plan.slice(0, 3)).toEqual(['a', 'b', 'c']);
        // The 4th and 5th grants go to whoever still owes the most, in order.
        expect(plan[3]).toBe('a');
        expect(plan[4]).toBe('b');
    });

    it('never manufactures a run: an automation that missed nothing is not run', () => {
        // 'a' is hourly, 'b' is daily — over a 6-hour window 'a' missed ticks
        // and 'b' missed none. A budget of 10 must not invent work for 'b'.
        const list = [automation('a'), automation('b', { schedule: { cron: '0 0 * * *' } })];
        const plan = planCatchUp(list, { lastSeen: stale(6), now: NOW, budget: 10 });
        expect(plan).not.toContain('b');
        expect(plan.filter(id => id === 'a').length).toBeGreaterThan(0);
    });

    it('caps what ONE automation can take, at the per-schedule limit', () => {
        // The miss count itself is capped upstream (MAX_CATCH_UP_RUNS), so a
        // schedule that missed 24 hourly ticks is still owed only that many —
        // this is the guard against a returning user being billed for a day.
        const list = [automation('a')];
        const plan = planCatchUp(list, { lastSeen: stale(24), now: NOW, budget: 100 });
        expect(plan.length).toBeLessThanOrEqual(3);
        expect(plan.length).toBeGreaterThan(0);
    });

    it('owes nothing to a DISABLED schedule — replay would run work the user switched off', () => {
        const list = [automation('a'), automation('b', { enabled: false })];
        const plan = planCatchUp(list, { lastSeen: stale(6), now: NOW });
        expect(plan.length).toBeGreaterThan(0);
        expect(plan, 'a disabled schedule must never be replayed').not.toContain('b');
    });

    it('owes nothing to a PAUSED schedule, but resumes it once the pause expires', () => {
        const paused = [automation('a', { pauseUntil: NOW + HOUR })];
        expect(planCatchUp(paused, { lastSeen: stale(6), now: NOW })).toEqual([]);

        const expired = [automation('a', { pauseUntil: NOW - 1 })];
        const plan = planCatchUp(expired, { lastSeen: stale(6), now: NOW });
        expect(plan.length).toBeGreaterThan(0);
        expect(plan.every(id => id === 'a')).toBe(true);
    });

    it('honours the global cap, whatever the list looks like', () => {
        const many = Array.from({ length: 12 }, (_, i) => automation(`a${i}`));
        const plan = planCatchUp(many, { lastSeen: stale(24), now: NOW });
        expect(plan).toHaveLength(MAX_TOTAL_CATCH_UP);
    });

    it('a zero or negative budget owes nothing', () => {
        const list = [automation('a'), automation('b')];
        expect(planCatchUp(list, { lastSeen: stale(6), now: NOW, budget: 0 })).toEqual([]);
        expect(planCatchUp(list, { lastSeen: stale(6), now: NOW, budget: -5 })).toEqual([]);
    });

    it('an empty roster owes nothing, and terminates rather than spinning', () => {
        expect(planCatchUp([], { lastSeen: stale(6), now: NOW })).toEqual([]);
    });

    it('is deterministic — the same inputs give the same plan', () => {
        const list = [automation('a'), automation('b'), automation('c')];
        const opts = { lastSeen: stale(6), now: NOW, budget: 4 };
        expect(planCatchUp(list, opts)).toEqual(planCatchUp(list, opts));
    });
});

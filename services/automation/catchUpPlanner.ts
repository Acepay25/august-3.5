/**
 * Catch-up allocation: which automated runs the app owes after it was closed.
 *
 * WHY THIS IS ITS OWN MODULE. The policy used to live as a loop inside the
 * scheduler's mount effect, interleaved with the `await` that actually ran each
 * automation. That made it untestable — the only way to observe the allocation
 * was to let a timer fire — and it is the part most likely to be wrong, since
 * it decides how much work a returning user is billed for before they touch
 * anything. Separating "decide the order" from "run the next thing" is what
 * makes it testable at all.
 *
 * THE RULE. A flat budget spent in array order is unfair in a way nobody
 * notices: the first few schedules in the list consume all of it, and one that
 * was twenty runs behind — and happened to sit below them — catches up
 * nothing. So the budget is handed out ROUND ROBIN: every eligible automation
 * takes one run before any may take a second. Same total work, and every
 * overdue schedule moves, which is the only defensible answer when the user
 * was not there to choose.
 */

import { getMissedRunCount } from './AutomationService';
import type { AutomationConfig } from '../../types/automation';

/** The whole point of the global cap: a week of missed hourly runs must not
 *  fire 168 times the moment the app opens. */
export const MAX_TOTAL_CATCH_UP = 3;

/**
 * The fields the policy reads. Structurally a subset of `AutomationConfig`
 * rather than a redefinition: the miss count is owned by
 * `getMissedRunCount`, which needs the whole config, so the planner takes the
 * real type and names only what it filters on.
 */
export type CatchUpCandidate = AutomationConfig;

export interface CatchUpPlanOptions {
    /** When the scheduler last recorded that it was alive. Null ⇒ never ran,
     *  so there is nothing to catch up on. */
    lastSeen: number | null;
    now: number;
    budget?: number;
}

/**
 * The ordered list of automation ids to catch up on, each appearing at most
 * once per round-robin pass and never more times than it missed.
 *
 * Deterministic and side-effect free: the caller runs them, in order.
 */
export const planCatchUp = (
    candidates: CatchUpCandidate[],
    opts: CatchUpPlanOptions,
): string[] => {
    if (opts.lastSeen == null) return [];
    const budget = opts.budget ?? MAX_TOTAL_CATCH_UP;
    if (budget <= 0) return [];

    // Only what may actually fire. A disabled or paused schedule is not owed a
    // run — replaying one would execute work the user has switched off.
    const eligible = candidates.filter(c => c.enabled
        && !(c.pauseUntil != null && c.pauseUntil > opts.now));
    if (eligible.length === 0) return [];

    const owed = new Map<string, number>();
    for (const c of eligible) {
        // `getMissedRunCount` takes the config it reads cron/lastRunAt from;
        // the candidate carries them, so the count is computed once, here.
        const missed = getMissedRunCount(c, new Date(opts.lastSeen), new Date(opts.now));
        if (missed > 0) owed.set(c.id, missed);
    }
    if (owed.size === 0) return [];

    // Round robin: walk the list, granting one to each that still owes
    // something, until the budget is spent or nothing is left owed.
    const order: string[] = [];
    let remaining = budget;
    let grantedThisPass = true;
    while (remaining > 0 && owed.size > 0 && grantedThisPass) {
        grantedThisPass = false;
        for (const c of eligible) {
            if (remaining <= 0) break;
            const left = owed.get(c.id) ?? 0;
            if (left <= 0) continue;
            if (left === 1) owed.delete(c.id);
            else owed.set(c.id, left - 1);
            order.push(c.id);
            remaining--;
            grantedThisPass = true;
        }
    }
    return order;
};

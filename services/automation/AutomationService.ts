/**
 * AutomationService — persistence + schedule bookkeeping for Automations.
 *
 * Configs and runs are stored per-user in Preferences (same pattern as
 * strategy docs / lens config). Runs are capped per automation (oldest
 * pruned) so a long-running automation cannot grow localStorage without
 * bound. All schedule MATH (next fire time, missed-run counts) lives in
 * cronParser.ts — this service only persists and reads.
 */

import { getPreferenceArray, getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { AutomationConfig, AutomationRun } from '../../types/automation';
import { nextCronTime, countMissedRuns } from './cronParser';

const CONFIGS_KEY_PREFIX = 'automations_v1_';
const RUNS_KEY_PREFIX = 'automation_runs_v1_';

/** Max stored runs per automation (prune oldest beyond this). */
export const MAX_RUNS_PER_AUTOMATION = 30;

/** Max catch-up runs executed after the app reopens. */
export const MAX_CATCH_UP_RUNS = 3;

export const uid = (): string => `automation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const runUid = (): string => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Item guard for the configs blob: the scheduler maps every item through
 *  `.id`/`.enabled`/`.schedule.cron`, so a junk entry (null, string, missing
 *  cron) must be dropped at the read boundary, not hit in a .map later. */
const isAutomationConfig = (item: unknown): item is AutomationConfig => {
    const c = item as Partial<AutomationConfig> | null;
    return !!c && typeof c === 'object'
        && typeof c.id === 'string'
        && typeof c.name === 'string'
        && typeof c.enabled === 'boolean'
        && !!c.schedule && typeof c.schedule.cron === 'string';
};

/** Item guard for the runs blob: consumers render `run.status`/`startedAt`
 *  and dedupe by `run.id`. */
const isAutomationRun = (item: unknown): item is AutomationRun => {
    const r = item as Partial<AutomationRun> | null;
    return !!r && typeof r === 'object'
        && typeof r.id === 'string'
        && typeof r.automationId === 'string'
        && typeof r.status === 'string';
};

// ─── Configs ────────────────────────────────────────────────────────────────

export const loadAutomationConfigs = async (username: string): Promise<AutomationConfig[]> => {
    try {
        return await getPreferenceArray<AutomationConfig>(`${CONFIGS_KEY_PREFIX}${username}`, isAutomationConfig);
    } catch (e) {
        console.warn('[Automation] Failed to load configs:', e);
        return [];
    }
};

export const saveAutomationConfigs = async (username: string, configs: AutomationConfig[]): Promise<void> => {
    await setPreferenceObject(`${CONFIGS_KEY_PREFIX}${username}`, configs);
};

// ─── Runs ───────────────────────────────────────────────────────────────────

export const loadAutomationRuns = async (username: string, automationId: string): Promise<AutomationRun[]> => {
    try {
        return await getPreferenceArray<AutomationRun>(`${RUNS_KEY_PREFIX}${username}_${automationId}`, isAutomationRun);
    } catch (e) {
        console.warn('[Automation] Failed to load runs:', e);
        return [];
    }
};

export const saveAutomationRuns = async (username: string, automationId: string, runs: AutomationRun[]): Promise<void> => {
    const pruned = runs.slice(0, MAX_RUNS_PER_AUTOMATION);
    await setPreferenceObject(`${RUNS_KEY_PREFIX}${username}_${automationId}`, pruned);
};

// ─── Scheduler last-seen (catch-up bookkeeping) ─────────────────────────────

const LAST_SEEN_KEY_PREFIX = 'automation_last_seen_v1_';

/** When the scheduler was last alive (epoch ms) — used to count ticks
 *  missed while the app was closed. */
export const loadAutomationLastSeen = async (username: string): Promise<number | null> => {
    try {
        const stored = await getPreferenceObject<number>(`${LAST_SEEN_KEY_PREFIX}${username}`);
        return typeof stored === 'number' && stored > 0 ? stored : null;
    } catch (e) {
        console.warn('[Automation] Failed to load last-seen:', e);
        return null;
    }
};

export const saveAutomationLastSeen = async (username: string, at: number): Promise<void> => {
    try {
        await setPreferenceObject(`${LAST_SEEN_KEY_PREFIX}${username}`, at);
    } catch (e) {
        console.warn('[Automation] Failed to save last-seen:', e);
    }
};

// ─── Plan quota (stage 20r) ────────────────────────────────────────────────

const PLAN_LEDGER_KEY_PREFIX = 'automation_plans_v1_';

/** How many plans ONE automation may present in one local day. The per-RUN cap
 *  is a turn-local counter (`MAX_PLANS_PER_RUN` in automationTurn); this one is
 *  the cross-run half, and it needs storage because a schedule fires again after
 *  a reload, after a crash, and while nobody is watching. */
export const MAX_PLANS_PER_DAY = 3;

/**
 * How many `error`/`skipped` runs in a row disable a schedule (E-57 §6, the
 * owner's ruling (d)). Three rather than two: one bad morning and one provider
 * maintenance window are not a broken automation, and the app should not cut a
 * trader's schedule off on the first hiccup. A SKIPPED run counts because the
 * two ways to be skipped — cancelled, or re-queued for reconnect while offline —
 * are both "the run never answered", which is exactly what an unattended
 * schedule must not do three times without anyone noticing.
 *
 * Only a human re-enable clears the counter (see `toggleAutomationEnabled`), so
 * the breaker cannot reset itself and quietly start trying again.
 */
export const MAX_CONSECUTIVE_AUTOMATION_FAILURES = 3;

/** A local calendar day, `YYYY-MM-DD`. LOCAL on purpose: a trader who sets a
 *  schedule for "every morning" means their morning, and a UTC boundary would
 *  let a 09:00 PHT schedule spend two days' quota in one afternoon. */
export const automationPlanDay = (at: Date = new Date()): string =>
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

interface PlanLedger { day: string; count: number; }

const isPlanLedger = (item: unknown): item is PlanLedger => {
    const l = item as Partial<PlanLedger> | null;
    return !!l && typeof l === 'object' && typeof l.day === 'string' && typeof l.count === 'number';
};

/** Plans presented TODAY by this automation. A ledger from another day reads as
 *  zero, so the counter cannot be stuck high by a stale blob. */
export const loadAutomationPlanCount = async (username: string, automationId: string): Promise<number> => {
    try {
        const stored = await getPreferenceObject<PlanLedger>(`${PLAN_LEDGER_KEY_PREFIX}${username}_${automationId}`);
        if (!isPlanLedger(stored) || stored.day !== automationPlanDay()) return 0;
        return Math.max(0, Math.floor(stored.count));
    } catch (e) {
        console.warn('[Automation] Failed to load the plan ledger:', e);
        return 0;
    }
};

/** Spend one of the day's plans. Returns the count AFTER this one, so the
 *  caller's receipt can name the limit it just consumed against. */
export const recordAutomationPlan = async (username: string, automationId: string): Promise<number> => {
    const day = automationPlanDay();
    const next = await loadAutomationPlanCount(username, automationId) + 1;
    try {
        await setPreferenceObject(`${PLAN_LEDGER_KEY_PREFIX}${username}_${automationId}`, { day, count: next });
    } catch (e) {
        // A ledger that cannot be written must not lose the run whose plan it
        // is tracking. The per-run cap still binds inside this turn; only the
        // cross-run half degrades, and it degrades to the NEXT turn reading 0.
        console.warn('[Automation] Failed to save the plan ledger:', e);
    }
    return next;
};

// ─── Schedule helpers (pure) ────────────────────────────────────────────────

/** Next fire time after `from`, or null when the cron is invalid/no match. */
export const getNextRunAt = (config: AutomationConfig, from: Date = new Date()): number | null => {
    const start = config.pauseUntil && config.pauseUntil > from.getTime()
        ? new Date(config.pauseUntil)
        : from;
    const next = nextCronTime(config.schedule.cron, start);
    return next ? next.getTime() : null;
};

/** Missed ticks in (since, now] capped at MAX_CATCH_UP_RUNS. */
export const getMissedRunCount = (config: AutomationConfig, since: Date, now: Date = new Date()): number =>
    countMissedRuns(config.schedule.cron, since, now, MAX_CATCH_UP_RUNS);

/**
 * AutomationService — persistence + schedule bookkeeping for Automations.
 *
 * Configs and runs are stored per-user in Preferences (same pattern as
 * strategy docs / lens config). Runs are capped per automation (oldest
 * pruned) so a long-running automation cannot grow localStorage without
 * bound. All schedule MATH (next fire time, missed-run counts) lives in
 * cronParser.ts — this service only persists and reads.
 */

import { getPreferenceObject, setPreferenceObject, removePreference } from '../infrastructure/PreferencesService';
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

// ─── Configs ────────────────────────────────────────────────────────────────

export const loadAutomationConfigs = async (username: string): Promise<AutomationConfig[]> => {
    try {
        const stored = await getPreferenceObject<AutomationConfig[]>(`${CONFIGS_KEY_PREFIX}${username}`);
        return Array.isArray(stored) ? stored : [];
    } catch (e) {
        console.warn('[Automation] Failed to load configs:', e);
        return [];
    }
};

export const saveAutomationConfigs = async (username: string, configs: AutomationConfig[]): Promise<void> => {
    await setPreferenceObject(`${CONFIGS_KEY_PREFIX}${username}`, configs);
};

export const clearAutomationConfigs = async (username: string): Promise<void> => {
    await removePreference(`${CONFIGS_KEY_PREFIX}${username}`);
};

// ─── Runs ───────────────────────────────────────────────────────────────────

export const loadAutomationRuns = async (username: string, automationId: string): Promise<AutomationRun[]> => {
    try {
        const stored = await getPreferenceObject<AutomationRun[]>(`${RUNS_KEY_PREFIX}${username}_${automationId}`);
        return Array.isArray(stored) ? stored : [];
    } catch (e) {
        console.warn('[Automation] Failed to load runs:', e);
        return [];
    }
};

export const saveAutomationRuns = async (username: string, automationId: string, runs: AutomationRun[]): Promise<void> => {
    const pruned = runs.slice(0, MAX_RUNS_PER_AUTOMATION);
    await setPreferenceObject(`${RUNS_KEY_PREFIX}${username}_${automationId}`, pruned);
};

export const clearAutomationRuns = async (username: string, automationId: string): Promise<void> => {
    await removePreference(`${RUNS_KEY_PREFIX}${username}_${automationId}`);
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

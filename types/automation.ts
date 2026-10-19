/**
 * Automations — scheduled, self-running ensemble analyses.
 *
 * Each automation has its own schedule (cron), input source (a fixed prompt
 * template, or "repeat the last manual analysis"), a legacy mode field and its
 * own moderator pick. Runs are stored per automation and
 * shown in the automation's own card feed (sidebar → Automations) — results
 * never pollute the main conversation. Reasoning/thinking records persist
 * exactly like manual runs.
 */

import { Message } from './message';

/** One analyst slot: a provider + model pair. */
export interface AutomationModelPick {
    providerId: string;
    modelId: string;
}

/** Cron-like schedule: standard 5-field expression (minute hour dom month dow). */
export interface AutomationSchedule {
    /** e.g. "star/15 * * * *" (every 15 min), "0 * * * *" (hourly),
     *  "0 9 * * 1-5" (weekdays 09:00). Evaluated in the user's local
     *  timezone. */
    cron: string;
}

export type AutomationInputSource = 'template' | 'last_analysis';

export type AutomationMode = 'standard';

export interface AutomationConfig {
    id: string;
    name: string;
    enabled: boolean;
    schedule: AutomationSchedule;
    /** What each run analyzes. */
    inputSource: AutomationInputSource;
    /** The fixed prompt template (inputSource === 'template'). */
    promptTemplate?: string;
    /** Legacy field: every run analyzes in 'standard' mode. */
    mode: AutomationMode;
    /** The debate moderator model. */
    moderatorModel: AutomationModelPick;
    pauseUntil?: number;
    createdAt: number;
    updatedAt: number;
    /** Last completed run (epoch ms). */
    lastRunAt?: number;
    /** Total runs attempted (including failures). */
    runCount: number;
    /** when set, the routine runs AS this bot —
     *  its persona prompt + its own provider/model, a casual-chat reply in
     *  its thread — instead of the ensemble debate pipeline. The bot must
     *  stay on the roster; a dangling id disables the routine at fire time
     *  (the run is marked skipped with the reason). */
    botId?: string;
}

export type AutomationRunStatus = 'running' | 'complete' | 'error' | 'skipped';

/** One scheduled execution — the stored user prompt + the full AI card. */
export interface AutomationRun {
    id: string;
    automationId: string;
    status: AutomationRunStatus;
    startedAt: string;
    finishedAt: string;
    /** The prompt (and any replayed chart images) that was sent. */
    userMessage?: Message;
    /** The complete AI message: analysis, debate turns, reasoning, models. */
    message?: Message;
    error?: string;
}

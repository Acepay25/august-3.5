/**
 * Automations — scheduled, self-running ensemble analyses.
 *
 * Each automation has its own schedule (cron), input source (a fixed prompt
 * template, or "repeat the last manual analysis"), mode (Standard / Accuracy
 * original / Accuracy pure-AI), optional lens roles, and its own model picks
 * for the three analysts + the moderator. Runs are stored per automation and
 * shown in the automation's own card feed (sidebar → Automations) — results
 * never pollute the main conversation. Reasoning/thinking records persist
 * exactly like manual runs.
 */

import { AccuracySubMode } from './enums';
import { Message } from './message';
import { Conversation } from './trade';

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

export type AutomationMode = 'standard' | AccuracySubMode;

export interface AutomationConfig {
    id: string;
    name: string;
    enabled: boolean;
    schedule: AutomationSchedule;
    /** What each run analyzes. */
    inputSource: AutomationInputSource;
    /** The fixed prompt template (inputSource === 'template'). */
    promptTemplate?: string;
    /** Analysis mode: 'standard' | 'original' (accuracy) | 'pure_ai'. */
    mode: AutomationMode;
    /** Lens mode: the 3 analyst picks map to the Macro/Technical/Risk roles. */
    useLenses: boolean;
    /** Analyst models — exactly 3 when useLenses, 1-3 otherwise. */
    analystModels: AutomationModelPick[];
    /** The debate moderator model. */
    moderatorModel: AutomationModelPick;
    createdAt: number;
    updatedAt: number;
    /** Last completed run (epoch ms). */
    lastRunAt?: number;
    /** Total runs attempted (including failures). */
    runCount: number;
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

/** Synthetic conversation used to run an automation through the pipeline. */
export interface AutomationRunContext {
    automationId: string;
    conversation: Conversation;
}

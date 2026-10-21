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
    /**
     * Consecutive runs that ended `error` or `skipped` (E-57 §6, ruling d).
     * A clean complete resets it; a human re-enable clears it. It is NOT a
     * running total of failures — the breaker counts a STREAK, because three
     * failures spread over a month are a schedule that works, and three in a
     * row are a schedule nobody is watching.
     */
    consecutiveFailures?: number;
    /**
     * Set only when the BREAKER disabled the schedule. A schedule the trader
     * turned off themselves has `enabled: false` and no reason here, and the
     * two must not look alike on the card: one is a choice, the other is the
     * app reporting that it stopped trying.
     */
    disabledReason?: string;
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
    /**
     * The turn's honest caveats, structured (E-57 §6): a read that called no
     * market tool, a tool that came back `ok: false`, a plan the ration refused.
     *
     * The turn already wrote these into `message.text` — and that is load-bearing,
     * because the next scheduled run's history is built from these stored rows,
     * so the model is told what went wrong last time. What evaporated was the
     * RECORD: an `error` or `skipped` run has no message at all, and the card's
     * analysis-shaped path builds its bubble from the analysis object and drops
     * the prose. Either way nothing structural recorded that the run had a
     * caveat, so a schedule could badge `Complete` on a run that never read
     * the tape.
     */
    notices?: string[];
    /**
     * How the plan ration answered THIS run. Counts, not prose: the refusal
     * sentence lives in `notices`, and a card that wants to say "1 of 2 plans
     * was allowed" must not parse a sentence to get a number.
     */
    plans?: { presented: number; refused: number };
}

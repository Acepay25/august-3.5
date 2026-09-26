/**
 * useAutomations — state + scheduler for scheduled ensemble analyses.
 *
 * Owns the automation configs (CRUD), the per-automation run store, the
 * cron tick loop, and the catch-up pass that replays ticks missed while the
 * app was closed (capped). Runs execute through the SAME analysis pipeline
 * (handleSendMessage with the automation option): each run gets its own
 * mode/model overrides and delivers its card via onMessage — the main
 * conversation is never touched, and reasoning/thinking records persist
 * exactly like manual runs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, ImageMetadata, Message, MessageRole } from '../types';
import { ProviderConfig } from '../types/provider';
import { AnalystLensConfig, AnalystRole, AccuracySubMode } from '../types';
import { AutomationConfig, AutomationRun, AutomationModelPick } from '../types/automation';
import {
    loadAutomationConfigs,
    saveAutomationConfigs,
    loadAutomationRuns,
    saveAutomationRuns,
    getNextRunAt,
    getMissedRunCount,
    loadAutomationLastSeen,
    saveAutomationLastSeen,
    uid,
    runUid,
} from '../services/automation/AutomationService';
import { parseCron, nextCronTime, hasCronFireBetween } from '../services/automation/cronParser';
import { planCatchUp } from '../services/automation/catchUpPlanner';
import type { AgentBot } from '../services/agents/agentRoster';
import type { DMEnvelope } from '../services/agents/botMailbox';
import {
    botRoutineMessageRow,
    botRoutineRunRow,
    botRoutineSkipReason,
    runBotRoutineTurn,
} from '../services/agents/botRoutine';
import { readBotSystemMarkdown, readBotMemoryMarkdown } from '../services/bots/BotMemoryService';
import { buildBotSharedMemoryContext, recordBotTurnOutcome } from '../services/agents/botLearning';
import type { LoggedTrade } from '../types';
import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';

/** Global catch-up budget: at most this many missed runs replay on reopen. */

/** Per-run mode/model overrides (absent fields fall back to global settings). */
export interface AutomationRunOverrides {
    accuracyMode?: boolean;
    accuracySubMode?: AccuracySubMode;
    lensConfig?: AnalystLensConfig;
    ensembleModelSelection?: { providerId: string; model: string }[];
    moderatorConfig?: ProviderConfig;
    moderatorModel?: string;
}

/** What the pipeline reports when it returns. The scheduler needs this because
 *  several pipeline exits reach neither `onMessage` nor `onError` — without an
 *  observable return, a run that bailed early would never be settled. */
export interface AutomationPipelineOutcome {
    /** true = the pipeline finished by its own rules, which is NOT the same as
     *  "produced a verdict" (cancellation and the offline re-queue both set it). */
    ok?: boolean;
}

export interface AutomationPipelineRunner {
    (
        prompt: string,
        images: ImageMetadata[] | undefined,
        hiddenContext: string | undefined,
        options: {
            automation: {
                automationId: string;
                conversation: Conversation;
                overrides?: AutomationRunOverrides;
                onMessage: (run: { userMessage: Message; aiMessage: Message }) => void;
                onError: (error: string) => void;
            };
        }
    ): Promise<AutomationPipelineOutcome | void>;
}

export interface UseAutomationsParams {
    activeUsername: string | null;
    runPipeline: AutomationPipelineRunner;
    conversationHistory: Conversation[];
    providerConfigs: ProviderConfig[];
    isAnalysisInProgress: boolean;
    toast: {
        success: (t: string, m?: string) => void;
        error: (t: string, m?: string) => void;
        warning: (t: string, m?: string) => void;
    };
    /**
     * the bot roster. Bot-scoped routines run AS a
     * roster bot (persona + its provider/model) instead of the ensemble.
     * Accepts a live snapshot getter (App's roster state lives below this
     * hook in its body) or a plain array. Optional so existing call sites
     * and tests stay valid; a bot-scoped run without a bridge is a visible
     * skip (never a silent no-show).
     */
    bots?: AgentBot[] | (() => AgentBot[]);
    /** Live journal snapshot for the bot's write-back (WS-3.2): a scheduled
     *  turn folds the closed trades its bot authored through the same draft
     *  chain a DM turn runs. Optional — absent, the routine still runs and
     *  still reads the shared notebook. */
    trades?: () => LoggedTrade[];
    /** Live message array ref — the bot turn's history is its own thread. */
    messagesRef?: React.MutableRefObject<Message[]>;
    /** Deliver the reply's [[dm:@…]] markers (useBotMailbox.dispatchFromBotReply shape). */
    onBotRoutineDMs?: (envelopes: DMEnvelope[]) => void;
}

/** Reconstruct an ImageMetadata from a stored data URL (repeat-last-analysis). */
const dataURLToImageMetadata = async (dataURL: string, index: number, summaries: string[]): Promise<ImageMetadata | null> => {
    let file: File;
    try {
        const blob = await (await fetch(dataURL)).blob();
        file = new File([blob], `automation-chart-${index}.png`, { type: blob.type || 'image/png' });
    } catch {
        return null; // unrecoverable image — skip it, the prompt still runs
    }
    const summary = summaries[index] || '';
    return {
        file,
        dataURL,
        summary,
        fullAnalysisText: summary,
        isLoading: false,
        ocrModelUsed: undefined,
    };
};

export const buildAutomationOverrides = (
    config: AutomationConfig,
    providerConfigs: ProviderConfig[]
): AutomationRunOverrides => {
    const moderatorConfig = providerConfigs.find(p => p.id === config.moderatorModel.providerId);
    const accuracyMode = config.mode !== 'standard';
    const accuracySubMode: AccuracySubMode = config.mode === 'pure_ai' ? 'pure_ai' : 'original';

    if (config.useLenses && config.analystModels.length === 3) {
        const [macro, technical, risk] = config.analystModels;
        return {
            accuracyMode,
            accuracySubMode,
            lensConfig: {
                enabled: true,
                // The run's own trading style — 'swing' was hardcoded here,
                // so automated lens runs could never use position/scalp/auto.
                tradingStyle: config.lensTradingStyle ?? 'swing',
                assignments: [
                    { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: macro.providerId, assignedModel: macro.modelId },
                    { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: technical.providerId, assignedModel: technical.modelId },
                    { role: AnalystRole.RISK_EXECUTION, assignedProvider: risk.providerId, assignedModel: risk.modelId },
                ],
            },
            moderatorConfig: moderatorConfig ?? undefined,
            moderatorModel: config.moderatorModel.modelId,
        };
    }

    return {
        accuracyMode,
        accuracySubMode,
        ensembleModelSelection: config.analystModels.map(m => ({ providerId: m.providerId, model: m.modelId })),
        moderatorConfig: moderatorConfig ?? undefined,
        moderatorModel: config.moderatorModel.modelId,
    };
};

/** How often the scheduler may persist its "still alive" checkpoint. The tick
 *  runs every 15s; the checkpoint only feeds catch-up accounting, and
 *  `getMissedRunCount` answers in whole cron occurrences, so a checkpoint that
 *  lags by up to a minute cannot invent or lose a run — while writing a
 *  Preferences blob every 15s around the clock is real I/O (and on native, real
 *  eviction pressure on the shared origin) for a number that only needs to be
 *  roughly right. Flushed with force on teardown instead. */
const LAST_SEEN_FLUSH_MS = 60_000;

export function useAutomations(params: UseAutomationsParams) {
    const { activeUsername, runPipeline, conversationHistory, providerConfigs, isAnalysisInProgress, toast } = params;

    const [configs, setConfigs] = useState<AutomationConfig[]>([]);
    const [viewAutomationId, setViewAutomationId] = useState<string | null>(null);
    const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; automation: AutomationConfig } | null>(null);
    const [runsByAutomation, setRunsByAutomation] = useState<Record<string, AutomationRun[]>>({});
    const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null);

    // Refs for the interval + async paths (no stale closures).
    const configsRef = useRef<AutomationConfig[]>([]);
    configsRef.current = configs;
    const usernameRef = useRef<string | null>(activeUsername);
    usernameRef.current = activeUsername;
    const inFlightRef = useRef<string | null>(null);
    const conversationHistoryRef = useRef(conversationHistory);
    conversationHistoryRef.current = conversationHistory;
    // live roster/messages/DM-delivery read at FIRE time (the
    // roster can change between render and a cron fire, and App's roster
    // state is declared below this hook, so a getter must not be invoked
    // during render — only once a run actually fires).
    const botsSourceRef = useRef<AgentBot[] | (() => AgentBot[]) | undefined>(undefined);
    botsSourceRef.current = params.bots;
    const messagesRefRef = useRef<React.MutableRefObject<Message[]> | undefined>(params.messagesRef);
    messagesRefRef.current = params.messagesRef;
    const dmsRef = useRef<((envelopes: DMEnvelope[]) => void) | undefined>(params.onBotRoutineDMs);
    dmsRef.current = params.onBotRoutineDMs;
    const tradesRef = useRef<(() => LoggedTrade[]) | undefined>(params.trades);
    tradesRef.current = params.trades;
    // The scheduler lives in an interval that only re-subscribes when the
    // PROFILE changes (its deps are [activeUsername]), so every value the tick
    // reads has to come from a ref — otherwise the interval keeps running
    // against the props of the render that created it. Two bugs that made
    // visible: the busy-guard at the top of the tick saw a FROZEN
    // isAnalysisInProgress, so a manual analysis could not block a cron fire and
    // both wrote into the same conversation; and `runAutomation` resolved the
    // moderator/analyst configs from the provider list AS IT WAS AT MOUNT
    // (buildAutomationOverrides + botRoutineSkipReason both take
    // providerConfigs), so a Settings → Providers edit never reached a
    // scheduled run. Assigning during render is the convention already used by
    // every other volatile value above.
    const analysisBusyRef = useRef(false);
    analysisBusyRef.current = !!params.isAnalysisInProgress;
    const runAutomationRef = useRef<(config: AutomationConfig, isCatchUp?: boolean) => Promise<void>>(
        async () => { /* replaced on first render */ },
    );

    const botsNow = (): AgentBot[] => {
        const src = botsSourceRef.current;
        return typeof src === 'function' ? src() : (src ?? []);
    };
    // Per-automation "last tick checked" timestamps — the scheduler fires
    // when the cron's next occurrence falls inside the tick window, so
    // second-exact schedules are never missed by a coarse tick.
    const lastCheckedRef = useRef<Map<string, number>>(new Map());

    const persistConfigs = useCallback(async (next: AutomationConfig[]) => {
        setConfigs(next);
        const username = usernameRef.current;
        if (username) {
            try {
                await saveAutomationConfigs(username, next);
            } catch (e) {
                console.warn('[Automation] Failed to persist configs:', e);
            }
        }
    }, []);

    const loadRuns = useCallback(async (automationId: string) => {
        const username = usernameRef.current;
        if (!username) return;
        const runs = await loadAutomationRuns(username, automationId);
        setRunsByAutomation(prev => ({ ...prev, [automationId]: runs }));
    }, []);

    const appendRun = useCallback(async (automationId: string, run: AutomationRun) => {
        const username = usernameRef.current;
        if (!username) return;
        const existing = runsByAutomationRef.current[automationId] ?? [];
        const next = [run, ...existing];
        setRunsByAutomation(prev => ({ ...prev, [automationId]: next }));
        runsByAutomationRef.current = { ...runsByAutomationRef.current, [automationId]: next };
        try {
            await saveAutomationRuns(username, automationId, next);
        } catch (e) {
            console.warn('[Automation] Failed to persist run:', e);
        }
    }, []);
    const runsByAutomationRef = useRef<Record<string, AutomationRun[]>>({});

    // ─── bot-scoped routine execution ─────────────────────────────────
    // Runs the automation AS a roster bot: persona system prompt + the
    // bot's own provider/model, reply appended as an AI row attributed to
    // the bot's identity pair (threadForProvider files it in the bot's
    // 1:1 thread). Mirrors runAutomation's bookkeeping (one-run guard,
    // lastRunAt/runCount bump, catch-up chaining) minus the ensemble
    // machinery. DM markers in the reply are stripped by the pure half and
    // delivered through the mailbox bridge.
    const runBotScopedAutomation = useCallback(async (
        config: AutomationConfig,
        isCatchUp: boolean,
    ): Promise<void> => {
        const bots = botsNow();
        const messagesSource = messagesRefRef.current;
        const deliverDMs = dmsRef.current;
        const skipReason = botRoutineSkipReason(bots, config, providerConfigs);
        const prompt = (config.promptTemplate ?? '').trim();
        const runId = runUid();
        const startedAt = new Date().toISOString();
        const finishMeta = (): void => {
            const nextConfigs = configsRef.current.map(c => c.id === config.id
                ? { ...c, lastRunAt: Date.now(), runCount: c.runCount + 1, updatedAt: Date.now() }
                : c);
            void persistConfigs(nextConfigs);
        };

        if (skipReason || !prompt) {
            if (skipReason) {
                appendRun(config.id, {
                    id: runId, automationId: config.id, status: 'skipped',
                    startedAt, finishedAt: new Date().toISOString(), error: skipReason,
                });
                toast.warning(isCatchUp ? 'Routine skipped (catch-up)' : 'Routine skipped',
                    `"${config.name}" — ${skipReason}`);
            } else {
                toast.warning('Routine skipped', `"${config.name}" has no prompt template.`);
            }
            finishMeta();
            return;
        }

        if (!messagesSource || !deliverDMs) {
            // No bridge wired (embedders/tests without the Bot Mode half):
            // a bot-scoped routine must not silently degrade into the
            // ensemble pipeline — surface the miss.
            toast.error('Routine failed', `"${config.name}" — bot routines are not wired up.`);
            return;
        }

        inFlightRef.current = config.id;
        setRunningAutomationId(config.id);
        try {
            const outcome = await runBotRoutineTurn(config.botId!, prompt, {
                bots,
                providerConfigs,
                messages: messagesSource.current,
                persona: readBotSystemMarkdown(config.botId!),
                notes: readBotMemoryMarkdown(config.botId!),
                stream: (provider, p, history, system) => streamQuickResponse(provider, p, history, system),
                // WS-3: a scheduled bot reads the shared notebook too — same
                // budgeted retrieval slice a DM turn gets, same scope contract,
                // recorded under this run's reply id so a trade logged from it
                // credits what the bot was actually shown.
                sharedMemory: (p, bot) => buildBotSharedMemoryContext(p, {
                    botId: bot.id,
                    memoryScope: bot.memoryScope ?? 'global',
                    runId: `botrun-${runId}`,
                }),
            });
            if (outcome.status === 'skipped') {
                appendRun(config.id, {
                    id: runId, automationId: config.id, status: 'skipped',
                    startedAt, finishedAt: new Date().toISOString(), error: outcome.skipReason,
                });
                toast.warning(isCatchUp ? 'Routine skipped (catch-up)' : 'Routine skipped',
                    `"${config.name}" — ${outcome.skipReason}`);
            } else {
                const replyId = `botrun-${runId}`;
                const row = botRoutineMessageRow(outcome.bot, outcome.reply, replyId, {
                    runId: replyId,
                    startedAt,
                    durationMs: Date.now() - new Date(startedAt).getTime(),
                });
                messagesSource.current = [...messagesSource.current, row];
                appendMessageRef.current?.(row);
                if (outcome.dmEnvelopes.length > 0) deliverDMs(outcome.dmEnvelopes);
                appendRun(config.id, botRoutineRunRow(config, prompt, runId, startedAt, row));
                // WS-3.2: a scheduled turn teaches the bot too — lesson into its
                // own memory.md and its closed trades through the same draft
                // chain a DM turn runs. Fire-and-forget: a learning failure
                // never marks a delivered run as failed.
                const runUser = usernameRef.current;
                if (runUser) {
                    void recordBotTurnOutcome(outcome.bot, prompt, outcome.reply, {
                        username: runUser,
                        trades: tradesRef.current?.() ?? [],
                    }).catch(err => console.warn('[Automations] bot turn learning failed:', err));
                }
                toast.success(isCatchUp ? 'Routine caught up' : 'Routine complete',
                    `"${config.name}" — ${outcome.bot.name} replied.`);
            }
            finishMeta();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            appendRun(config.id, {
                id: runId, automationId: config.id, status: 'error',
                startedAt, finishedAt: new Date().toISOString(), error: msg,
            });
            toast.error('Routine failed', `"${config.name}" — ${msg}`);
            finishMeta();
        } finally {
            inFlightRef.current = null;
            setRunningAutomationId(null);
        }
    }, [providerConfigs, toast, appendRun, persistConfigs]);

    // Set once by App after both hooks exist (see assignAutomationsBridge).
    const appendMessageRef = useRef<((msg: Message) => void) | null>(null);

    // ─── Execute one run ──────────────────────────────────────────────────
    const runAutomation = useCallback(async (config: AutomationConfig, isCatchUp = false): Promise<void> => {
        if (inFlightRef.current) return; // one run at a time (manual or automation)
        if (params.isAnalysisInProgress) return;
        const username = usernameRef.current;
        if (!username || !config.enabled) return;

        // ─── bot-scoped routine — run AS the bot, not the ensemble ─────
        // A bot-scoped run is the bot's own casual turn (persona prompt +
        // provider/model, reply filed into its thread) instead of the
        // ensemble debate. No-op prompts and a dangling bot/provider are
        // VISIBLE skips (stored on the run), never silent no-shows.
        if (config.botId) {
            await runBotScopedAutomation(config, isCatchUp);
            return;
        }

        // Build the input: fixed template, or replay the last manual analysis.
        let prompt = (config.promptTemplate ?? '').trim();
        let images: ImageMetadata[] | undefined;
        if (config.inputSource === 'last_analysis') {
            const last = await findLastManualAnalysis(conversationHistoryRef.current);
            if (!last) {
                toast.warning('Automation skipped', `"${config.name}" — no previous analysis found to repeat.`);
                return;
            }
            prompt = last.prompt;
            images = last.images;
        }
        if (!prompt) {
            toast.warning('Automation skipped', `"${config.name}" has no prompt template.`);
            return;
        }

        const runId = runUid();
        const startedAt = new Date().toISOString();
        inFlightRef.current = config.id;
        setRunningAutomationId(config.id);
        appendRun(config.id, { id: runId, automationId: config.id, status: 'running', startedAt, finishedAt: startedAt });

        // The run's chat history = the last few runs of THIS automation
        // (context continuity), never the main conversation.
        const previousRuns = (await loadAutomationRuns(username, config.id)).slice(0, 4);
        const historyMessages: Message[] = [];
        for (const r of [...previousRuns].reverse()) {
            if (r.userMessage) historyMessages.push(r.userMessage);
            if (r.message) historyMessages.push(r.message);
        }
        const conversation: Conversation = {
            id: `automation-${config.id}`,
            title: config.name,
            timestamp: Date.now(),
            messages: historyMessages,
            ocrModel: '',
            moderatorProviderId: config.moderatorModel.providerId,
            moderatorModel: config.moderatorModel.modelId,
            leverage: DEFAULT_LEVERAGE,
            threadSummary: undefined,
        };

        // A promise that resolves when the run actually completes (or bails)
        // — lets the catch-up loop chain runs instead of no-oping on the
        // in-flight guard (the pipeline itself is fire-and-forget).
        let resolveDone: () => void = () => { };
        const done = new Promise<void>(res => { resolveDone = res; });
        let finished = false;
        const finish = (run: Partial<AutomationRun> & { status: AutomationRun['status'] }) => {
            // Exactly-once: the pipeline callback and the settlement guard
            // below can both legitimately reach `finish`, and a duplicate
            // would write a second run row and double-count runCount.
            if (finished) return;
            finished = true;
            const finishedAt = new Date().toISOString();
            appendRun(config.id, {
                id: runId,
                automationId: config.id,
                status: run.status,
                startedAt,
                finishedAt,
                userMessage: run.userMessage,
                message: run.message,
                error: run.error,
            });
            const nextConfigs = configsRef.current.map(c => c.id === config.id
                ? { ...c, lastRunAt: Date.now(), runCount: c.runCount + 1, updatedAt: Date.now() }
                : c);
            void persistConfigs(nextConfigs);
            inFlightRef.current = null;
            setRunningAutomationId(null);
            resolveDone();
        };

        // `runPipeline` invokes onMessage/onError BEFORE it returns, so
        // awaiting its promise is a superset of waiting on `done` — and unlike
        // `done` it cannot be stranded. Four of the pipeline's early returns
        // (cancelled, 429 rate-limit, quota, offline re-queue) reach NO
        // automation callback at all; when one of those fired, `done` never
        // resolved, `inFlightRef` stayed set, and the tick loop's in-flight
        // guard silently disabled every automation until the app restarted.
        // A 429 is the single most likely outcome of an unattended run.
        const settled = await Promise.resolve(runPipeline(prompt, images, undefined, {
            automation: {
                automationId: config.id,
                conversation,
                overrides: buildAutomationOverrides(config, providerConfigs),
                onMessage: ({ userMessage, aiMessage }) => {
                    finish({ status: 'complete', userMessage, message: aiMessage });
                    const a = aiMessage.analysis;
                    toast.success(isCatchUp ? 'Automation caught up' : 'Automation complete',
                        `"${config.name}" — ${a?.direction ?? 'No signal'} ${a?.coinName ?? ''} (${a?.confidence ?? '—'} confidence)`);
                },
                onError: (error) => {
                    finish({ status: 'error', error });
                    toast.error('Automation failed', `"${config.name}" — ${error}`);
                },
            },
        })).then(
            result => ({ ok: true as const, result }),
            (error: unknown) => ({ ok: false as const, error }),
        );

        if (!finished) {
            if (!settled.ok) {
                const msg = settled.error instanceof Error
                    ? settled.error.message
                    : 'The automation run threw before producing a result.';
                finish({ status: 'error', error: msg });
                toast.error('Automation failed', `"${config.name}" — ${msg}`);
            } else if ((settled.result as unknown as AutomationPipelineOutcome | undefined)?.ok === true) {
                // The pipeline considered itself finished without a verdict
                // bubble — cancellation and the offline re-queue both land
                // here. Not a failure, and not a completed analysis.
                finish({ status: 'skipped', error: 'The run ended before producing a verdict (cancelled, or re-queued for reconnect).' });
            } else {
                finish({ status: 'error', error: 'The run ended before producing a verdict (rate limit, quota, or an early pipeline exit).' });
                toast.error('Automation failed', `"${config.name}" — the run ended without a verdict.`);
            }
        }

        // Wait for the run to complete (finish callback) so callers that
        // await this (catch-up chaining) serialize correctly.
        await done;
    }, [params.isAnalysisInProgress, providerConfigs, toast, appendRun, persistConfigs, runPipeline]);

    // The scheduler interval is created once per profile, not once per render,
    // so it reaches this render's closure through a ref instead of capturing
    // the one it was created in (see analysisBusyRef above).
    runAutomationRef.current = runAutomation;


    // ─── Scheduler: tick loop + catch-up on init ──────────────────────────
    useEffect(() => {
        const username = activeUsername;
        if (!username) {
            setConfigs([]);
            return;
        }

        let cancelled = false;

        // The "scheduler is alive" checkpoint, throttled — see LAST_SEEN_FLUSH_MS.
        // The caller names the profile THIS scheduler instance owns rather than
        // reading usernameRef: on a profile switch the teardown flush has to
        // stamp the clock that is STOPPING, and the ref already points at the
        // next profile by the time cleanup runs.
        let lastFlushAt = 0;
        const touchLastSeen = async (who: string, force = false): Promise<void> => {
            const now = Date.now();
            if (!force && now - lastFlushAt < LAST_SEEN_FLUSH_MS) return;
            lastFlushAt = now;
            await saveAutomationLastSeen(who, now);
        };

        (async () => {
            const loaded = await loadAutomationConfigs(username);
            if (cancelled) return;
            setConfigs(loaded);
            // Prime the per-automation checkpoints: a fresh automation starts
            // its clock NOW (never fires retroactively); an existing one
            // continues from its last completed run.
            for (const config of loaded) {
                lastCheckedRef.current.set(config.id, config.lastRunAt ?? Date.now());
            }

            // Catch-up: replay ticks missed while the app was closed. The
            // policy — which schedule is owed what, in what order — lives in
            // services/automation/catchUpPlanner, because it is a decision
            // worth testing and was not testable while it was a loop wrapped
            // around the await that does the work.
            const lastSeen = await loadAutomationLastSeen(username);
            for (const id of planCatchUp(loaded, { lastSeen, now: Date.now() })) {
                if (cancelled) break;
                const config = loaded.find(c => c.id === id);
                if (!config) continue;
                // Through the ref: this loop outlives the render that created
                // it, and a catch-up run must resolve the same live provider
                // configs a live tick run resolves.
                await runAutomationRef.current(config, true);
            }
            if (!cancelled) await touchLastSeen(username, true);
        })();

        // Tick every 15s: fire an automation when its cron's next occurrence
        // falls inside the window since the last check. Window-based (not
        // "matches right now") so second-exact schedules are never missed,
        // and one run per tick keeps manual + automation runs serialized.
        const interval = window.setInterval(async () => {
            if (cancelled) return;
            const usernameNow = usernameRef.current;
            if (!usernameNow) return;
            await touchLastSeen(usernameNow);
            const now = Date.now();
            // The live busy flag, read from a ref: this closure is only as old as
            // the profile switch, and a manual run started after that is exactly
            // what this guard exists to yield to.
            if (inFlightRef.current || analysisBusyRef.current) {
                // A run that lasts longer than the cron cadence must NOT look
                // like N missed fires when it finishes: advance every
                // automation's checkpoint even while one is in flight, or the
                // next tick's window spans the whole run and re-fires it
                // (back-to-back runs for every-N-minute crons).
                for (const config of configsRef.current) {
                    lastCheckedRef.current.set(config.id, now);
                }
                return;
            }
            for (const config of configsRef.current) {
                if (!config.enabled) continue;
                if (config.pauseUntil && config.pauseUntil > now) continue;
                const lastCheck = lastCheckedRef.current.get(config.id)
                    ?? (config.lastRunAt ?? Date.now());
                if (hasCronFireBetween(config.schedule.cron, new Date(lastCheck), new Date(now))) {
                    lastCheckedRef.current.set(config.id, now);
                    // Same reason as the guard above: the provider configs this
                    // run resolves its moderator/analyst pair from must be the
                    // current ones, not the ones alive at mount.
                    void runAutomationRef.current(config);
                    break; // one run per tick
                }
            }
        }, 15_000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
            // The tick's checkpoint writes are throttled, so the last minute of
            // this scheduler's life has no checkpoint yet. Stamp it on the way
            // out — catch-up accounting reads precisely this number, and after a
            // hard kill (task manager, crash) the last throttled flush IS the
            // checkpoint, which is why the throttle only needs to be roughly
            // right.
            void touchLastSeen(username, true);
        };
    }, [activeUsername]);

    // ─── CRUD ─────────────────────────────────────────────────────────────
    const saveAutomation = useCallback(async (config: AutomationConfig) => {
        const existing = configsRef.current.some(c => c.id === config.id);
        const next = existing
            ? configsRef.current.map(c => c.id === config.id ? config : c)
            : [...configsRef.current, config];
        await persistConfigs(next);
        // A created/edited schedule starts counting from now — the new
        // schedule must not fire retroactively.
        lastCheckedRef.current.set(config.id, Date.now());
    }, [persistConfigs]);

    const deleteAutomation = useCallback(async (id: string) => {
        const username = usernameRef.current;
        const next = configsRef.current.filter(c => c.id !== id);
        await persistConfigs(next);
        if (username) {
            try {
                await saveAutomationRuns(username, id, []);
            } catch (e) {
                console.warn('[Automation] Failed to clear runs:', e);
            }
        }
        setRunsByAutomation(prev => {
            const nextRuns = { ...prev };
            delete nextRuns[id];
            return nextRuns;
        });
        if (viewAutomationId === id) setViewAutomationId(null);
    }, [persistConfigs, viewAutomationId]);

    const toggleAutomationEnabled = useCallback(async (id: string) => {
        const config = configsRef.current.find(c => c.id === id);
        if (!config) return;
        await persistConfigs(configsRef.current.map(c => c.id === id ? { ...c, enabled: !c.enabled, updatedAt: Date.now() } : c));
        // Enabling must not immediately fire a stale match — restart the
        // schedule clock at now.
        lastCheckedRef.current.set(id, Date.now());
    }, [persistConfigs]);

    const pauseAutomationUntil = useCallback(async (id: string, untilMs: number) => {
        await persistConfigs(configsRef.current.map(c => c.id === id ? { ...c, pauseUntil: untilMs, updatedAt: Date.now() } : c));
    }, [persistConfigs]);

    // ─── UI state helpers ─────────────────────────────────────────────────
    const openAutomation = useCallback((id: string | null) => {
        setViewAutomationId(id);
        if (id) void loadRuns(id);
    }, [loadRuns]);

    const refreshRuns = useCallback((id: string) => {
        void loadRuns(id);
    }, [loadRuns]);

    /**
     * App wires the automations hook to the Bot Mode half after
     * both hooks exist (the roster state and mailbox live below useAuto-
     * mations in App's body). Assigned refs, never re-rendering state.
     */
    const assignAutomationsBridge = useCallback((bridge: {
        appendMessage: (msg: Message) => void;
    }) => {
        appendMessageRef.current = bridge.appendMessage;
    }, []);

    // ─── Schedule previews (for the sidebar + editor) ─────────────────────
    const getNextRunPreview = useCallback((config: AutomationConfig): string | null => {
        if (!config.enabled) return null;
        const next = nextCronTime(config.schedule.cron, new Date());
        if (!next) return null;
        return next.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }, []);

    return {
        configs,
        viewAutomationId,
        editor,
        setEditor,
        runningAutomationId,
        runsByAutomation,
        openAutomation,
        closeAutomation: () => setViewAutomationId(null),
        refreshRuns,
        runAutomation,
        runNow: (config: AutomationConfig) => void runAutomation(config, false),
        saveAutomation,
        deleteAutomation,
        toggleAutomationEnabled,
        pauseAutomationUntil,
        assignAutomationsBridge,
        botRoutineCount: (botId: string): number =>
            configs.filter(c => c.botId === botId).length,
        botRoutinesFor: (botId: string): AutomationConfig[] =>
            configs.filter(c => c.botId === botId),
        getNextRunPreview,
        isCronValid: (cron: string) => parseCron(cron) !== null,
        uid,
    };
}

/**
 * Find the most recent manual analysis in any conversation: the newest
 * AI message carrying a real analysis, with its preceding user prompt +
 * chart images (replayed from the stored data URLs).
 */
const findLastManualAnalysis = async (
    conversations: Conversation[]
): Promise<{ prompt: string; images: ImageMetadata[] } | null> => {
    for (let c = conversations.length - 1; c >= 0; c--) {
        const msgs = conversations[c].messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
            const ai = msgs[i];
            if (ai.role === MessageRole.AI && ai.analysis && ai.analysis.direction && ai.analysis.direction !== 'Neutral') {
                const user = msgs[i - 1];
                if (user && user.role === MessageRole.USER && user.text.trim()) {
                    const dataURLs = user.images || [];
                    const summaries = user.imageSummaries || [];
                    const images: ImageMetadata[] = [];
                    for (let d = 0; d < dataURLs.length; d++) {
                        const meta = await dataURLToImageMetadata(dataURLs[d], d, summaries);
                        if (meta) images.push(meta);
                    }
                    return { prompt: user.text, images };
                }
            }
        }
    }
    return null;
};

/** Default analyst + moderator picks: first ready providers' selected models. */
export const defaultAutomationModels = (providerConfigs: ProviderConfig[]): {
    analystModels: AutomationModelPick[];
    moderatorModel: AutomationModelPick;
} => {
    const ready = providerConfigs.filter(p => p.isEnabled && p.apiKey.trim().length > 0 && (p.models.length > 0 || !!p.selectedModel));
    const pick = (index: number): AutomationModelPick | null => {
        const provider = ready[index % Math.max(1, ready.length)];
        if (!provider) return null;
        const modelId = provider.selectedModel || provider.models[0];
        return modelId ? { providerId: provider.id, modelId } : null;
    };
    const analystModels: AutomationModelPick[] = [];
    for (let i = 0; i < Math.min(3, Math.max(1, ready.length)); i++) {
        const p = pick(i);
        if (p && !analystModels.some(m => m.providerId === p.providerId && m.modelId === p.modelId)) analystModels.push(p);
    }
    const moderator = pick(0) ?? analystModels[0] ?? { providerId: '', modelId: '' };
    return { analystModels, moderatorModel: moderator };
};

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
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';

/** Global catch-up budget: at most this many missed runs replay on reopen. */
const MAX_TOTAL_CATCH_UP = 3;

/** Per-run mode/model overrides (absent fields fall back to global settings). */
export interface AutomationRunOverrides {
    accuracyMode?: boolean;
    accuracySubMode?: AccuracySubMode;
    lensConfig?: AnalystLensConfig;
    ensembleModelSelection?: { providerId: string; model: string }[];
    moderatorConfig?: ProviderConfig;
    moderatorModel?: string;
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
    ): void;
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

    // ─── Execute one run ──────────────────────────────────────────────────
    const runAutomation = useCallback(async (config: AutomationConfig, isCatchUp = false): Promise<void> => {
        if (inFlightRef.current) return; // one run at a time (manual or automation)
        if (params.isAnalysisInProgress) return;
        const username = usernameRef.current;
        if (!username || !config.enabled) return;

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
            if (!finished) {
                finished = true;
                resolveDone();
            }
        };

        runPipeline(prompt, images, undefined, {
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
        });

        // Wait for the run to complete (finish callback) so callers that
        // await this (catch-up chaining) serialize correctly.
        await done;
    }, [params.isAnalysisInProgress, providerConfigs, toast, appendRun, persistConfigs, runPipeline]);

    // ─── Scheduler: tick loop + catch-up on init ──────────────────────────
    useEffect(() => {
        const username = activeUsername;
        if (!username) {
            setConfigs([]);
            return;
        }

        let cancelled = false;

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

            // Catch-up: replay ticks missed while the app was closed (capped
            // globally at MAX_TOTAL_CATCH_UP — a week of missed hourly runs
            // must not fire 168 times).
            const lastSeen = await loadAutomationLastSeen(username);
            if (lastSeen) {
                let budget = MAX_TOTAL_CATCH_UP;
                for (const config of loaded) {
                    if (cancelled || budget <= 0) break;
                    if (!config.enabled) continue;
                    const missed = getMissedRunCount(config, new Date(lastSeen));
                    const toRun = Math.min(missed, budget);
                    for (let i = 0; i < toRun; i++) {
                        if (cancelled || budget <= 0) break;
                        await runAutomation(config, true);
                        budget--;
                    }
                }
            }
            if (!cancelled) await saveAutomationLastSeen(username, Date.now());
        })();

        // Tick every 15s: fire an automation when its cron's next occurrence
        // falls inside the window since the last check. Window-based (not
        // "matches right now") so second-exact schedules are never missed,
        // and one run per tick keeps manual + automation runs serialized.
        const interval = window.setInterval(async () => {
            if (cancelled) return;
            const usernameNow = usernameRef.current;
            if (!usernameNow) return;
            await saveAutomationLastSeen(usernameNow, Date.now());
            const now = Date.now();
            if (inFlightRef.current || params.isAnalysisInProgress) {
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
                const lastCheck = lastCheckedRef.current.get(config.id)
                    ?? (config.lastRunAt ?? Date.now());
                if (hasCronFireBetween(config.schedule.cron, new Date(lastCheck), new Date(now))) {
                    lastCheckedRef.current.set(config.id, now);
                    void runAutomation(config);
                    break; // one run per tick
                }
            }
        }, 15_000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
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

    // ─── UI state helpers ─────────────────────────────────────────────────
    const openAutomation = useCallback((id: string | null) => {
        setViewAutomationId(id);
        if (id) void loadRuns(id);
    }, [loadRuns]);

    const refreshRuns = useCallback((id: string) => {
        void loadRuns(id);
    }, [loadRuns]);

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

/**
 * Pipeline stage module — RAF-throttled stream update helpers.
 *
 * Extracted verbatim from `useAnalysisPipeline.ts` (lines 448-704 of the
 * pre-extraction revision). These five `useRafThrottle` wrappers all share a
 * single responsibility: coalesce the per-token / per-event message updates
 * the streaming pipeline produces into one `updateMessages` write per
 * animation frame. Each wraps a small "find-by-id and patch fields" updater
 * — the updaters themselves are pure given their inputs and exported as
 * named functions for direct unit testing.
 *
 * Why bundled:
 *   - All five share the same throttle primitive (`useRafThrottle`) and the
 *     same shared dependencies (`updateMessages`, two stream refs, the run
 *     contract view, the phase ref). Co-locating them avoids five
 *     independent hand-rolled factories in the host hook.
 *   - One hook invocation replaces ~250 lines of inline closures; the wiring
 *     change in `useAnalysisPipeline.ts` shrinks to a single destructure.
 *
 * Public surface:
 *   - `useStreamThrottlers(deps)` — hook returning the five throttled writers
 *   - The five `applyXxx` functions below — the un-throttled updaters,
 *     exported for unit tests and any future synchronous caller.
 */

import { useCallback, MutableRefObject } from 'react';
import type { Message, DebateTurn, DebateRunEvent, TradeAnalysis } from '../../types';
import { useRafThrottle } from '../useRafThrottle';
import { lastCompletedRound, laneDraftsFromTurns } from '../../utils/debateResume';

type UpdateMessagesFn = (updater: (prev: Message[]) => Message[], conversationId?: string | null) => void;
type RunContractFn = () => Message['runContract'];

export interface StreamThrottlersDeps {
    updateMessages: UpdateMessagesFn;
    /** Live desk-tool chips: speaker -> latest tool line. Read by the debate
     *  updater so the persisted run log is captured alongside the turns. */
    liveToolEventsRef: MutableRefObject<Record<string, string>>;
    /** Persisted debate-run event log; mirrored into the AI message by the
     *  debate updater on every push. */
    debateRunLogRef: MutableRefObject<DebateRunEvent[]>;
    /** Live run-contract view (U1); re-derived from the run log on demand. */
    runContractFor: RunContractFn;
    /** Which pipeline phase is running. The opening-phase writer guards on
     *  this so it does not clobber the debate loop once rounds start. */
    currentPhaseRef: MutableRefObject<'analysis' | 'debate'>;
}

/** Analyst descriptor consumed by `applyOpeningThinking`. */
export interface AnalystSeed {
    name: string;
    thoughtsKey: string;
}

// ─── Pure updaters (testable without mounting the hook) ─────────────────────

/**
 * Debate-round writer: persists the latest turns + thought/reasoning maps +
 * active speaker set + run-contract view + debate checkpoint snapshot.
 * Reads `liveToolEventsRef` / `debateRunLogRef` via `runContractFor` /
 * inline refs because the upserted message must include the live state at
 * the moment of coalescing — not a stale snapshot.
 */
export function applyDebateStreamUpdate(
    prev: Message[],
    debateMessageId: string,
    currentTurns: DebateTurn[],
    thoughtMap: Record<string, string>,
    reasoningMap: Record<string, string>,
    activeSpeakers: Record<string, number>,
    runContractStages: Message['runContract'],
    liveToolEvents: Record<string, string>,
    debateRunLog: DebateRunEvent[],
): Message[] {
    const messageIndex = prev.findIndex(m => m.id === debateMessageId);
    if (messageIndex === -1) return prev;
    const updatedMessage = {
        ...prev[messageIndex],
        debateTurns: currentTurns,
        thoughtProcesses: thoughtMap,
        reasoningProcesses: reasoningMap,
        activeDebateSpeakers: { ...activeSpeakers },
        liveToolEvents: { ...liveToolEvents },
        debateRunLog: [...debateRunLog],
        runContract: runContractStages,
        debateCheckpoint: currentTurns.length > 0 ? (() => {
            const analystNames = [...new Set(currentTurns
                .filter(t => t.speaker !== 'System' && t.speaker !== 'Moderator')
                .map(t => t.speaker))];
            const completed = lastCompletedRound(currentTurns, analystNames);
            return {
                lastCompletedRound: completed,
                savedAt: new Date().toISOString(),
                analystNames,
                laneDrafts: laneDraftsFromTurns(currentTurns, completed),
            };
        })() : prev[messageIndex].debateCheckpoint,
    };
    const newMessages = [...prev];
    newMessages[messageIndex] = updatedMessage;
    return newMessages;
}

/**
 * Provisional verdict writer: while the moderator is still streaming, surface
 * the partial labeled plan so the verdict card fills in live. The final
 * authoritative commit replaces `provisionalAnalysis` with `analysis`.
 */
export function applyProvisionalVerdictUpdate(
    prev: Message[],
    debateMessageId: string,
    provisional: TradeAnalysis | undefined,
    planFields: Message['provisionalPlanFields'],
): Message[] {
    const messageIndex = prev.findIndex(m => m.id === debateMessageId);
    if (messageIndex === -1) return prev;
    if (prev[messageIndex].analysis) return prev; // final verdict already committed
    const newMessages = [...prev];
    newMessages[messageIndex] = {
        ...prev[messageIndex],
        provisionalAnalysis: provisional,
        provisionalPlanFields: planFields,
    };
    return newMessages;
}

/**
 * Ensemble-progress writer: patches a single analyst's live `reasoning` field
 * inside `ensembleProgress.analysts[thoughtsKey]` for the staged-ensemble
 * opening cards.
 */
export function applyEnsembleProgressUpdate(
    prev: Message[],
    placeholderId: string,
    thoughtsKey: string,
    reasoning: string,
): Message[] {
    const messageIndex = prev.findIndex(m => m.id === placeholderId);
    if (messageIndex === -1) return prev;
    const current = prev[messageIndex];
    const next = {
        ...current,
        ensembleProgress: {
            ...(current.ensembleProgress ?? { analysts: [], moderator: { status: 'waiting' as const } }),
            analysts: (current.ensembleProgress?.analysts ?? []).map(analyst =>
                analyst.key === thoughtsKey ? { ...analyst, reasoning } : analyst),
        },
    };
    const newMessages = [...prev];
    newMessages[messageIndex] = next;
    return newMessages;
}

/**
 * Casual-chat streaming writer: patches the live reply bubble's `text` /
 * `isStreaming` / `thoughtProcesses` fields. The latest accumulated text +
 * reasoning win per frame; `flush()` commits the settled state synchronously.
 */
export function applyCasualStreamUpdate(
    prev: Message[],
    messageId: string,
    text: string,
    thinking: string,
    providerId: string,
    streaming: boolean,
): Message[] {
    const messageIndex = prev.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return prev;
    const current = prev[messageIndex];
    const next = {
        ...current,
        text,
        isStreaming: streaming,
        thoughtProcesses: thinking ? { [providerId]: thinking } : current.thoughtProcesses,
    };
    const newMessages = [...prev];
    newMessages[messageIndex] = next;
    return newMessages;
}

/**
 * Opening-phase writer: folds accumulated reasoning + partial visible text
 * into round-1 (openings) turns, marking the message live so the debate
 * floor streams each model's thinking + output exactly the way it streams
 * later debate turns. Guarded to the analysis phase.
 */
export function applyOpeningThinkingUpdate(
    prev: Message[],
    messageId: string,
    analysts: AnalystSeed[],
    reasoningMap: Record<string, string>,
    partialMap: Record<string, string>,
): Message[] {
    const idx = prev.findIndex(m => m.id === messageId);
    if (idx === -1) return prev;
    const turns: DebateTurn[] = [];
    for (const a of analysts) {
        const key = a.thoughtsKey || a.name;
        const cot = reasoningMap[key];
        const text = partialMap[key] || '';
        if ((cot && cot.trim()) || text.trim()) {
            turns.push({ speaker: a.name, round: 1, text, reasoning: cot || '' });
        }
    }
    if (turns.length === 0) return prev;
    const active: Record<string, number> = {};
    for (const t of turns) active[t.speaker] = 1;
    const next = {
        ...prev[idx],
        isDebating: true,
        debateTurns: turns,
        activeDebateSpeakers: active,
    };
    const copy = [...prev];
    copy[idx] = next;
    return copy;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface StreamThrottlers {
    throttledDebateUpdate: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
    throttledProvisionalVerdict: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
    throttledEnsembleProgress: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
    throttledCasualStream: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
    throttledOpeningThinking: ReturnType<typeof useRafThrottle<(...args: any[]) => void>>;
}

/**
 * Bundles the five RAF-throttled stream writers used by the analysis
 * pipeline. Returns stable throttlers (`useRafThrottle` uses an empty-deps
 * `useCallback` internally) so the returned object identity changes only
 * when `deps` change.
 */
export function useStreamThrottlers(deps: StreamThrottlersDeps): StreamThrottlers {
    const {
        updateMessages,
        liveToolEventsRef,
        debateRunLogRef,
        runContractFor,
        currentPhaseRef,
    } = deps;

    // ─── Debate stream updates ────────────────────────────────────────────
    const throttledDebateUpdate = useRafThrottle(useCallback((
        conversationId: string | null,
        debateMessageId: string,
        currentTurns: DebateTurn[],
        thoughtMap: Record<string, string>,
        reasoningMap: Record<string, string>,
        activeSpeakers: Record<string, number>,
        runContractStages: Message['runContract'],
    ) => {
        updateMessages(prev => applyDebateStreamUpdate(
            prev,
            debateMessageId,
            currentTurns,
            thoughtMap,
            reasoningMap,
            activeSpeakers,
            runContractStages,
            liveToolEventsRef.current,
            debateRunLogRef.current,
        ), conversationId);
    }, [updateMessages, liveToolEventsRef, debateRunLogRef]));

    // ─── Progressive (provisional) verdict ────────────────────────────────
    const throttledProvisionalVerdict = useRafThrottle(useCallback((
        conversationId: string | null,
        debateMessageId: string,
        provisional: TradeAnalysis | undefined,
        planFields: Message['provisionalPlanFields'],
    ) => {
        updateMessages(prev => applyProvisionalVerdictUpdate(prev, debateMessageId, provisional, planFields), conversationId);
    }, [updateMessages]));

    // ─── Ensemble live reasoning updates ──────────────────────────────────
    const throttledEnsembleProgress = useRafThrottle(useCallback((
        conversationId: string | null,
        placeholderId: string,
        thoughtsKey: string,
        reasoning: string,
    ) => {
        updateMessages(prev => applyEnsembleProgressUpdate(prev, placeholderId, thoughtsKey, reasoning), conversationId);
    }, [updateMessages]));

    // ─── Casual-chat streaming updates ────────────────────────────────────
    const throttledCasualStream = useRafThrottle(useCallback((
        conversationId: string | null,
        messageId: string,
        text: string,
        thinking: string,
        providerId: string,
        streaming: boolean,
    ) => {
        updateMessages(prev => applyCasualStreamUpdate(prev, messageId, text, thinking, providerId, streaming), conversationId);
    }, [updateMessages]));

    // ─── Opening-phase thinking/output surfacing ──────────────────────────
    // Guarded to the analysis phase: once the debate loop starts it owns the
    // transcript.
    const throttledOpeningThinking = useRafThrottle(useCallback((
        conversationId: string | null,
        messageId: string,
        analysts: AnalystSeed[],
        reasoningMap: Record<string, string>,
        partialMap: Record<string, string>,
    ) => {
        if (currentPhaseRef.current !== 'analysis') return;
        updateMessages(prev => applyOpeningThinkingUpdate(prev, messageId, analysts, reasoningMap, partialMap), conversationId);
    }, [updateMessages, currentPhaseRef]));

    return {
        throttledDebateUpdate,
        throttledProvisionalVerdict,
        throttledEnsembleProgress,
        throttledCasualStream,
        throttledOpeningThinking,
    };
}
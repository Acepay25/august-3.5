/**
 * One analysis turn, written into the dock's chat transcript.
 *
 * Its only caller is the Chart AI dock's "Full analysis"
 * (`chatTurnRunner.runFullAnalysis`). That path runs the pipeline with the
 * `automation` option, which writes into a PRIVATE message list because the dock
 * renders its own session rather than App's conversation — so the transcript
 * bookkeeping (append the question, open a streaming answer, settle it, release
 * the run slot) has to happen here, or the run leaves no trace at all.
 *
 * The Chat surface deliberately does NOT use this. It renders the active
 * conversation, and the pipeline writes the same turn there; a session copy
 * keyed with fresh ids could not be recognised by `entriesForSession` as the
 * exchange it duplicated, so the dock ended up showing the question twice with
 * two different answers — its own summary beside the model's reply.
 *
 * The pipeline call is injected (`run`) so this module owns the TRANSCRIPT and
 * nothing else: it does not know how a market packet is fetched, how a debate
 * is staged, or what an `Image` is.
 */

import * as chatStore from './chatStore';
import type { LiveEntry } from './chatStore';
import { titleFromMessage } from './chatSessions';

/** What the injected pipeline call hands back. The message id is how the dock's
 *  Locate button finds the App-side message the pipeline also wrote, so the two
 *  copies of the same turn can be scrolled to together. */
export type AnalysisTurnOutcome = string | { text: string; messageId?: string };

export interface AnalysisTurnOptions {
    /** The chat session the turn belongs to — usually the active one. */
    sid: string;
    /** The trader's question, already carrying any attachment note. */
    text: string;
    /** First attached image, rendered on the question row. */
    image?: string;
    /** The pipeline itself. Rejection is reported into the transcript, not thrown. */
    run: () => Promise<AnalysisTurnOutcome>;
    /** Called once the pipeline hands back an App-side message id, so the caller
     *  can wire its Locate/scroll mapping to the answer row it just created. */
    onMessageId?: (entryId: string, messageId: string) => void;
    /** Prefix on the placeholder shown while the pipeline runs. */
    pendingText?: string;
}

const newId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** The text an analysis answer row settles to when the run produced none, an
 *  error, or was stopped. One vocabulary for all three — an empty bubble is
 *  indistinguishable from a hang. */
export const ANALYSIS_STOP_TEXT = 'The analysis was stopped.';
export const ANALYSIS_EMPTY_TEXT = 'The analysis produced no summary.';
export const ANALYSIS_FAILED_TEXT = (message: string): string => `The analysis run failed: ${message}`;

/**
 * Append the question and a streaming answer row, run the pipeline, settle the
 * answer. Always releases the session's run slot, including when the run was
 * aborted — the early return on an aborted run used to skip the settle, which
 * orphaned a `streaming: true` bubble that then blocked all session persistence
 * until reload.
 */
export const runAnalysisAsChatTurn = async (opts: AnalysisTurnOptions): Promise<void> => {
    const { sid, text, image, run, onMessageId, pendingText } = opts;

    const userEntry: LiveEntry = {
        id: newId('u'), role: 'user', text, tools: [], image, at: Date.now(),
    };
    const aiEntry: LiveEntry = {
        id: newId('a'), role: 'ai',
        text: pendingText ?? 'Running the full ensemble analysis — hybrid data pull, debate, verdict…',
        tools: [], streaming: true, at: Date.now(),
    };
    chatStore.mutate(sid, s => ({
        ...s,
        title: titleFromMessage(text),
        updatedAt: Date.now(),
        entries: [...s.entries, userEntry, aiEntry],
    }));

    const controller = new AbortController();
    chatStore.beginRun(sid, controller);
    try {
        const result = await run();
        if (controller.signal.aborted) {
            chatStore.mutate(sid, s => ({
                ...s,
                entries: s.entries.map(e => (
                    e.id === aiEntry.id
                        // Unconditionally, not `e.text || …`. Unlike the streaming
                        // answer rows, this one is never filled in progressively —
                        // its text is only the "Running the full ensemble
                        // analysis…" placeholder, so keeping it left a settled
                        // bubble still claiming the analysis was running.
                        ? { ...e, streaming: false, text: ANALYSIS_STOP_TEXT }
                        : e
                )),
            }));
            return;
        }
        const answer = typeof result === 'string' ? result : result.text;
        const messageId = typeof result === 'string' ? undefined : result.messageId;
        if (messageId) onMessageId?.(aiEntry.id, messageId);
        chatStore.mutate(sid, s => ({
            ...s,
            entries: s.entries.map(e => (
                e.id === aiEntry.id
                    ? { ...e, text: answer || ANALYSIS_EMPTY_TEXT, streaming: false }
                    : e
            )),
        }));
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        chatStore.mutate(sid, s => ({
            ...s,
            entries: s.entries.map(e2 => (
                e2.id === aiEntry.id
                    ? { ...e2, text: ANALYSIS_FAILED_TEXT(message), streaming: false }
                    : e2
            )),
        }));
    } finally {
        chatStore.endRunOwned(sid, controller);
    }
};

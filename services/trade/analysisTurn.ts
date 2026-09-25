/**
 * One analysis turn, written into the chat transcript.
 *
 * WHY THIS IS ITS OWN MODULE. Two surfaces can ask the desk a question: the
 * Chart AI dock's "Full analysis", and the Agents surface with no bot selected
 * (which is the same promise, stated in the Chat's own words). Both call the
 * same pipeline — `handleSendMessage` — but only the dock did the transcript
 * bookkeeping around it: append the question, open a streaming answer, settle
 * it, release the run slot. A turn sent from Chat therefore ran the full
 * analysis and left NO trace in the session the dock renders, so the two
 * surfaces looked like separate products even though they were one feature.
 *
 * The bookkeeping is extracted rather than copied. A second copy is exactly how
 * the two drift again — and the drift is invisible, because both copies look
 * correct in isolation.
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

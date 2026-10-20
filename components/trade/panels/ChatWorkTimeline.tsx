/**
 * ChatWorkTimeline — one AI entry's ZCode-style work timeline: the reasoning
 * stream interleaved with the desk-tool rounds that interrupted it, folded
 * into a single "Analyzed for Ns" row, plus the model's side-effect status
 * rows. Extracted from TradeChatPanel unchanged (it was an inline IIFE).
 *
 * The `[Desk tools] …` mirrors inside the reasoning text are the cut points,
 * so consecutive tool events group into ONE ToolActivityRow whose rows pair
 * call→result (a `calling…` line updates to `ok` in place, never a second
 * line). Reads only the entry it is given — no dock state.
 */

import React, { useMemo } from 'react';
import { Lightbulb } from '../../shared/Icons';
import type { ToolAction } from '../../../types/message';
import { tipForSeed } from '../../../utils/tradingTips';
import { splitReasoningAroundTools } from '../../../utils/traceText';
import { turnActivityLabel, turnKindSummary, turnWorkSummary } from '../../../utils/turnStatus';
import AnalyzedRow from '../../shared/AnalyzedRow';
import ReasoningRow from '../../shared/ReasoningRow';
import ToolActivityRow from '../../shared/ToolActivityRow';
import ToolActionsRow from '../../chat/ToolActionsRow';
import { getPayloadWriteFailure } from '../../../services/trade/toolPayloadStore';

/** What this turn's work actually was, named from the transcript it already
 *  produced — no model call, no new store.
 *
 *  The grammar, the pairing and the naming all live in `utils/turnStatus.ts`,
 *  because the transcript row and this summary are two readers of ONE
 *  grammar: what the trader reads collapsed is exactly what they get when
 *  they open it. This export stays so the existing callers keep working. */
export const workSummaryLabel = (tools: string[]): string | null =>
    turnWorkSummary(tools);

/** What the turn's work was, counted by KIND — "4 reads, 1 search". The
 *  settled row's headline, and the one thing a trader reading only the
 *  collapsed row can learn about it. */
export const workKindSummary = (tools: string[]): string | null => turnKindSummary(tools);

/** The shape this actually reads. The dock passes its `LiveEntry` straight
 *  in; the Chat surface adapts a pipeline `Message` onto the same fields.
 *  Widening the prop to the fields rather than to a store type is what lets
 *  two surfaces render one timeline without either owning the other's model. */
export interface ChatWorkView {
    id: string;
    reasoning?: string;
    tools: string[];
    streaming?: boolean;
    /** The answer text so far — "running" means work with nothing to show yet. */
    text?: string;
    actions?: ToolAction[];
    /** Frozen work time in ms, persisted at settle — survives a reload. */
    workedMs?: number;
    /** One payload id per entry in `tools`, same order. */
    toolIds?: string[];
}

export interface ChatWorkTimelineProps {
    entry: ChatWorkView;
}

const ChatWorkTimeline: React.FC<ChatWorkTimelineProps> = ({ entry }) => {
    const reasoning = entry.reasoning ?? '';
    const running = !!entry.streaming && !entry.text;
    const hasWork = reasoning.trim().length > 0 || entry.tools.length > 0;
    const hasActions = !!(entry.actions && entry.actions.length > 0);
    // What the turn is doing RIGHT NOW — the status line's word, derived from
    // the turn's own tool lines. It changes as the work changes, and it can
    // only ever report what the tools did. Declared before the early return
    // below, because a hook after one is a hook called conditionally.
    const activity = useMemo(
        () => turnActivityLabel(entry.tools, reasoning.trim().length > 0),
        [entry.tools, reasoning],
    );
    // The settled headline: what the desk did, counted by kind. It counts
    // CALLS, not lines — the transcript holds two lines per call, so a line
    // count would double every number the trader is told.
    const kindSummary = useMemo(() => turnKindSummary(entry.tools), [entry.tools]);
    if (!hasWork && !hasActions) {
        // Nothing yet: the waiting tip covers
        // the silent first moments of a turn. It is the tip's ONLY home now —
        // once there is work, the status line names the activity instead.
        return running ? (
            <p className="flex items-start gap-1.5 text-ui-dense leading-5 text-zinc-500" data-testid="thinking-placeholder">
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" aria-hidden="true" />
                <span className="min-w-0 break-words">Tip: {tipForSeed(entry.id)}</span>
            </p>
        ) : null;
    }
    const segs = splitReasoningAroundTools(reasoning);
    const markerCount = segs.length - 1;
    const nodes: React.ReactNode[] = [];
    let buf: string[] = [];
    // Payload ids in the SAME order the lines are pushed below, so `flush` can
    // hand each `ToolActivityRow` the ids for exactly the lines it is given.
    const idBuf: string[] = [...(entry.toolIds ?? [])];
    const flush = (key: string): void => {
        if (buf.length > 0) {
            // The ids ride WITH their lines: pairing inside `pairToolLines` is
            // FIFO by label, so a payload is attached by position in the buffer
            // it was rendered from, never by a lookup that could drift.
            const ids = buf.map(() => idBuf.shift() ?? '');
            nodes.push(<ToolActivityRow key={key} lines={buf} running={running} payloadIds={ids} />);
            buf = [];
        }
    };
    for (let s = 0; s < segs.length; s++) {
        if (s > 0 && s - 1 < entry.tools.length) buf.push(entry.tools[s - 1]);
        if (segs[s]?.trim()) {
            flush(`tools-${s}`);
            nodes.push(
                <ReasoningRow
                    key={`thought-${s}`}
                    thinking={segs[s]}
                    running={running && s === segs.length - 1}
                />
            );
        }
    }
    // Mirrors can lag the tools array (tool lines pushed
    // outside the desk loop) — leftovers render at the end.
    buf.push(...entry.tools.slice(markerCount));
    flush('tools-tail');

    // 2.11 — the sticky payload write failure needs a READER, or the record the
    // store keeps is invisible. A row that opens onto "full result not kept"
    // cannot tell a CLIP (a pause, the bytes exist under a ta-… id) from a store
    // that REFUSED the write (the bytes are gone). This line says which, only
    // where tool rows exist — payloads are written by tool calls alone — and it
    // names the ceiling, not a stack trace.
    const writeFailure = entry.tools.length > 0 ? getPayloadWriteFailure() : null;
    const writeFailureNote = writeFailure
        ? writeFailure.kind === 'quota'
            ? 'Some tool output was not kept — browser storage refused the write.'
            : writeFailure.kind === 'budget'
                ? 'Some tool output was not kept — the payload store is at its ceiling.'
                : 'Some tool output was not kept — a tool result could not be saved.'
        : null;
    return (
        /* The Claude-pattern work card: one bordered rounded container for the
           turn's reasoning + tool rows (was a bare left-rail border). The
           AnalyzedRow inside still does the folding to "Analyzed for Ns". */
        <div className="my-1.5 space-y-1.5 rounded-bubble border border-white/[0.06] bg-zinc-900/40 px-2.5 py-2">
            {hasWork && (
                <AnalyzedRow
                    running={running}
                    summary={kindSummary}
                    persistedMs={entry.workedMs}
                    title={workSummaryLabel(entry.tools) ?? undefined}
                    activity={activity}
                >
                    {nodes}
                    {writeFailureNote && (
                        <p className="text-ui-dense leading-5 text-zinc-500" data-testid="payload-write-failure">
                            {writeFailureNote}
                        </p>
                    )}
                </AnalyzedRow>
            )}
            {hasActions && <ToolActionsRow actions={entry.actions!} />}
        </div>
    );
};

export default ChatWorkTimeline;

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

import React from 'react';
import { Lightbulb } from '../../shared/Icons';
import type { ToolAction } from '../../../types/message';
import { tipForSeed } from '../../../utils/tradingTips';
import { splitReasoningAroundTools, stripTraceMarkers } from '../../../utils/traceText';
import AnalyzedRow from '../../shared/AnalyzedRow';
import ReasoningRow from '../../shared/ReasoningRow';
import ToolActivityRow from '../../shared/ToolActivityRow';
import ToolActionsRow from '../../chat/ToolActionsRow';

/** What this turn's work actually was, named from the transcript it already
 *  produced — no model call, no new store.
 *
 *  `pairToolLines` yields the human labels the transcript shows ("order book",
 *  "indicators", "notebook recall"), so the block title is built from the same
 *  strings the rows below it display: what you read in the summary is exactly
 *  what you get when you open it. Duplicates are folded (four order-book calls
 *  are one mention), reasoning is named once, and the result is capped so a
 *  tool-heavy turn does not become a paragraph. */
export const workSummaryLabel = (tools: string[], hasReasoning: boolean): string | null => {
    const parts: string[] = [];
    if (hasReasoning) parts.push('Read the chart');
    const seen = new Set<string>();
    for (const raw of tools) {
        const line = stripTraceMarkers(raw ?? '').trim();
        if (!line) continue;
        // Strip the trailing outcome/detail so "order book · buy wall at 88k"
        // contributes "order book", not the whole line.
        const called = /^calling\s+(.+?)(…|$)/i.exec(line);
        const head = (called ? called[1] : (line.split(' · ')[0] ?? '')).trim();
        if (!head) continue;
        const key = head.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(head);
        // Keep SCANNING past the cap: "+N more" has to name how many were
        // actually left out, not how many the loop happened to reach.
    }
    if (parts.length === 0) return null;
    const shown = parts.slice(0, 4);
    const more = parts.length - shown.length;
    const label = shown.join(', ');
    return more > 0 ? `${label} +${more}` : label;
};

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
}

export interface ChatWorkTimelineProps {
    entry: ChatWorkView;
}

const ChatWorkTimeline: React.FC<ChatWorkTimelineProps> = ({ entry }) => {
    const reasoning = entry.reasoning ?? '';
    const running = !!entry.streaming && !entry.text;
    const hasWork = reasoning.trim().length > 0 || entry.tools.length > 0;
    const hasActions = !!(entry.actions && entry.actions.length > 0);
    if (!hasWork && !hasActions) {
        // Nothing yet: the waiting tip covers
        // the silent first moments of a turn.
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
    const flush = (key: string): void => {
        if (buf.length > 0) {
            nodes.push(<ToolActivityRow key={key} lines={buf} running={running} />);
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
    return (
        <div className="border-l border-white/[0.08] pl-3 ml-1 my-1.5 space-y-1.5">
            {hasWork && (
                <AnalyzedRow
                    running={running}
                    toolsCount={entry.tools.length}
                    persistedMs={entry.workedMs}
                    title={workSummaryLabel(entry.tools, reasoning.trim().length > 0) ?? undefined}
                >
                    {nodes}
                </AnalyzedRow>
            )}
            {hasActions && <ToolActionsRow actions={entry.actions!} />}
        </div>
    );
};

export default ChatWorkTimeline;

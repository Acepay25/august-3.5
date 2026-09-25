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
import { Lightbulb } from 'lucide-react';
import type { ToolAction } from '../../../types/message';
import { tipForSeed } from '../../../utils/tradingTips';
import { splitReasoningAroundTools } from '../../../utils/traceText';
import AnalyzedRow from '../../shared/AnalyzedRow';
import ReasoningRow from '../../shared/ReasoningRow';
import ToolActivityRow from '../../shared/ToolActivityRow';
import ToolActionsRow from '../../chat/ToolActionsRow';

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
        // Nothing yet: the MiniMax waiting tip covers
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
            {hasWork && <AnalyzedRow running={running} toolsCount={entry.tools.length}>{nodes}</AnalyzedRow>}
            {hasActions && <ToolActionsRow actions={entry.actions!} />}
        </div>
    );
};

export default ChatWorkTimeline;

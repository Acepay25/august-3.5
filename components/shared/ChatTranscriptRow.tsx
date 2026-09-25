/**
 * One transcript row, shared by the Chart AI dock and the Chat surface.
 *
 * The dock already had this furniture — markdown body, Thought rows, desk-tool
 * activity, side-effect status rows, copy, key levels, the verdict — and the
 * Chat surface was still a bare `{m.text}` div. Rather than write it twice,
 * both now render this over their own row model (see `ChatRowView`).
 *
 * Two things are honestly approximate and say so at the call site rather than
 * faking:
 *
 *  - **Tool and reasoning are separate blocks here.** The dock interleaves
 *    tool calls INTO the reasoning stream via a `[Desk tools]` marker the
 *    provider emits mid-answer. A settled pipeline `Message` has no single
 *    ordered stream — `reasoningProcesses` and `toolActions` are independent
 *    collections — so they render as their own rows.
 *  - **`toolLines` is live-only.** `Message.liveToolEvents` is nulled when the
 *    turn settles (`verdictFinalizer.ts`), so the call→result pairs only exist
 *    while the answer streams. `toolActions` is the persistent trail.
 */
import React from 'react';
import ChatWorkTimeline, { type ChatWorkView } from '../trade/panels/ChatWorkTimeline';
import { CopyChip, FadingText, PinChip, RetryChip } from './chatChips';
import KeyLevelsCard from '../trade/KeyLevelsCard';
import { parseKeyLevels, type ModelKeyLevel } from '../../services/trade/keyLevels';
import type { TradeAnalysis } from '../../types';
import type { ToolAction } from '../../types/message';

export type ChatRowRole = 'user' | 'ai';

export interface ChatRowView {
    id: string;
    role: ChatRowRole;
    text: string;
    /** Who said it — bot name, seat name, or 'desk'. */
    speaker?: string;
    /** Pre-formatted relative time. */
    timeLabel?: string;
    /** True while this turn is still producing. */
    streaming?: boolean;
    images?: string[];
    /** Merged reasoning trace (per-seat maps are joined by the caller). */
    reasoning?: string;
    /** Live desk-tool call/result lines. */
    toolLines?: string[];
    /** Persistent side-effect status rows. */
    actions?: ToolAction[];
    analysis?: TradeAnalysis;
}

export interface ChatTranscriptRowProps {
    row: ChatRowView;
    /** Omit on surfaces with no canvas — the card then renders as a plain
     *  table, without the live-distance column or the "draw on chart" action,
     *  because both are meaningless away from a chart. */
    symbol?: string;
    getMark?: () => number | null;
    onChatLevels?: (payload: never, ownerId?: string) => void;
    onRetry?: () => void;
    pinned?: boolean;
    onTogglePin?: () => void;
    onLogTrade?: (analysis: TradeAnalysis) => void;
    canLogTrade?: boolean;
    /** Extra chrome the caller renders under the bubble (the verdict card). */
    children?: React.ReactNode;
}

const ChatTranscriptRow: React.FC<ChatTranscriptRowProps> = ({
    row, symbol, getMark, onChatLevels, onRetry, pinned, onTogglePin, onLogTrade, canLogTrade, children,
}) => {
    const isUser = row.role === 'user';
    // Only a CLOSED key-levels fence yields levels; an open one is stripped
    // from `clean` so the protocol never flashes mid-stream.
    const levels: ModelKeyLevel[] | null =
        !isUser && row.text ? parseKeyLevels(row.text).levels : null;
    const body = levels && levels.length > 0 ? parseKeyLevels(row.text).clean : row.text;

    const work: ChatWorkView = {
        id: row.id,
        reasoning: row.reasoning,
        tools: row.toolLines ?? [],
        streaming: row.streaming,
        text: row.text,
        actions: row.actions,
    };

    return (
        <div
            data-message-id={row.id}
            data-role={row.role}
            data-testid={isUser ? 'agent-message' : 'agent-message'}
            className={`group/msg flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
        >
            <span className="mb-0.5 font-mono text-ui-2xs uppercase tracking-wider text-zinc-600">
                {row.speaker ?? (isUser ? 'you' : 'desk')}
                {row.timeLabel ? <> {' · '}{row.timeLabel}</> : null}
            </span>

            {isUser && row.images && row.images.length > 0 && (
                <div className="mb-1 flex flex-wrap justify-end gap-1">
                    {row.images.map((src, i) => (
                        <img key={i} src={src} alt=""
                            className="max-h-40 rounded-control border border-zinc-800" />
                    ))}
                </div>
            )}

            <div className={`max-w-[85%] rounded-bubble px-3 py-2 text-ui-caption leading-5 ${
                isUser
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'border border-zinc-800/80 bg-zinc-900 text-zinc-200'
            }`}>
                {!isUser && <ChatWorkTimeline entry={work} />}
                {body.trim()
                    ? <FadingText text={body} streaming={!!row.streaming} />
                    : <span className="text-zinc-500">{row.analysis ? 'Analysis' : '…'}</span>}
                {children}
            </div>

            {!isUser && levels && levels.length > 0 && symbol && (
                <div className="mt-1 max-w-[85%] w-full">
                    <KeyLevelsCard
                        levels={levels}
                        symbol={symbol}
                        messageId={row.id}
                        getMark={getMark}
                        onChatLevels={onChatLevels as never}
                    />
                </div>
            )}

            <div className="mt-0.5 flex items-center gap-1">
                {isUser && onRetry && <RetryChip onRetry={onRetry} />}
                <CopyChip text={row.text} />
                {!isUser && onTogglePin && (
                    <PinChip pinned={!!pinned} onToggle={onTogglePin} />
                )}
                {!isUser && canLogTrade && onLogTrade && row.analysis && (
                    <button type="button" onClick={() => onLogTrade(row.analysis!)}
                        className="rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100">
                        Log this trade
                    </button>
                )}
            </div>
        </div>
    );
};

export default React.memo(ChatTranscriptRow);

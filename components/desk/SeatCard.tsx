/**
 * SeatCard — one thin row in the desk overlay. A seat is a single debate
 * actor (one of the three lens seats, or the moderator). The card shows the
 * role glyph, the actor name, a one-line speech excerpt, and the live
 * thinking/streaming state. Pure presentational — receives the same
 * `DebateStageActor` shape `DebateStage` already passes, so the desk view is
 * a *projection* of the same DebateState, never a separate state.
 *
 * Phase 2 deliverable. No business logic, no storage, no LLM calls.
 */

import React from 'react';
import { Mic, MicOff, Loader2, MessageSquare } from 'lucide-react';
import type { DebateStageActor } from '../analysis/DebateStage';

export interface SeatCardProps {
    actor: DebateStageActor;
    onOpen?: (id: string) => void;
}

const truncate = (s: string | undefined, n: number): string => {
    if (!s) return '';
    const cleaned = s.replace(/\s+/g, ' ').trim();
    return cleaned.length <= n ? cleaned : `${cleaned.slice(0, n - 1).trimEnd()}…`;
};

export const SeatCard: React.FC<SeatCardProps> = ({ actor, onOpen }) => {
    const isLive = !!actor.live;
    const isThinking = !!actor.thinking;
    const isSpeaking = !!actor.speaking;
    const hasSpeech = !!actor.speech && actor.speech.trim().length > 0;
    const hasThought = !!actor.thought && actor.thought.trim().length > 0;

    const handleOpen = (): void => {
        onOpen?.(actor.id);
    };

    return (
        <button
            type="button"
            onClick={handleOpen}
            aria-label={`Open ${actor.name} transcript`}
            className={`flex w-full items-start gap-2 rounded-lg border border-white/10 bg-zinc-900/70 p-2 text-left transition-colors hover:border-white/20 hover:bg-zinc-800/70 ${isLive ? 'ring-1 ring-amber-500/40' : ''}`}
        >
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-800 text-zinc-300">
                {isSpeaking ? (
                    <Mic className="h-3.5 w-3.5" />
                ) : isThinking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                ) : hasSpeech || hasThought ? (
                    <MessageSquare className="h-3.5 w-3.5" />
                ) : (
                    <MicOff className="h-3.5 w-3.5 text-zinc-500" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate text-xs font-semibold text-zinc-200">{actor.name}</div>
                    {actor.meta ? (
                        <div className="truncate text-[10px] text-zinc-500" title={actor.meta}>{actor.meta}</div>
                    ) : null}
                </div>
                {hasSpeech ? (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-300">
                        {truncate(actor.speech, 220)}
                    </div>
                ) : hasThought ? (
                    <div className="mt-0.5 line-clamp-1 text-[11px] leading-snug italic text-zinc-500">
                        {truncate(actor.thought, 160)}
                    </div>
                ) : (
                    <div className="mt-0.5 text-[11px] text-zinc-600">—</div>
                )}
                {actor.toolChip ? (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-white/10 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {actor.toolChip}
                    </div>
                ) : null}
            </div>
        </button>
    );
};

export default SeatCard;

import React, { useEffect, useRef } from 'react';
import { DebateTurn } from '../../types/message';
import MarkdownContent from '../shared/MarkdownContent';
import { X as CloseIcon, Wrench } from 'lucide-react';
import { DebateBotAvatar } from './DebateBotAvatar';

interface DebateSidePanelProps {
    open: boolean;
    onClose: () => void;
    turns: DebateTurn[];
    actorIds: string[];
    activeActor: string | null;
    onSelectActor: (id: string) => void;
    isLive?: boolean;
    /** Live desk-tool / routing chips per speaker (shown while debating). */
    liveToolEvents?: Record<string, string>;
    /** Full per-seat thinking traces — rendered in the panel, not the chat. */
    reasoningProcesses?: Record<string, string>;
}

/**
 * Right-hand transcript drawer (ROUND-34): one tab per debater (analysts and
 * moderator). The main chat only shows thinking bubbles; each debater's full
 * thinking and output streams here, like the reference's side tabs.
 */
export const DebateSidePanel: React.FC<DebateSidePanelProps> = ({
    open,
    onClose,
    turns,
    actorIds,
    activeActor,
    onSelectActor,
    isLive = false,
    liveToolEvents,
    reasoningProcesses,
}) => {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const actorTurns = turns.filter(t => t.speaker === activeActor);
    const turnCount = actorTurns.length;
    const lastTextLen = actorTurns.length > 0 ? (actorTurns[actorTurns.length - 1].text || '').length : 0;

    // The seat's full chain-of-thought trace (keys are thoughtsKey / name).
    const actorThinking = (() => {
        if (!activeActor || !reasoningProcesses) return '';
        const needle = activeActor.trim().toLowerCase();
        for (const [key, content] of Object.entries(reasoningProcesses)) {
            const k = key.toLowerCase();
            if (needle === 'moderator' ? k.includes('moderator') : k.includes(needle)) {
                return content || '';
            }
        }
        return '';
    })();

    // Follow the stream while live.
    useEffect(() => {
        if (!isLive || !bodyRef.current) return;
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [turnCount, lastTextLen, isLive, activeActor]);

    if (!open || !activeActor) return null;

    return (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[min(480px,94vw)] flex-col border-l border-white/10 bg-zinc-950 shadow-2xl animate-fade-in">
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 custom-scrollbar">
                {actorIds.map(id => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onSelectActor(id)}
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            id === activeActor ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                    >
                        <DebateBotAvatar name={id} toneKey={id} size={18} />
                        <span className="max-w-[110px] truncate">{id}</span>
                    </button>
                ))}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close debate panel"
                    className="ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>
            <div ref={bodyRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                {isLive && activeActor && liveToolEvents?.[activeActor] && (
                    <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900/60 px-2.5 py-1.5 text-[10px] text-zinc-500">
                        <Wrench className="h-3 w-3 shrink-0" />
                        <span className="truncate">{liveToolEvents[activeActor]}</span>
                    </div>
                )}
                {actorThinking && (
                    <details className="mb-4 rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-2" open={isLive}>
                        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                            Thinking
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-zinc-500">{actorThinking}</p>
                    </details>
                )}
                {turnCount === 0 ? (
                    <p className="py-10 text-center text-xs text-zinc-600">
                        {isLive ? 'Waiting for this debater to speak…' : 'No transcript for this debater.'}
                    </p>
                ) : (
                    actorTurns.map((turn, i) => (
                        <div key={`${turn.createdAt ?? 'turn'}-${i}`} className="mb-5">
                            {turn.round ? (
                                <p className="pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                    Round {turn.round}
                                </p>
                            ) : null}
                            {turn.reasoning && (
                                <div className="mb-2 rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-2">
                                    <p className="pb-1 text-[10px] uppercase tracking-widest text-zinc-600">Thought</p>
                                    <p className="text-[11px] leading-5 text-zinc-500">{turn.reasoning}</p>
                                </div>
                            )}
                            <MarkdownContent content={turn.text || '…'} className="text-[13px] leading-6" />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default DebateSidePanel;

/**
 * DeskScene — opt-in overlay that renders the current debate as a "room of
 * seat cards" per the reference images. Hidden by default. The toggle lives
 * in the header `⋯` menu (SettingsMenu). This scene is a *projection* of the
 * same DebateState that drives the transcript — no separate state.
 *
 * Layout: three lens seats on the left/top, moderator in the center, verdict
 * line at the bottom. Each seat is a thin `SeatCard` row (text + Lucide
 * icons; rich character art is a polish phase).
 *
 * Phase 2 deliverable. No business logic, no storage, no LLM calls.
 */

import React from 'react';
import { X } from 'lucide-react';
import type { DebateStageActor } from '../analysis/DebateStage';
import { SeatCard } from './SeatCard';

export interface DeskSceneProps {
    actors: DebateStageActor[];
    caption?: string;
    phase?: string;
    verdict?: string;
    onOpenActor?: (id: string) => void;
    onClose: () => void;
}

const splitSeats = (actors: DebateStageActor[]): { seats: DebateStageActor[]; moderator: DebateStageActor | null } => {
    // Heuristic: the moderator is the only seat whose name contains
    // "Moderator" (case-insensitive) or whose id starts with "moderator".
    // If no moderator actor is present, we still render the seats; the
    // moderator slot stays empty rather than guessing.
    let moderator: DebateStageActor | null = null;
    const seats: DebateStageActor[] = [];
    for (const a of actors) {
        if (!moderator && (a.id.toLowerCase().startsWith('moderator') || a.name.toLowerCase().includes('moderator'))) {
            moderator = a;
        } else {
            seats.push(a);
        }
    }
    return { seats, moderator };
};

export const DeskScene: React.FC<DeskSceneProps> = ({ actors, caption, phase, verdict, onOpenActor, onClose }) => {
    const { seats, moderator } = splitSeats(actors);
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div
            role="dialog"
            aria-label="Desk view of the current debate"
            className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative flex h-[min(720px,90vh)] w-[min(960px,95vw)] flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-200">Desk view</div>
                        {caption || phase ? (
                            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                                {caption ?? ''}{caption && phase ? ' · ' : ''}{phase ?? ''}
                            </div>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close desk view"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Seats</div>
                        {seats.length === 0 ? (
                            <div className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-zinc-500">
                                No analyst seats yet.
                            </div>
                        ) : (
                            seats.map((a) => <SeatCard key={a.id} actor={a} onOpen={onOpenActor} />)
                        )}
                    </div>
                    <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Moderator</div>
                        {moderator ? (
                            <SeatCard actor={moderator} onOpen={onOpenActor} />
                        ) : (
                            <div className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-zinc-500">
                                Moderator seat is empty.
                            </div>
                        )}
                        {verdict ? (
                            <div className="mt-2 rounded-lg border border-white/10 bg-zinc-900/80 p-3">
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Verdict</div>
                                <div className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-zinc-200">
                                    {verdict}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="text-[10px] text-zinc-500">
                    Click a seat to open its full transcript. Esc closes.
                </div>
            </div>
        </div>
    );
};

export default DeskScene;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn } from '../../types';
import ReasoningRow from '../shared/ReasoningRow';

interface DebateReplayProps {
    turns: DebateTurn[];
    onClose: () => void;
}

const SPEEDS = [2, 4, 8] as const;

/** Characters revealed per tick at 1× — scaled by the speed multiplier. */
const CHARS_PER_TICK = 14;
const TICK_MS = 30;
/** Pause between turns at 1× (scaled down by speed). */
const TURN_GAP_MS = 420;

const roundName = (round?: number): string => {
    if (!round || round <= 1) return 'Opening';
    if (round <= 3) return `Rebuttal R${round}`;
    return `Round ${round}`;
};

/**
 * Verdict replay — re-animates a settled debate's stored transcript at
 * 2/4/8× speed. Pure playback of persisted data (no provider calls), so a
 * losing trade's reasoning can be reviewed turn by turn.
 */
const DebateReplay: React.FC<DebateReplayProps> = ({ turns, onClose }) => {
    const playable = useMemo(
        () => turns.filter(t => t.speaker !== 'System' && (t.text.trim() || (t.reasoning ?? '').trim())),
        [turns],
    );
    const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
    const [cursor, setCursor] = useState(0); // index of the turn being typed
    const [shown, setShown] = useState(0);   // chars revealed in the current turn
    const [done, setDone] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (done) return undefined;
        const turn = playable[cursor];
        if (!turn) {
            setDone(true);
            return undefined;
        }
        const target = turn.text.length;
        if (shown >= target) {
            const timer = window.setTimeout(() => {
                setCursor(c => c + 1);
                setShown(0);
            }, TURN_GAP_MS / speed);
            return () => window.clearTimeout(timer);
        }
        const timer = window.setInterval(() => {
            setShown(s => Math.min(target, s + CHARS_PER_TICK * speed));
        }, TICK_MS);
        return () => window.clearInterval(timer);
    }, [cursor, shown, speed, playable, done]);

    useEffect(() => {
        if (cursor >= playable.length && !done) setDone(true);
    }, [cursor, playable.length, done]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [cursor, shown]);

    const restart = (): void => {
        setCursor(0);
        setShown(0);
        setDone(false);
    };

    return (
        <div className="rounded-xl border border-white/10 bg-zinc-950/70">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Replay</span>
                <span className="text-[10px] tabular-nums text-zinc-600">
                    {Math.min(cursor + 1, playable.length)}/{playable.length}
                </span>
                <div className="ml-auto flex items-center gap-1">
                    {SPEEDS.map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSpeed(s)}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
                                speed === s
                                    ? 'bg-zinc-200 text-zinc-950'
                                    : 'border border-white/10 text-zinc-500 hover:text-zinc-200'
                            }`}
                        >
                            {s}×
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={restart}
                        className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 hover:text-zinc-200"
                    >
                        Restart
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close replay"
                        className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 hover:text-zinc-200"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className="custom-scrollbar max-h-80 space-y-2 overflow-y-auto px-3 py-2">
                {playable.slice(0, cursor + 1).map((turn, index) => {
                    const isCurrent = index === cursor && !done;
                    const text = isCurrent ? turn.text.slice(0, shown) : turn.text;
                    return (
                        <div key={`${turn.round ?? 0}-${turn.speaker}-${index}`} className="debate-speech rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2">
                            <p className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                                <span className={turn.speaker === 'Moderator' ? 'text-zinc-200' : ''}>{turn.speaker}</span>
                                <span className="text-zinc-700">{roundName(turn.round)}</span>
                            </p>
                            {(turn.reasoning ?? '').trim() && (
                                <ReasoningRow thinking={turn.reasoning ?? ''} label="Thinking" defaultOpen={false} />
                            )}
                            {text.trim() && (
                                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                                    {text}
                                    {isCurrent && <span className="streaming-caret" aria-hidden="true" />}
                                </p>
                            )}
                        </div>
                    );
                })}
                {done && (
                    <p className="py-1 text-center text-[10px] uppercase tracking-widest text-zinc-600">
                        End of debate
                    </p>
                )}
            </div>
        </div>
    );
};

export default DebateReplay;

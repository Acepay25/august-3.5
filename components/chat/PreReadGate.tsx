
import React, { useState } from 'react';
import { UserPriorCall } from '../../types';

/**
 * Pre-read gate (Batch 5, plan §5a) — opt-in training mode. When enabled
 * (Settings → Harness), the settled verdict card stays hidden behind this
 * panel: the user commits their OWN direction + confidence first (cognitive
 * forcing), then reveals. The commit rides the message (`userPriorCall`),
 * is copied onto the trade at log time, and the journal shows user-prior vs
 * verdict vs outcome. "Skip" reveals without committing — never a wall.
 */
interface PreReadGateProps {
    onCommit: (prior: Omit<UserPriorCall, 'createdAt'>) => void;
    onSkip: () => void;
}

const CONFIDENCE_STEPS = [25, 50, 75, 95];

export const PreReadGate: React.FC<PreReadGateProps> = ({ onCommit, onSkip }) => {
    const [direction, setDirection] = useState<UserPriorCall['direction'] | null>(null);
    const [confidence, setConfidence] = useState<number | null>(null);
    const ready = direction !== null && confidence !== null;
    return (
        <div className="ui-panel p-4 sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Pre-read · commit before the reveal
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Training mode (plan §5a): call the setup yourself before reading the floor&apos;s verdict.
                Your prior is scored against the outcome next to the verdict&apos;s — this measures
                <span className="text-zinc-400"> your</span> calibration, not just the panel&apos;s.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
                {(['Long', 'Short', 'Flat'] as const).map(d => (
                    <button
                        key={d}
                        type="button"
                        onClick={() => setDirection(d)}
                        aria-pressed={direction === d}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                            direction === d
                                ? 'bg-zinc-200 text-zinc-900'
                                : 'border border-zinc-700 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                        }`}
                    >
                        {d}
                    </button>
                ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">confidence</span>
                {CONFIDENCE_STEPS.map(c => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => setConfidence(c)}
                        aria-pressed={confidence === c}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] tabular-nums transition-colors ${
                            confidence === c
                                ? 'bg-zinc-200 text-zinc-900'
                                : 'border border-zinc-700 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                        }`}
                    >
                        {c}%
                    </button>
                ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    disabled={!ready}
                    onClick={() => ready && direction && confidence && onCommit({ direction, confidencePct: confidence })}
                    className="rounded-md bg-zinc-200 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                >
                    Commit &amp; reveal
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    className="rounded-md px-3 py-1.5 text-[11px] uppercase tracking-widest text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                >
                    Skip this one
                </button>
            </div>
        </div>
    );
};

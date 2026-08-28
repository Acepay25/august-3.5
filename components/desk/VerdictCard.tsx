/**
 * VerdictCard — pinned under the moderator anchor when the debate settles.
 * Shows direction, confidence, grade, and the sealed conviction auction
 * (each seat's private 0-100 stake, made visible after the verdict).
 *
 * Renders nothing when the analysis is missing or `direction` is neutral.
 */

import React from 'react';

export interface VerdictSeat {
    name: string;
    /** 0..100, or null if the seat did not seal a conviction. */
    value: number | null;
}

export interface VerdictCardProps {
    direction: 'Long' | 'Short' | 'Neutral' | string;
    confidence: string;
    grade?: string | null;
    seats: VerdictSeat[];
    'data-testid'?: string;
}

const directionClass = (d: string): string => {
    if (d === 'Long') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    if (d === 'Short') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
};

const CONVICTION_RE = /^\s*CONVICTION:\s*(\d{1,3})\b/im;

export const extractConvictions = (turns: Array<{ speaker: string; text: string }>): VerdictSeat[] => {
    const bySeat = new Map<string, number>();
    for (const t of turns) {
        if (!t.speaker || t.speaker === 'Moderator' || t.speaker === 'System') continue;
        const m = (t.text || '').match(CONVICTION_RE);
        if (!m) continue;
        bySeat.set(t.speaker, Math.min(100, Math.max(0, parseInt(m[1], 10))));
    }
    return [...bySeat.entries()].map(([name, value]) => ({ name, value }));
};

export const VerdictCard: React.FC<VerdictCardProps> = ({ direction, confidence, grade, seats, 'data-testid': testId }) => {
    if (!direction) return null;
    const values = seats.map(s => s.value).filter((v): v is number => v !== null);
    const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    return (
        <div
            data-testid={testId}
            className="status-surface w-72 rounded-md border border-white/15 bg-zinc-950/95 px-3 py-2.5 text-left shadow-2xl"
        >
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Verdict</span>
                <span
                    className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${directionClass(direction)}`}
                >
                    {direction}
                </span>
                <span className="text-[10px] font-semibold text-zinc-300">{confidence}</span>
                {grade && (
                    <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {grade}
                    </span>
                )}
            </div>
            {values.length > 0 && (
                <div className="mt-1">
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                        Conviction auction
                        <span className="ml-1 font-medium normal-case tracking-normal text-zinc-500">
                            {spread <= 10
                                ? `tight (${spread}) — the floor agreed`
                                : `wide (${spread}) — minority verdict`}
                        </span>
                    </p>
                    <div className="space-y-0.5">
                        {seats.filter(s => s.value !== null).map(s => (
                            <div key={s.name} className="flex items-center gap-1.5">
                                <span className="w-16 shrink-0 truncate text-[9px] text-zinc-400" title={s.name}>
                                    {s.name}
                                </span>
                                <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                    <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${s.value}%` }} />
                                </span>
                                <span className="w-6 shrink-0 text-right text-[9px] font-semibold tabular-nums text-zinc-300">
                                    {s.value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VerdictCard;

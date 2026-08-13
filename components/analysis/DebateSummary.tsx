import React, { useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
import { ChevronDownIcon, CheckIcon } from '../shared/Icons';
import { signalDirectionLabel } from '../../utils/analysisUtils';

interface DebateSummaryProps {
    debateTurns: DebateTurn[];
    analysis: TradeAnalysis | null;
}

/**
 * Compact debate header — direction/confidence chips plus round count.
 * Levels stay on the trading signal; the transcript below is the briefing.
 */
const DebateSummary: React.FC<DebateSummaryProps> = ({ debateTurns, analysis }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const summary = useMemo(() => {
        if (!analysis) return null;

        const analystTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && t.round === 1);
        const directions = analystTurns.map(t => {
            const upper = t.text.toUpperCase();
            if (/\b(?:LONG|BULLISH)\b/.test(upper)) return 'Long';
            if (/\b(?:SHORT|BEARISH)\b/.test(upper)) return 'Short';
            return 'Neutral';
        });
        const uniqueDirections = [...new Set(directions)];
        const rounds = [...new Set(debateTurns.map(t => t.round).filter(Boolean))];

        return {
            direction: analysis.direction,
            confidence: analysis.confidence,
            grade: analysis.grade,
            hadDisagreement: uniqueDirections.length > 1,
            totalRounds: rounds.length,
        };
    }, [analysis, debateTurns]);

    if (!summary) return null;

    const directionColor = summary.direction === 'Long'
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
        : summary.direction === 'Short'
            ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
            : 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';

    const confidenceColor = summary.confidence === 'High'
        ? 'text-emerald-400'
        : summary.confidence === 'Medium'
            ? 'text-amber-400'
            : 'text-rose-400';

    return (
        <div className="status-surface mb-3 overflow-hidden rounded-xl border border-white/5 bg-zinc-900/80">
            <button
                type="button"
                onClick={() => setIsExpanded(p => !p)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
                aria-expanded={isExpanded}
            >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">TL;DR</span>
                    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${directionColor}`}>
                        {signalDirectionLabel(summary.direction)}
                    </span>
                    {summary.grade && (
                        <span className="inline-flex items-center rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                            Grade {summary.grade}
                        </span>
                    )}
                    <span className={`text-[10px] font-semibold ${confidenceColor}`}>
                        {summary.confidence}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-zinc-600">
                    {summary.hadDisagreement && (
                        <span className="flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                            <CheckIcon className="h-2.5 w-2.5" /> Resolved
                        </span>
                    )}
                    <span>{summary.totalRounds} rounds</span>
                    <ChevronDownIcon className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {isExpanded && (
                <p className="border-t border-white/5 px-4 py-3 text-[12px] leading-relaxed text-zinc-500">
                    Openings, rebuttals, and the moderator verdict are in the briefing below. Trade levels are on the signal card.
                </p>
            )}
        </div>
    );
};

export default DebateSummary;

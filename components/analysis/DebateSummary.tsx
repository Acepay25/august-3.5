import React, { useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
import { ChevronDownIcon, CheckIcon } from '../shared/Icons';

interface DebateSummaryProps {
    debateTurns: DebateTurn[];
    analysis: TradeAnalysis | null;
}

/**
 * Collapsible TL;DR card shown at the top of completed debates.
 * Extracts the key consensus points (direction, entry, SL, TP, confidence)
 * and surfaces any notable disagreements that were resolved.
 */
const DebateSummary: React.FC<DebateSummaryProps> = ({ debateTurns, analysis }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const summary = useMemo(() => {
        if (!analysis) return null;

        const direction = analysis.direction;
        const confidence = analysis.confidence;
        const entry = analysis.entryPoints?.[0]?.price;
        const sl = analysis.stopLoss;
        const tps = analysis.takeProfit?.map(tp => tp.price).filter(Boolean);
        const strategy = analysis.strategy;
        const grade = analysis.grade;
        const rrRatio = analysis.rrRatio;

        // Count analyst positions from opening turns
        const analystTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && t.round === 1);
        const directions = analystTurns.map(t => {
            const upper = t.text.toUpperCase();
            // Word-boundary matching so "PROLONGED" isn't a LONG and
            // "SHORT-TERM" isn't a SHORT — only actual position words count.
            if (/\b(?:LONG|BULLISH)\b/.test(upper)) return 'Long';
            if (/\b(?:SHORT|BEARISH)\b/.test(upper)) return 'Short';
            return 'Neutral';
        });
        const uniqueDirections = [...new Set(directions)];
        const hadDisagreement = uniqueDirections.length > 1;

        // Count total rounds
        const rounds = [...new Set(debateTurns.map(t => t.round).filter(Boolean))];

        return {
            direction,
            confidence,
            entry,
            sl,
            tps,
            strategy,
            grade,
            rrRatio,
            hadDisagreement,
            analystCount: analystTurns.length,
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
        <div className="status-surface mb-3 rounded-xl border border-white/5 bg-zinc-900/80 overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded(p => !p)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">TL;DR</span>
                    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${directionColor}`}>
                        {summary.direction}
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
                <div className="border-t border-white/5 px-4 py-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {summary.entry && (
                            <div>
                                <span className="text-[9px] uppercase text-zinc-600">Entry</span>
                                <p className="text-zinc-200 font-medium">{summary.entry}</p>
                            </div>
                        )}
                        {summary.sl && (
                            <div>
                                <span className="text-[9px] uppercase text-zinc-600">Stop Loss</span>
                                <p className="text-rose-400 font-medium">{summary.sl}</p>
                            </div>
                        )}
                        {summary.tps && summary.tps.length > 0 && (
                            <div>
                                <span className="text-[9px] uppercase text-zinc-600">Take Profit{summary.tps.length > 1 ? 's' : ''}</span>
                                <p className="text-emerald-400 font-medium">{summary.tps.join(' / ')}</p>
                            </div>
                        )}
                        {summary.rrRatio && (
                            <div>
                                <span className="text-[9px] uppercase text-zinc-600">R:R</span>
                                <p className="text-cyan-400 font-medium">1:{summary.rrRatio.toFixed(1)}</p>
                            </div>
                        )}
                    </div>
                    {summary.strategy && (
                        <div>
                            <span className="text-[9px] uppercase text-zinc-600">Strategy</span>
                            <p className="text-xs text-zinc-400 mt-0.5">{summary.strategy}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(DebateSummary);

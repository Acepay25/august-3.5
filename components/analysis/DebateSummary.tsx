import React, { useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
import { ChevronDownIcon, CheckIcon } from '../shared/Icons';
import { resolveLevelHitOdds } from '../../utils/analysisUtils';

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
        const grade = analysis.grade;
        const rrRatio = analysis.rrRatio;
        const odds = resolveLevelHitOdds(analysis, debateTurns);

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
            grade,
            rrRatio,
            odds,
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
                        {summary.direction === 'Long' ? 'Buy' : summary.direction === 'Short' ? 'Sell' : summary.direction}
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
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        {summary.entry && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Entry</div>
                                <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{summary.entry}</p>
                            </div>
                        )}
                        {summary.sl && (
                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Stop Loss</div>
                                    {summary.odds.sl !== undefined && (
                                        <div className="text-[11px] font-bold tabular-nums text-rose-400">{summary.odds.sl}% hit</div>
                                    )}
                                </div>
                                <p className="mt-1 text-lg font-semibold tabular-nums text-rose-400">{summary.sl}</p>
                            </div>
                        )}
                        {summary.tps && summary.tps.length > 0 && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Take Profit{summary.tps.length > 1 ? 's' : ''}</div>
                                <div className="mt-1 space-y-1">
                                    {summary.tps.slice(0, 3).map((tp, i) => (
                                        <div key={`tp-${i}`} className="flex items-baseline justify-between gap-2">
                                            <p className="text-lg font-semibold tabular-nums leading-tight text-emerald-400">
                                                <span className="mr-1.5 text-[10px] font-semibold text-emerald-400/70">TP{i + 1}</span>
                                                {tp}
                                            </p>
                                            {summary.odds.tp[i] !== undefined && (
                                                <span className="text-[11px] font-bold tabular-nums text-emerald-400">{summary.odds.tp[i]}% hit</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {summary.rrRatio && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">R:R</div>
                                <p className="mt-1 text-lg font-semibold tabular-nums text-cyan-400">1:{summary.rrRatio.toFixed(1)}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(DebateSummary);

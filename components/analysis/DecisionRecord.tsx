import React, { useMemo, useState } from 'react';
import { TradeAnalysis } from '../../types/analysis';
import { TradeOutcome } from '../../types/enums';
import SetupLifecycleCard from './SetupLifecycleCard';

interface DecisionRecordProps {
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
}

const confidenceValue: Record<TradeAnalysis['confidence'], number> = { High: 80, Medium: 60, Low: 35, Avoid: 15 };

export const DecisionRecord: React.FC<DecisionRecordProps> = ({ analysis, outcome }) => {
    const [isOpen, setIsOpen] = useState(true);
    const rawConfidence = analysis.originalConfidence ?? analysis.confidence;
    const evidenceCounts = useMemo(() => {
        const claims = analysis.evidence ?? [];
        return {
            observed: claims.filter(item => item.state === 'observed').length,
            partial: claims.filter(item => item.state === 'partial').length,
            unobserved: claims.filter(item => item.state === 'unobserved').length,
        };
    }, [analysis.evidence]);
    const snapshot = analysis.marketSnapshot as { dataQuality?: { status?: string; unavailableSources?: string[] } } | undefined;
    const unavailableSources = snapshot?.dataQuality?.unavailableSources ?? [];
    const verdict = analysis.direction === 'Neutral' || analysis.confidence === 'Avoid' ? 'WAIT / AVOID' : analysis.direction.toUpperCase();
    const adjustmentCount = (analysis.validationWarnings?.length ?? 0) + (analysis.originalConfidence && analysis.originalConfidence !== analysis.confidence ? 1 : 0);

    return (
        <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/80 p-3 sm:p-4" aria-label="Decision record">
            <button type="button" onClick={() => setIsOpen(value => !value)} className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-lg">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Decision record</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{verdict}</span>
                        <span className="text-xs text-zinc-500">{analysis.coinName ?? 'Unknown asset'} · {analysis.strategy || 'No strategy recorded'}</span>
                    </div>
                </div>
                <span className="text-xs text-zinc-500" aria-hidden="true">{isOpen ? 'Collapse' : 'Expand'}</span>
            </button>

            {isOpen && (
                <div className="mt-4 space-y-3">
                    <SetupLifecycleCard analysis={analysis} outcome={outcome} compact />

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-zinc-500">Entry</div><div className="mt-1 truncate text-xs font-mono text-zinc-200">{analysis.entryPoints?.map(item => item.price).join(' / ') || 'Not set'}</div></div>
                        <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-rose-400">Stop</div><div className="mt-1 truncate text-xs font-mono text-rose-100">{analysis.stopLoss || 'Not set'}</div></div>
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-emerald-400">Targets</div><div className="mt-1 truncate text-xs font-mono text-emerald-100">{analysis.takeProfit?.map(item => item.price).join(' / ') || 'Not set'}</div></div>
                        <div className="rounded-xl border border-white/10 bg-zinc-900 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-zinc-500">Confidence</div><div className="mt-1 text-xs font-semibold text-zinc-200">{rawConfidence} → {analysis.confidence} <span className="font-mono text-zinc-500">({confidenceValue[analysis.confidence]}%)</span></div></div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                        <span>Evidence: <strong className="text-emerald-400">{evidenceCounts.observed} observed</strong>, {evidenceCounts.partial} partial, {evidenceCounts.unobserved} unobserved</span>
                        <span>Adjustments: <strong className="text-zinc-300">{adjustmentCount}</strong></span>
                        {analysis.rrRatio && <span>R:R <strong className="text-zinc-300">{analysis.rrRatio.toFixed(2)}</strong></span>}
                    </div>

                    {unavailableSources.length > 0 && <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-[10px] text-amber-200">Data gap: {unavailableSources.join(', ')} unavailable. Confidence should be treated as provisional.</div>}
                    {analysis.invalidationCriteria && analysis.invalidationCriteria.length > 0 && <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-3 py-2 text-[10px] text-rose-200"><strong className="text-rose-300">Invalidation:</strong> {analysis.invalidationCriteria[0].condition} ({analysis.invalidationCriteria[0].level}){analysis.invalidationCriteria.length > 1 ? ` +${analysis.invalidationCriteria.length - 1} more` : ''}</div>}
                </div>
            )}
        </section>
    );
};

export default DecisionRecord;

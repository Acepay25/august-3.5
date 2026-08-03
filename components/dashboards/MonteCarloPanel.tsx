/**
 * MonteCarloPanel - Monte Carlo simulation results display.
 *
 * Renders either per-AI labeled predictions (when available) or the single
 * aggregated Monte Carlo result, plus a placeholder when no data exists.
 *
 * Extracted from AdvancedAnalyticsSidePanel.tsx.
 */

import React from 'react';
import { SectionCard, StatPill, MonteCarloResult, LabeledMonteCarloResult } from './analyticsShared';
import { computeKellyFraction } from '../../services/analysis/MonteCarloService';

interface MonteCarloPanelProps {
    monteCarloResult?: MonteCarloResult | null;
    perAIMonteCarloResults?: LabeledMonteCarloResult[];
    isCalculating?: boolean;
}

const MonteCarloPanel: React.FC<MonteCarloPanelProps> = ({
    monteCarloResult,
    perAIMonteCarloResults = [],
    isCalculating = false,
}) => {
    const hasMonteCarloResults = monteCarloResult && monteCarloResult.simulations > 0;
    const hasPerAIResults = perAIMonteCarloResults.length > 0;

    const status: 'calculating' | 'active' | 'waiting' =
        isCalculating && !hasPerAIResults
            ? 'calculating'
            : hasMonteCarloResults || hasPerAIResults
                ? 'active'
                : 'waiting';

    const statusLabel =
        isCalculating && !hasPerAIResults
            ? 'Calculating...'
            : hasMonteCarloResults || hasPerAIResults
                ? 'Live'
                : 'Waiting';

    const subtitle = hasPerAIResults
        ? `${perAIMonteCarloResults.length} AI predictions`
        : 'Probability simulation';

    return (
        <SectionCard
            title="Monte Carlo"
            subtitle={subtitle}
            icon=""
            accentColor="cyan"
            status={status}
            statusLabel={statusLabel}
        >
            {hasPerAIResults ? (
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {perAIMonteCarloResults.map((labeled, idx) => (
                        <div
                            key={idx}
                            className={`p-3 rounded-xl border transition-all duration-200 hover:scale-[1.01] ${labeled.isModeratorFinal
                                ? 'bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/30'
                                : 'bg-zinc-800 border-white/[0.06] hover:border-cyan-500/30'
                                }`}
                        >
                            {/* Provider Label */}
                            <div className="flex items-center justify-between mb-3">
                                <span className={`text-[11px] font-semibold ${labeled.isModeratorFinal ? 'text-amber-400' : 'text-zinc-300'}`}>
                                    {labeled.provider}
                                </span>
                                {labeled.isModeratorFinal && (
                                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">FINAL</span>
                                )}
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <div className="text-center p-2 rounded-lg bg-zinc-800">
                                    <span className="text-[9px] text-zinc-500 block mb-0.5">Win Rate</span>
                                    <span className={`text-lg font-bold ${labeled.result.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {labeled.result.winRate}%
                                    </span>
                                    <span className="text-[9px] text-zinc-600 block">
                                        {labeled.result.winCount}/{labeled.result.simulations}
                                    </span>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-zinc-800">
                                    <span className="text-[9px] text-zinc-500 block mb-0.5">Expected Value</span>
                                    <span className={`text-lg font-bold ${labeled.result.expectedValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {labeled.result.expectedValue >= 0 ? '+' : ''}{labeled.result.expectedValue}%
                                    </span>
                                </div>
                            </div>

                            {/* Probabilities */}
                            <div className="flex gap-1.5">
                                <span className="flex-1 text-center text-[9px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                                    TP1 {labeled.result.probabilities.tp1Hit}%
                                </span>
                                <span className="flex-1 text-center text-[9px] px-2 py-1 rounded-lg bg-emerald-500/5 text-emerald-300/80">
                                    TP2 {labeled.result.probabilities.tp2Hit}%
                                </span>
                                <span className="flex-1 text-center text-[9px] px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400">
                                    SL {labeled.result.probabilities.slHit}%
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : hasMonteCarloResults ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <StatPill
                            label="Win Rate"
                            value={`${monteCarloResult!.winRate}%`}
                            variant={monteCarloResult!.winRate >= 50 ? 'success' : 'danger'}
                        />
                        <StatPill
                            label="Expected Value"
                            value={`${monteCarloResult!.expectedValue >= 0 ? '+' : ''}${monteCarloResult!.expectedValue}%`}
                            variant={monteCarloResult!.expectedValue >= 0 ? 'success' : 'danger'}
                        />
                        <StatPill
                            label="Kelly (position)"
                            value={`${(computeKellyFraction(
                                monteCarloResult!.winRate,
                                monteCarloResult!.expectedValue,
                                monteCarloResult!.probabilities.slHit,
                                monteCarloResult!.confidenceInterval.lower
                            ) * 100).toFixed(0)}%`}
                            variant="neutral"
                        />
                    </div>

                    {/* Probabilities */}
                    <div className="p-3 rounded-xl bg-zinc-800 border border-white/[0.04]">
                        <span className="text-[10px] text-zinc-500 block mb-2">Target Probabilities</span>
                        <div className="flex gap-1.5">
                            <span className="flex-1 text-center text-[10px] px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 font-medium">
                                TP1: {monteCarloResult!.probabilities.tp1Hit}%
                            </span>
                            <span className="flex-1 text-center text-[10px] px-2 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300">
                                TP2: {monteCarloResult!.probabilities.tp2Hit}%
                            </span>
                            <span className="flex-1 text-center text-[10px] px-2 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 font-medium">
                                SL: {monteCarloResult!.probabilities.slHit}%
                            </span>
                        </div>
                    </div>

                    {/* Confidence Interval */}
                    <div className="text-[11px] text-zinc-500 text-center">
                        <span className="text-zinc-400">90% CI:</span> {monteCarloResult!.confidenceInterval.lower}% – {monteCarloResult!.confidenceInterval.upper}%
                    </div>
                </div>
            ) : (
                <div className="text-center py-4">
                    <div className="text-2xl mb-2 opacity-40"></div>
                    <div className="text-[11px] text-zinc-500">Run analysis with trade setup to see results</div>
                </div>
            )}
        </SectionCard>
    );
};

export default MonteCarloPanel;

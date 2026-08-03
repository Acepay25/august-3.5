/**
 * BacktestResults - Live backtest results display.
 *
 * Renders similar historical trade matches, win-rate visual, average
 * outcome / ratios, a verdict badge, and optional session performance
 * breakdown. Shows a placeholder when there is no backtest data.
 *
 * Extracted from AdvancedAnalyticsSidePanel.tsx.
 */

import React from 'react';
import { SectionCard, StatPill, ProgressBar, LiveBacktestResult } from './analyticsShared';

interface BacktestResultsProps {
    backtestResult?: LiveBacktestResult | null;
    isCalculating?: boolean;
}

const BacktestResults: React.FC<BacktestResultsProps> = ({
    backtestResult,
    isCalculating = false,
}) => {
    const hasBacktestResults = backtestResult && backtestResult.totalMatches > 0;

    const status: 'calculating' | 'active' | 'waiting' =
        isCalculating && !hasBacktestResults
            ? 'calculating'
            : hasBacktestResults
                ? 'active'
                : 'waiting';

    const statusLabel =
        isCalculating && !hasBacktestResults
            ? 'Searching...'
            : hasBacktestResults
                ? 'Live'
                : 'Need 3+ trades';

    return (
        <SectionCard
            title="Live Backtest"
            subtitle="Similar historical trades"
            icon=""
            accentColor="amber"
            status={status}
            statusLabel={statusLabel}
        >
            {hasBacktestResults ? (
                <div className="space-y-4">
                    {/* Primary Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        <StatPill label="Matches" value={backtestResult!.totalMatches} variant="neutral" />
                        <StatPill
                            label="Win Rate"
                            value={`${backtestResult!.winRate.toFixed(0)}%`}
                            variant={backtestResult!.winRate >= 60 ? 'success' : backtestResult!.winRate >= 50 ? 'warning' : 'danger'}
                        />
                        <StatPill
                            label="EV"
                            value={`${backtestResult!.expectedValue >= 0 ? '+' : ''}${backtestResult!.expectedValue.toFixed(1)}%`}
                            variant={backtestResult!.expectedValue >= 0 ? 'success' : 'danger'}
                        />
                    </div>

                    {/* Win Rate Visual */}
                    <div className="p-3 rounded-xl bg-zinc-800 border border-white/[0.04]">
                        <div className="flex justify-between text-[10px] mb-2">
                            <span className="text-emerald-400 font-medium">✓ Wins</span>
                            <span className="text-zinc-500">{backtestResult!.winRate.toFixed(0)}% / {(100 - backtestResult!.winRate).toFixed(0)}%</span>
                            <span className="text-rose-400 font-medium">✗ Losses</span>
                        </div>
                        <ProgressBar value={backtestResult!.winRate} />
                    </div>

                    {/* Secondary Stats */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 rounded-xl bg-zinc-800 border border-white/[0.04]">
                            <span className="text-[10px] text-zinc-500 block mb-2">Average Outcome</span>
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-emerald-400">Avg Win</span>
                                    <span className="text-emerald-400 font-semibold">+{backtestResult!.avgWinPercent.toFixed(1)}%</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-rose-400">Avg Loss</span>
                                    <span className="text-rose-400 font-semibold">-{backtestResult!.avgLossPercent.toFixed(1)}%</span>
                                </div>
                            </div>
                        </div>
                        <div className="p-3 rounded-xl bg-zinc-800 border border-white/[0.04]">
                            <span className="text-[10px] text-zinc-500 block mb-2">Ratios</span>
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-amber-300">Profit Factor</span>
                                    <span className={`font-semibold ${(backtestResult!.avgWinPercent / Math.max(backtestResult!.avgLossPercent, 0.1)) >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {(backtestResult!.avgWinPercent / Math.max(backtestResult!.avgLossPercent, 0.1)).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-amber-300">R:R</span>
                                    <span className="text-amber-400 font-semibold">
                                        1:{(backtestResult!.avgWinPercent / Math.max(backtestResult!.avgLossPercent, 0.1)).toFixed(1)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Verdict */}
                    <div className={`p-3 rounded-xl text-center text-[11px] font-medium ${backtestResult!.expectedValue >= 1.5
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : backtestResult!.expectedValue >= 0
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                        {backtestResult!.expectedValue >= 1.5
                            ? ' Strong Edge — High Probability Setup'
                            : backtestResult!.expectedValue >= 0
                                ? ' Marginal Edge — Proceed with Caution'
                                : ' Negative Edge — Consider Skipping'}
                    </div>

                    {/* Session Performance Breakdown */}
                    {backtestResult!.sessionBreakdown && backtestResult!.sessionBreakdown.length > 0 && (
                        <div className="p-3 rounded-xl bg-zinc-800 border border-white/[0.04]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium"> Session Performance</span>
                                {backtestResult!.bestSession && (
                                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                                        Best: {backtestResult!.bestSession}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {backtestResult!.sessionBreakdown.map((session, idx) => (
                                    <div
                                        key={idx}
                                        className={`text-center p-2 rounded-lg ${session.session === backtestResult!.bestSession
                                            ? 'bg-emerald-500/10 border border-emerald-500/20'
                                            : session.session === backtestResult!.worstSession
                                                ? 'bg-rose-500/10 border border-rose-500/20'
                                                : 'bg-zinc-800 border border-white/[0.04]'
                                            }`}
                                    >
                                        <div className="text-[9px] text-zinc-500 mb-0.5">{session.session}</div>
                                        <div className={`text-sm font-bold ${session.winRate >= 60 ? 'text-emerald-400'
                                            : session.winRate >= 50 ? 'text-amber-400'
                                                : 'text-rose-400'
                                            }`}>
                                            {session.winRate.toFixed(0)}%
                                        </div>
                                        <div className="text-[8px] text-zinc-600">{session.count} trades</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {backtestResult!.warning && (
                        <div className="text-[10px] text-amber-400/80 bg-amber-500/10 p-3 rounded-xl border border-amber-500/15">
                             {backtestResult!.warning}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-4">
                    <div className="text-2xl mb-2 opacity-40"></div>
                    <div className="text-[11px] text-zinc-500 mb-1">Requires 3+ logged trades with similar patterns</div>
                    <div className="text-[10px] text-zinc-600">Same coin, direction, and pattern family</div>
                </div>
            )}
        </SectionCard>
    );
};

export default BacktestResults;

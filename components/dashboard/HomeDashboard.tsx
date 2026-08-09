import React, { useMemo } from 'react';
import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../../types';
import { calculateOverallStats, calculateStreakData } from '../../utils/dashboardUtils';
import SetupLifecycleCard from '../analysis/SetupLifecycleCard';

export interface HomeDashboardProps {
    username: string | null;
    trades: LoggedTrade[];
    latestAnalysis?: TradeAnalysis;
    conversationCount: number;
    readyProviderCount: number;
    hasProviderConfig: boolean;
    onStartAnalysis: () => void;
    onOpenJournal: () => void;
    onOpenLiveMarket: () => void;
    onOpenSettings: () => void;
}

const HomeDashboard: React.FC<HomeDashboardProps> = ({
    username,
    trades,
    latestAnalysis,
    conversationCount,
    readyProviderCount,
    hasProviderConfig,
    onStartAnalysis,
    onOpenJournal,
    onOpenLiveMarket,
    onOpenSettings,
}) => {
    const stats = useMemo(() => calculateOverallStats(trades), [trades]);
    const streak = useMemo(() => calculateStreakData(trades), [trades]);
    const pendingTrades = useMemo(() => trades.filter(trade => trade.outcome === TradeOutcome.PENDING).slice(0, 3), [trades]);
    const lessons = useMemo(() => trades.filter(trade => Boolean(trade.postMortem)).length, [trades]);

    return (
        <section className="w-full rounded-3xl border border-white/10 bg-zinc-900/80 p-4 shadow-2xl sm:p-6" aria-label="Trading dashboard">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Trading workspace</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Welcome back{username ? `, ${username}` : ''}.</h1>
                    <p className="mt-1 text-sm text-zinc-400">Your decision history, active setups, and next best action in one place.</p>
                </div>
                <button type="button" onClick={onStartAnalysis} className="status-surface rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Analyze a chart</button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                    ['Win rate', `${stats.winRate}%`, `${stats.totalTrades} completed`],
                    ['P&L', `${stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(2)}`, 'recorded amount'],
                    ['Current streak', streak.currentStreak.count ? `${streak.currentStreak.count} ${streak.currentStreak.type}` : '—', 'latest results'],
                    ['Journal', `${trades.length}`, `${lessons} lessons captured`],
                ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-zinc-950/70 px-3 py-3">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
                        <div className="mt-1 text-lg font-bold text-zinc-100">{value}</div>
                        <div className="text-[10px] text-zinc-600">{detail}</div>
                    </div>
                ))}
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-bold text-white">Active setups</h2>
                            <p className="text-xs text-zinc-500">Monitor manually; this app does not execute trades.</p>
                        </div>
                        <button type="button" onClick={onOpenJournal} className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:text-white">Open journal</button>
                    </div>
                    {pendingTrades.length > 0 ? pendingTrades.map(trade => (
                        <div key={trade.id} className="mt-3 border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                                <span className="font-semibold text-zinc-200">{trade.analysis.coinName ?? 'Unknown asset'} · {trade.analysis.direction}</span>
                                <span className="text-[10px] text-zinc-500">{new Date(trade.timestamp).toLocaleDateString()}</span>
                            </div>
                            <SetupLifecycleCard analysis={trade.analysis} outcome={trade.outcome} triggeredEntryIndices={trade.triggeredEntryIndices} compact />
                        </div>
                    )) : <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">No active setups. Start with a chart analysis when you are ready.</p>}
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                    <h2 className="text-sm font-bold text-white">Workspace readiness</h2>
                    <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between"><span className="text-zinc-400">AI connection</span><span className={hasProviderConfig ? 'text-emerald-400' : 'text-amber-400'}>{hasProviderConfig ? 'Configured' : 'Needs setup'}</span></div>
                        <div className="flex items-center justify-between"><span className="text-zinc-400">Ready providers</span><span className="text-zinc-200">{readyProviderCount}</span></div>
                        <div className="flex items-center justify-between"><span className="text-zinc-400">Conversations</span><span className="text-zinc-200">{conversationCount}</span></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {!hasProviderConfig && <button type="button" onClick={onOpenSettings} className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-950/40">Connect AI</button>}
                        <button type="button" onClick={onOpenLiveMarket} className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-200 hover:bg-zinc-700">Live market</button>
                    </div>
                    {latestAnalysis && <div className="mt-5 border-t border-white/5 pt-4"><div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Latest decision</div><div className="mt-1 text-sm font-semibold text-zinc-200">{latestAnalysis.coinName ?? 'Unknown asset'} · {latestAnalysis.direction} · {latestAnalysis.confidence}</div><div className="mt-1 line-clamp-2 text-xs text-zinc-500">{latestAnalysis.strategy}</div></div>}
                </div>
            </div>
        </section>
    );
};

export default React.memo(HomeDashboard);

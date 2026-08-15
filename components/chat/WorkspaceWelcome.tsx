import React, { useMemo } from 'react';
import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../../types';
import { calculateOverallStats, calculateStreakData } from '../../utils/dashboardUtils';
import MarkdownRenderer from '../shared/MarkdownRenderer';

export interface WorkspaceWelcomeProps {
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

const fmtPrice = (v?: string): string => (v && v.trim() ? v : '—');

/**
 * The "Trading workspace" as the FIRST MESSAGE of a fresh session — a normal
 * chat bubble with properly formatted markdown (headings, stat table, active
 * setups, readiness, latest decision) and action buttons beneath, instead of
 * a modal-style dashboard card floating above the composer.
 */
const WorkspaceWelcome: React.FC<WorkspaceWelcomeProps> = ({
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
    const markdown = useMemo(() => {
        const stats = calculateOverallStats(trades);
        const streak = calculateStreakData(trades);
        const pendingTrades = trades.filter(trade => trade.outcome === TradeOutcome.PENDING).slice(0, 3);
        const lessons = trades.filter(trade => Boolean(trade.postMortem)).length;

        const lines: string[] = [];
        lines.push(`## Welcome back${username ? `, ${username}` : ''}`);
        lines.push('');
        lines.push('Your decision history, active setups, and next best action in one place.');
        lines.push('');

        lines.push('### At a glance');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('|---|---|');
        lines.push(`| Win rate | ${stats.totalTrades > 0 ? `${stats.winRate}% (${stats.totalTrades} completed)` : 'No completed trades yet'} |`);
        lines.push(`| P&L | ${stats.totalTrades > 0 ? `${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}` : '—'} |`);
        lines.push(`| Current streak | ${streak.currentStreak.count > 0 ? `${streak.currentStreak.count} ${streak.currentStreak.type}` : '—'} |`);
        lines.push(`| Journal | ${trades.length} trade${trades.length === 1 ? '' : 's'} · ${lessons} lesson${lessons === 1 ? '' : 's'} captured |`);
        lines.push('');

        if (pendingTrades.length > 0) {
            lines.push('### Active setups');
            lines.push('');
            pendingTrades.forEach(trade => {
                const a = trade.analysis;
                const date = new Date(trade.timestamp).toLocaleDateString();
                lines.push(`- **${a.coinName ?? 'Unknown asset'} · ${a.direction ?? 'Neutral'}** (${date}) — Entry ${fmtPrice(a.entryPoints?.[0]?.price)} · SL ${fmtPrice(a.stopLoss)} · TP1 ${fmtPrice(a.takeProfit?.[0]?.price)}`);
            });
            lines.push('');
        }

        lines.push('### Workspace readiness');
        lines.push('');
        lines.push(`- **AI connection:** ${hasProviderConfig ? 'Configured' : 'Needs setup'}`);
        lines.push(`- **Ready providers:** ${readyProviderCount}`);
        lines.push(`- **Conversations:** ${conversationCount}`);
        lines.push('');

        if (latestAnalysis) {
            lines.push('### Latest decision');
            lines.push('');
            lines.push(`**${latestAnalysis.coinName ?? 'Unknown asset'} · ${latestAnalysis.direction ?? 'Neutral'} · ${latestAnalysis.confidence ?? '—'}**`);
            if (latestAnalysis.strategy) lines.push('');
            if (latestAnalysis.strategy) lines.push(latestAnalysis.strategy.length > 200 ? `${latestAnalysis.strategy.slice(0, 200)}…` : latestAnalysis.strategy);
            lines.push('');
        }

        lines.push('---');
        lines.push('');
        lines.push('Start a new chart analysis below, or use the quick actions to review the journal, open live market data, or check your settings.');
        return lines.join('\n');
    }, [username, trades, latestAnalysis, conversationCount, readyProviderCount, hasProviderConfig]);

    return (
        <div className="w-full chat-column">
            {/* Rendered like a normal AI message bubble */}
            <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-4 sm:p-5 shadow-lg">
                <div className="flex items-center gap-2 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Trading workspace</span>
                </div>
                <div className="prose-sm">
                    <MarkdownRenderer content={markdown} />
                </div>
            </div>

            {/* Action buttons beneath the message */}
            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={onStartAnalysis}
                    className="status-surface rounded-xl bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-white"
                >
                    Analyze a chart
                </button>
                <button
                    type="button"
                    onClick={onOpenJournal}
                    className="rounded-xl border border-white/10 bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                    Open journal
                </button>
                <button
                    type="button"
                    onClick={onOpenLiveMarket}
                    className="rounded-xl border border-white/10 bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                    Live market
                </button>
                {!hasProviderConfig && (
                    <button
                        type="button"
                        onClick={onOpenSettings}
                        className="status-surface rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2 text-xs font-bold text-amber-200 transition-colors hover:bg-amber-950/40"
                    >
                        Connect AI
                    </button>
                )}
            </div>
        </div>
    );
};

export default React.memo(WorkspaceWelcome);

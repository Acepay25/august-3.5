/**
 * ModelPerformanceDashboard - Visualizes AI model rolling window performance
 * Shows win rates, cold streaks, expertise, and dynamic weights
 */

import React, { useState, useEffect, useRef, Fragment } from 'react';
import { clamp100 } from '../../utils/math';
import { Cpu } from 'lucide-react';
import { AIProvider, LoggedTrade } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import {
    getRollingWindowStats,
    getSituationalExpertise,
    calculateDynamicWeightsEnhanced,
    syncRollingWindowFromTradeLog,
    RollingWindowStats,
    SituationalExpertise,
    DynamicWeights
} from '../../services/backtesting/ModelPerformanceService';
import { MarketRegime } from '../../services/analysis/TechnicalAnalysisService';
import { getUnderperformerStatus } from '../../services/learning/UnderperformerFeedbackService';
import { seriesColor } from '../../utils/seriesPalette';

interface ModelCardData {
    provider: AIProvider;
    name: string;
    color: string;
    stats: RollingWindowStats;
    expertise: SituationalExpertise;
    modelName?: string;
}

interface ModelPerformanceDashboardProps {
    enabledProviders?: AIProvider[];
    currentRegime?: MarketRegime;
    currentFamily?: string;
    trades?: LoggedTrade[];
    selectedModels?: Record<string, string>; // provider -> model name
}

// Series colors are POSITIONAL (utils/seriesPalette), never provider-derived:
// no brand hints (providers are user-configured), and the old duplicate-gray
// ramp is gone — two models sharing one color made the lines unreadable.
// Rose/green stay reserved for loss/win; see utils/seriesPalette.
const resolveModelDisplay = (provider: AIProvider, index: number): { provider: AIProvider; name: string; color: string } => ({
    provider,
    name: provider,
    color: seriesColor(index),
});

/** A demoted model wears the neutral chrome color instead of its series
 *  color, so "this line is parked" reads without borrowing the loss hue. */
const DEMOTED_SERIES_COLOR = '#56564f';

/** Provider ids that contributed to a trade (dynamic first, legacy fallback). */
const tradeProviderIds = (trade: LoggedTrade): string[] => {
    if (trade.modelsUsed && Object.keys(trade.modelsUsed).length > 0) {
        return Object.keys(trade.modelsUsed);
    }
    const legacy: string[] = [];
    if (trade.geminiModelUsed) legacy.push('gemini');
    if (trade.deepseekModelUsed) legacy.push('deepseek');
    if (trade.zhipuModelUsed) legacy.push('zhipu');
    if (trade.groqModelUsed) legacy.push('groq');
    if (trade.groqNewModelUsed) legacy.push('groq_new');
    if (trade.groqAlt2ModelUsed) legacy.push('groq_alt2');
    if (trade.openrouterModelUsed) legacy.push('openrouter');
    return legacy;
};

const WinRateRing: React.FC<{ percentage: number; color: string; size?: number }> = ({
    percentage,
    color,
    size = 80
}) => {
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = clamp100(percentage);
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                {/* Progress circle — the inline transition animates a DATA mark
                    (stroke-dashoffset = the win rate), not UI chrome, so it is the
                    sanctioned exception to the --ease-snappy/0.12–0.18s rule. */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-mono font-bold tabular-nums text-white">{Math.round(percentage)}%</span>
            </div>
        </div>
    );
};

const StatusBadge: React.FC<{ stats: RollingWindowStats }> = ({ stats }) => {
    if (stats.isDemoted) {
        return <StatusPill tone="down" kicker>DEMOTED</StatusPill>;
    }

    if (stats.coldStreakCount >= 2) {
        return <StatusPill tone="warn" kicker>COOLING</StatusPill>;
    }

    if (stats.hotStreakCount >= 3) {
        return <StatusPill tone="up" kicker>HOT</StatusPill>;
    }

    return <StatusPill tone="neutral" kicker>STABLE</StatusPill>;
};

const ExpertiseBar: React.FC<{ expertise: SituationalExpertise }> = ({ expertise }) => {
    const reversalPct = expertise.reversalStats.total > 0
        ? Math.round(expertise.reversalStats.winRate)
        : 50;
    const continuationPct = expertise.continuationStats.total > 0
        ? Math.round(expertise.continuationStats.winRate)
        : 50;

    return (
        <div className="space-y-1">
            <div className="flex justify-between text-ui-xs tabular-nums text-zinc-500">
                <span>REV {reversalPct}%</span>
                <span>CONT {continuationPct}%</span>
            </div>
            <div className="flex gap-1 h-1.5">
                {/* The two segments are labelled (REV / CONT) right above them, so
                    the split reads from position alone: reversal is neutral zinc and
                    only continuation carries the view's cyan. Violet here was a
                    forbidden hue with no meaning attached to it. */}
                <div
                    className="rounded-full bg-gradient-to-r from-zinc-500 to-zinc-400"
                    style={{ width: `${Math.max(10, reversalPct)}%` }}
                />
                <div
                    className="rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                    style={{ width: `${Math.max(10, continuationPct)}%` }}
                />
            </div>
        </div>
    );
};

/**
 * One model = one hairline-divided row. Win rates are tabular data, so they
 * get a table (UI doctrine / WS-5.4), not a tile: the per-model ring became a
 * thin bar in the row, which keeps the readout and drops the card-in-a-card.
 * What genuinely does not fit a row — the streak counts and the reversal /
 * continuation split — sits behind disclosure, so rows stay one line high.
 */
const ModelTableRow: React.FC<{
    data: ModelCardData;
    expanded: boolean;
    onToggle: () => void;
}> = ({ data, expanded, onToggle }) => {
    const { name, color, stats, expertise, modelName } = data;
    const modelColor = stats.isDemoted ? DEMOTED_SERIES_COLOR : color;
    const losses = stats.last20Total - stats.last20Wins;

    return (
        <Fragment>
            <tr className="border-b border-white/5 last:border-0">
                <td className="py-1.5 pr-1 w-6 align-middle">
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} detail for ${name}`}
                        className="text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Model detail"
                    >
                        <span className={`inline-block text-[8px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                </td>
                <td className="py-1.5 pr-3 text-left">
                    <p className="text-zinc-200 truncate max-w-[160px]" title={name}>{name}</p>
                    {modelName && (
                        <p className="text-ui-2xs text-zinc-600 truncate max-w-[160px]" title={modelName}>
                            {modelName}
                        </p>
                    )}
                </td>
                <td className="py-1.5 px-2">
                    <div className="flex items-center gap-2 min-w-[150px]">
                        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            {/* width is the win rate: a data mark, so this animates
                                width alone — a blanket geometry transition is what
                                lets a growing bar shove the layout around. */}
                            <div
                                className="h-full rounded-full transition-[width] duration-[150ms] ease-[var(--ease-snappy)]"
                                style={{ width: `${clamp100(stats.last20WinRate)}%`, backgroundColor: modelColor }}
                            />
                        </div>
                        <span className="w-10 text-right text-zinc-100">{Math.round(stats.last20WinRate)}%</span>
                    </div>
                </td>
                <td className="py-1.5 px-2 text-zinc-300 whitespace-nowrap">
                    {stats.last20Wins}W / {losses}L
                </td>
                <td className="py-1.5 pl-2">
                    <StatusBadge stats={stats} />
                </td>
            </tr>
            {expanded && (
                <tr className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 pr-1" />
                    <td colSpan={4} className="py-1.5 px-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
                            <WinRateRing percentage={stats.last20WinRate} color={modelColor} size={64} />
                            <div className="space-y-0.5 text-zinc-400">
                                <p>Last {stats.last20Total} trades</p>
                                {stats.coldStreakCount > 0 && (
                                    <p className="text-red-400">
                                        {stats.coldStreakCount} consecutive losses
                                    </p>
                                )}
                                {stats.hotStreakCount > 0 && (
                                    <p className="text-emerald-400">
                                        {stats.hotStreakCount} consecutive wins
                                    </p>
                                )}
                            </div>
                            <div className="flex-1 min-w-[140px]">
                                <ExpertiseBar expertise={expertise} />
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </Fragment>
    );
};

const WeightsChart: React.FC<{ weights: DynamicWeights; enabledProviders: AIProvider[] }> = ({
    weights,
    enabledProviders
}) => {
    const weightData = enabledProviders
        .map((provider, idx) => {
            const weight = weights.byProvider?.[provider] ?? 0;
            return { ...resolveModelDisplay(provider, idx), weight: Math.round(weight * 100) };
        })
        .filter(m => m.weight > 0)
        .sort((a, b) => b.weight - a.weight);

    if (weightData.length === 0) {
        return (
            <div className="text-center text-zinc-500 py-4">
                No weight data available
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {weightData.map(({ name, color, weight, provider }) => (
                <div key={provider} className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 w-20 truncate">{name}</span>
                    <div className="flex-1 h-4 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-[width] duration-[150ms] ease-[var(--ease-snappy)]"
                            style={{
                                width: `${weight}%`,
                                backgroundColor: color,
                                opacity: 0.8
                            }}
                        />
                    </div>
                    <span className="text-xs text-zinc-300 w-10 text-right tabular-nums">{weight}%</span>
                </div>
            ))}
        </div>
    );
};

const ColdStreakAlerts: React.FC<{ modelData: ModelCardData[] }> = ({ modelData }) => {
    const demotedModels = modelData.filter(m => m.stats.isDemoted);

    if (demotedModels.length === 0) {
        return null;
    }

    return (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
                 Cold Streak Alerts
            </h3>
            <div className="space-y-1">
                {demotedModels.map(m => (
                    <div key={m.provider} className="flex items-center justify-between">
                        <span className="text-xs text-zinc-300">{m.name}</span>
                        <span className="text-xs text-red-400 tabular-nums">
                            {m.stats.coldStreakCount} losses • weight -50%
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ModelPerformanceDashboard: React.FC<ModelPerformanceDashboardProps> = ({
    enabledProviders = [],
    currentRegime = 'ranging' as MarketRegime,
    currentFamily = '',
    trades = [],
    selectedModels = {}
}) => {
    const [modelData, setModelData] = useState<ModelCardData[]>([]);
    const [weights, setWeights] = useState<DynamicWeights | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    // Which model rows are showing their detail. Keyed by provider id so a
    // refresh that reorders rows cannot move an open row under the cursor.
    const [expandedProviders, setExpandedProviders] = useState<string[]>([]);
    const toggleProvider = (provider: AIProvider): void =>
        setExpandedProviders(prev =>
            prev.includes(provider) ? prev.filter(p => p !== provider) : [...prev, provider]
        );
    // Tracks the pending refresh timer so rapid prop changes (trade log
    // updates, provider toggles) cancel the in-flight scan instead of
    // stacking overlapping 500ms runs; also cleared on unmount.
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const refreshData = () => {
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = null;
        }
        setIsRefreshing(true);

        // Small delay to show the animation
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null;
            // Sync rolling window from current trade log (works with any number of trades)
            if (trades.length > 0) {
                syncRollingWindowFromTradeLog(trades);
            }

            // Build rows for the union of enabled providers and providers found
            // in the trade log (dynamic ids), so historical models stay visible.
            const tradedProviders = new Set<string>();
            trades.forEach(t => tradeProviderIds(t).forEach(id => tradedProviders.add(id)));
            const allIds = [...new Set<string>([...enabledProviders, ...tradedProviders])];

            const allModelData = allIds.map((id, idx) => ({
                ...resolveModelDisplay(id, idx),
                stats: getRollingWindowStats(id),
                expertise: getSituationalExpertise(id),
                modelName: selectedModels[id] || undefined
            }));

            // Filter to show only models that have at least 1 trade (stats.last20Total > 0)
            // OR models that are currently enabled (so user can see them even with 0 trades)
            const data = allModelData.filter(m =>
                m.stats.last20Total > 0 || enabledProviders.includes(m.provider)
            );

            setModelData(data);
            setWeights(calculateDynamicWeightsEnhanced(currentRegime, currentFamily, enabledProviders));
            setLastUpdated(new Date());
            setIsRefreshing(false);
        }, 500);
    };

    useEffect(() => {
        refreshData();
        return () => {
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
        };
    }, [enabledProviders, currentRegime, currentFamily, trades]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-2xl"></span>
                    <div>
                        <h2 className="text-lg font-semibold text-white">AI Model Performance</h2>
                        <p className="text-xs text-zinc-500">
                            Rolling window: Last 20 trades per model
                        </p>
                    </div>
                </div>
                <button
                    onClick={refreshData}
                    disabled={isRefreshing}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors duration-[150ms] ease-[var(--ease-snappy)] flex items-center gap-2 ${isRefreshing
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'
                        }`}
                >
                    <span className={`inline-block ${isRefreshing ? 'animate-spin' : ''}`}></span>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Model performance — win rates are tabular, so they get a table
                (WS-5.4), one hairline-divided row per model. */}
            {modelData.length > 0 && (
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left text-ui-xs font-mono tabular-nums">
                            <thead>
                                <tr className="text-zinc-600 border-b border-white/5">
                                    <th className="py-1.5 pr-1 w-6">
                                        <span className="sr-only">Detail</span>
                                    </th>
                                    <th className="py-1.5 pr-3 font-bold">Model</th>
                                    <th className="py-1.5 px-2 font-bold">Win rate</th>
                                    <th className="py-1.5 px-2 font-bold">Last 20</th>
                                    <th className="py-1.5 pl-2 font-bold">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modelData.map(data => (
                                    <ModelTableRow
                                        key={data.provider}
                                        data={data}
                                        expanded={expandedProviders.includes(data.provider)}
                                        onToggle={() => toggleProvider(data.provider)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* No Data State */}
            {modelData.length === 0 && (
                <EmptyState
                    icon={<Cpu className="w-8 h-8" />}
                    title="Not enough data"
                    description="Enable AI providers and log some trades to see model performance analytics."
                />
            )}

            {/* Dynamic Weights */}
            {weights && modelData.length > 0 && (
                <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700/50">
                    <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                         Dynamic Weights
                        <span className="text-xs font-normal text-zinc-500">
                            (Confidence: {weights.confidence})
                        </span>
                    </h3>
                    <WeightsChart weights={weights} enabledProviders={enabledProviders} />
                    {weights.dominantModel && (
                        <p className="text-xs text-zinc-300 mt-3">
                             Dominant model for current context: {weights.dominantModel.toUpperCase()}
                        </p>
                    )}
                </div>
            )}

            {/* Cold Streak Alerts */}
            <ColdStreakAlerts modelData={modelData} />

            {/* Footer */}
            <div className="text-center text-xs text-zinc-600">
                Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
        </div>
    );
};

export default ModelPerformanceDashboard;

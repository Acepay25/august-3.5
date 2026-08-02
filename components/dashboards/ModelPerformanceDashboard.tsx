/**
 * ModelPerformanceDashboard - Visualizes AI model rolling window performance
 * Shows win rates, cold streaks, expertise, and dynamic weights
 */

import React, { useState, useEffect } from 'react';
import { Cpu } from 'lucide-react';
import { AIProvider, LoggedTrade } from '../../types';
import { EmptyState } from '../ui/EmptyState';
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

// Decorative brand hints for known provider ids — custom providers get a
// palette color and use their id as display name.
const PROVIDER_BRAND_HINTS: Record<string, { name: string; color: string }> = {
    gemini: { name: 'Gemini', color: '#FAFAFA' },
    deepseek: { name: 'DeepSeek', color: '#A1A1AA' },
    groq: { name: 'Groq', color: '#E4E4E7' },
    groq_new: { name: 'Groq Alt', color: '#D4D4D8' },
    groq_alt2: { name: 'Groq Alt2', color: '#A1A1AA' },
    openrouter: { name: 'OpenRouter', color: '#71717A' },
    zhipu: { name: 'Zhipu', color: '#B8B8BF' },
    openai: { name: 'OpenAI', color: '#909097' },
    grok: { name: 'Grok', color: '#82828A' },
};

const FALLBACK_PALETTE = ['#FAFAFA', '#E4E4E7', '#D4D4D8', '#A1A1AA', '#C9C9CF', '#909097', '#71717A', '#B8B8BF', '#DEDEE2', '#82828A'];

const resolveModelDisplay = (provider: AIProvider, index: number): { provider: AIProvider; name: string; color: string } => {
    const hint = PROVIDER_BRAND_HINTS[provider];
    return {
        provider,
        name: hint?.name || provider,
        color: hint?.color || FALLBACK_PALETTE[index % FALLBACK_PALETTE.length],
    };
};

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
    const progress = Math.max(0, Math.min(100, percentage));
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
                {/* Progress circle */}
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
                <span className="text-lg font-bold text-white">{Math.round(percentage)}%</span>
            </div>
        </div>
    );
};

const StatusBadge: React.FC<{ stats: RollingWindowStats }> = ({ stats }) => {
    if (stats.isDemoted) {
        return (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/50">
                <span className="text-red-400 text-xs font-medium">DEMOTED</span>
            </div>
        );
    }

    if (stats.coldStreakCount >= 2) {
        return (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/50">
                <span className="text-yellow-400 text-xs font-medium">COOLING</span>
            </div>
        );
    }

    if (stats.hotStreakCount >= 3) {
        return (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/50">
                <span className="text-green-400 text-xs font-medium">HOT</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700/50 border border-zinc-600/50">
            <span className="text-zinc-400 text-xs font-medium">STABLE</span>
        </div>
    );
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
            <div className="flex justify-between text-[10px] text-zinc-500">
                <span>REV {reversalPct}%</span>
                <span>CONT {continuationPct}%</span>
            </div>
            <div className="flex gap-1 h-1.5">
                <div
                    className="rounded-full bg-gradient-to-r from-violet-500 to-violet-400"
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

const ModelCard: React.FC<{ data: ModelCardData }> = ({ data }) => {
    const { name, color, stats, expertise, modelName } = data;

    return (
        <div className="relative p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 backdrop-blur-sm hover:border-zinc-600/70 transition-all">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white text-sm">{name}</h3>
                    {modelName && (
                        <p className="text-[10px] text-zinc-500 truncate" title={modelName}>
                            {modelName}
                        </p>
                    )}
                </div>
                <StatusBadge stats={stats} />
            </div>

            {/* Win Rate Ring */}
            <div className="flex justify-center mb-3">
                <WinRateRing
                    percentage={stats.last20WinRate}
                    color={stats.isDemoted ? '#52525B' : color}
                />
            </div>

            {/* Stats */}
            <div className="text-center mb-3">
                <p className="text-xs text-zinc-400">
                    Last {stats.last20Total} trades
                </p>
                <p className="text-xs text-zinc-500">
                    {stats.last20Wins}W / {stats.last20Total - stats.last20Wins}L
                </p>
            </div>

            {/* Streak Info */}
            {(stats.coldStreakCount > 0 || stats.hotStreakCount > 0) && (
                <div className="text-center mb-2">
                    {stats.coldStreakCount > 0 && (
                        <span className="text-xs text-red-400">
                            {stats.coldStreakCount} consecutive losses
                        </span>
                    )}
                    {stats.hotStreakCount > 0 && (
                        <span className="text-xs text-green-400">
                            {stats.hotStreakCount} consecutive wins
                        </span>
                    )}
                </div>
            )}

            {/* Expertise */}
            <ExpertiseBar expertise={expertise} />
        </div>
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
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${weight}%`,
                                backgroundColor: color,
                                opacity: 0.8
                            }}
                        />
                    </div>
                    <span className="text-xs text-zinc-300 w-10 text-right">{weight}%</span>
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
                        <span className="text-xs text-red-400">
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

    const refreshData = () => {
        setIsRefreshing(true);

        // Small delay to show the animation
        setTimeout(() => {
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
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-2 ${isRefreshing
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'
                        }`}
                >
                    <span className={`inline-block ${isRefreshing ? 'animate-spin' : ''}`}></span>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Model Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {modelData.map(data => (
                    <ModelCard key={data.provider} data={data} />
                ))}
            </div>

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
                <div className="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
                    <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                         Dynamic Weights
                        <span className="text-xs font-normal text-zinc-500">
                            (Confidence: {weights.confidence})
                        </span>
                    </h3>
                    <WeightsChart weights={weights} enabledProviders={enabledProviders} />
                    {weights.dominantModel && (
                        <p className="text-xs text-violet-400 mt-3">
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

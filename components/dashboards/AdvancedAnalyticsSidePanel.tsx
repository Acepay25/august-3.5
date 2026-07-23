/**
 * AdvancedAnalyticsSidePanel - Modern collapsible side panel for chat area
 * Shows Underperformer Feedback, Monte Carlo, and Live Backtesting results
 * Redesigned with ChatGPT/Gemini-inspired aesthetics
 */

import React, { useState, useEffect } from 'react';
import { AIProvider, LevelProbabilities } from '../../types';
import { getUnderperformerStatus, generateUnderperformerFeedback } from '../../services/learning/UnderperformerFeedbackService';

// Types for analytics results
interface MonteCarloResult {
    simulations: number;
    winRate: number;
    winCount: number;
    expectedValue: number;
    timeframe: string;
    probabilities: {
        tp1Hit: number;
        tp2Hit: number;
        tp3Hit: number;
        slHit: number;
        timeout: number;
    };
    maxDrawdownAvg: number;
    confidenceInterval: {
        lower: number;
        upper: number;
    };
}

interface LiveBacktestResult {
    totalMatches: number;
    winRate: number;
    expectedValue: number;
    avgWinPercent: number;
    avgLossPercent: number;
    warning?: string;
    // Session breakdown
    sessionBreakdown?: {
        session: string;
        winRate: number;
        count: number;
        avgPnl: number;
    }[];
    bestSession?: string;
    worstSession?: string;
}

// Per-AI labeled Monte Carlo result
interface LabeledMonteCarloResult {
    provider: string;
    result: MonteCarloResult;
    isModeratorFinal?: boolean;
}

interface AdvancedAnalyticsSidePanelProps {
    enabledProviders: AIProvider[];
    monteCarloResult?: MonteCarloResult | null;
    backtestResult?: LiveBacktestResult | null;
    isCalculating?: boolean;
    perAIMonteCarloResults?: LabeledMonteCarloResult[];
    entryTimingScore?: {
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null;
    slOptimization?: {
        recommendedMultiplier: number;
        missedWinRate: number;
        hasEnoughData?: boolean;
        contextRecommendations?: { context: string; recommendedMultiplier: number }[];
    } | null;
    // AI Probability Estimation
    levelProbabilities?: LevelProbabilities | null;
    // Trade selection for AI Probability
    selectedCoinName?: string | null;
    onClearSelection?: () => void;
    onRegenerateProbabilities?: (mode: 'AI' | 'Algo', messageId?: string) => void;
    selectedMessageId?: string | null;
    // External control props
    isExternallyOpen?: boolean;
    onClose?: () => void;
}

// Modern Section Card Component
const SectionCard: React.FC<{
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    status?: 'active' | 'calculating' | 'waiting' | 'warning' | 'success';
    statusLabel?: string;
    children: React.ReactNode;
    accentColor?: 'cyan' | 'amber' | 'red' | 'emerald' | 'purple';
    action?: React.ReactNode;
}> = ({ title, subtitle, icon, status, statusLabel, children, accentColor = 'cyan', action }) => {
    const accentStyles = {
        cyan: 'from-cyan-500/10 to-transparent border-cyan-500/20 hover:border-cyan-500/40',
        amber: 'from-amber-500/10 to-transparent border-amber-500/20 hover:border-amber-500/40',
        red: 'from-rose-500/10 to-transparent border-rose-500/20 hover:border-rose-500/40',
        emerald: 'from-emerald-500/10 to-transparent border-emerald-500/20 hover:border-emerald-500/40',
        purple: 'from-purple-500/10 to-transparent border-purple-500/20 hover:border-purple-500/40',
    };

    const iconBgStyles = {
        cyan: 'bg-cyan-500/10 text-cyan-400',
        amber: 'bg-amber-500/10 text-amber-400',
        red: 'bg-rose-500/10 text-rose-400',
        emerald: 'bg-emerald-500/10 text-emerald-400',
        purple: 'bg-purple-500/10 text-purple-400',
    };

    const statusStyles = {
        active: 'bg-emerald-500/20 text-emerald-400',
        calculating: 'bg-cyan-500/20 text-cyan-400 animate-pulse',
        waiting: 'bg-zinc-500/20 text-zinc-400',
        warning: 'bg-amber-500/20 text-amber-400',
        success: 'bg-emerald-500/20 text-emerald-400',
    };

    return (
        <div className={`group relative rounded-2xl bg-gradient-to-b ${accentStyles[accentColor]} border backdrop-blur-sm transition-all duration-300`}>
            {/* Header */}
            <div className="flex items-center gap-3 p-4 pb-3">
                <div className={`w-9 h-9 rounded-xl ${iconBgStyles[accentColor]} flex items-center justify-center text-base transition-transform duration-300 group-hover:scale-110`}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-white/90 tracking-tight">{title}</h4>
                    {subtitle && (
                        <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
                    )}
                </div>
                {status && statusLabel && (
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${statusStyles[status]}`}>
                        {statusLabel}
                    </span>
                )}
                {action && (
                    <div className="ml-auto pl-2">
                        {action}
                    </div>
                )}
            </div>
            {/* Content */}
            <div className="px-4 pb-4 pt-1">
                {children}
            </div>
        </div>
    );
};

// Stat Pill Component
const StatPill: React.FC<{
    label: string;
    value: string | number;
    variant?: 'success' | 'danger' | 'warning' | 'neutral' | 'info';
    size?: 'sm' | 'md' | 'lg';
}> = ({ label, value, variant = 'neutral', size = 'md' }) => {
    const variantStyles = {
        success: 'text-emerald-400',
        danger: 'text-rose-400',
        warning: 'text-amber-400',
        neutral: 'text-zinc-300',
        info: 'text-cyan-400',
    };

    const sizeStyles = {
        sm: 'text-sm',
        md: 'text-lg',
        lg: 'text-2xl',
    };

    return (
        <div className="flex flex-col items-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1">{label}</span>
            <span className={`${sizeStyles[size]} font-bold ${variantStyles[variant]} tracking-tight`}>{value}</span>
        </div>
    );
};

// Progress Bar Component
const ProgressBar: React.FC<{
    value: number;
    successColor?: string;
    dangerColor?: string;
}> = ({ value, successColor = 'from-emerald-500 to-emerald-400', dangerColor = 'from-rose-500 to-rose-400' }) => {
    return (
        <div className="relative h-2 rounded-full overflow-hidden bg-zinc-800/50">
            <div
                className={`absolute left-0 top-0 h-full bg-gradient-to-r ${successColor} transition-all duration-700 ease-out`}
                style={{ width: `${value}%` }}
            />
            <div
                className={`absolute right-0 top-0 h-full bg-gradient-to-r ${dangerColor} transition-all duration-700 ease-out`}
                style={{ width: `${100 - value}%` }}
            />
        </div>
    );
};

const AdvancedAnalyticsSidePanel: React.FC<AdvancedAnalyticsSidePanelProps> = ({
    enabledProviders,
    monteCarloResult,
    backtestResult,
    isCalculating = false,
    perAIMonteCarloResults = [],
    entryTimingScore,
    slOptimization,
    levelProbabilities,
    selectedCoinName,
    onClearSelection,
    isExternallyOpen,
    onClose,
    onRegenerateProbabilities,
    selectedMessageId
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [probMode, setProbMode] = useState<'AI' | 'Algo'>('AI');

    // Sync local mode state if the data already has a mode
    useEffect(() => {
        if (levelProbabilities?.calculationMode) {
            setProbMode(levelProbabilities.calculationMode);
        }
    }, [levelProbabilities?.calculationMode]);

    // Sync with external open state
    useEffect(() => {
        if (isExternallyOpen !== undefined) {
            setIsOpen(isExternallyOpen);
        }
    }, [isExternallyOpen]);

    const handleClose = () => {
        setIsOpen(false);
        onClose?.();
    };

    const [underperformerData, setUnderperformerData] = useState<{
        provider: AIProvider;
        winRate: number;
        coldStreak: number;
        prompt: string;
        showPrompt: boolean;
    }[]>([]);

    useEffect(() => {
        const status = getUnderperformerStatus(enabledProviders);
        const data = status
            .filter(s => s.shouldInject)
            .map(s => ({
                provider: s.provider,
                winRate: s.stats.last20WinRate,
                coldStreak: s.stats.coldStreakCount,
                prompt: generateUnderperformerFeedback(s.provider, s.stats, s.expertise),
                showPrompt: false
            }));
        setUnderperformerData(data);
    }, [enabledProviders]);

    const togglePromptView = (index: number) => {
        setUnderperformerData(prev => prev.map((item, i) =>
            i === index ? { ...item, showPrompt: !item.showPrompt } : item
        ));
    };

    // Determine if we have live results
    const hasMonteCarloResults = monteCarloResult && monteCarloResult.simulations > 0;
    const hasBacktestResults = backtestResult && backtestResult.totalMatches > 0;
    const hasLiveData = hasMonteCarloResults || hasBacktestResults || perAIMonteCarloResults.length > 0;

    return (
        <>
            {/* Modern Side Panel */}
            <div
                className={`fixed right-0 top-0 h-full w-80 sm:w-[340px] transform transition-all duration-500 ease-out z-30 ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                {/* Glassmorphic Background */}
                <div className="absolute inset-0 bg-zinc-900/95 backdrop-blur-2xl border-l border-white/[0.08]" />

                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-purple-500/[0.02] via-transparent to-cyan-500/[0.02]" />

                {/* Content Container */}
                <div className="relative h-full flex flex-col">
                    {/* Header */}
                    <div className="flex-shrink-0 p-5 pb-4 border-b border-white/[0.06]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                                    <span className="text-xl">🔬</span>
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold text-white tracking-tight">Analytics</h2>
                                    <p className="text-[11px] text-zinc-500">Real-time AI insights</p>
                                </div>
                            </div>
                            {hasLiveData && (
                                <span className="flex items-center gap-1.5 text-[10px] font-medium text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-full">
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
                                    </span>
                                    Live
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">

                        {/* Underperformer Feedback */}
                        <SectionCard
                            title="Model Health"
                            subtitle="Underperforming AI feedback"
                            icon="⚡"
                            accentColor={underperformerData.length > 0 ? 'red' : 'emerald'}
                            status={underperformerData.length > 0 ? 'warning' : 'success'}
                            statusLabel={underperformerData.length > 0 ? `${underperformerData.length} Issues` : 'All Good'}
                        >
                            {underperformerData.length > 0 ? (
                                <div className="space-y-2">
                                    {underperformerData.map((item, index) => (
                                        <div key={item.provider} className="rounded-xl bg-rose-500/[0.05] border border-rose-500/20 overflow-hidden">
                                            <button
                                                onClick={() => togglePromptView(index)}
                                                className="w-full p-3 flex items-center justify-between hover:bg-rose-500/10 transition-all duration-200"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <span className="text-[11px] font-bold text-white bg-rose-500/30 px-2 py-0.5 rounded-lg">
                                                        {item.provider.toUpperCase()}
                                                    </span>
                                                    <span className="text-[11px] text-rose-300/80">
                                                        {item.winRate}% win • {item.coldStreak} streak
                                                    </span>
                                                </div>
                                                <span className={`text-zinc-500 text-xs transition-transform duration-200 ${item.showPrompt ? 'rotate-180' : ''}`}>
                                                    ▼
                                                </span>
                                            </button>

                                            {item.showPrompt && (
                                                <div className="p-3 pt-0 animate-in slide-in-from-top-2 duration-200">
                                                    <div className="p-3 rounded-lg bg-black/30 border border-rose-500/10">
                                                        <div className="text-[10px] text-rose-400/80 mb-2 font-medium">Injected Prompt:</div>
                                                        <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono leading-relaxed">
                                                            {item.prompt.substring(0, 600)}...
                                                        </pre>
                                                        <div className="text-[9px] text-zinc-600 mt-2">
                                                            Showing first 600 of {item.prompt.length} chars
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-[12px] text-emerald-400/80 bg-emerald-500/[0.05] rounded-xl p-3 border border-emerald-500/10">
                                    <span>✓</span>
                                    <span>All models performing optimally</span>
                                </div>
                            )}
                        </SectionCard>

                        {/* Monte Carlo Simulation */}
                        <SectionCard
                            title="Monte Carlo"
                            subtitle={perAIMonteCarloResults.length > 0 ? `${perAIMonteCarloResults.length} AI predictions` : 'Probability simulation'}
                            icon="🎲"
                            accentColor="cyan"
                            status={isCalculating && perAIMonteCarloResults.length === 0 ? 'calculating' : (hasMonteCarloResults || perAIMonteCarloResults.length > 0) ? 'active' : 'waiting'}
                            statusLabel={isCalculating && perAIMonteCarloResults.length === 0 ? 'Calculating...' : (hasMonteCarloResults || perAIMonteCarloResults.length > 0) ? 'Live' : 'Waiting'}
                        >
                            {perAIMonteCarloResults.length > 0 ? (
                                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                                    {perAIMonteCarloResults.map((labeled, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-3 rounded-xl border transition-all duration-200 hover:scale-[1.01] ${labeled.isModeratorFinal
                                                ? 'bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/30'
                                                : 'bg-white/[0.02] border-white/[0.06] hover:border-cyan-500/30'
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
                                                <div className="text-center p-2 rounded-lg bg-black/20">
                                                    <span className="text-[9px] text-zinc-500 block mb-0.5">Win Rate</span>
                                                    <span className={`text-lg font-bold ${labeled.result.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {labeled.result.winRate}%
                                                    </span>
                                                    <span className="text-[9px] text-zinc-600 block">
                                                        {labeled.result.winCount}/{labeled.result.simulations}
                                                    </span>
                                                </div>
                                                <div className="text-center p-2 rounded-lg bg-black/20">
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
                                    </div>

                                    {/* Probabilities */}
                                    <div className="p-3 rounded-xl bg-black/20 border border-white/[0.04]">
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
                                    <div className="text-2xl mb-2 opacity-40">🎲</div>
                                    <div className="text-[11px] text-zinc-500">Run analysis with trade setup to see results</div>
                                </div>
                            )}
                        </SectionCard>

                        {/* Live Backtest */}
                        <SectionCard
                            title="Live Backtest"
                            subtitle="Similar historical trades"
                            icon="📊"
                            accentColor="amber"
                            status={isCalculating && !hasBacktestResults ? 'calculating' : hasBacktestResults ? 'active' : 'waiting'}
                            statusLabel={isCalculating && !hasBacktestResults ? 'Searching...' : hasBacktestResults ? 'Live' : 'Need 3+ trades'}
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
                                    <div className="p-3 rounded-xl bg-black/20 border border-white/[0.04]">
                                        <div className="flex justify-between text-[10px] mb-2">
                                            <span className="text-emerald-400 font-medium">✓ Wins</span>
                                            <span className="text-zinc-500">{backtestResult!.winRate.toFixed(0)}% / {(100 - backtestResult!.winRate).toFixed(0)}%</span>
                                            <span className="text-rose-400 font-medium">✗ Losses</span>
                                        </div>
                                        <ProgressBar value={backtestResult!.winRate} />
                                    </div>

                                    {/* Secondary Stats */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="p-3 rounded-xl bg-black/20 border border-white/[0.04]">
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
                                        <div className="p-3 rounded-xl bg-black/20 border border-white/[0.04]">
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
                                            ? '✅ Strong Edge — High Probability Setup'
                                            : backtestResult!.expectedValue >= 0
                                                ? '⚖️ Marginal Edge — Proceed with Caution'
                                                : '❌ Negative Edge — Consider Skipping'}
                                    </div>

                                    {/* Session Performance Breakdown */}
                                    {backtestResult!.sessionBreakdown && backtestResult!.sessionBreakdown.length > 0 && (
                                        <div className="p-3 rounded-xl bg-black/20 border border-white/[0.04]">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">🕐 Session Performance</span>
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
                                                                : 'bg-white/[0.02] border border-white/[0.04]'
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
                                            ⚠️ {backtestResult!.warning}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-4">
                                    <div className="text-2xl mb-2 opacity-40">📊</div>
                                    <div className="text-[11px] text-zinc-500 mb-1">Requires 3+ logged trades with similar patterns</div>
                                    <div className="text-[10px] text-zinc-600">Same coin, direction, and pattern family</div>
                                </div>
                            )}
                        </SectionCard>

                        {/* Entry Timing Score */}
                        {entryTimingScore && (
                            <SectionCard
                                title="Entry Timing"
                                subtitle="Display only • Does not affect AI"
                                icon="🎯"
                                accentColor={entryTimingScore.score >= 70 ? 'emerald' : entryTimingScore.score >= 50 ? 'amber' : 'red'}
                                status={entryTimingScore.score >= 70 ? 'success' : entryTimingScore.score >= 50 ? 'warning' : 'waiting'}
                                statusLabel={entryTimingScore.timingQuality}
                            >
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <StatPill
                                            label="Score"
                                            value={`${entryTimingScore.score}/100`}
                                            variant={entryTimingScore.score >= 70 ? 'success' : entryTimingScore.score >= 50 ? 'warning' : 'danger'}
                                            size="lg"
                                        />
                                        <StatPill
                                            label="Quality"
                                            value={entryTimingScore.score >= 70 ? '✓ Good' : entryTimingScore.score >= 50 ? '⚡ Fair' : '⚠️ Poor'}
                                            variant={entryTimingScore.score >= 70 ? 'success' : entryTimingScore.score >= 50 ? 'warning' : 'danger'}
                                        />
                                    </div>

                                    {entryTimingScore.suggestedEntry && (
                                        <div className="p-3 rounded-xl bg-cyan-500/[0.08] border border-cyan-500/20">
                                            <div className="text-[10px] text-cyan-400 mb-1.5 font-medium">💡 Better Entry Available</div>
                                            <div className="text-lg text-cyan-100 font-mono font-bold">
                                                ${entryTimingScore.suggestedEntry.price.toLocaleString()}
                                            </div>
                                            <div className="text-[10px] text-cyan-300/60 mt-1.5">
                                                {entryTimingScore.suggestedEntry.reason}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </SectionCard>
                        )}

                        {/* SL Optimization */}
                        {slOptimization && slOptimization.hasEnoughData && (
                            <SectionCard
                                title="SL Optimization"
                                subtitle="Display only • Does not affect AI"
                                icon="📈"
                                accentColor="amber"
                                status="active"
                                statusLabel={`${slOptimization.missedWinRate.toFixed(0)}% missed`}
                            >
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <StatPill
                                            label="Recommended Width"
                                            value={`${(slOptimization.recommendedMultiplier * 100).toFixed(0)}%`}
                                            variant="info"
                                            size="lg"
                                        />
                                        <StatPill
                                            label="Missed Win Rate"
                                            value={`${slOptimization.missedWinRate.toFixed(0)}%`}
                                            variant={slOptimization.missedWinRate > 30 ? 'danger' : slOptimization.missedWinRate > 15 ? 'warning' : 'success'}
                                            size="lg"
                                        />
                                    </div>

                                    {slOptimization.contextRecommendations && slOptimization.contextRecommendations.length > 0 && (
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] text-zinc-500">Context-Specific:</span>
                                            {slOptimization.contextRecommendations.slice(0, 2).map((rec, i) => (
                                                <div key={i} className="text-[10px] text-amber-200/80 bg-black/20 px-3 py-2 rounded-lg flex justify-between">
                                                    <span>{rec.context}</span>
                                                    <span className="font-semibold text-amber-300">{(rec.recommendedMultiplier * 100).toFixed(0)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </SectionCard>
                        )}

                        {/* AI Probability Estimation - ALWAYS VISIBLE */}
                        <SectionCard
                            title="AI Probability"
                            subtitle="SL/TP hit estimation with reasoning"
                            icon="🎯"
                            accentColor="purple"
                            status={levelProbabilities ? 'active' : (isCalculating ? 'calculating' : 'waiting')}
                            statusLabel={isCalculating ? 'Thinking...' : undefined}
                            action={
                                <div className="flex items-center gap-1.5 bg-black/20 rounded-lg p-0.5 border border-white/5">
                                    {/* Mode Selector */}
                                    <select
                                        value={probMode}
                                        onChange={(e) => setProbMode(e.target.value as 'AI' | 'Algo')}
                                        className="bg-transparent text-[10px] font-medium text-zinc-400 px-1 py-0.5 outline-none cursor-pointer hover:text-white transition-colors appearance-none text-center min-w-[50px]"
                                        title="Switch between AI Reasoning and Algorithmic Calculation"
                                        disabled={isCalculating}
                                    >
                                        <option value="AI">🤖 AI</option>
                                        <option value="Algo">📈 Algo</option>
                                    </select>

                                    {/* Regenerate Button */}
                                    <button
                                        onClick={() => onRegenerateProbabilities?.(probMode, selectedMessageId!)}
                                        disabled={isCalculating || !selectedMessageId}
                                        className={`p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-purple-400 transition-all ${isCalculating ? 'animate-spin opacity-50' : ''}`}
                                        title="Regenerate Probability Analysis"
                                    >
                                        🔄
                                    </button>
                                </div>
                            }
                        >
                            {levelProbabilities ? (
                                <div className="space-y-3">
                                    {/* Selected Trade Indicator */}
                                    {selectedCoinName && (
                                        <div className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                            <span className="text-[10px] text-purple-300">
                                                📌 Viewing: <span className="font-bold text-purple-200">{selectedCoinName}</span>
                                            </span>
                                            <button
                                                onClick={onClearSelection}
                                                className="text-[9px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    )}
                                    {/* Probability Grid */}
                                    <div className="grid grid-cols-2 gap-2">
                                        {/* SL Probability */}
                                        <div className={`text-center p-3 rounded-xl border ${levelProbabilities.slProbability > 50 ? 'bg-rose-500/15 border-rose-500/30' :
                                            levelProbabilities.slProbability > 30 ? 'bg-amber-500/10 border-amber-500/20' :
                                                'bg-emerald-500/10 border-emerald-500/20'
                                            }`}>
                                            <span className="text-[9px] text-zinc-500 block mb-1">Stop Loss</span>
                                            <span className={`text-xl font-bold font-mono ${levelProbabilities.slProbability > 50 ? 'text-rose-400' :
                                                levelProbabilities.slProbability > 30 ? 'text-amber-400' :
                                                    'text-emerald-400'
                                                }`}>
                                                {levelProbabilities.slProbability}%
                                            </span>
                                        </div>

                                        {/* Dynamic TP Probabilities */}
                                        {levelProbabilities.tpProbabilities && levelProbabilities.tpProbabilities.length > 0 ? (
                                            levelProbabilities.tpProbabilities.map((tp) => (
                                                <div key={tp.level} className={`text-center p-3 rounded-xl border ${tp.probability > 60 ? 'bg-emerald-500/15 border-emerald-500/30' :
                                                    tp.probability > 40 ? 'bg-amber-500/10 border-amber-500/20' :
                                                        'bg-zinc-500/10 border-zinc-500/20'
                                                    }`}>
                                                    <span className="text-[9px] text-zinc-500 block mb-1">TP{tp.level}</span>
                                                    <span className={`text-xl font-bold font-mono ${tp.probability > 60 ? 'text-emerald-400' :
                                                        tp.probability > 40 ? 'text-amber-400' :
                                                            'text-zinc-400'
                                                        }`}>
                                                        {tp.probability}%
                                                    </span>
                                                </div>
                                            ))
                                        ) : (
                                            /* Backward Compatibility for old fixed fields */
                                            <>
                                                {/* TP1 Probability */}
                                                {(levelProbabilities as any).tp1Probability !== undefined && (
                                                    <div className={`text-center p-3 rounded-xl border ${(levelProbabilities as any).tp1Probability > 60 ? 'bg-emerald-500/15 border-emerald-500/30' :
                                                        (levelProbabilities as any).tp1Probability > 40 ? 'bg-amber-500/10 border-amber-500/20' :
                                                            'bg-zinc-500/10 border-zinc-500/20'
                                                        }`}>
                                                        <span className="text-[9px] text-zinc-500 block mb-1">TP1</span>
                                                        <span className={`text-xl font-bold font-mono ${(levelProbabilities as any).tp1Probability > 60 ? 'text-emerald-400' :
                                                            (levelProbabilities as any).tp1Probability > 40 ? 'text-amber-400' :
                                                                'text-zinc-400'
                                                            }`}>
                                                            {(levelProbabilities as any).tp1Probability}%
                                                        </span>
                                                    </div>
                                                )}
                                                {/* TP2 Probability */}
                                                {(levelProbabilities as any).tp2Probability !== undefined && (
                                                    <div className={`text-center p-3 rounded-xl border ${(levelProbabilities as any).tp2Probability > 60 ? 'bg-emerald-500/15 border-emerald-500/30' :
                                                        (levelProbabilities as any).tp2Probability > 40 ? 'bg-amber-500/10 border-amber-500/20' :
                                                            'bg-zinc-500/10 border-zinc-500/20'
                                                        }`}>
                                                        <span className="text-[9px] text-zinc-500 block mb-1">TP2</span>
                                                        <span className={`text-xl font-bold font-mono ${(levelProbabilities as any).tp2Probability > 60 ? 'text-emerald-400' :
                                                            (levelProbabilities as any).tp2Probability > 40 ? 'text-amber-400' :
                                                                'text-zinc-400'
                                                            }`}>
                                                            {(levelProbabilities as any).tp2Probability}%
                                                        </span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {/* AI Reasoning Section */}
                                    <div className="p-3 rounded-xl bg-black/20 border border-purple-500/10">
                                        <span className="text-[10px] text-purple-400 font-medium block mb-2">🤖 AI Reasoning</span>
                                        <div className="space-y-2 text-[10px]">
                                            {/* SL Reasoning */}
                                            {(levelProbabilities.slReasoning || (levelProbabilities as any).reasoning?.sl) && (
                                                <details className="group">
                                                    <summary className="cursor-pointer text-rose-300 hover:text-rose-200 flex items-center gap-1.5">
                                                        <span className="text-[8px] group-open:rotate-90 transition-transform">▶</span>
                                                        Stop Loss Reasoning
                                                    </summary>
                                                    <div className="mt-1.5 pl-3 space-y-1 text-zinc-400 border-l border-rose-500/20">
                                                        {(() => {
                                                            const r = levelProbabilities.slReasoning || (levelProbabilities as any).reasoning?.sl;
                                                            return (
                                                                <>
                                                                    <div><span className="text-cyan-400">Indicators:</span> {r.indicatorBasis}</div>
                                                                    <div><span className="text-amber-400">Volatility:</span> {r.volatilityFactor}</div>
                                                                    <div><span className="text-violet-400">Pattern:</span> {r.patternMemoryInfluence}</div>
                                                                    <div><span className="text-emerald-400">Adjustments:</span> {r.aiAdjustments}</div>
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                </details>
                                            )}

                                            {/* Dynamic TP Reasoning */}
                                            {levelProbabilities.tpProbabilities && levelProbabilities.tpProbabilities.length > 0 ? (
                                                levelProbabilities.tpProbabilities.map((tp) => (
                                                    <details key={tp.level} className="group">
                                                        <summary className="cursor-pointer text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5">
                                                            <span className="text-[8px] group-open:rotate-90 transition-transform">▶</span>
                                                            TP{tp.level} Reasoning
                                                        </summary>
                                                        <div className="mt-1.5 pl-3 space-y-1 text-zinc-400 border-l border-emerald-500/20">
                                                            <div><span className="text-cyan-400">Indicators:</span> {tp.reasoning.indicatorBasis}</div>
                                                            <div><span className="text-amber-400">Volatility:</span> {tp.reasoning.volatilityFactor}</div>
                                                            <div><span className="text-violet-400">Pattern:</span> {tp.reasoning.patternMemoryInfluence}</div>
                                                            <div><span className="text-emerald-400">Adjustments:</span> {tp.reasoning.aiAdjustments}</div>
                                                        </div>
                                                    </details>
                                                ))
                                            ) : (
                                                /* Backward Compatibility for old fixed reasoning */
                                                <>
                                                    {['tp1', 'tp2', 'tp3'].map(key => {
                                                        const r = (levelProbabilities as any).reasoning?.[key];
                                                        if (!r) return null;
                                                        return (
                                                            <details key={key} className="group">
                                                                <summary className="cursor-pointer text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5">
                                                                    <span className="text-[8px] group-open:rotate-90 transition-transform">▶</span>
                                                                    {key.toUpperCase()} Reasoning
                                                                </summary>
                                                                <div className="mt-1.5 pl-3 space-y-1 text-zinc-400 border-l border-emerald-500/20">
                                                                    <div><span className="text-cyan-400">Indicators:</span> {r.indicatorBasis}</div>
                                                                    <div><span className="text-amber-400">Volatility:</span> {r.volatilityFactor}</div>
                                                                    <div><span className="text-violet-400">Pattern:</span> {r.patternMemoryInfluence}</div>
                                                                    <div><span className="text-emerald-400">Adjustments:</span> {r.aiAdjustments}</div>
                                                                </div>
                                                            </details>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Placeholder when no data */
                                <div className="flex flex-col items-center justify-center py-8 px-4 rounded-xl bg-white/[0.02] border border-dashed border-white/10">
                                    {isCalculating ? (
                                        <>
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                            <span className="text-xs text-purple-300/70 font-medium">AI Calculating Probabilities...</span>
                                            <p className="text-[10px] text-zinc-500 mt-2 text-center max-w-[180px]">
                                                The moderator is currently resolving the debate and estimating level success rates.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-2xl mb-2 opacity-20">🎯</div>
                                            <span className="text-xs text-zinc-500 font-medium">No Analysis Active</span>
                                            <p className="text-[10px] text-zinc-600 mt-1 text-center font-normal">
                                                Probabilities appear during live trade analysis.
                                            </p>
                                        </>
                                    )}
                                </div>
                            )}
                        </SectionCard>

                        {/* Footer Tip */}
                        <div className="text-center py-3">
                            <div className="text-[10px] text-zinc-600">
                                💡 Enable Hybrid Intelligence to see live results
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backdrop for mobile */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden transition-opacity duration-300"
                    onClick={handleClose}
                />
            )}
        </>
    );
};

export default AdvancedAnalyticsSidePanel;

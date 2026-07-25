/**
 * AdvancedAnalyticsSidePanel - Modern collapsible side panel for chat area
 * Shows Underperformer Feedback, Monte Carlo, and Live Backtesting results
 * Redesigned with ChatGPT/Gemini-inspired aesthetics
 *
 * Monte Carlo, Live Backtest, and AI Probability displays have been
 * extracted into dedicated sub-components (see ./MonteCarloPanel,
 * ./BacktestResults, ./ProbabilityPanel). Shared helpers and result
 * types live in ./analyticsShared.
 */

import React, { useState, useEffect } from 'react';
import { AIProvider, LevelProbabilities } from '../../types';
import { getUnderperformerStatus, generateUnderperformerFeedback } from '../../services/learning/UnderperformerFeedbackService';
import {
    SectionCard,
    StatPill,
    MonteCarloResult,
    LiveBacktestResult,
    LabeledMonteCarloResult,
} from './analyticsShared';
import MonteCarloPanel from './MonteCarloPanel';
import BacktestResults from './BacktestResults';
import ProbabilityPanel from './ProbabilityPanel';

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
                        <MonteCarloPanel
                            monteCarloResult={monteCarloResult}
                            perAIMonteCarloResults={perAIMonteCarloResults}
                            isCalculating={isCalculating}
                        />

                        {/* Live Backtest */}
                        <BacktestResults
                            backtestResult={backtestResult}
                            isCalculating={isCalculating}
                        />

                        {/* Entry Timing score */}
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
                        <ProbabilityPanel
                            levelProbabilities={levelProbabilities}
                            isCalculating={isCalculating}
                            selectedCoinName={selectedCoinName}
                            selectedMessageId={selectedMessageId}
                            onClearSelection={onClearSelection}
                            onRegenerateProbabilities={onRegenerateProbabilities}
                        />

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

/**
 * ProbabilityPanel - AI probability estimation display.
 *
 * Renders SL/TP hit probability estimates with collapsible AI reasoning.
 * Owns its own AI/Algo mode selection state (previously held by the parent),
 * syncing it from `levelProbabilities.calculationMode` when that changes.
 *
 * Extracted from AdvancedAnalyticsSidePanel.tsx.
 */

import React, { useEffect, useState } from 'react';
import { LevelProbabilities } from '../../types';
import { SectionCard } from './analyticsShared';

interface ProbabilityPanelProps {
    levelProbabilities?: LevelProbabilities | null;
    isCalculating?: boolean;
    selectedCoinName?: string | null;
    selectedMessageId?: string | null;
    onClearSelection?: () => void;
    onRegenerateProbabilities?: (mode: 'AI' | 'Algo', messageId?: string) => void;
}

const ProbabilityPanel: React.FC<ProbabilityPanelProps> = ({
    levelProbabilities,
    isCalculating = false,
    selectedCoinName,
    selectedMessageId,
    onClearSelection,
    onRegenerateProbabilities,
}) => {
    const [probMode, setProbMode] = useState<'AI' | 'Algo'>('AI');

    // Sync local mode state if the data already has a mode
    useEffect(() => {
        if (levelProbabilities?.calculationMode) {
            setProbMode(levelProbabilities.calculationMode);
        }
    }, [levelProbabilities?.calculationMode]);

    const status: 'active' | 'calculating' | 'waiting' = levelProbabilities
        ? 'active'
        : isCalculating
            ? 'calculating'
            : 'waiting';

    const statusLabel = isCalculating ? 'Thinking...' : undefined;

    return (
        <SectionCard
            title="AI Probability"
            subtitle="SL/TP hit estimation with reasoning"
            icon=""
            accentColor="purple"
            status={status}
            statusLabel={statusLabel}
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
                        <option value="AI"> AI</option>
                        <option value="Algo"> Algo</option>
                    </select>

                    {/* Regenerate Button */}
                    <button
                        onClick={() => onRegenerateProbabilities?.(probMode, selectedMessageId!)}
                        disabled={isCalculating || !selectedMessageId}
                        className={`p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-purple-400 transition-all ${isCalculating ? 'animate-spin opacity-50' : ''}`}
                        title="Regenerate Probability Analysis"
                    >
                        
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
                                 Viewing: <span className="font-bold text-purple-200">{selectedCoinName}</span>
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
                        <span className="text-[10px] text-purple-400 font-medium block mb-2"> AI Reasoning</span>
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
                            <div className="text-2xl mb-2 opacity-20"></div>
                            <span className="text-xs text-zinc-500 font-medium">No Analysis Active</span>
                            <p className="text-[10px] text-zinc-600 mt-1 text-center font-normal">
                                Probabilities appear during live trade analysis.
                            </p>
                        </>
                    )}
                </div>
            )}
        </SectionCard>
    );
};

export default ProbabilityPanel;

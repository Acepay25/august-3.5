/**
 * ConfluenceScoreIndicator - Multi-Timeframe Confluence Score Display
 * Shows alignment across timeframes with expandable signal details
 */

import React, { useState } from 'react';
import { ChevronDownIcon } from '../shared/Icons';

export interface ConfluenceData {
    score: number;  // 0-100
    direction: 'bullish' | 'bearish' | 'neutral';
    strength: 'strong' | 'moderate' | 'weak';
    alignedSignals: string[];
    conflictingSignals: string[];
    timeframeCount: number;
}

interface ConfluenceScoreIndicatorProps {
    data: ConfluenceData;
}

const ConfluenceScoreIndicator: React.FC<ConfluenceScoreIndicatorProps> = ({ data }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const { score, direction, strength, alignedSignals, conflictingSignals, timeframeCount } = data;

    // Color based on direction
    const getDirectionColor = () => {
        if (direction === 'bullish') return { text: 'text-emerald-400', bg: 'bg-emerald-500', border: 'border-emerald-500/30' };
        if (direction === 'bearish') return { text: 'text-rose-400', bg: 'bg-rose-500', border: 'border-rose-500/30' };
        return { text: 'text-zinc-400', bg: 'bg-zinc-500', border: 'border-zinc-500/30' };
    };

    const colors = getDirectionColor();

    // Score color (green = high alignment, red = low)
    const getScoreColor = () => {
        if (score >= 70) return 'text-emerald-400';
        if (score >= 40) return 'text-yellow-400';
        return 'text-rose-400';
    };

    // Calculate how many timeframes align
    const alignedCount = Math.round((score / 100) * timeframeCount);

    return (
        <div className={`rounded-xl border ${colors.border} bg-black/30 backdrop-blur-sm overflow-hidden transition-all`}>
            {/* Header - Always Visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {/* Score Circle */}
                    <div className="relative w-12 h-12">
                        <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                            {/* Background circle */}
                            <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                className="text-zinc-800"
                            />
                            {/* Score arc */}
                            <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeDasharray={`${score * 0.88} 100`}
                                strokeLinecap="round"
                                className={getScoreColor()}
                            />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-xs font-black ${getScoreColor()}`}>
                            {score}
                        </span>
                    </div>

                    {/* Labels */}
                    <div className="text-left">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Confluence</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${colors.text} bg-white/5`}>
                                {direction}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-sm font-bold ${colors.text}`}>
                                {alignedCount}/{timeframeCount} TFs Aligned
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${strength === 'strong' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' :
                                    strength === 'moderate' ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' :
                                        'border-zinc-500/50 text-zinc-400 bg-zinc-500/10'
                                } font-bold uppercase tracking-wider`}>
                                {strength}
                            </span>
                        </div>
                    </div>
                </div>

                <ChevronDownIcon className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="px-3 pb-3 border-t border-white/5 animate-fade-in">
                    {/* Aligned Signals */}
                    {alignedSignals.length > 0 && (
                        <div className="mt-3">
                            <span className="text-[9px] uppercase tracking-widest text-emerald-600 font-bold block mb-1.5">
                                ✅ Aligned Signals
                            </span>
                            <div className="space-y-1">
                                {alignedSignals.slice(0, 6).map((signal, idx) => (
                                    <div key={idx} className="text-[10px] text-emerald-300/80 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/10">
                                        {signal}
                                    </div>
                                ))}
                                {alignedSignals.length > 6 && (
                                    <div className="text-[9px] text-emerald-400/50 italic">
                                        +{alignedSignals.length - 6} more signals
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Conflicting Signals */}
                    {conflictingSignals.length > 0 && (
                        <div className="mt-3">
                            <span className="text-[9px] uppercase tracking-widest text-rose-600 font-bold block mb-1.5">
                                ⚠️ Conflicting Signals
                            </span>
                            <div className="space-y-1">
                                {conflictingSignals.slice(0, 4).map((signal, idx) => (
                                    <div key={idx} className="text-[10px] text-rose-300/80 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/10">
                                        {signal}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty state */}
                    {alignedSignals.length === 0 && conflictingSignals.length === 0 && (
                        <div className="mt-3 text-center text-zinc-600 text-xs py-2">
                            No detailed signal data available
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(ConfluenceScoreIndicator);

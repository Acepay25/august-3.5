// MistakeWarningBanner.tsx
// Dismissible alert that warns users about recurring mistake patterns

import React, { useState, useEffect } from 'react';
import { LoggedTrade, TradingWeaknesses } from '../../../types';
import { getTradingWeaknesses } from '../../services/learning/MistakePatternService';

interface MistakeWarningBannerProps {
    tradeLog: LoggedTrade[];
    currentCoin?: string;
    currentDirection?: 'Long' | 'Short' | 'Neutral';
    onDismiss?: () => void;
}

const MistakeWarningBanner: React.FC<MistakeWarningBannerProps> = ({
    tradeLog,
    currentCoin,
    currentDirection,
    onDismiss
}) => {
    const [isVisible, setIsVisible] = useState(true);
    const [weaknesses, setWeaknesses] = useState<TradingWeaknesses | null>(null);

    useEffect(() => {
        if (tradeLog && tradeLog.length > 0) {
            const result = getTradingWeaknesses(tradeLog);
            setWeaknesses(result);
        }
    }, [tradeLog]);

    // No data or no warnings
    if (!weaknesses || (weaknesses.mistakes.length === 0 && weaknesses.worstPerformingSetups.length === 0)) {
        return null;
    }

    // Check if current setup matches a bad performer
    const matchingSetup = currentCoin && currentDirection !== 'Neutral'
        ? weaknesses.worstPerformingSetups.find(
            s => s.setup.toLowerCase().includes(currentCoin.toLowerCase())
        )
        : null;

    // Get top 2 high-severity mistakes
    const topMistakes = weaknesses.mistakes
        .filter(m => m.severity === 'high' || m.severity === 'medium')
        .slice(0, 2);

    // Nothing relevant to show
    if (!matchingSetup && topMistakes.length === 0) {
        return null;
    }

    const handleDismiss = () => {
        setIsVisible(false);
        onDismiss?.();
    };

    if (!isVisible) return null;

    return (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-amber-900/30 to-rose-900/20 border border-amber-500/30 p-4 mb-4 shadow-lg animate-fade-in">
            {/* Dismiss Button */}
            <button
                onClick={handleDismiss}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-zinc-400 hover:text-white transition-colors"
                aria-label="Dismiss warning"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">⚠️</span>
                <span className="text-sm font-bold text-amber-400 uppercase tracking-wide">
                    Personal Trading Alert
                </span>
            </div>

            {/* Setup Warning */}
            {matchingSetup && (
                <div className="mb-3 p-2 rounded-lg bg-rose-950/40 border border-rose-500/20">
                    <div className="flex items-center gap-2">
                        <span className="text-rose-400 font-bold text-sm">
                            ❌ {matchingSetup.setup}
                        </span>
                        <span className="text-xs text-zinc-400">
                            only {matchingSetup.winRate}% win rate ({matchingSetup.count} trades)
                        </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">
                        Consider extra confirmation or skip this setup type.
                    </p>
                </div>
            )}

            {/* Recurring Mistakes */}
            {topMistakes.length > 0 && (
                <div className="space-y-1.5">
                    <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">
                        Recurring Mistakes to Watch:
                    </span>
                    {topMistakes.map((mistake, i) => (
                        <div
                            key={i}
                            className={`flex items-center gap-2 text-xs ${mistake.severity === 'high' ? 'text-rose-400' : 'text-amber-400'
                                }`}
                        >
                            <span>{mistake.severity === 'high' ? '🔴' : '🟡'}</span>
                            <span>{mistake.description}</span>
                            <span className="text-zinc-600">({mistake.occurrences}x)</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MistakeWarningBanner;

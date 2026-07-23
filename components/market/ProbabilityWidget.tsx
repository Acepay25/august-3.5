// ProbabilityWidget.tsx
// Visual gauge showing historical win rate based on confidence calibration

import React from 'react';
import { ConfidenceCalibration } from '../../types';
import { getCalibratedWinRateWithDecay, getSampleSize, ConfidenceLevel } from '../../services/validation/ConfidenceCalibrationService';

interface ProbabilityWidgetProps {
    confidence: ConfidenceLevel;
    calibration?: ConfidenceCalibration;
    coin?: string;
    direction?: 'Long' | 'Short' | 'Neutral';
}

const ProbabilityWidget: React.FC<ProbabilityWidgetProps> = ({
    confidence,
    calibration,
    coin,
    direction
}) => {
    const winRate = getCalibratedWinRateWithDecay(calibration, confidence);
    const sampleSize = getSampleSize(calibration, confidence);

    // Not enough data yet
    if (winRate === null || sampleSize < 3) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/50 border border-white/5">
                <div className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse"></div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Calibrating... ({sampleSize}/3 trades)
                </span>
            </div>
        );
    }

    // Determine color based on win rate
    const getColorScheme = (rate: number) => {
        if (rate >= 60) return {
            bg: 'bg-emerald-500/15',
            border: 'border-emerald-400/30',
            text: 'text-emerald-400',
            glow: 'shadow-emerald-500/20',
            barBg: 'bg-emerald-500',
            label: 'FAVORABLE'
        };
        if (rate >= 45) return {
            bg: 'bg-yellow-500/15',
            border: 'border-yellow-400/30',
            text: 'text-yellow-400',
            glow: 'shadow-yellow-500/20',
            barBg: 'bg-yellow-500',
            label: 'NEUTRAL'
        };
        return {
            bg: 'bg-rose-500/15',
            border: 'border-rose-400/30',
            text: 'text-rose-400',
            glow: 'shadow-rose-500/20',
            barBg: 'bg-rose-500',
            label: 'CAUTION'
        };
    };

    const colors = getColorScheme(winRate);

    return (
        <div className={`relative overflow-hidden rounded-xl ${colors.bg} border ${colors.border} p-3 shadow-lg ${colors.glow}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-base">📊</span>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">
                        Historical Accuracy
                    </span>
                </div>
                <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
                    {colors.label}
                </span>
            </div>

            {/* Main Win Rate Display */}
            <div className="flex items-baseline gap-1 mb-2">
                <span className={`text-3xl font-mono font-black ${colors.text}`}>
                    {winRate}%
                </span>
                <span className="text-xs text-zinc-500">win rate</span>
            </div>

            {/* Progress Bar */}
            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden mb-2">
                <div
                    className={`h-full ${colors.barBg} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(winRate, 100)}%` }}
                />
            </div>

            {/* Footer Stats */}
            <div className="flex items-center justify-between text-[9px] text-zinc-500">
                <span>Based on {sampleSize} "{confidence}" trades</span>
                {coin && direction && direction !== 'Neutral' && (
                    <span className="text-zinc-600">
                        {coin} {direction}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ProbabilityWidget;

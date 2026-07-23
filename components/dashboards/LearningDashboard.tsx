
import React, { useMemo } from 'react';
import { LoggedTrade } from '../../../types';
import { computeLearningProfile, PersonalizedLearningProfile } from '../../services/learning/SelfLearningService';

interface LearningDashboardProps {
    trades: LoggedTrade[];
}

// Stat card component
const StatCard: React.FC<{
    title: string;
    items: { name: string; value: string; subtext?: string; color?: string }[];
    emptyText?: string;
}> = ({ title, items, emptyText = 'Not enough data' }) => (
    <div className="bg-zinc-900/50 rounded-xl border border-white/5 p-3 sm:p-4">
        <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">{title}</h4>
        {items.length > 0 ? (
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-zinc-300 truncate pr-2">{item.name}</span>
                        <div className="text-right">
                            <span className={`text-sm font-bold ${item.color || 'text-white'}`}>{item.value}</span>
                            {item.subtext && <span className="text-[10px] text-zinc-500 ml-1">{item.subtext}</span>}
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-xs text-zinc-600 italic">{emptyText}</p>
        )}
    </div>
);

// Progress bar for calibration
const CalibrationBar: React.FC<{ label: string; actual: number; expected: number; count: number }> = ({
    label, actual, expected, count
}) => {
    const diff = actual - expected;
    const color = diff >= 5 ? 'bg-emerald-500' : diff <= -10 ? 'bg-red-500' : 'bg-yellow-500';
    const status = diff >= 5 ? 'Underconfident' : diff <= -10 ? 'Overconfident' : 'Calibrated';

    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-500">n={count}</span>
            </div>
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={`absolute h-full ${color} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, actual)}%` }}
                />
                {/* Expected marker */}
                <div
                    className="absolute h-full w-0.5 bg-white/30"
                    style={{ left: `${expected}%` }}
                />
            </div>
            <div className="flex justify-between text-[10px]">
                <span className={diff >= 5 ? 'text-emerald-400' : diff <= -10 ? 'text-red-400' : 'text-yellow-400'}>
                    {status}
                </span>
                <span className="text-zinc-500">
                    Actual: {actual}% | Expected: ~{expected}%
                </span>
            </div>
        </div>
    );
};

export const LearningDashboard: React.FC<LearningDashboardProps> = ({ trades }) => {
    const profile = useMemo(() => computeLearningProfile(trades), [trades]);

    const getWinRateColor = (rate: number) => {
        if (rate >= 65) return 'text-emerald-400';
        if (rate >= 50) return 'text-yellow-400';
        return 'text-red-400';
    };

    if (profile.totalAnalyzedTrades < 3) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="text-4xl mb-4">🧠</div>
                <h3 className="text-lg font-bold text-zinc-300 mb-2">Building Your Profile</h3>
                <p className="text-sm text-zinc-500 max-w-xs">
                    Log at least 3 trades (WIN or LOSS) to start seeing personalized AI learnings.
                </p>
                <p className="text-xs text-zinc-600 mt-4">
                    Current: {profile.totalAnalyzedTrades} / 3 trades
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="text-center pb-3 sm:pb-4 border-b border-white/5">
                <h2 className="text-base sm:text-lg font-bold text-cyan-400 mb-1">AI Learning Profile</h2>
                <p className="text-[10px] sm:text-xs text-zinc-500">
                    Based on {profile.totalAnalyzedTrades} analyzed trades
                </p>
            </div>

            {/* Overall Performance */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-gradient-to-br from-cyan-950/50 to-zinc-900 rounded-xl p-3 sm:p-4 border border-cyan-500/20">
                    <p className="text-[9px] sm:text-xs text-cyan-400/70 uppercase tracking-wider mb-1">Win Rate</p>
                    <p className={`text-2xl sm:text-3xl font-black ${getWinRateColor(profile.overallWinRate)}`}>
                        {profile.overallWinRate}%
                    </p>
                </div>
                <div className="bg-gradient-to-br from-purple-950/50 to-zinc-900 rounded-xl p-3 sm:p-4 border border-purple-500/20">
                    <p className="text-[9px] sm:text-xs text-purple-400/70 uppercase tracking-wider mb-1">Trades</p>
                    <p className="text-2xl sm:text-3xl font-black text-white">
                        {profile.totalAnalyzedTrades}
                    </p>
                </div>
            </div>

            {/* Strengths & Weaknesses Grid */}
            <div className="grid grid-cols-1 gap-3 sm:gap-4">
                {/* Best Coins */}
                <StatCard
                    title="🏆 Best Coins"
                    items={profile.bestCoins.slice(0, 4).map(c => ({
                        name: c.coin,
                        value: `${c.winRate}%`,
                        subtext: `(n=${c.count})`,
                        color: getWinRateColor(c.winRate)
                    }))}
                />

                {/* Best Patterns */}
                <StatCard
                    title="📈 Best Patterns"
                    items={profile.bestPatterns.slice(0, 4).map(p => ({
                        name: p.pattern,
                        value: `${p.winRate}%`,
                        subtext: `(n=${p.count})`,
                        color: getWinRateColor(p.winRate)
                    }))}
                />

                {/* Best Directions */}
                <StatCard
                    title="↗️ Direction Performance"
                    items={profile.bestDirections.map(d => ({
                        name: d.direction,
                        value: `${d.winRate}%`,
                        subtext: `(n=${d.count})`,
                        color: getWinRateColor(d.winRate)
                    }))}
                />

                {/* Market Regimes */}
                <StatCard
                    title="📊 Regime Performance"
                    items={profile.bestRegimes.map(r => ({
                        name: r.regime,
                        value: `${r.winRate}%`,
                        subtext: `(n=${r.count})`,
                        color: getWinRateColor(r.winRate)
                    }))}
                />
            </div>

            {/* Setups to Avoid */}
            {profile.worstSetups.length > 0 && (
                <div className="bg-red-950/20 rounded-xl border border-red-500/20 p-3 sm:p-4">
                    <h4 className="text-[10px] sm:text-xs font-bold text-red-400 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                        <span>⚠️</span> Setups to Avoid
                    </h4>
                    <div className="space-y-2">
                        {profile.worstSetups.slice(0, 4).map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-zinc-400 truncate pr-2">{s.description}</span>
                                <span className="text-red-400 font-bold whitespace-nowrap">{s.winRate}% WR</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Confidence Calibration */}
            {profile.confidenceAccuracy.length > 0 && (
                <div className="bg-zinc-900/50 rounded-xl border border-white/5 p-3 sm:p-4">
                    <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 sm:mb-4">
                        🎯 Confidence Calibration
                    </h4>
                    <div className="space-y-4">
                        {profile.confidenceAccuracy
                            .filter(c => c.count >= 3)
                            .map((c, i) => {
                                const expected = c.level === 'High' ? 70 : c.level === 'Medium' ? 55 : 40;
                                return (
                                    <CalibrationBar
                                        key={i}
                                        label={`${c.level} Confidence`}
                                        actual={c.winRate}
                                        expected={expected}
                                        count={c.count}
                                    />
                                );
                            })}
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-4">
                        * White line = expected win rate for that confidence level
                    </p>
                </div>
            )}

            {/* Last Updated */}
            <p className="text-[10px] text-zinc-600 text-center">
                Last updated: {new Date(profile.lastUpdated).toLocaleString()}
            </p>
        </div>
    );
};

export default LearningDashboard;

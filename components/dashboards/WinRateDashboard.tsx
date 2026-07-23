/**
 * WinRateDashboard - Comprehensive Trading Analytics Dashboard
 * Features real charts using recharts library
 */

import React, { useMemo, useState } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, Cell
} from 'recharts';
import { LoggedTrade } from '../../../types';
import {
    calculateOverallStats,
    calculatePerformanceByConfidence,
    calculatePerformanceByCoin,
    calculatePerformanceByFamily,
    calculateStreakData,
    calculateRecentTrends,
    OverallStats,
    ConfidenceStats,
    CoinStats,
    FamilyStats,
    StreakData,
    TrendDataPoint
} from '../../../utils/dashboardUtils';

interface WinRateDashboardProps {
    trades: LoggedTrade[];
}

// Color constants
const COLORS = {
    cyan: '#06b6d4',
    emerald: '#10b981',
    rose: '#f43f5e',
    yellow: '#eab308',
    orange: '#f97316',
    purple: '#a855f7',
    blue: '#3b82f6',
    zinc: '#71717a'
};

const FAMILY_COLORS: Record<string, string> = {
    'Family A': COLORS.rose,
    'Family B': COLORS.emerald,
    'Family C': COLORS.blue,
    'Omega': COLORS.purple
};

const CONFIDENCE_COLORS: Record<string, string> = {
    'High': COLORS.emerald,
    'Medium': COLORS.yellow,
    'Low': COLORS.orange,
    'Avoid': COLORS.rose
};

// Custom tooltip for charts
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 shadow-xl">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <p key={index} className="text-sm font-bold" style={{ color: entry.color }}>
                        {entry.name}: {entry.value}{entry.name === 'winRate' ? '%' : ''}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

// Date range presets
const DATE_PRESETS = [
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
    { label: 'All', days: 0 }
];

const WinRateDashboard: React.FC<WinRateDashboardProps> = ({ trades }) => {
    // Date range state
    const [selectedPreset, setSelectedPreset] = useState<number>(30); // Default 30 days
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
    const [isCustomRange, setIsCustomRange] = useState(false);

    // Filter trades by date range
    const filteredTrades = useMemo(() => {
        if (isCustomRange && customStartDate && customEndDate) {
            const start = new Date(customStartDate);
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999); // Include entire end day
            return trades.filter(t => {
                const tradeDate = new Date(t.timestamp);
                return tradeDate >= start && tradeDate <= end;
            });
        } else if (selectedPreset === 0) {
            return trades; // All time
        } else {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - selectedPreset);
            return trades.filter(t => new Date(t.timestamp) >= cutoffDate);
        }
    }, [trades, selectedPreset, isCustomRange, customStartDate, customEndDate]);

    // Calculate all stats using filtered trades
    const overallStats = useMemo(() => calculateOverallStats(filteredTrades), [filteredTrades]);
    const confidenceStats = useMemo(() => calculatePerformanceByConfidence(filteredTrades), [filteredTrades]);
    const coinStats = useMemo(() => calculatePerformanceByCoin(filteredTrades), [filteredTrades]);
    const familyStats = useMemo(() => calculatePerformanceByFamily(filteredTrades), [filteredTrades]);
    const streakData = useMemo(() => calculateStreakData(filteredTrades), [filteredTrades]);
    const trendData = useMemo(() => calculateRecentTrends(filteredTrades, selectedPreset || 30), [filteredTrades, selectedPreset]);

    // Prepare chart data
    const confidenceChartData = confidenceStats.filter(s => s.total > 0);
    const familyChartData = familyStats.filter(s => s.total > 0);
    const topCoins = coinStats.slice(0, 5);

    const handlePresetClick = (days: number) => {
        setSelectedPreset(days);
        setIsCustomRange(false);
        setCustomStartDate('');
        setCustomEndDate('');
    };

    // Empty state
    if (trades.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-4 p-8">
                <div className="w-20 h-20 rounded-full bg-zinc-800/50 flex items-center justify-center border border-white/5 text-3xl">
                    📊
                </div>
                <p className="font-medium text-center">No completed trades yet.<br />Log some wins or losses to see your analytics.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-transparent p-3 sm:p-4 md:p-5 space-y-3 sm:space-y-5 overflow-y-auto">
            {/* Header with Date Range Selector */}
            <div className="flex flex-col gap-2 sm:gap-3 border-b border-white/5 pb-3 sm:pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-1 h-6 sm:h-8 bg-cyan-500 rounded-full shadow-[0_0_10px_#06b6d4]"></div>
                        <h2 className="text-base sm:text-xl font-black text-white uppercase tracking-wide">Analytics</h2>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">
                        {filteredTrades.length} trades
                    </span>
                </div>

                {/* Date Range Controls */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2">
                    {/* Preset Buttons */}
                    <div className="flex gap-1 bg-zinc-900/50 rounded-lg p-1 border border-white/5 w-full sm:w-auto">
                        {DATE_PRESETS.map(preset => (
                            <button
                                key={preset.days}
                                onClick={() => handlePresetClick(preset.days)}
                                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${!isCustomRange && selectedPreset === preset.days
                                    ? 'bg-cyan-500 text-white shadow-md'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>

                    {/* Custom Date Range */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => {
                                setCustomStartDate(e.target.value);
                                if (e.target.value && customEndDate) setIsCustomRange(true);
                            }}
                            className="flex-1 sm:flex-none px-2 py-1 text-[10px] font-mono bg-zinc-900/50 border border-white/10 rounded-md text-zinc-300 focus:outline-none focus:border-cyan-500/50"
                        />
                        <span className="text-zinc-600 text-[10px]">to</span>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => {
                                setCustomEndDate(e.target.value);
                                if (customStartDate && e.target.value) setIsCustomRange(true);
                            }}
                            className="flex-1 sm:flex-none px-2 py-1 text-[10px] font-mono bg-zinc-900/50 border border-white/10 rounded-md text-zinc-300 focus:outline-none focus:border-cyan-500/50"
                        />
                    </div>
                </div>
            </div>

            {/* Top Stats Row */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {/* Win Rate */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50 text-center">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Win Rate</div>
                    <div className={`text-xl sm:text-3xl font-black ${overallStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {overallStats.winRate}%
                    </div>
                </div>

                {/* Total Trades */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50 text-center">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Trades</div>
                    <div className="text-xl sm:text-3xl font-black text-white">{overallStats.totalTrades}</div>
                </div>

                {/* Net PnL */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50 text-center relative overflow-hidden">
                    {overallStats.totalPnL !== 0 && (
                        <div className={`absolute top-0 left-0 w-full h-1 ${overallStats.totalPnL > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                    )}
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Net PnL</div>
                    <div className={`text-lg sm:text-2xl font-mono font-black ${overallStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {overallStats.totalPnL >= 0 ? '+' : ''}{overallStats.totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </div>
                </div>

                {/* Profit Factor */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50 text-center">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Profit Factor</div>
                    <div className={`text-xl sm:text-3xl font-black ${overallStats.profitFactor >= 1.5 ? 'text-cyan-400' : overallStats.profitFactor >= 1 ? 'text-yellow-400' : 'text-rose-400'}`}>
                        {overallStats.profitFactor >= 999 ? '∞' : `${overallStats.profitFactor}x`}
                    </div>
                </div>
            </div>

            {/* Win Rate Trend Chart */}
            <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50">
                <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2 sm:mb-3">Win Rate Trend</div>
                {trendData.length > 1 ? (
                    <div className="h-32">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendData}>
                                <defs>
                                    <linearGradient id="winRateGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.4} />
                                        <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} width={25} />
                                <Tooltip content={<CustomTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="winRate"
                                    stroke={COLORS.cyan}
                                    strokeWidth={2}
                                    fill="url(#winRateGradient)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-32 flex items-center justify-center text-zinc-600 text-sm">
                        Need more data to show trends
                    </div>
                )}
            </div>

            {/* Performance by Confidence */}
            <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50">
                <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2 sm:mb-3">By Confidence</div>
                {confidenceChartData.length > 0 ? (
                    <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={confidenceChartData} layout="vertical">
                                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fill: '#71717a' }} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="level" tick={{ fontSize: 11, fill: '#a1a1aa', fontWeight: 'bold' }} axisLine={false} tickLine={false} width={60} />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="winRate" radius={[0, 6, 6, 0]} barSize={20}>
                                    {confidenceChartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={CONFIDENCE_COLORS[entry.level]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-24 flex items-center justify-center text-zinc-600 text-sm">No data available</div>
                )}
                {/* Legend */}
                <div className="flex flex-wrap justify-center gap-4 mt-2 pt-2 border-t border-white/5">
                    {confidenceStats.map(s => (
                        <div key={s.level} className="text-[10px] text-zinc-500">
                            <span className="font-bold" style={{ color: CONFIDENCE_COLORS[s.level] }}>{s.level}</span>: {s.wins}W / {s.total}T
                        </div>
                    ))}
                </div>
            </div>

            {/* Pattern Family Performance */}
            <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50">
                <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2 sm:mb-3">Pattern Families</div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {familyStats.map(family => {
                        const color = FAMILY_COLORS[family.family] || COLORS.zinc;
                        return (
                            <div
                                key={family.family}
                                className="p-2 sm:p-3 rounded-xl border text-center transition-all"
                                style={{
                                    borderColor: `${color}30`,
                                    backgroundColor: `${color}10`
                                }}
                            >
                                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color }}>
                                    {family.family.replace('Family ', '')}
                                </span>
                                <span className="text-lg sm:text-xl font-black block" style={{ color }}>
                                    {family.total > 0 ? `${family.winRate}%` : '-'}
                                </span>
                                <span className="text-[8px] sm:text-[9px] opacity-60 text-zinc-400">
                                    {family.wins}W / {family.total}T
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Top Coins + Streaks */}
            <div className="grid grid-cols-1 gap-3 sm:gap-4">
                {/* Top Coins */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2 sm:mb-3">Top Coins</div>
                    {topCoins.length > 0 ? (
                        <div className="space-y-2">
                            {topCoins.map((coin, idx) => (
                                <div key={coin.coin} className="flex items-center justify-between p-2 bg-black/20 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-zinc-600 font-mono w-4">#{idx + 1}</span>
                                        <span className="font-bold text-sm text-white">{coin.coin}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className={`text-xs font-mono ${coin.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {coin.pnl >= 0 ? '+' : ''}{coin.pnl.toFixed(0)}
                                        </span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${coin.winRate >= 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                            {coin.winRate}%
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-zinc-600 text-sm py-4">No coin data yet</div>
                    )}
                </div>

                {/* Streaks */}
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-900/50">
                    <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2 sm:mb-3">Streaks</div>
                    <div className="space-y-3 sm:space-y-4">
                        {/* Current Streak */}
                        <div className="flex items-center justify-between p-3 rounded-lg" style={{
                            backgroundColor: streakData.currentStreak.type === 'win' ? `${COLORS.emerald}15` : streakData.currentStreak.type === 'loss' ? `${COLORS.rose}15` : `${COLORS.zinc}15`,
                            borderColor: streakData.currentStreak.type === 'win' ? `${COLORS.emerald}30` : streakData.currentStreak.type === 'loss' ? `${COLORS.rose}30` : `${COLORS.zinc}30`,
                            borderWidth: 1
                        }}>
                            <span className="text-xs text-zinc-400 uppercase tracking-wider">Current</span>
                            <span className={`text-lg font-black ${streakData.currentStreak.type === 'win' ? 'text-emerald-400' : streakData.currentStreak.type === 'loss' ? 'text-rose-400' : 'text-zinc-400'}`}>
                                {streakData.currentStreak.count > 0 ? (
                                    <>
                                        {streakData.currentStreak.type === 'win' ? '🔥' : '❄️'} {streakData.currentStreak.count} {streakData.currentStreak.type.toUpperCase()}S
                                    </>
                                ) : '-'}
                            </span>
                        </div>

                        {/* Best/Worst */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-center">
                                <span className="text-[9px] text-emerald-600 uppercase tracking-wider block mb-1">Best Win Streak</span>
                                <span className="text-2xl font-black text-emerald-400">{streakData.bestWinStreak}</span>
                            </div>
                            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-center">
                                <span className="text-[9px] text-rose-600 uppercase tracking-wider block mb-1">Worst Loss Streak</span>
                                <span className="text-2xl font-black text-rose-400">{streakData.worstLossStreak}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Avg Win/Loss */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center">
                    <div className="text-[9px] sm:text-[10px] text-emerald-600 uppercase font-bold tracking-widest mb-1">Avg Win</div>
                    <div className="text-base sm:text-xl font-mono font-bold text-emerald-400">
                        +{overallStats.avgWinSize.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </div>
                </div>
                <div className="glass-panel p-3 sm:p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-center">
                    <div className="text-[9px] sm:text-[10px] text-rose-600 uppercase font-bold tracking-widest mb-1">Avg Loss</div>
                    <div className="text-base sm:text-xl font-mono font-bold text-rose-400">
                        -{overallStats.avgLossSize.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(WinRateDashboard);

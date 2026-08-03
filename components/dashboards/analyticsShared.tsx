/**
 * Shared types and helper components for the Advanced Analytics side panel
 * and its extracted sub-components.
 *
 * These are co-located here (not in ../../types) because they describe the
 * analytics result shapes produced by the panel's callers and are only used
 * within the dashboards directory.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface MonteCarloResult {
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

export interface LiveBacktestResult {
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
export interface LabeledMonteCarloResult {
    provider: string;
    result: MonteCarloResult;
    isModeratorFinal?: boolean;
}

// ---------------------------------------------------------------------------
// Shared helper components
// ---------------------------------------------------------------------------

// Modern Section Card Component
export const SectionCard: React.FC<{
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
        <div className={`group relative rounded-2xl bg-gradient-to-b ${accentStyles[accentColor]} border transition-all duration-300`}>
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
export const StatPill: React.FC<{
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
        <div className="flex flex-col items-center p-3 rounded-xl bg-zinc-800 border border-white/10 hover:bg-zinc-700 transition-colors">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1">{label}</span>
            <span className={`${sizeStyles[size]} font-bold ${variantStyles[variant]} tracking-tight`}>{value}</span>
        </div>
    );
};

// Progress Bar Component
export const ProgressBar: React.FC<{
    value: number;
    successColor?: string;
    dangerColor?: string;
}> = ({ value, successColor = 'from-emerald-500 to-emerald-400', dangerColor = 'from-rose-500 to-rose-400' }) => {
    return (
        <div className="relative h-2 rounded-full overflow-hidden bg-zinc-800">
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

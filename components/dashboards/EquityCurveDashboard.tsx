/**
 * EquityCurveDashboard — cumulative P&L curve (in %) over the decided trade
 * log, with a max-drawdown readout.
 *
 * Unit policy matches journalAnalytics: percent-based (pnlPercent). Trades
 * without a percent (manual dollar-only wins) are excluded from the curve —
 * they still count toward win rate and streaks elsewhere.
 *
 * Status surface: P&L meaning would be lost in the monochrome remap, so the
 * root opts into .status-surface (emerald = net positive, rose = net negative).
 */

import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { LoggedTrade, TradeOutcome } from '../../types';

interface EquityCurveDashboardProps {
    trades: LoggedTrade[];
}

export const EquityCurveDashboard: React.FC<EquityCurveDashboardProps> = ({ trades }) => {
    const { points, maxDrawdown, totalPnl, counted } = useMemo(() => {
        const decided = trades
            .filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && typeof t.pnlPercent === 'number')
            .slice()
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        let cumulative = 0;
        let peak = 0;
        let worstDd = 0;
        const points = decided.map(t => {
            cumulative += t.pnlPercent as number;
            peak = Math.max(peak, cumulative);
            worstDd = Math.min(worstDd, cumulative - peak);
            return {
                label: new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                equity: Math.round(cumulative * 10) / 10,
                drawdown: Math.round((cumulative - peak) * 10) / 10,
            };
        });
        return { points, maxDrawdown: Math.round(worstDd * 10) / 10, totalPnl: Math.round(cumulative * 10) / 10, counted: decided.length };
    }, [trades]);

    if (counted === 0) return null;

    const pnlPositive = totalPnl >= 0;
    const accent = pnlPositive ? '#34d399' : '#fb7185';

    return (
        <div className="status-surface glass-panel p-3 sm:p-4 rounded-xl border border-white/5 bg-zinc-800 mb-3 sm:mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 sm:mb-3">
                <div className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Equity Curve (cumulative P&L %)</div>
                <div className="flex items-center gap-3 text-[10px] font-mono">
                    <span className={pnlPositive ? 'text-emerald-400' : 'text-rose-400'}>{pnlPositive ? '+' : ''}{totalPnl}%</span>
                    <span className="text-zinc-500">Max DD {maxDrawdown}%</span>
                    <span className="text-zinc-600">{counted} trade{counted === 1 ? '' : 's'}</span>
                </div>
            </div>
            <div className="h-48 sm:h-56">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <defs>
                            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={accent} stopOpacity={0.25} />
                                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={40} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={false} />
                        <Tooltip
                            contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                            labelStyle={{ color: '#a1a1aa' }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" />
                        <Area type="monotone" dataKey="equity" stroke={accent} strokeWidth={1.8} fill="url(#equityFill)" dot={false} name="Equity" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default React.memo(EquityCurveDashboard);

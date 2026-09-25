/**
 * The timeframe bar, lifted out of `TradingChart` so the Chat surface can
 * offer the same control over the same data.
 *
 * It reads `CHART_INTERVALS` and the per-user `trade_tf_bar_v1_<user>`
 * selection through the same helpers the chart uses, so the customizable set
 * is identical in both places and a choice made in one is the choice in the
 * other — not a second, parallel preference.
 */
import React, { useState } from 'react';
import { Check, Settings } from 'lucide-react';
import {
    CHART_INTERVALS,
    readTfBarSelection,
    writeTfBarSelection,
    type ChartInterval,
} from './TradingChart';

export interface TimeframeBarProps {
    interval: ChartInterval;
    onIntervalChange: (next: ChartInterval) => void;
    /** Rendered after the bar's own controls (the chart puts studies here). */
    children?: React.ReactNode;
}

const TimeframeBar: React.FC<TimeframeBarProps> = ({ interval, onIntervalChange, children }) => {
    const [open, setOpen] = useState(false);
    // The ACTIVE timeframe is always shown, whatever the saved set says.
    const bar = readTfBarSelection();
    const shownIntervals = CHART_INTERVALS.filter(tf => bar.includes(tf) || tf === interval);

    const toggle = (tf: ChartInterval): void => {
        const next = bar.includes(tf) ? bar.filter(x => x !== tf) : [...bar, tf];
        writeTfBarSelection(next);
        // Re-read rather than keep local state: the selection is persisted, so
        // another surface reading the same key must see it.
        setOpen(false);
    };

    return (
        <div className="relative flex shrink-0 flex-wrap items-center gap-0.5 border-b border-white/[0.06] px-2 py-1.5">
            {shownIntervals.map(tf => (
                <button
                    key={tf}
                    type="button"
                    onClick={() => onIntervalChange(tf)}
                    className={`rounded-control px-2 py-1 text-ui-dense font-semibold transition-colors ${
                        interval === tf ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                    }`}
                >
                    {tf}
                </button>
            ))}
            <button type="button" onClick={() => setOpen(v => !v)}
                aria-label="Customize timeframes" aria-expanded={open}
                title="Choose which timeframes show in this bar"
                className={`ml-0.5 flex h-6 w-6 items-center justify-center rounded-control transition-colors ${
                    open ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                }`}>
                <Settings className="h-3.5 w-3.5" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-20" aria-hidden onClick={() => setOpen(false)} />
                    {/* z-40, not the chart's z-30: this bar is also rendered
                        on the Chat surface, and the Chat composer sits at
                        z-[90]. The overlay that closes it is z-20 either
                        way; only the panel needed lifting. */}
                    <div className="absolute left-2 top-9 z-40 w-40 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="tf-picker">
                        <p className="px-2 py-1 text-ui-2xs uppercase tracking-widest text-zinc-600">Timeframes</p>
                        <div className="grid grid-cols-2 gap-0.5">
                            {CHART_INTERVALS.map(tf => {
                                const isShown = bar.includes(tf) || tf === interval;
                                return (
                                    <button key={tf} type="button" onClick={() => toggle(tf)} disabled={tf === interval}
                                        aria-pressed={isShown}
                                        title={tf === interval ? 'The current timeframe always shows' : undefined}
                                        className={`flex items-center justify-between rounded-lg px-2 py-1 text-ui-dense transition-colors hover:bg-white/[0.06] disabled:opacity-40 ${
                                            isShown ? 'text-zinc-100' : 'text-zinc-500'
                                        }`}>
                                        {tf}
                                        <span aria-hidden>{isShown ? <Check className="h-3 w-3 text-cyan-400" /> : null}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
            {children}
        </div>
    );
};

export default TimeframeBar;

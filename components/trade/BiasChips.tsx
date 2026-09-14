/**
 * BiasChips — the prototype's bias-pill row sitting right under the Chart AI
 * header: 1D regime, the chart timeframe's regime, and position vs session
 * VWAP. CODE-CALCULATED from the app's own klines (the regime math lives in
 * services/trade/regime — EMA/RSI/VWAP, pure + unit-tested), never model
 * prose; re-pulls on coin/timeframe change and every 60 s, and renders
 * NOTHING until both series arrive — a missing chip beats an invented one.
 */

import React, { useEffect, useState } from 'react';
import { fetchKlines } from '../../services/analysis/KlineService';
import { biasChips, type BiasChip } from '../../services/trade/regime';
import { toKlineInterval, type ChartInterval } from './TradingChart';

/** Matches the chart's REST refresh cadence — the regime moves slower than
 *  price, and the kline cache already absorbs most of this traffic. */
const REFRESH_MS = 60_000;

const TONE: Record<BiasChip['tone'], string> = {
    bull: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    bear: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    neutral: 'border-white/10 bg-white/[0.04] text-zinc-400',
    vwap: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
};

const BiasChips: React.FC<{ symbol: string; interval: ChartInterval }> = ({ symbol, interval }) => {
    const [chips, setChips] = useState<BiasChip[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        setChips(null);
        const load = async (): Promise<void> => {
            try {
                const [cur, day] = await Promise.all([
                    fetchKlines(symbol, toKlineInterval(interval), 200),
                    fetchKlines(symbol, '1d', 60),
                ]);
                if (!cancelled) setChips(biasChips(cur, interval, day));
            } catch { /* fetch failed — stay silent, retry on the next tick */ }
        };
        void load();
        const poll = window.setInterval(() => void load(), REFRESH_MS);
        return () => { cancelled = true; window.clearInterval(poll); };
    }, [symbol, interval]);
    if (!chips || chips.length === 0) return null;
    return (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-1 pt-3" data-testid="bias-chips">
            {chips.map(c => (
                <span key={c.text} title="Code-calculated from klines: EMA9/21 + RSI-14 trend, session VWAP"
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold ${TONE[c.tone]}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                    {c.text}
                </span>
            ))}
        </div>
    );
};

export default React.memo(BiasChips);

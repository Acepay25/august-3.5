import React, { useMemo } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import { extractSignalStrategyText, formatInvalidationLine, resolveLevelHitOdds, signalDirectionLabel } from '../../utils/analysisUtils';

interface TradingSignalCardProps {
    analysis: TradeAnalysis;
    debateTurns?: DebateTurn[];
    isLatest?: boolean;
    onReRun?: () => void;
    supplementMarkdown?: string;
    ensembleNote?: string;
}

const formatLevel = (value?: string): string => {
    if (!value) return '';
    const cleaned = value.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return value.replace(/^\$/, '');
    if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const directionChip = (direction?: string): string => {
    if (direction === 'Long') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400';
    if (direction === 'Short') return 'border-rose-500/30 bg-rose-500/15 text-rose-400';
    return 'border-white/10 bg-zinc-800 text-zinc-300';
};

const directionText = (direction?: string): string => {
    if (direction === 'Long') return 'font-semibold text-emerald-400';
    if (direction === 'Short') return 'font-semibold text-rose-400';
    return 'font-semibold text-zinc-50';
};

const confidenceColor = (confidence?: string): string => {
    if (confidence === 'High') return 'text-emerald-400';
    if (confidence === 'Medium') return 'text-amber-400';
    return 'text-rose-400';
};

const TradingSignalCard: React.FC<TradingSignalCardProps> = ({
    analysis,
    debateTurns,
    isLatest,
    onReRun,
    supplementMarkdown,
    ensembleNote,
}) => {
    const entry = analysis.entryPoints?.[0]?.price;
    const sl = analysis.stopLoss;
    const tps = (analysis.takeProfit ?? []).map(tp => tp.price).filter(Boolean);
    const rr = typeof analysis.rrRatio === 'number' ? analysis.rrRatio : undefined;
    const dirLabel = signalDirectionLabel(analysis.direction);
    const odds = useMemo(
        () => resolveLevelHitOdds(analysis, debateTurns),
        [analysis, debateTurns],
    );
    const slHit = odds.sl;
    const tpHit = (level: number): number | undefined => odds.tp[level - 1];
    const why = useMemo(
        () => extractSignalStrategyText(analysis, debateTurns),
        [debateTurns, analysis],
    );
    const invalidation = useMemo(() => formatInvalidationLine(analysis), [analysis]);

    return (
        <div className="status-surface overflow-hidden rounded-2xl border border-white/5 bg-zinc-900/80 shadow-lg">
            <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Trading signal</span>
                {analysis.direction && (
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${directionChip(analysis.direction)}`}>
                        {dirLabel}
                    </span>
                )}
                {analysis.confidence && (
                    <span className={`text-[11px] font-semibold ${confidenceColor(analysis.confidence)}`}>
                        {analysis.confidence}
                    </span>
                )}
                {isLatest && onReRun && (
                    <button
                        type="button"
                        onClick={onReRun}
                        className="ml-auto text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-cyan-400"
                        title="Adds a fresh analysis with the same prompt + chart; the old card is kept for comparison"
                    >
                        ↻ Regenerate
                    </button>
                )}
            </div>

            <div className="space-y-5 border-t border-white/5 px-4 py-4 sm:px-5">
                {(entry || sl || tps.length > 0 || rr !== undefined || analysis.direction) && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        {analysis.direction && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Direction</div>
                                <div className={`mt-1 text-lg font-semibold uppercase tracking-wide ${directionText(analysis.direction)}`}>
                                    {dirLabel}
                                </div>
                            </div>
                        )}
                        {entry && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Entry</div>
                                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{formatLevel(entry)}</div>
                            </div>
                        )}
                        {sl && (
                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Stop Loss</div>
                                    {slHit !== undefined && (
                                        <div className="text-[11px] font-bold tabular-nums text-rose-400">{slHit}% hit</div>
                                    )}
                                </div>
                                <div className="mt-1 text-lg font-semibold tabular-nums text-rose-400">{formatLevel(sl)}</div>
                            </div>
                        )}
                        {tps.length > 0 && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                    Take Profit{tps.length > 1 ? 's' : ''}
                                </div>
                                <div className="mt-1 space-y-1">
                                    {tps.slice(0, 3).map((tp, i) => (
                                        <div key={`tp-${i}`} className="flex items-baseline justify-between gap-2">
                                            <div className="text-lg font-semibold tabular-nums leading-tight text-emerald-400">
                                                <span className="mr-1.5 text-[10px] font-semibold text-emerald-400/70">TP{i + 1}</span>
                                                {formatLevel(tp)}
                                            </div>
                                            {tpHit(i + 1) !== undefined && (
                                                <span className="text-[11px] font-bold tabular-nums text-emerald-400">{tpHit(i + 1)}% hit</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {rr !== undefined && (
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">R:R</div>
                                <div className="mt-1 text-lg font-semibold tabular-nums text-cyan-400">1:{rr.toFixed(1)}</div>
                            </div>
                        )}
                    </div>
                )}

                {invalidation && (
                    <div>
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Invalidation</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{invalidation}</p>
                    </div>
                )}

                {why && (
                    <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Why</div>
                        <p className="text-[13px] leading-relaxed text-zinc-400">{why}</p>
                    </div>
                )}

                {supplementMarkdown && (
                    <div className="border-t border-white/5 pt-4">
                        <MarkdownContent content={supplementMarkdown} className="text-xs leading-6 text-zinc-400" />
                    </div>
                )}

                {ensembleNote && (
                    <p className="border-t border-white/5 pt-3 text-[11px] leading-relaxed text-zinc-500">{ensembleNote}</p>
                )}
            </div>
        </div>
    );
};

export default React.memo(TradingSignalCard);

import React, { useMemo } from 'react';
import { DebateTurn, TradeAnalysis, ConfidenceCalibration } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import ConsensusPanel from './ConsensusPanel';
import { explainSignalConfidence, extractSignalStrategyText, formatInvalidationLine, isNoTradeSignal, explainNoTrade, resolveLevelHitOdds, signalDirectionLabel } from '../../utils/analysisUtils';
import { getCalibrationDrift } from '../../services/validation/ConfidenceCalibrationService';

interface TradingSignalCardProps {
    analysis: TradeAnalysis;
    debateTurns?: DebateTurn[];
    isLatest?: boolean;
    onReRun?: () => void;
    supplementMarkdown?: string;
    ensembleNote?: string;
    calibration?: ConfidenceCalibration;
    bare?: boolean;
}

const parsePrice = (value?: string): number | undefined => {
    if (!value) return undefined;
    const n = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
};

const formatLevel = (value?: string): string => {
    if (!value) return '';
    const n = parsePrice(value);
    if (n === undefined) return value.replace(/^\$/, '');
    if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const resolveRr = (analysis: TradeAnalysis): number | undefined => {
    if (typeof analysis.rrRatio === 'number' && Number.isFinite(analysis.rrRatio)) {
        return analysis.rrRatio;
    }
    const entryN = parsePrice(analysis.entryPoints?.[0]?.price);
    const slN = parsePrice(analysis.stopLoss);
    const tpN = parsePrice(analysis.takeProfit?.[0]?.price);
    if (entryN === undefined || slN === undefined || tpN === undefined) return undefined;
    const risk = Math.abs(entryN - slN);
    if (risk <= 0) return undefined;
    return parseFloat((Math.abs(tpN - entryN) / risk).toFixed(2));
};

const directionChip = (direction?: string): string => {
    if (direction === 'Long') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400';
    if (direction === 'Short') return 'border-rose-500/30 bg-rose-500/15 text-rose-400';
    return 'border-white/10 bg-zinc-800 text-zinc-300';
};

const directionText = (direction?: string): string => {
    if (direction === 'Long') return 'text-emerald-400';
    if (direction === 'Short') return 'text-rose-400';
    return 'text-zinc-50';
};

const confidenceColor = (confidence?: string): string => {
    if (confidence === 'High') return 'text-emerald-400';
    if (confidence === 'Medium') return 'text-amber-400';
    return 'text-rose-400';
};

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</div>
        <div className="mt-1 truncate text-base font-semibold leading-tight sm:text-lg">{children}</div>
    </div>
);

interface LevelRow {
    label: string;
    price: string;
    hit?: number;
    tone: 'entry' | 'sl' | 'tp';
}

const priceTone = (tone: LevelRow['tone']): string => {
    if (tone === 'sl') return 'text-rose-400';
    if (tone === 'tp') return 'text-emerald-400';
    return 'text-zinc-100';
};

const hitTone = (tone: LevelRow['tone']): string => {
    if (tone === 'sl') return 'text-rose-400';
    if (tone === 'tp') return 'text-emerald-400';
    return 'text-zinc-600';
};

const TradingSignalCard: React.FC<TradingSignalCardProps> = ({
    analysis,
    debateTurns,
    isLatest,
    onReRun,
    supplementMarkdown,
    ensembleNote,
    calibration,
    bare = false,
}) => {
    const entry = analysis.entryPoints?.[0]?.price;
    const sl = analysis.stopLoss;
    const tps = (analysis.takeProfit ?? []).map(tp => tp.price).filter(Boolean);
    const rr = resolveRr(analysis);
    const dirLabel = signalDirectionLabel(analysis.direction, analysis.confidence);
    const noTrade = isNoTradeSignal(analysis.direction, analysis.confidence);
    const noTradeWhy = useMemo(
        () => (noTrade ? explainNoTrade(analysis) : ''),
        [analysis, noTrade],
    );
    const odds = useMemo(
        () => resolveLevelHitOdds(analysis, debateTurns),
        [analysis, debateTurns],
    );
    const why = useMemo(
        () => extractSignalStrategyText(analysis, debateTurns),
        [debateTurns, analysis],
    );
    const invalidation = useMemo(() => formatInvalidationLine(analysis), [analysis]);
    const confidenceWhy = useMemo(() => explainSignalConfidence(analysis), [analysis]);
    const drift = useMemo(
        () => analysis.confidence === 'Avoid'
            ? { status: 'insufficient_data' as const, declared: analysis.probability, actual: null, delta: null, sampleSize: 0 }
            : getCalibrationDrift(calibration, analysis.confidence, analysis.probability),
        [calibration, analysis.confidence, analysis.probability],
    );

    const levelRows = useMemo((): LevelRow[] => {
        const rows: LevelRow[] = [];
        if (entry) rows.push({ label: 'Entry', price: formatLevel(entry), tone: 'entry' });
        if (sl) rows.push({ label: 'Stop Loss', price: formatLevel(sl), hit: odds.sl, tone: 'sl' });
        tps.slice(0, 3).forEach((tp, i) => {
            rows.push({
                label: `TP${i + 1}`,
                price: formatLevel(tp),
                hit: odds.tp[i],
                tone: 'tp',
            });
        });
        return rows;
    }, [entry, sl, tps, odds]);

    return (
        <div className={bare ? 'status-surface' : 'status-surface overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80'}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                <span className="ui-kicker">Trading signal</span>
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
                {typeof analysis.probability === 'number' && (
                    <span className="text-[11px] tabular-nums text-zinc-500">{Math.round(analysis.probability)}%</span>
                )}
                {rr !== undefined && (
                    <span className="text-[11px] tabular-nums text-zinc-400">R:R 1:{rr.toFixed(1)}</span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {isLatest && onReRun && (
                        <button
                            type="button"
                            onClick={onReRun}
                            className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-200"
                            title="Adds a fresh analysis with the same prompt + chart; the old card is kept for comparison"
                        >
                            ↻ Regenerate
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-4 border-t border-white/5 px-4 py-4 sm:px-5">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {analysis.direction && (
                        <Stat label="Direction">
                            <span className={`uppercase tracking-wide ${directionText(analysis.direction)}`}>{dirLabel}</span>
                        </Stat>
                    )}
                    <Stat label="R:R">
                        <span className="tabular-nums text-zinc-100">{rr !== undefined ? `1:${rr.toFixed(1)}` : '—'}</span>
                    </Stat>
                    {analysis.grade && (
                        <Stat label="Grade">
                            <span className="text-zinc-100">{analysis.grade}</span>
                        </Stat>
                    )}
                </div>

                {levelRows.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-white/10">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-white/10 bg-zinc-800/80">
                                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Level</th>
                                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Price</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-zinc-500">Hit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {levelRows.map(row => (
                                    <tr key={row.label} className="border-b border-white/5 last:border-b-0">
                                        <td className="px-3 py-2 text-[11px] font-medium text-zinc-400">{row.label}</td>
                                        <td className={`px-3 py-2 text-[15px] font-semibold tabular-nums ${priceTone(row.tone)}`}>
                                            {row.price}
                                        </td>
                                        <td className={`px-3 py-2 text-right text-[11px] font-bold tabular-nums ${hitTone(row.tone)}`}>
                                            {row.hit !== undefined ? `${row.hit}% hit` : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {analysis.confidence && (
                    <div>
                        <div className="ui-kicker">Confidence</div>
                        <p className="mt-1 border-l-2 border-white/15 pl-3 text-[13px] leading-relaxed text-zinc-300">{confidenceWhy}</p>
                        {drift.status !== 'insufficient_data' && drift.actual !== null && (
                            <p className="mt-1 text-[11px] text-zinc-500">
                                {drift.status === 'overconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize}) — running hot`}
                                {drift.status === 'underconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize}) — running cold`}
                                {drift.status === 'accurate' && `In line with history: ${Math.round(drift.actual)}% at this confidence (n=${drift.sampleSize})`}
                            </p>
                        )}
                    </div>
                )}

                {noTradeWhy && (
                    <div>
                        <div className="ui-kicker">No trade</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{noTradeWhy}</p>
                    </div>
                )}

                {invalidation && (
                    <div>
                        <div className="ui-kicker">Invalidation</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{invalidation}</p>
                    </div>
                )}

                {why && (
                    <div>
                        <div className="mb-1 ui-kicker">Why</div>
                        <p className="text-[13px] leading-relaxed text-zinc-400">{why}</p>
                    </div>
                )}

                {analysis.recommendationContract && (
                    <div>
                        <div className="ui-kicker">Contract</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                            {analysis.recommendationContract.action.toUpperCase()} · {analysis.recommendationContract.riskBoundary}
                            {analysis.recommendationContract.validityMinutes
                                ? ` · valid ${analysis.recommendationContract.validityMinutes}m`
                                : ''}
                        </p>
                    </div>
                )}

                {analysis.analystConsensus && analysis.analystConsensus.entries.length > 0 && (
                    <ConsensusPanel consensus={analysis.analystConsensus} />
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

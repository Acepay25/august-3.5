import React, { useEffect, useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis, ConfidenceCalibration } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import ConsensusPanel from './ConsensusPanel';
import { explainSignalConfidence, extractSignalStrategyText, formatInvalidationLine, isNoTradeSignal, explainNoTrade, resolveLevelHitOdds, signalDirectionLabel, leveragedMovePercent } from '../../utils/analysisUtils';
import { getCalibrationDrift } from '../../services/validation/ConfidenceCalibrationService';
import { citeLevel } from '../../utils/levelEvidence';
import { computeContractSize } from '../../utils/ticketSize';
import { getHarnessSettings } from '../../utils/harnessSettings';
import { ticketExpiryLine } from '../../utils/paperPnl';
import { buildTicketSheet } from '../../utils/analysisReport';

interface TradingSignalCardProps {
    analysis: TradeAnalysis;
    debateTurns?: DebateTurn[];
    isLatest?: boolean;
    onReRun?: () => void;
    supplementMarkdown?: string;
    ensembleNote?: string;
    calibration?: ConfidenceCalibration;
    bare?: boolean;
    priorAnalysis?: TradeAnalysis | null;
    promptLane?: 'live' | 'control';
    leverage?: number;
    onFollowUp?: (text: string) => void;
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

const confidenceColor = (confidence?: string): string => {
    if (confidence === 'High') return 'text-emerald-400';
    if (confidence === 'Medium') return 'text-amber-400';
    return 'text-rose-400';
};

const SignalMarkdown: React.FC<{ content: string }> = ({ content }) => (
    <MarkdownContent
        content={content}
        className="!text-sm leading-6 text-zinc-200 [&_p]:my-1.5 [&_p]:text-sm [&_p]:leading-6 [&_li]:text-sm [&_li]:leading-6 [&_h1]:mb-2 [&_h1]:text-base [&_h2]:mb-1.5 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:text-sm [&_ul]:my-1.5 [&_ol]:my-1.5"
    />
);

interface LevelRow {
    label: string;
    price: string;
    move?: string;
    hit?: number;
    tone: 'entry' | 'sl' | 'tp';
    cite: string;
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

const moveTone = (move?: string): string => {
    if (!move) return 'text-zinc-500';
    if (move.trim().startsWith('-')) return 'text-rose-400';
    if (move.trim().startsWith('+')) return 'text-emerald-400';
    return 'text-zinc-500';
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
    priorAnalysis,
    leverage,
    onFollowUp,
}) => {
    const entry = analysis.entryPoints?.[0]?.price;
    const sl = analysis.stopLoss;
    const tps = (analysis.takeProfit ?? []).map(tp => tp.price).filter(Boolean);
    const rr = resolveRr(analysis);
    const dirLabel = signalDirectionLabel(analysis.direction, analysis.confidence);
    const noTrade = isNoTradeSignal(analysis.direction, analysis.confidence);
    const lev = leverage && leverage > 0 ? leverage : 1;
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
    const invalidationMove = useMemo(() => {
        const level = analysis.invalidationCriteria?.[0]?.level;
        return leveragedMovePercent(entry, level, lev, 'loss');
    }, [analysis.invalidationCriteria, entry, lev]);
    const confidenceWhy = useMemo(() => explainSignalConfidence(analysis), [analysis]);
    const drift = useMemo(
        () => analysis.confidence === 'Avoid'
            ? { status: 'insufficient_data' as const, declared: analysis.probability, actual: null, delta: null, sampleSize: 0 }
            : getCalibrationDrift(calibration, analysis.confidence, analysis.probability),
        [calibration, analysis.confidence, analysis.probability],
    );

    const levelRows = useMemo((): LevelRow[] => {
        const rows: LevelRow[] = [];
        if (entry) rows.push({ label: 'Entry', price: formatLevel(entry), tone: 'entry', cite: citeLevel('Entry', entry, analysis.evidence, analysis.levelCitations).source });
        if (sl) {
            rows.push({
                label: 'SL',
                price: formatLevel(sl),
                move: leveragedMovePercent(entry, sl, lev, 'loss') || analysis.stopLossPercentage,
                hit: odds.sl,
                tone: 'sl',
                cite: citeLevel('Stop Loss', sl, analysis.evidence, analysis.levelCitations).source,
            });
        }
        tps.slice(0, 3).forEach((tp, i) => {
            rows.push({
                label: `TP${i + 1}`,
                price: formatLevel(tp),
                move: leveragedMovePercent(entry, tp, lev, 'gain') || analysis.takeProfit?.[i]?.percentage,
                hit: odds.tp[i],
                tone: 'tp',
                cite: citeLevel(`TP${i + 1}`, tp, analysis.evidence, analysis.levelCitations).source,
            });
        });
        return rows;
    }, [entry, sl, tps, odds, analysis.evidence, analysis.stopLossPercentage, analysis.takeProfit, lev]);

    const gateLine = useMemo(() => {
        const bits: string[] = [];
        const cap = analysis.gateResult?.confidenceCap;
        if (typeof analysis.probability === 'number') {
            if (cap !== undefined && cap < 1) {
                bits.push(`${Math.round(analysis.probability)}% (capped · gate ${Math.round(cap * 100)}%)`);
            }
        }
        if (analysis.originalConfidence && analysis.originalConfidence !== analysis.confidence) {
            bits.push(`${analysis.originalConfidence} → ${analysis.confidence}`);
        }
        if (analysis.rrRatio === 0) bits.push('inverted SL · R:R 0');
        const skill = (analysis.validationWarnings ?? []).find(w => /NOTEBOOK SKILL/i.test(w));
        if (skill) bits.push(skill.replace(/^NOTEBOOK SKILL[^:]*:\s*/i, 'skill: ').slice(0, 80));
        return bits.join(' · ');
    }, [analysis]);

    const size = useMemo(
        () => computeContractSize(analysis, getHarnessSettings().equityUsd, leverage || 1),
        [analysis, leverage],
    );
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [followUp, setFollowUp] = useState('');
    useEffect(() => {
        if (!analysis.createdAt || !analysis.validityDurationMinutes) return undefined;
        const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, [analysis.createdAt, analysis.validityDurationMinutes]);
    const validityLine = ticketExpiryLine(analysis, nowMs)?.line || '';
    const priorLine = useMemo(() => {
        if (!priorAnalysis) return '';
        const bits: string[] = [];
        const prevEntry = priorAnalysis.entryPoints?.[0]?.price;
        const curEntry = analysis.entryPoints?.[0]?.price;
        if (prevEntry && curEntry && prevEntry !== curEntry) bits.push(`Entry ${formatLevel(prevEntry)} → ${formatLevel(curEntry)}`);
        if (priorAnalysis.stopLoss && analysis.stopLoss && priorAnalysis.stopLoss !== analysis.stopLoss) {
            bits.push(`SL ${formatLevel(priorAnalysis.stopLoss)} → ${formatLevel(analysis.stopLoss)}`);
        }
        const prevTp = priorAnalysis.takeProfit?.[0]?.price;
        const curTp = analysis.takeProfit?.[0]?.price;
        if (prevTp && curTp && prevTp !== curTp) bits.push(`TP1 ${formatLevel(prevTp)} → ${formatLevel(curTp)}`);
        if (priorAnalysis.direction && priorAnalysis.direction !== analysis.direction) {
            bits.push(`${priorAnalysis.direction} → ${analysis.direction}`);
        }
        return bits.join(' · ');
    }, [priorAnalysis, analysis]);

    return (
        <div className={bare ? 'status-surface' : 'status-surface overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80'}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-5">
                {analysis.coinName && (
                    <span className="text-[13px] font-medium text-zinc-200">{analysis.coinName}</span>
                )}
                {analysis.direction && (
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${directionChip(analysis.direction)}`}>
                        {dirLabel}
                    </span>
                )}
                {analysis.confidence && (
                    <span className={`text-xs font-semibold ${confidenceColor(analysis.confidence)}`}>
                        {analysis.confidence}
                    </span>
                )}
                {typeof analysis.probability === 'number' && (
                    <span className="text-xs tabular-nums text-zinc-400">{Math.round(analysis.probability)}%</span>
                )}
                {rr !== undefined && (
                    <span className="text-xs tabular-nums text-zinc-300">R:R 1:{rr.toFixed(1)}</span>
                )}
                {validityLine && <span className="text-xs text-zinc-500">{validityLine}</span>}
                {gateLine && <span className="text-xs text-zinc-500">{gateLine}</span>}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            const sheet = buildTicketSheet(analysis);
                            void navigator.clipboard?.writeText(sheet);
                        }}
                        className="text-xs font-medium text-zinc-500 hover:text-zinc-200"
                    >
                        Copy
                    </button>
                    {isLatest && onReRun && (
                        <button
                            type="button"
                            onClick={onReRun}
                            className="text-xs font-medium text-zinc-500 hover:text-zinc-200"
                        >
                            Regenerate
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-3 border-t border-white/5 px-4 py-3 sm:px-5">
                {levelRows.length > 0 && (
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                                <th className="pb-1.5 font-medium">Level</th>
                                <th className="pb-1.5 font-medium">Price</th>
                                <th className="pb-1.5 font-medium">Move</th>
                                <th className="pb-1.5 text-right font-medium">Hit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {levelRows.map(row => (
                                <tr key={row.label} className="border-t border-white/5">
                                    <td className="py-1.5 text-sm text-zinc-400">{row.label}</td>
                                    <td className={`py-1.5 text-sm font-semibold tabular-nums ${priceTone(row.tone)}`} title={row.cite}>
                                        {row.price}
                                    </td>
                                    <td className={`py-1.5 text-sm font-medium tabular-nums ${moveTone(row.move)}`}>
                                        {row.move || '—'}
                                    </td>
                                    <td className={`py-1.5 text-right text-sm tabular-nums ${hitTone(row.tone)}`}>
                                        {row.hit !== undefined ? `${row.hit}%` : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                <p className="text-xs text-zinc-500">
                    {size.line}
                    {size.notionalUsd > 0 ? ` · $${Math.round(size.notionalUsd).toLocaleString()} notional` : ''}
                    {` · ${lev}x`}
                </p>

                {noTradeWhy && (
                    <p className="text-sm leading-6 text-zinc-400">{noTradeWhy.replace(/^#+\s*/gm, '').slice(0, 220)}</p>
                )}

                {invalidation && (
                    <p className="text-sm leading-6 text-zinc-400">
                        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Invalidation </span>
                        {invalidation}
                        {invalidationMove && (
                            <span className={`ml-2 tabular-nums ${moveTone(invalidationMove)}`}>{invalidationMove}</span>
                        )}
                    </p>
                )}

                {priorLine && (
                    <p className="text-xs text-zinc-600">vs last · {priorLine}</p>
                )}

                {(why || confidenceWhy || analysis.analystConsensus || analysis.dualScenarioAnalysis || analysis.recommendationContract || supplementMarkdown || ensembleNote || onFollowUp) && (
                    <details className="border-t border-white/5 pt-2">
                        <summary className="cursor-pointer list-none text-[11px] uppercase tracking-widest text-zinc-500">
                            More
                        </summary>
                        <div className="mt-3 space-y-3">
                            {confidenceWhy && (
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Confidence</div>
                                    <SignalMarkdown content={confidenceWhy} />
                                </div>
                            )}
                            {drift.status !== 'insufficient_data' && drift.actual !== null && (
                                <p className="text-xs leading-5 text-zinc-500">
                                    {drift.status === 'overconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize})`}
                                    {drift.status === 'underconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize})`}
                                    {drift.status === 'accurate' && `In line: ${Math.round(drift.actual)}% at this confidence (n=${drift.sampleSize})`}
                                </p>
                            )}
                            {why && (
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Why</div>
                                    <SignalMarkdown content={why} />
                                </div>
                            )}
                            {analysis.dualScenarioAnalysis && (
                                <p className="text-sm leading-6 text-zinc-400">
                                    {analysis.dualScenarioAnalysis.selectedScenario === 'bearish' ? 'Kept short' : analysis.dualScenarioAnalysis.selectedScenario === 'bullish' ? 'Kept long' : 'Neutral'}
                                    {' · '}
                                    Long {analysis.dualScenarioAnalysis.bullish.target}
                                    {' · '}
                                    Short {analysis.dualScenarioAnalysis.bearish.target}
                                </p>
                            )}
                            {analysis.recommendationContract && (
                                <p className="text-sm leading-6 text-zinc-400">
                                    {analysis.recommendationContract.action.toUpperCase()} · {analysis.recommendationContract.riskBoundary}
                                </p>
                            )}
                            {analysis.analystConsensus && analysis.analystConsensus.entries.length > 0 && (
                                <ConsensusPanel consensus={analysis.analystConsensus} />
                            )}
                            {supplementMarkdown && <SignalMarkdown content={supplementMarkdown} />}
                            {ensembleNote && <p className="text-sm leading-6 text-zinc-500">{ensembleNote}</p>}
                            {onFollowUp && (
                                <form
                                    onSubmit={e => {
                                        e.preventDefault();
                                        const text = followUp.trim();
                                        if (!text) return;
                                        onFollowUp(text);
                                        setFollowUp('');
                                    }}
                                >
                                    <label className="ui-kicker" htmlFor="signal-follow-up">Ask this ticket</label>
                                    <input
                                        id="signal-follow-up"
                                        value={followUp}
                                        onChange={e => setFollowUp(e.target.value)}
                                        placeholder="@Risk why this SL?"
                                        className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-[13px] text-zinc-200 placeholder:text-zinc-600"
                                    />
                                </form>
                            )}
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
};

export default React.memo(TradingSignalCard);

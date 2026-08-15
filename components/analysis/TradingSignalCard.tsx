import React, { useEffect, useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis, ConfidenceCalibration } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import ConsensusPanel from './ConsensusPanel';
import { explainSignalConfidence, extractSignalStrategyText, formatInvalidationLine, isNoTradeSignal, explainNoTrade, resolveLevelHitOdds, signalDirectionLabel } from '../../utils/analysisUtils';
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

const SignalMarkdown: React.FC<{ content: string }> = ({ content }) => (
    <MarkdownContent
        content={content}
        className="!text-sm leading-6 text-zinc-200 [&_p]:my-1.5 [&_p]:text-sm [&_p]:leading-6 [&_li]:text-sm [&_li]:leading-6 [&_h1]:mb-2 [&_h1]:text-base [&_h2]:mb-1.5 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:text-sm [&_ul]:my-1.5 [&_ol]:my-1.5"
    />
);

interface LevelRow {
    label: string;
    price: string;
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
    promptLane,
    leverage,
    onFollowUp,
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
        if (entry) rows.push({ label: 'Entry', price: formatLevel(entry), tone: 'entry', cite: citeLevel('Entry', entry, analysis.evidence, analysis.levelCitations).source });
        if (sl) rows.push({ label: 'Stop Loss', price: formatLevel(sl), hit: odds.sl, tone: 'sl', cite: citeLevel('Stop Loss', sl, analysis.evidence, analysis.levelCitations).source });
        tps.slice(0, 3).forEach((tp, i) => {
            rows.push({
                label: `TP${i + 1}`,
                price: formatLevel(tp),
                hit: odds.tp[i],
                tone: 'tp',
                cite: citeLevel(`TP${i + 1}`, tp, analysis.evidence, analysis.levelCitations).source,
            });
        });
        return rows;
    }, [entry, sl, tps, odds, analysis.evidence]);

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
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Trading signal</span>
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
                <span className="text-xs text-zinc-400">Size {analysis.positionSize?.line || size.line}</span>
                {promptLane && (
                    <span className="text-xs uppercase tracking-widest text-zinc-500">{promptLane}</span>
                )}
                {validityLine && <span className="text-sm text-zinc-400">{validityLine}</span>}
                {gateLine && (
                    <span className="w-full text-sm leading-6 text-zinc-400">{gateLine}</span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            const sheet = buildTicketSheet(analysis);
                            void navigator.clipboard?.writeText(sheet);
                        }}
                        className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                        title="Copy a one-page ticket"
                    >
                        Copy ticket
                    </button>
                    {isLatest && onReRun && (
                        <button
                            type="button"
                            onClick={onReRun}
                            className="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
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
                    <Stat label="Size">
                        <span className="text-zinc-100">{analysis.positionSize?.line || size.line}</span>
                    </Stat>
                </div>
                {priorLine && (
                    <p className="text-sm leading-6 text-zinc-500">vs last tape: {priorLine}</p>
                )}
                {analysis.dualScenarioAnalysis && (
                    <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">Other side</div>
                        <p className="mt-1 text-sm leading-6 text-zinc-300">
                            {analysis.dualScenarioAnalysis.selectedScenario === 'bearish' ? 'Kept short' : analysis.dualScenarioAnalysis.selectedScenario === 'bullish' ? 'Kept long' : 'Neutral'}
                            {' · '}
                            Long: {analysis.dualScenarioAnalysis.bullish.target} / inv {analysis.dualScenarioAnalysis.bullish.invalidation}
                            {' · '}
                            Short: {analysis.dualScenarioAnalysis.bearish.target} / inv {analysis.dualScenarioAnalysis.bearish.invalidation}
                        </p>
                    </div>
                )}

                {levelRows.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-white/10">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-white/10 bg-zinc-800/80">
                                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Level</th>
                                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Price</th>
                                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Cite</th>
                                    <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">Hit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {levelRows.map(row => (
                                    <tr key={row.label} className="border-b border-white/5 last:border-b-0">
                                        <td className="px-3 py-2.5 text-sm font-medium text-zinc-300">{row.label}</td>
                                        <td className={`px-3 py-2.5 text-sm font-semibold tabular-nums ${priceTone(row.tone)}`}>
                                            {row.price}
                                        </td>
                                        <td className="max-w-[10rem] truncate px-3 py-2.5 text-sm text-zinc-500" title={row.cite}>
                                            {row.cite}
                                        </td>
                                        <td className={`px-3 py-2.5 text-right text-sm font-bold tabular-nums ${hitTone(row.tone)}`}>
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
                        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">Confidence</div>
                        <div className="mt-1 border-l-2 border-white/15 pl-3">
                            <SignalMarkdown content={confidenceWhy} />
                        </div>
                        {drift.status !== 'insufficient_data' && drift.actual !== null && (
                            <p className="mt-1 text-sm leading-6 text-zinc-500">
                                {drift.status === 'overconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize}) — running hot`}
                                {drift.status === 'underconfident' && `Declared ${Math.round(drift.declared)}% vs ${Math.round(drift.actual)}% realized (n=${drift.sampleSize}) — running cold`}
                                {drift.status === 'accurate' && `In line with history: ${Math.round(drift.actual)}% at this confidence (n=${drift.sampleSize})`}
                            </p>
                        )}
                    </div>
                )}

                {noTradeWhy && (
                    <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">No trade</div>
                        <div className="mt-1">
                            <SignalMarkdown content={noTradeWhy} />
                        </div>
                    </div>
                )}

                {invalidation && (
                    <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">Invalidation</div>
                        <div className="mt-1">
                            <SignalMarkdown content={invalidation} />
                        </div>
                    </div>
                )}

                {why && (
                    <div>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">Why</div>
                        <SignalMarkdown content={why} />
                    </div>
                )}

                {analysis.recommendationContract && (
                    <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">Contract</div>
                        <p className="mt-1 text-sm leading-6 text-zinc-200">
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
                        <SignalMarkdown content={supplementMarkdown} />
                    </div>
                )}

                {ensembleNote && (
                    <p className="border-t border-white/5 pt-3 text-sm leading-6 text-zinc-400">{ensembleNote}</p>
                )}
                {onFollowUp && (
                    <form
                        className="border-t border-white/5 pt-3"
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
        </div>
    );
};

export default React.memo(TradingSignalCard);

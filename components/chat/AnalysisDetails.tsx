/**
 * AnalysisDetails — the markdown-only replacement for the old AnalysisResult
 * card. Rendered on the message bubble when a message carries an analysis:
 *
 *  1. Supplement markdown — the harness-side data the plan itself can't
 *     contain (validation gate, calibration, pattern-memory insight, data
 *     freshness), rendered as organized markdown sections.
 *  2. Context chips — regime, calibration trust badge, raw→adjusted
 *     divergence, dissent count + the team verdict line.
 *  3. Action row — log win/loss, probabilities, compare, alerts, autopilot.
 *
 * No parsed-data card, no JSON — the **FINAL TRADE PLAN** markdown in the
 * message text is the single source of truth for the analysis itself.
 */

import React, { useState } from 'react';
import { TradeAnalysis, TradeOutcome, ConfidenceCalibration } from '../../types';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';
import { PriceAlertService } from '../../services/ui/PriceAlertService';
import MarkdownContent from '../shared/MarkdownContent';

interface AnalysisDetailsProps {
    messageId: string;
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    confidenceCalibration?: ConfidenceCalibration;
    autopilotResolution?: AutopilotResolution;
    onLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    onConfirmAutopilot?: (messageId: string) => void;
    onDismissAutopilot?: (messageId: string) => void;
    onSelectForProbability?: (messageId: string) => void;
    onCompare?: (messageId: string) => void;
}

// ─── Supplement markdown ───────────────────────────────────────────────────

/**
 * Build the harness-side sections that live BELOW the plan as markdown:
 * everything the old card showed that the model's plan text can't carry
 * (the gate, calibration, memory insight, data freshness). Each section
 * renders only when its data exists.
 */
const buildSupplementMarkdown = (analysis: TradeAnalysis, calibration?: ConfidenceCalibration): string => {
    const lines: string[] = [];
    const push = (s: string) => lines.push(s);

    // ── Setup quality (harness-computed bits around the plan's levels) ──
    const snap = analysis.marketSnapshot as { regime?: { regime?: string; adx?: number }; confluence?: { score?: number; direction?: string; strength?: string; alignment?: string[]; conflicts?: string[] } } | undefined;
    const setupBits: string[] = [];
    if (analysis.tradeType) setupBits.push(`Style: **${analysis.tradeType.toUpperCase()}**`);
    if (snap?.regime?.regime) {
        setupBits.push(`Regime: **${snap.regime.regime.replace(/_/g, ' ')}**${typeof snap.regime.adx === 'number' ? ` (ADX ${snap.regime.adx.toFixed(1)})` : ''}`);
    }
    const ets = analysis.entryTimingScore;
    if (ets && typeof ets.score === 'number') {
        setupBits.push(`Entry timing: **${ets.score}/100**${ets.timingQuality ? ` (${ets.timingQuality})` : ''}${ets.suggestedEntry?.reason ? ` — ${ets.suggestedEntry.reason}` : ''}`);
    }
    if (typeof analysis.rrRatio === 'number') setupBits.push(`Risk/Reward: **${analysis.rrRatio.toFixed(2)}:1**`);
    if (analysis.stopLossPercentage) setupBits.push(`Stop distance: **${analysis.stopLossPercentage}**`);
    const tp0 = analysis.takeProfit?.[0];
    if (tp0?.percentage) setupBits.push(`TP1 gain: **${tp0.percentage}**`);
    // Extended SL (150%) — worst-case loss threshold (SL distance × 1.5).
    const entryP = parseFloat(analysis.entryPoints?.[0]?.price ?? '');
    const slP = parseFloat(analysis.stopLoss ?? '');
    if (Number.isFinite(entryP) && Number.isFinite(slP) && slP !== entryP) {
        const distance = Math.abs(slP - entryP);
        const extended = slP > entryP ? entryP + 1.5 * distance : entryP - 1.5 * distance;
        setupBits.push(`Max loss (extended SL 150%): **$${extended.toFixed(2)}**`);
    }
    // Confluence (hybrid snapshot)
    const confluence = snap?.confluence;
    if (confluence && typeof confluence.score === 'number') {
        const aligned = confluence.alignment?.length ?? 0;
        const total = (confluence.alignment?.length ?? 0) + (confluence.conflicts?.length ?? 0);
        setupBits.push(`Confluence: **${confluence.score}/100** ${confluence.direction ?? ''}${total > 0 ? ` · ${aligned}/${total} TFs aligned` : ''}${confluence.strength ? ` · ${confluence.strength}` : ''}`);
    }
    if (analysis.createdAt) {
        setupBits.push(`Analyzed: ${new Date(analysis.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    }
    if (typeof analysis.validityDurationMinutes === 'number' && analysis.createdAt) {
        const expires = new Date(new Date(analysis.createdAt).getTime() + analysis.validityDurationMinutes * 60000);
        const remainMin = Math.max(0, Math.round((expires.getTime() - Date.now()) / 60000));
        if (remainMin > 0) {
            const h = Math.floor(remainMin / 60);
            const m = remainMin % 60;
            setupBits.push(`Valid for ~${h > 0 ? `${h}h ` : ''}${m}m (until ${expires.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`);
        }
    }
    if (setupBits.length > 0) {
        push('**Setup quality**');
        setupBits.forEach(b => push(`- ${b}`));
        push('');
    }

    // ── Confidence & calibration ──
    const conf = analysis.confidence;
    const tierKey = (conf ?? 'Medium').toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const stats = calibration?.[tierKey];
    const expected = tierKey === 'high' ? 70 : tierKey === 'medium' ? 55 : 40;
    const actual = stats && stats.total >= 3 ? (stats.wins / stats.total) * 100 : null;
    const overconfident = actual !== null && actual < expected - 10;
    const confBits: string[] = [];
    if (analysis.originalConfidence && analysis.originalConfidence !== conf) {
        confBits.push(`Original: ${analysis.originalConfidence} → Adjusted: ${conf}`);
    }
    if (overconfident && actual !== null && stats) {
        const downgrade = tierKey === 'high' ? 'Medium' : tierKey === 'medium' ? 'Low' : 'Avoid';
        confBits.push(`Calibration downgrade — this confidence tier historically wins ${actual.toFixed(0)}% (n=${stats.total}), shown as **${downgrade}**`);
    } else if (actual !== null && stats) {
        confBits.push(`Calibration — tier historically wins ${actual.toFixed(0)}% (n=${stats.total})`);
    }
    const rawProbs = (analysis.analystConsensus?.entries ?? [])
        .map(e => e.probability)
        .filter((p): p is number => typeof p === 'number');
    const rawAvg = rawProbs.length > 0 ? rawProbs.reduce((a, b) => a + b, 0) / rawProbs.length : null;
    if (rawAvg !== null && typeof analysis.probability === 'number' && Math.abs(rawAvg - analysis.probability) >= 8) {
        confBits.push(`Divergence — raw analysts ${Math.round(rawAvg)}% → adjusted verdict ${Math.round(analysis.probability)}%`);
    }
    if (confBits.length > 0) {
        push('**Confidence & calibration**');
        confBits.forEach(b => push(`- ${b}`));
        push('');
    }

    // ── Team verdict (per-analyst calls vs the verdict) ──
    const consensusEntries = analysis.analystConsensus?.entries ?? [];
    if (consensusEntries.length > 0) {
        push('**Team verdict**');
        const verdictDir = analysis.direction ?? 'Neutral';
        const dissents = consensusEntries.filter(e => e.direction && e.direction !== verdictDir).length;
        consensusEntries.forEach(e => {
            const dir = e.direction === 'Long' ? '▲ Long' : e.direction === 'Short' ? '▼ Short' : '—';
            const agrees = e.direction === verdictDir;
            const call = `${e.displayName ?? e.thoughtsKey ?? e.providerId ?? '?'}: ${dir}${typeof e.probability === 'number' ? ` ${Math.round(e.probability)}%` : e.confidence ? ` ${e.confidence}` : ''} ${agrees ? '✓' : '✗'}`;
            push(`- ${call}`);
        });
        if (dissents > 0) push(`- **${dissents} dissent${dissents > 1 ? 's' : ''}** from the verdict`);
        push('');
    }

    // ── Validation gate ──
    const gate = analysis.gateResult;
    if (gate) {
        const penalties: string[] = [];
        const p = gate.penalties;
        if (p.dataIntegrity > 0) penalties.push(`Data −${(p.dataIntegrity * 100).toFixed(0)}%`);
        if (p.patternMemory > 0) penalties.push(`Memory −${(p.patternMemory * 100).toFixed(0)}%`);
        if (p.htfConflict > 0) penalties.push(`HTF −${(p.htfConflict * 100).toFixed(0)}%`);
        if (p.volumeContext > 0) penalties.push(`Volume −${(p.volumeContext * 100).toFixed(0)}%`);
        const biasParts = (['A', 'B', 'C', 'Omega'] as const)
            .map(f => ({ f, v: gate.familyBias[f] }))
            .filter(x => x.v !== 0);
        const hasInfo = !gate.passed
            || gate.confidenceCap < 1
            || penalties.length > 0
            || (gate.suggestedDirection && gate.suggestedDirection !== 'Neutral')
            || biasParts.length > 0
            || (gate.warnings?.length ?? 0) > 0
            || (gate.insights?.length ?? 0) > 0
            || (analysis.validationWarnings?.length ?? 0) > 0
            || !!analysis.riskVeto;
        if (hasInfo) {
            push('**Validation gate**');
            push(`- Verdict: ${gate.passed ? 'PASS' : 'Adjusted'}${gate.confidenceCap < 1 ? ` — confidence capped at ${(gate.confidenceCap * 100).toFixed(0)}%` : ''}`);
            if (penalties.length > 0) push(`- Penalties: ${penalties.join(' · ')}`);
            if (gate.suggestedDirection && gate.suggestedDirection !== 'Neutral') push(`- Pattern memory suggests ${gate.suggestedDirection}`);
            if (biasParts.length > 0) push(`- Family bias: ${biasParts.map(x => `${x.f === 'Omega' ? 'Ω' : x.f} ${x.v > 0 ? '+' : ''}${(x.v * 100).toFixed(0)}%`).join(' · ')}`);
            (analysis.validationWarnings ?? []).forEach(w => push(`- ⚠ ${w}`));
            (gate.warnings ?? []).forEach(w => push(`- ⚠ ${w}`));
            (gate.insights ?? []).forEach(i => push(`- 💡 ${i}`));
            if (analysis.riskVeto) push(`- ⛔ **Risk veto:** ${analysis.riskVeto}`);
            push('');
        }
    }

    // ── Pattern memory insight ──
    if (analysis.historicalCorrelation && analysis.historicalCorrelation !== 'N/A') {
        push('**Pattern memory insight**');
        push(`> ${analysis.historicalCorrelation}`);
        push('');
    }

    // ── Data freshness ──
    const snapshot = analysis.marketSnapshot as { dataTimestamp?: string } | undefined;
    if (snapshot?.dataTimestamp) {
        const ageMin = Math.max(0, Math.round((Date.now() - new Date(snapshot.dataTimestamp).getTime()) / 60000));
        if (ageMin > 10) {
            push('**Data freshness**');
            push(`- Market snapshot ${ageMin}m old — treat confidence as provisional.`);
            push('');
        }
    }

    return lines.join('\n').trim();
};

// ─── Component ────────────────────────────────────────────────────────────

const AnalysisDetails: React.FC<AnalysisDetailsProps> = ({
    messageId,
    analysis,
    outcome,
    confidenceCalibration,
    autopilotResolution,
    onLogTrade,
    onConfirmAutopilot,
    onDismissAutopilot,
    onSelectForProbability,
    onCompare,
}) => {
    const [alertsSet, setAlertsSet] = useState(false);
    const handleSetAlerts = () => {
        if (alertsSet) return; // one alert set per message — avoid duplicate monitoring
        PriceAlertService.createAlert(messageId, analysis);
        setAlertsSet(true);
    };

    const supplement = buildSupplementMarkdown(analysis, confidenceCalibration);

    return (
        <div className="mt-4 sm:mt-6 space-y-3">
            {/* Harness-side data as organized markdown (below the plan) */}
            {supplement && (
                <div className="pt-3 border-t border-white/5">
                    <MarkdownContent content={supplement} />
                </div>
            )}

            {/* Outcome Autopilot — detected SL/TP hit, one-click confirmation */}
            {autopilotResolution && outcome === TradeOutcome.PENDING && (() => {
                const r = autopilotResolution;
                const isWin = r.outcome === TradeOutcome.WIN;
                const isLoss = r.outcome === TradeOutcome.LOSS;
                const tint = r.expiredOpen
                    ? 'bg-amber-500/5 border-amber-500/20 text-amber-200'
                    : isWin
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-200'
                        : isLoss
                            ? 'bg-rose-500/5 border-rose-500/20 text-rose-200'
                            : 'bg-amber-500/5 border-amber-500/20 text-amber-200';
                const winTier = isWin && r.hitTarget ? ` · ${r.hitTarget}${r.recoveredAfterSlTouch ? ' · recovered after SL touch' : ' · clean'}` : '';
                const confirmLabel = r.expiredOpen
                    ? null
                    : r.outcome === TradeOutcome.ENTRY_NOT_HIT
                        ? 'Entry not hit'
                        : isWin
                            ? `WIN${r.pnlPercent !== undefined ? ` (+${r.pnlPercent}%)` : ''}${winTier}`
                            : `LOSS${r.pnlPercent !== undefined ? ` (${r.pnlPercent}%)` : ''}`;
                return (
                    <div className={`px-4 py-3 rounded-xl border ${tint}`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-80">Autopilot Detection</div>
                                <div className="text-xs sm:text-sm font-semibold mt-1">{r.detail}</div>
                                {r.timeToOutcome && <div className="text-[10px] opacity-60 mt-0.5">Resolved {r.timeToOutcome} after analysis</div>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                {confirmLabel && onConfirmAutopilot && (
                                    <button
                                        onClick={() => onConfirmAutopilot(messageId)}
                                        className={`status-surface rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                                            isWin
                                                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                                                : isLoss
                                                    ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                                                    : 'bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                                        }`}
                                    >
                                        Confirm {confirmLabel}
                                    </button>
                                )}
                                {!r.expiredOpen && (isWin || isLoss) && (
                                    <button
                                        onClick={() => onLogTrade(messageId, r.outcome as TradeOutcome.WIN | TradeOutcome.LOSS)}
                                        className="rounded-xl border border-white/10 bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
                                        title="Open the capture flow to attach a chart screenshot"
                                    >
                                         Attach Screenshot
                                    </button>
                                )}
                                {onDismissAutopilot && (
                                    <button
                                        onClick={() => onDismissAutopilot(messageId)}
                                        className="rounded-xl border border-white/10 bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 opacity-70 hover:opacity-100"
                                    >
                                        Dismiss
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Action row — like the workspace buttons */}
            <div
                className="flex flex-wrap gap-2 outline-none"
                tabIndex={0}
                onKeyDown={(e) => {
                    const target = e.target as HTMLElement;
                    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
                    if ((e.key === 'w' || e.key === 'W') && outcome === TradeOutcome.PENDING && !autopilotResolution) {
                        e.preventDefault();
                        onLogTrade(messageId, TradeOutcome.WIN);
                    } else if ((e.key === 'l' || e.key === 'L') && outcome === TradeOutcome.PENDING && !autopilotResolution) {
                        e.preventDefault();
                        onLogTrade(messageId, TradeOutcome.LOSS);
                    }
                }}
            >
                {outcome === TradeOutcome.PENDING && !autopilotResolution && (
                    <>
                        <button
                            onClick={() => onLogTrade(messageId, TradeOutcome.WIN)}
                            className="status-surface rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-2 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                            title="Log this trade as a win (opens the capture flow)"
                        >
                            Win
                        </button>
                        <button
                            onClick={() => onLogTrade(messageId, TradeOutcome.LOSS)}
                            className="status-surface rounded-xl bg-rose-500/15 border border-rose-500/40 px-4 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/25"
                            title="Log this trade as a loss (opens the capture flow)"
                        >
                            Loss
                        </button>
                    </>
                )}
                {onSelectForProbability && (
                    <button
                        onClick={() => onSelectForProbability(messageId)}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-purple-950/80 border border-purple-500/40 text-purple-300 uppercase tracking-widest hover:bg-purple-500/30 transition-colors"
                        title="View AI Probability estimations in side panel"
                    >
                         View Probabilities
                    </button>
                )}
                {onCompare && (
                    <button
                        onClick={() => onCompare(messageId)}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-zinc-800 border border-white/10 text-zinc-300 uppercase tracking-widest hover:border-cyan-400/30 hover:text-cyan-300 transition-colors"
                        title="Compare this analysis side-by-side with another"
                    >
                        ⧉ Compare
                    </button>
                )}
                <button
                    onClick={handleSetAlerts}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${alertsSet
                        ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                        : 'bg-zinc-800 border border-white/10 text-zinc-300 hover:border-cyan-400/30 hover:text-cyan-300'}`}
                    title="Create price alerts for this setup's entry, stop loss and take profit levels"
                >
                    {alertsSet ? '✓ Alerts set' : '⏰ Set alerts'}
                </button>
                <span className="text-[9px] text-zinc-600 self-center hidden sm:inline" title="Focus the actions, then: W = log win, L = log loss">
                    <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10">W</kbd>
                    <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10 ml-1">L</kbd>
                </span>
            </div>
        </div>
    );
};

export default React.memo(AnalysisDetails);

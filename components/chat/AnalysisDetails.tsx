/**
 * AnalysisDetails — the interactive layer under an analysis message.
 *
 * The plan + harness-side data render as ONE workspace-style markdown card
 * in MessageItem (buildAnalysisMarkdown + buildSupplementMarkdown). This
 * component adds what markdown can't: the outcome autopilot banner and the
 * action row (log win/loss, probabilities, compare, alerts).
 */

import React, { useState } from 'react';
import { TradeAnalysis, TradeOutcome, Message, TradingStyle } from '../../types';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';
import { PriceAlertService } from '../../services/ui/PriceAlertService';
import ShareMenu from '../analysis/ShareMenu';
import SetupWatchControl from '../analysis/SetupWatchControl';

interface AnalysisDetailsProps {
    messageId: string;
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    autopilotResolution?: AutopilotResolution;
    onLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    onConfirmAutopilot?: (messageId: string) => void;
    onDismissAutopilot?: (messageId: string) => void;
    onSelectForProbability?: (messageId: string) => void;
    onCompare?: (messageId: string) => void;
    watched?: boolean;
    onToggleWatch?: (messageId: string) => void;
    message?: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'> & { text?: string };
    tradingStyle?: Exclude<TradingStyle, 'auto'>;
}

const AnalysisDetails: React.FC<AnalysisDetailsProps> = ({
    messageId,
    analysis,
    outcome,
    autopilotResolution,
    onLogTrade,
    onConfirmAutopilot,
    onDismissAutopilot,
    onSelectForProbability,
    onCompare,
    watched = false,
    onToggleWatch,
    message,
    tradingStyle,
}) => {
    const [alertsSet, setAlertsSet] = useState(false);
    const handleSetAlerts = () => {
        if (alertsSet) return; // one alert set per message — avoid duplicate monitoring
        PriceAlertService.createAlert(messageId, analysis);
        setAlertsSet(true);
    };

    return (
        <div className="mt-3 space-y-3">
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
                {onToggleWatch && (
                    <button
                        type="button"
                        onClick={() => onToggleWatch(messageId)}
                        className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                            watched
                                ? 'border-white/25 bg-zinc-800 text-zinc-100'
                                : 'border-white/10 bg-zinc-800 text-zinc-300 hover:border-white/25 hover:text-zinc-100'
                        }`}
                        title="Add this trading signal to the Watch list — autopilot and Win/Loss still work the same"
                    >
                        {watched ? 'Watching' : 'Watch'}
                    </button>
                )}
                <SetupWatchControl analysis={analysis} messageId={messageId} />
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
                <ShareMenu analysis={analysis} outcome={outcome} tradingStyle={tradingStyle} message={message} />
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

/**
 * AnalysisDetails — next-steps under a finished signal.
 *
 * Primary: log Win/Loss/Skip, pin to the Watch list, arm a price re-debate.
 * Secondary (More): probabilities, compare, share, alerts.
 */

import React, { useEffect, useRef, useState } from 'react';
import { TradeAnalysis, TradeOutcome, Message, TradingStyle } from '../../types';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';
import { PriceAlertService } from '../../services/ui/PriceAlertService';
import ShareMenu from '../analysis/ShareMenu';
import SetupWatchControl from '../analysis/SetupWatchControl';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const HINT_KEY = 'august_next_steps_hint_dismissed';

interface AnalysisDetailsProps {
    messageId: string;
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    autopilotResolution?: AutopilotResolution;
    onLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    onSkipTrade?: (messageId: string) => void;
    onConfirmAutopilot?: (messageId: string) => void;
    onDismissAutopilot?: (messageId: string) => void;
    onSelectForProbability?: (messageId: string) => void;
    onCompare?: (messageId: string) => void;
    watched?: boolean;
    onToggleWatch?: (messageId: string) => void;
    message?: Pick<Message, 'analysis' | 'debateTurns' | 'debateRunLog'> & { text?: string };
    tradingStyle?: Exclude<TradingStyle, 'auto'>;
    highlighted?: boolean;
}

const AnalysisDetails: React.FC<AnalysisDetailsProps> = ({
    messageId,
    analysis,
    outcome,
    autopilotResolution,
    onLogTrade,
    onSkipTrade,
    onConfirmAutopilot,
    onDismissAutopilot,
    onSelectForProbability,
    onCompare,
    watched = false,
    onToggleWatch,
    message,
    tradingStyle,
    highlighted = false,
}) => {
    const [alertsSet, setAlertsSet] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [showHint, setShowHint] = useState(() => {
        try {
            return localStorage.getItem(HINT_KEY) !== 'true';
        } catch {
            return false;
        }
    });
    const stripRef = useRef<HTMLDivElement>(null);
    useEscapeClose(moreOpen, () => setMoreOpen(false));

    useEffect(() => {
        if (!highlighted) return;
        stripRef.current?.focus();
    }, [highlighted]);

    const dismissHint = (): void => {
        try {
            localStorage.setItem(HINT_KEY, 'true');
        } catch { /* ignore */ }
        setShowHint(false);
    };

    const handleSetAlerts = (): void => {
        if (alertsSet) return;
        PriceAlertService.createAlert(messageId, analysis);
        setAlertsSet(true);
        dismissHint();
    };

    const pending = outcome === TradeOutcome.PENDING && !autopilotResolution;

    return (
        <div className="mt-0 space-y-3">
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

            {showHint && pending && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-zinc-900/80 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                        Next: log Win or Loss, Skip if you did not take it, Pin it on the Watch list, or Arm a price re-debate.
                    </p>
                    <button
                        type="button"
                        onClick={dismissHint}
                        className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
                    >
                        Got it
                    </button>
                </div>
            )}

            <div
                ref={stripRef}
                id={`signal-next-${messageId}`}
                className="flex flex-wrap gap-2 outline-none"
                tabIndex={0}
                aria-label="Signal next steps"
                onKeyDown={(e) => {
                    const target = e.target as HTMLElement;
                    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
                    if (!pending) return;
                    if (e.key === 'w' || e.key === 'W') {
                        e.preventDefault();
                        dismissHint();
                        onLogTrade(messageId, TradeOutcome.WIN);
                    } else if (e.key === 'l' || e.key === 'L') {
                        e.preventDefault();
                        dismissHint();
                        onLogTrade(messageId, TradeOutcome.LOSS);
                    } else if ((e.key === 's' || e.key === 'S') && onSkipTrade) {
                        e.preventDefault();
                        dismissHint();
                        onSkipTrade(messageId);
                    }
                }}
            >
                {pending && (
                    <>
                        <button
                            onClick={() => { dismissHint(); onLogTrade(messageId, TradeOutcome.WIN); }}
                            className="status-surface rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                            title="Log this trade as a win (opens the capture flow)"
                        >
                            Win
                        </button>
                        <button
                            onClick={() => { dismissHint(); onLogTrade(messageId, TradeOutcome.LOSS); }}
                            className="status-surface rounded-lg bg-rose-500/15 border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25"
                            title="Log this trade as a loss (opens the capture flow)"
                        >
                            Loss
                        </button>
                        {onSkipTrade && (
                            <button
                                onClick={() => { dismissHint(); onSkipTrade(messageId); }}
                                className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-zinc-100"
                                title="Mark as skipped — you did not take this setup"
                            >
                                Skip
                            </button>
                        )}
                    </>
                )}
                {onToggleWatch && (
                    <button
                        type="button"
                        onClick={() => { dismissHint(); onToggleWatch(messageId); }}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            watched
                                ? 'border-white/25 bg-zinc-800 text-zinc-100'
                                : 'border-white/10 bg-zinc-800 text-zinc-300 hover:border-white/25 hover:text-zinc-100'
                        }`}
                        title="Pin this signal to the Watch list. Autopilot and Win/Loss still work. Separate from Arm trigger."
                    >
                        {watched ? 'Pinned' : 'Pin'}
                    </button>
                )}
                <SetupWatchControl analysis={analysis} messageId={messageId} />
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setMoreOpen(o => !o)}
                        aria-expanded={moreOpen}
                        className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100"
                    >
                        More
                    </button>
                    {moreOpen && (
                        <div className="absolute left-0 top-full z-30 mt-1 flex min-w-[11rem] flex-col gap-1 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-xl">
                            {onSelectForProbability && (
                                <button
                                    onClick={() => { setMoreOpen(false); onSelectForProbability(messageId); }}
                                    className="rounded-lg px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                                >
                                    View probabilities
                                </button>
                            )}
                            {onCompare && (
                                <button
                                    onClick={() => { setMoreOpen(false); onCompare(messageId); }}
                                    className="rounded-lg px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                                >
                                    Compare
                                </button>
                            )}
                            <div className="px-1 py-0.5">
                                <ShareMenu analysis={analysis} outcome={outcome} tradingStyle={tradingStyle} message={message} />
                            </div>
                            <button
                                onClick={() => { handleSetAlerts(); setMoreOpen(false); }}
                                className="rounded-lg px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                            >
                                {alertsSet ? 'Alerts set' : 'Set alerts'}
                            </button>
                        </div>
                    )}
                </div>
                {pending && (
                    <span className="text-[9px] text-zinc-600 self-center hidden sm:inline" title="Focus the actions, then: W = win, L = loss, S = skip">
                        <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10">W</kbd>
                        <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10 ml-1">L</kbd>
                        {onSkipTrade && <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10 ml-1">S</kbd>}
                    </span>
                )}
            </div>
        </div>
    );
};

export default React.memo(AnalysisDetails);

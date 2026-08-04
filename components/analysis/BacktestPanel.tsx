
import React, { useState, useEffect } from 'react';
import { TradeAnalysis, TradeOutcome } from '../../types';
import { LoadingIcon, WinIcon, LossIcon, ActivityIcon } from '../shared/Icons';
import { simulateFromAnalysisTime, TimestampedBacktestResult } from '../../services/backtesting/BacktestingService';

interface BacktestPanelProps {
    analysis: TradeAnalysis;
    coinName: string;
    createdAt?: string;
    leverage: number;
    messageId: string;
    outcome?: TradeOutcome;
    isLogging?: boolean;
    /**
     * Called when the user confirms a WIN/LOSS outcome after passing the
     * backtest-based validation check (or directly if no backtest data exists).
     */
    onOutcomeValidated: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    /**
     * Optional secondary action buttons (Skip, Simulate, Save, Alert, Share, Update)
     * rendered within the same secondary-actions row to preserve the original layout.
     */
    children?: React.ReactNode;
}

/**
 * Backtest panel: owns backtest state, the handleBacktest handler, the entry
 * selection UI, the backtest result display, the outcome validation flow, and
 * the Win/Loss + backtest buttons. The remaining secondary action buttons are
 * injected via children so they keep their place in the secondary-actions row.
 */
const BacktestPanel: React.FC<BacktestPanelProps> = ({
    analysis,
    coinName,
    createdAt,
    leverage,
    messageId,
    outcome,
    isLogging,
    onOutcomeValidated,
    children
}) => {
    // Defensive destructuring of fields used by the panel
    const { entryPoints = [] } = analysis || {};

    // Backtest state
    const [isBacktesting, setIsBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState<TimestampedBacktestResult | null>(null);
    const [backtestError, setBacktestError] = useState<string | null>(null);

    // Entry selection state for backtest (for trades with multiple entries)
    const hasMultipleEntries = entryPoints.length > 1;
    const [selectedBacktestEntries, setSelectedBacktestEntries] = useState<number[]>(
        entryPoints.map((_, idx) => idx) // Default: all entries selected
    );

    // Re-sync selected entries when entryPoints changes
    useEffect(() => {
        setSelectedBacktestEntries(entryPoints.map((_, idx) => idx));
    }, [entryPoints]);

    // Outcome validation state
    const [outcomeValidation, setOutcomeValidation] = useState<{
        show: boolean;
        intendedOutcome: TradeOutcome.WIN | TradeOutcome.LOSS | null;
        message: string;
    }>({ show: false, intendedOutcome: null, message: '' });

    // Debug logging for backtest results (Analyst Lens debugging)
    useEffect(() => {
        if (backtestResult) {
            console.log('Backtest Result Debug:', backtestResult);
        }
    }, [backtestResult]);

    // Backtest handler - uses analysis timestamp for accurate simulation
    const handleBacktest = async () => {
        if (isBacktesting || !analysis) return;

        // Extract symbol from coinName
        const symbol = coinName?.replace(/[^A-Z0-9]/gi, '').toUpperCase() || '';
        if (!symbol || symbol === 'UNKNOWNASSET') {
            setBacktestError('Cannot backtest: No valid symbol detected');
            return;
        }

        // Ensure symbol has USDT suffix
        const normalizedSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;

        // Use analysis createdAt timestamp for accurate simulation from that point forward
        const analysisTimestamp = createdAt || new Date().toISOString();

        setIsBacktesting(true);
        setBacktestError(null);
        setBacktestResult(null);

        try {
            // Use 1m candles for precise entry detection - avoids conflicts from larger candles
            // that might have swept through entry price on a different move
            // Pass selected entries for multi-entry trades
            const result = await simulateFromAnalysisTime(
                analysis,
                normalizedSymbol,
                analysisTimestamp,
                '1m',
                leverage,
                hasMultipleEntries ? selectedBacktestEntries : undefined
            );
            setBacktestResult(result);
        } catch (error) {
            console.error('[AnalysisResult] Backtest failed:', error);
            setBacktestError('Backtest failed - check console for details');
        } finally {
            setIsBacktesting(false);
        }
    };

    // Handler to validate outcome before logging - checks if backtest data supports the user's selection
    const validateAndLogOutcome = async (selectedOutcome: TradeOutcome.WIN | TradeOutcome.LOSS) => {
        // If we have a backtest result, validate against it
        if (backtestResult) {
            const backtestOutcome = backtestResult.outcome;

            // Case 1: User says WIN but backtest shows LOSS
            if (selectedOutcome === TradeOutcome.WIN && backtestOutcome === 'LOSS') {
                setOutcomeValidation({
                    show: true,
                    intendedOutcome: selectedOutcome,
                    message: ` Backtest shows the trade hit STOP LOSS, not Take Profit.\n\nAre you sure you want to log this as a WIN? This may have been a misclick.`
                });
                return;
            }

            // Case 2: User says LOSS but backtest shows WIN
            if (selectedOutcome === TradeOutcome.LOSS && backtestOutcome === 'WIN') {
                setOutcomeValidation({
                    show: true,
                    intendedOutcome: selectedOutcome,
                    message: ` Backtest shows the trade hit TAKE PROFIT, not Stop Loss.\n\nAre you sure you want to log this as a LOSS? This may have been a misclick.`
                });
                return;
            }

            // Case 3: Trade hasn't triggered or is still open
            if (backtestOutcome === 'NOT_TRIGGERED') {
                if (!backtestResult.wouldHaveTriggered) {
                    // Entry was never hit
                    setOutcomeValidation({
                        show: true,
                        intendedOutcome: selectedOutcome,
                        message: ` Backtest shows the ENTRY was never hit.\n\nThis trade should be marked as "Skip" (Entry Not Hit) instead of ${selectedOutcome}.\n\nProceed anyway?`
                    });
                    return;
                } else {
                    // Entry hit but TP/SL not reached yet
                    setOutcomeValidation({
                        show: true,
                        intendedOutcome: selectedOutcome,
                        message: ` Backtest shows the trade is still OPEN - neither TP nor SL was hit yet.\n\nAre you manually closing this trade as a ${selectedOutcome}?`
                    });
                    return;
                }
            }
        }

        // No backtest data or outcome matches - proceed directly
        onOutcomeValidated(messageId, selectedOutcome);
    };

    // Confirm the outcome despite validation warning
    const confirmOutcome = () => {
        if (outcomeValidation.intendedOutcome) {
            onOutcomeValidated(messageId, outcomeValidation.intendedOutcome);
        }
        setOutcomeValidation({ show: false, intendedOutcome: null, message: '' });
    };

    // Cancel the outcome selection
    const cancelOutcome = () => {
        setOutcomeValidation({ show: false, intendedOutcome: null, message: '' });
    };

    return (
        <>
            {/* Backtest Result Display */}
            {(backtestResult || backtestError) && (
                <div className={`mb-3 p-3 rounded-xl border text-xs ${backtestResult?.outcome === 'WIN' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' :
                    backtestResult?.outcome === 'LOSS' ? 'bg-rose-950/30 border-rose-500/30 text-rose-300' :
                        backtestError ? 'bg-rose-950/30 border-rose-500/30 text-rose-300' :
                            'bg-zinc-800 border-zinc-700 text-zinc-300'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9px] uppercase font-bold tracking-widest opacity-70">Backtest</span>
                            {backtestResult && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${backtestResult.outcome === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' :
                                    backtestResult.outcome === 'LOSS' ? 'bg-rose-500/20 text-rose-400' :
                                        'bg-zinc-700 text-zinc-400'
                                    }`}>
                                    {backtestResult.outcome === 'NOT_TRIGGERED' ? 'OPEN' : backtestResult.outcome}
                                </span>
                            )}

                            {/* P&L Display for ALL outcomes */}
                            {backtestResult && backtestResult.currentPnlPercent !== undefined && (
                                backtestResult.outcome === 'NOT_TRIGGERED' ? (
                                    // Open trade - show current unrealized P&L
                                    backtestResult.wouldHaveTriggered ? (
                                        <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold border ${backtestResult.currentPnlPercent >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                            {backtestResult.currentPnlPercent > 0 ? '+' : ''}{backtestResult.currentPnlPercent}% {backtestResult.currentPnlPercent >= 0 ? 'UP!' : 'DOWN!'}
                                        </span>
                                    ) : (
                                        <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                                            ⏳ ENTRY PENDING
                                        </span>
                                    )
                                ) : backtestResult.outcome === 'WIN' ? (
                                    // WIN - show realized profit
                                    <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        +{backtestResult.currentPnlPercent}% PROFIT 
                                    </span>
                                ) : backtestResult.outcome === 'LOSS' ? (
                                    // LOSS - show realized loss
                                    <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                        {backtestResult.currentPnlPercent}% LOSS 
                                    </span>
                                ) : null
                            )}
                        </div>
                        <button
                            onClick={() => { setBacktestResult(null); setBacktestError(null); }}
                            className="text-zinc-500 hover:text-zinc-300 text-[10px]"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Price Display for ALL outcomes */}
                    {backtestResult && (backtestResult.currentPrice || backtestResult.priceAtExit) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] bg-zinc-800 rounded-lg px-2 py-1.5">
                            {backtestResult.outcome === 'NOT_TRIGGERED' ? (
                                // Open trade - show current price
                                <>
                                    <span className="text-zinc-500">Current:</span>
                                    <span className="font-mono font-bold text-zinc-200">${backtestResult.currentPrice?.toLocaleString()}</span>
                                </>
                            ) : (
                                // WIN/LOSS - show exit price
                                <>
                                    <span className="text-zinc-500">Exit:</span>
                                    <span className={`font-mono font-bold ${backtestResult.outcome === 'WIN' ? 'text-emerald-300' : 'text-rose-300'}`}>
                                        ${backtestResult.priceAtExit?.toLocaleString()}
                                    </span>
                                </>
                            )}
                            {backtestResult.entryPrice && (
                                <>
                                    <span className="text-zinc-600">|</span>
                                    <span className="text-zinc-500">Entry:</span>
                                    <span className="font-mono text-zinc-400">${backtestResult.entryPrice.toLocaleString()}</span>
                                </>
                            )}
                            {/* Show R:R for all outcomes */}
                            {backtestResult.currentRR !== undefined && (
                                <>
                                    <span className="text-zinc-600">|</span>
                                    <span className="text-zinc-500">R:R:</span>
                                    <span className={`font-mono font-bold ${backtestResult.currentRR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {backtestResult.currentRR > 0 ? '+' : ''}{backtestResult.currentRR}R
                                    </span>
                                </>
                            )}
                            {/* Show max drawdown */}
                            {backtestResult.maxDrawdown !== undefined && backtestResult.maxDrawdown > 0 && (
                                <>
                                    <span className="text-zinc-600">|</span>
                                    <span className="text-zinc-500">Max DD:</span>
                                    <span className="font-mono text-rose-400/80">{backtestResult.maxDrawdown.toFixed(1)}%</span>
                                </>
                            )}
                        </div>
                    )}

                    {backtestResult && (
                        <div className="mt-2 text-[10px] leading-relaxed font-mono whitespace-pre-line">
                            {backtestResult.simulationDetails}
                        </div>
                    )}

                    {/* Entry Timing Optimization */}
                    {backtestResult?.optimalEntry && (
                        <div className={`mt-2 p-2 rounded-lg border ${backtestResult.optimalEntry.improvement > 0.1
                            ? 'bg-amber-950/30 border-amber-500/20'
                            : 'bg-emerald-950/30 border-emerald-500/20'
                            }`}>
                            <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${backtestResult.optimalEntry.improvement > 0.1
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                                }`}>
                                <span>{backtestResult.optimalEntry.improvement > 0.1 ? '⏱' : ''}</span>
                                Entry Timing
                            </div>
                            {backtestResult.optimalEntry.improvement > 0.1 ? (
                                <>
                                    <div className="mt-1 text-[10px] text-amber-200/80">
                                        <span className="text-amber-300">Best entry:</span> ${backtestResult.optimalEntry.price.toLocaleString()}
                                        <span className="ml-2 text-emerald-400">
                                            (+{backtestResult.optimalEntry.improvement.toFixed(1)}% better)
                                        </span>
                                    </div>
                                    <div className="text-[9px] text-amber-400/70 mt-0.5">
                                         {backtestResult.optimalEntry.waitRecommendation}
                                    </div>
                                </>
                            ) : (
                                <div className="mt-1 text-[10px] text-emerald-300/80">
                                    {backtestResult.optimalEntry.waitRecommendation}
                                </div>
                            )}
                        </div>
                    )}

                    {backtestError && <div className="mt-1 text-rose-400">{backtestError}</div>}
                </div>
            )}

            {isLogging ? (
                <div className="flex items-center justify-center py-2 sm:py-3 text-zinc-400 gap-2">
                    <LoadingIcon className="w-4 h-4 sm:w-5 sm:h-5" /> <span className="text-[10px] sm:text-xs uppercase tracking-widest font-bold">Syncing Trade...</span>
                </div>
            ) : outcome === TradeOutcome.PENDING ? (
                <div className="space-y-2">
                    {/* Outcome Validation Modal */}
                    {outcomeValidation.show && (
                        <div className="mb-3 p-4 rounded-xl border border-amber-500/40 bg-amber-950/30 animate-pulse">
                            <div className="text-sm text-amber-200 whitespace-pre-line mb-4">
                                {outcomeValidation.message}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={confirmOutcome}
                                    className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                                >
                                    Yes, Log as {outcomeValidation.intendedOutcome}
                                </button>
                                <button
                                    onClick={cancelOutcome}
                                    className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-bold uppercase tracking-wider transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    {/* Primary Actions: Win/Loss - Full width on mobile */}
                    <div className="flex gap-2">
                        <button onClick={() => validateAndLogOutcome(TradeOutcome.WIN)} className="flex-1 border border-[#86efac]/70 bg-[#16a34a] text-white py-3 rounded-xl font-bold uppercase tracking-wide transition-colors hover:bg-[#22c55e] active:scale-[0.98] flex items-center justify-center gap-2"><WinIcon className="h-4 w-4" />Win</button>
                        <button onClick={() => validateAndLogOutcome(TradeOutcome.LOSS)} className="flex-1 border border-[#fda4af]/70 bg-[#dc2626] text-white py-3 rounded-xl font-bold uppercase tracking-wide transition-colors hover:bg-[#ef4444] active:scale-[0.98] flex items-center justify-center gap-2"><LossIcon className="h-4 w-4" />Loss</button>
                    </div>
                    {/* Entry Selector for Backtest - shown when multiple entries exist */}
                    {hasMultipleEntries && (
                        <div className="mb-2 p-2 bg-zinc-800 rounded-lg border border-white/5">
                            <div className="text-[9px] uppercase font-bold text-zinc-500 mb-1.5 flex items-center gap-1">
                                <span></span> Select entries to backtest
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {entryPoints.map((ep, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            if (selectedBacktestEntries.includes(idx)) {
                                                // Don't allow deselecting all
                                                if (selectedBacktestEntries.length > 1) {
                                                    setSelectedBacktestEntries(prev => prev.filter(i => i !== idx));
                                                }
                                            } else {
                                                setSelectedBacktestEntries(prev => [...prev, idx]);
                                            }
                                        }}
                                        className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${selectedBacktestEntries.includes(idx)
                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                            : 'bg-zinc-700 text-zinc-500 border border-white/5 hover:text-zinc-300'
                                            }`}
                                    >
                                        E{idx + 1}: ${typeof ep.price === 'object' ? '?' : ep.price}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Secondary Actions: Grid layout for mobile */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleBacktest}
                            disabled={isBacktesting}
                            className="flex-1 min-w-[60px] px-3 py-2 rounded-lg border border-cyan-300/45 bg-cyan-600/25 text-cyan-100 hover:border-cyan-200/60 hover:bg-cyan-500/35 text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            title="Run Backtest"
                        >
                            {isBacktesting ? <LoadingIcon className="w-3 h-3" /> : <><ActivityIcon className="w-3.5 h-3.5" /> Test</>}
                        </button>
                        {children}
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-3 py-1 sm:py-2">
                    <span className={`inline-block px-3 py-1.5 sm:px-5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest border ${outcome === TradeOutcome.WIN ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                        outcome === TradeOutcome.LOSS ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' :
                            'border-zinc-700 text-zinc-500 bg-zinc-800'
                        }`}>
                        Outcome: {outcome}
                    </span>
                    {/* Backtest button for logged trades too */}
                    <button
                        onClick={handleBacktest}
                        disabled={isBacktesting}
                        className="px-3 py-1.5 rounded-lg border border-cyan-300/30 text-[10px] font-bold uppercase tracking-wider text-cyan-200 bg-cyan-600/15 hover:text-cyan-100 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                        title="Run Backtest Simulation"
                    >
                        {isBacktesting ? <LoadingIcon className="w-3 h-3" /> : ' Backtest'}
                    </button>
                </div>
            )}
        </>
    );
};

export default React.memo(BacktestPanel);

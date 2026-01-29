
import React, { useState, useEffect } from 'react';
import { TradeAnalysis, TradeOutcome, AccuracySubMode, ConfidenceCalibration, ConfluenceData, BacktestResult, DualScenarioAnalysis, LevelProbabilities, ProbabilityReasoning, TradingStyle } from '../types';
import { LoadingIcon, ChevronDownIcon, BookmarkIcon, BookmarkSolidIcon, BrainIcon, UpdateIcon } from './Icons';
import { FAMILY_UI_DATA } from '../constants/models';
import { getCalibratedWinRate, getSampleSize, ConfidenceLevel } from '../services/ConfidenceCalibrationService';
import { simulateFromAnalysisTime, TimestampedBacktestResult } from '../services/BacktestingService';
import { PriceAlertService } from '../services/PriceAlertService';
import { TradeShareService } from '../services/TradeShareService';
import ConfluenceScoreIndicator from './ConfluenceScoreIndicator';
import ProbabilityWidget from './ProbabilityWidget';


interface AnalysisResultProps {
    analysis: TradeAnalysis;
    messageId: string;
    onLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    onInitiateSkip: (messageId: string) => void;
    onViewStrategy: (strategyName: string) => void;
    onApplyStrategy: (strategyName: string) => void;
    activeFrameworks: string[];
    onSaveAnalysis: (messageId: string) => void;
    onUpdateTrade?: (messageId: string) => void;
    onSimulate?: (messageId: string) => void; // Scenario Simulator
    isSaved: boolean;
    outcome?: TradeOutcome;
    isLogging?: boolean;
    imageSummaries?: string[];
    isAccuracyMode?: boolean;
    accuracySubMode?: AccuracySubMode;
    confidenceCalibration?: ConfidenceCalibration;
    confluenceData?: ConfluenceData;
    leverage?: number; // Leverage multiplier for P&L calculations
    isLensMode?: boolean; // Was this trade analyzed with Analyst Lenses enabled?
    tradingStyle?: Exclude<TradingStyle, 'auto'>; // Trading style used for this analysis
    onSelectForProbability?: (messageId: string) => void; // Select this trade for probability display
}

const AnalysisResult: React.FC<AnalysisResultProps> = ({
    analysis,
    messageId,
    onLogTrade,
    onInitiateSkip,
    onViewStrategy,
    onSaveAnalysis,
    onUpdateTrade,
    onSimulate,
    isSaved,
    outcome,
    isLogging,
    activeFrameworks,
    onApplyStrategy,
    imageSummaries,
    isAccuracyMode,
    accuracySubMode,
    confidenceCalibration,
    confluenceData,
    leverage = 100, // Default to 100x leverage for futures
    isLensMode,
    tradingStyle,
    onSelectForProbability
}) => {
    // Defensive destructuring
    const {
        coinName = 'Unknown Asset',
        confidence = 'Medium',
        probability = 0,
        strategy = 'Analysis pending...',
        entryPoints = [],
        stopLoss = 'N/A',
        stopLossPercentage,
        takeProfit = [],
        historicalCorrelation = 'N/A',
        activeStrategies = [],
        direction = 'Neutral',
        marketConditions,
        createdAt,
        rrRatio,
        detectedPatternFamily,
        detectedPatterns = [],
        keyLevels,
        isUpdate,
        updateInterval,
        devilsAdvocate,
        validationWarnings = [],
        originalConfidence,
        entryTimingScore: analysisEntryTiming,
        validityDurationMinutes,
        grade,
        dualScenarioAnalysis,
        tradeType,
        tradeTypeManualOverride,
        originalStopLossPercentage,
        levelProbabilities
    } = analysis || {};

    const [isConditionsVisible, setIsConditionsVisible] = useState(false);
    const [isDetailsVisible, setIsDetailsVisible] = useState(true);
    const [showRRTooltip, setShowRRTooltip] = useState(false);

    // Backtest state
    const [isBacktesting, setIsBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState<TimestampedBacktestResult | null>(null);
    const [backtestError, setBacktestError] = useState<string | null>(null);

    // Entry selection state for backtest (for trades with multiple entries)
    const hasMultipleEntries = entryPoints.length > 1;
    const [selectedBacktestEntries, setSelectedBacktestEntries] = useState<number[]>(
        entryPoints.map((_, idx) => idx) // Default: all entries selected
    );

    // Share and Alert state
    const [isSharing, setIsSharing] = useState(false);
    const [shareSuccess, setShareSuccess] = useState<string | null>(null);
    const [alertEnabled, setAlertEnabled] = useState(() => {
        const existingAlert = PriceAlertService.getAlertForTrade(messageId);
        return existingAlert?.enabled ?? false;
    });

    // Outcome validation state
    const [outcomeValidation, setOutcomeValidation] = useState<{
        show: boolean;
        intendedOutcome: TradeOutcome.WIN | TradeOutcome.LOSS | null;
        message: string;
    }>({ show: false, intendedOutcome: null, message: '' });

    // === AUTO-POLLING FOR ENTRY DETECTION ===
    const [autoEntryStatus, setAutoEntryStatus] = useState<{
        isActive: boolean;
        wasActiveBeforeExpiry: boolean; // Track if entry was hit within valid window
        lastChecked: Date | null;
    } | null>(null);

    // Live countdown timer state
    const [now, setNow] = useState(Date.now());

    // Debug logging for backtest results (Analyst Lens debugging)
    useEffect(() => {
        if (backtestResult) {
            console.log('Backtest Result Debug:', backtestResult);
        }
    }, [backtestResult]);

    // Auto-poll every 30 seconds for PENDING trades to detect entry
    useEffect(() => {
        if (outcome !== TradeOutcome.PENDING || !createdAt || !coinName) return;

        const checkEntry = async () => {
            try {
                const validUntilMs = validityDurationMinutes
                    ? new Date(createdAt).getTime() + validityDurationMinutes * 60 * 1000
                    : null;
                const isNowExpired = validUntilMs ? Date.now() > validUntilMs : false;

                // If already marked as active before expiry, preserve that state forever
                if (autoEntryStatus?.wasActiveBeforeExpiry) {
                    return; // Entry was hit within valid window - don't overwrite
                }

                // CRITICAL FIX: Check if entry was hit BEFORE checking expiration
                // This ensures that if entry was hit within the validity window,
                // the trade stays active even after the timer expires
                const symbol = coinName.replace(/[^A-Z0-9]/gi, '').toUpperCase();
                const normalizedSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
                const result = await simulateFromAnalysisTime(analysis, normalizedSymbol, createdAt, '1m', leverage);

                if (result.wouldHaveTriggered && result.entryTriggerTime) {
                    // Entry was triggered - verify it happened within the validity window
                    const entryTriggerMs = new Date(result.entryTriggerTime).getTime();

                    // Check if entry was hit within the validity window:
                    // - If no validity limit (validUntilMs is null), entry is always valid
                    // - Otherwise, entry must have been triggered before the validity deadline
                    const entryWithinValidityWindow = !validUntilMs || (entryTriggerMs <= validUntilMs);

                    if (entryWithinValidityWindow) {
                        // Entry hit WITHIN valid window - trade is now active and won't expire
                        console.log(`[AnalysisResult] Entry triggered at ${result.entryTriggerTime}, within validity window`);
                        setAutoEntryStatus({
                            isActive: true,
                            wasActiveBeforeExpiry: true,
                            lastChecked: new Date()
                        });
                        return;
                    } else {
                        // Entry was hit AFTER validity expired - trade should remain expired
                        console.log(`[AnalysisResult] Entry triggered at ${result.entryTriggerTime}, but AFTER validity window expired`);
                    }
                }

                // Entry was NOT hit within validity window - check if timer expired
                if (isNowExpired) {
                    setAutoEntryStatus({
                        isActive: false,
                        wasActiveBeforeExpiry: false,
                        lastChecked: new Date()
                    });
                } else {
                    // Timer not expired yet, entry not hit yet - keep polling
                    setAutoEntryStatus({
                        isActive: false,
                        wasActiveBeforeExpiry: false,
                        lastChecked: new Date()
                    });
                }
            } catch (e) {
                console.error('[AnalysisResult] Auto entry check failed:', e);
            }
        };

        checkEntry(); // Initial check
        const interval = setInterval(checkEntry, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, [outcome, createdAt, coinName, analysis, leverage, validityDurationMinutes, autoEntryStatus?.wasActiveBeforeExpiry]);

    // Calculate validity remaining FIRST (needed for isTradeActive check)
    const validUntilForExpiry = (validityDurationMinutes && createdAt)
        ? new Date(new Date(createdAt).getTime() + validityDurationMinutes * 60 * 1000)
        : null;
    const remainingMsForExpiry = validUntilForExpiry ? validUntilForExpiry.getTime() - now : 0;

    // Trade is active if entry was hit within the validity window
    const isTradeActive = autoEntryStatus?.wasActiveBeforeExpiry === true;

    // Expiration only applies if time ran out AND entry was NEVER hit within the valid window
    // If entry was hit before expiration, the trade stays active and never expires
    const isExpired = validUntilForExpiry
        ? (remainingMsForExpiry <= 0 && !autoEntryStatus?.wasActiveBeforeExpiry)
        : false;
    const showValidityTimer =
        outcome === TradeOutcome.PENDING &&
        !isTradeActive &&
        validityDurationMinutes &&
        createdAt;

    useEffect(() => {
        if (!showValidityTimer) return;
        const interval = setInterval(() => setNow(Date.now()), 60000); // Update every minute
        return () => clearInterval(interval);
    }, [showValidityTimer]);

    // Additional validity UI values (reusing calculated expiry values)
    const validUntil = showValidityTimer ? validUntilForExpiry : null;
    const remainingMs = validUntil ? validUntil.getTime() - now : 0;
    const remainingMinutes = Math.max(0, Math.ceil(remainingMs / 60000));
    const isCloseToExpiry = remainingMs > 0 && remainingMs < 30 * 60 * 1000; // < 30 min

    // Helper to format minutes as "Xh Ym"
    const formatValidityDuration = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

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
                    message: `⚠️ Backtest shows the trade hit STOP LOSS, not Take Profit.\n\nAre you sure you want to log this as a WIN? This may have been a misclick.`
                });
                return;
            }

            // Case 2: User says LOSS but backtest shows WIN
            if (selectedOutcome === TradeOutcome.LOSS && backtestOutcome === 'WIN') {
                setOutcomeValidation({
                    show: true,
                    intendedOutcome: selectedOutcome,
                    message: `⚠️ Backtest shows the trade hit TAKE PROFIT, not Stop Loss.\n\nAre you sure you want to log this as a LOSS? This may have been a misclick.`
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
                        message: `⚠️ Backtest shows the ENTRY was never hit.\n\nThis trade should be marked as "Skip" (Entry Not Hit) instead of ${selectedOutcome}.\n\nProceed anyway?`
                    });
                    return;
                } else {
                    // Entry hit but TP/SL not reached yet
                    setOutcomeValidation({
                        show: true,
                        intendedOutcome: selectedOutcome,
                        message: `⚠️ Backtest shows the trade is still OPEN - neither TP nor SL was hit yet.\n\nAre you manually closing this trade as a ${selectedOutcome}?`
                    });
                    return;
                }
            }
        }

        // No backtest data or outcome matches - proceed directly
        onLogTrade(messageId, selectedOutcome);
    };

    // Confirm the outcome despite validation warning
    const confirmOutcome = () => {
        if (outcomeValidation.intendedOutcome) {
            onLogTrade(messageId, outcomeValidation.intendedOutcome);
        }
        setOutcomeValidation({ show: false, intendedOutcome: null, message: '' });
    };

    // Cancel the outcome selection
    const cancelOutcome = () => {
        setOutcomeValidation({ show: false, intendedOutcome: null, message: '' });
    };

    // Ensure direction is a valid string to prevent crashes if 'Neutral' object is passed
    const safeDirectionString = typeof direction === 'string' ? direction : 'Neutral';
    const isLong = safeDirectionString === 'Long';
    const isShort = safeDirectionString === 'Short';
    const isNeutral = !isLong && !isShort;

    const directionColor = isLong ? 'text-emerald-400' : isShort ? 'text-rose-400' : 'text-gray-400';
    const directionBg = isLong ? 'bg-emerald-500/15 border-emerald-400/30 shadow-emerald-500/20' : isShort ? 'bg-rose-500/15 border-rose-400/30 shadow-rose-500/20' : 'bg-gray-500/15 border-gray-400/30 shadow-gray-500/20';
    const directionGradient = isLong ? 'from-emerald-500/30 via-emerald-500/10 to-transparent' : isShort ? 'from-rose-500/30 via-rose-500/10 to-transparent' : 'from-gray-500/30 via-gray-500/10 to-transparent';

    // Helper to find family UI details
    const familyData = detectedPatternFamily ? FAMILY_UI_DATA.find(f =>
        detectedPatternFamily.toLowerCase().includes(f.name.toLowerCase()) ||
        detectedPatternFamily.toLowerCase().includes(f.tag.toLowerCase())
    ) : null;

    const familyColorClass = familyData?.color === 'red' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
        familyData?.color === 'emerald' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
            familyData?.color === 'blue' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                familyData?.color === 'purple' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
                    'text-zinc-400 bg-zinc-900/50 border-white/5';

    // Mode Badge Logic - All accuracy modes use cyan dark theme
    let modeBadge = null;
    if (isAccuracyMode) {
        modeBadge = (
            <span className="px-2 py-1 rounded text-[9px] font-black bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 uppercase tracking-widest shadow-[0_0_10px_-3px_rgba(34,211,238,0.4)] animate-pulse">
                {accuracySubMode === 'pure_ai' ? 'PURE AI REASONING' : 'STRICT ACCURACY MODE'}
            </span>
        );
    } else {
        modeBadge = (
            <span className="px-2 py-1 rounded text-[9px] font-bold bg-zinc-800 border border-white/10 text-zinc-500 uppercase tracking-widest">
                STANDARD MODE
            </span>
        );
    }

    // Lens Mode Badge - shows when this trade was analyzed with Analyst Lenses enabled
    const lensBadge = isLensMode ? (
        <span className="px-2 py-1 rounded text-[9px] font-bold bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 uppercase tracking-widest flex items-center gap-1">
            <span>🎭</span> LENS MODE
        </span>
    ) : null;

    // Safe RR check - check if it is defined and is a valid number > 0
    const hasValidRR = rrRatio !== undefined && rrRatio !== null && !isNaN(rrRatio) && rrRatio > 0;

    return (
        <div className="mt-6 sm:mt-8 w-full pb-28 sm:pb-8">

            {/* Coin Name Header */}
            <div className="mb-4 sm:mb-6 flex items-center px-1 justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 sm:gap-4 overflow-hidden min-w-0">
                    <div className={`w-1.5 h-10 sm:w-2 sm:h-14 rounded-full shrink-0 ${isLong ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_20px_rgba(52,211,153,0.5)]' : isShort ? 'bg-gradient-to-b from-rose-400 to-rose-600 shadow-[0_0_20px_rgba(244,63,94,0.5)]' : 'bg-gradient-to-b from-cyan-400 to-cyan-600 shadow-[0_0_20px_rgba(34,211,238,0.5)]'}`}></div>
                    <h3 className="text-2xl sm:text-4xl font-black text-white tracking-tight uppercase truncate min-w-0 drop-shadow-lg">{coinName}</h3>
                    <span className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-bold bg-white/5 backdrop-blur-sm text-zinc-300 border border-white/10 uppercase tracking-wider shrink-0 shadow-lg">FUTURES</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1 sm:mt-0">
                    {modeBadge}
                    {lensBadge}
                    {onSelectForProbability && (
                        <button
                            onClick={() => onSelectForProbability(messageId)}
                            className="px-2 py-1 rounded text-[9px] font-bold bg-purple-950/80 border border-purple-500/40 text-purple-300 uppercase tracking-widest flex items-center gap-1 hover:bg-purple-500/30 transition-colors shadow-[0_0_10px_-3px_rgba(168,85,247,0.4)]"
                            title="View AI Probability estimations in side panel"
                        >
                            <span>📊</span> VIEW PROBABILITIES
                        </button>
                    )}
                </div>

                {isUpdate && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-900/50 to-cyan-800/30 border border-cyan-400/40 text-cyan-300 shadow-[0_0_25px_-5px_rgba(34,211,238,0.4)] animate-pulse backdrop-blur-sm">
                        <UpdateIcon className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                            Updated Setup {updateInterval ? `(+${updateInterval})` : ''}
                        </span>
                    </div>
                )}
            </div>

            {/* Live Probability Widget */}
            {confidenceCalibration && confidence && (
                <div className="mb-4 px-1">
                    <ProbabilityWidget
                        confidence={confidence as ConfidenceLevel}
                        calibration={confidenceCalibration}
                        coin={coinName}
                        direction={safeDirectionString as 'Long' | 'Short' | 'Neutral'}
                    />
                </div>
            )}

            {/* Header Card (Collapsible Trigger) - Modern Glassmorphism */}
            <div
                className={`relative overflow-hidden ${isDetailsVisible ? 'rounded-t-3xl sm:rounded-t-[2rem] border-b-0' : 'rounded-3xl sm:rounded-[2rem] hover:scale-[1.01] cursor-pointer'} border-2 ${isLong ? 'border-emerald-400/40' : isShort ? 'border-rose-400/40' : 'border-gray-400/40'} bg-zinc-900/80 backdrop-blur-xl transition-all duration-500 group shadow-2xl hover:shadow-3xl`}
                onClick={() => setIsDetailsVisible(!isDetailsVisible)}
            >
                {/* Premium Gradient Overlay */}
                <div className={`absolute inset-0 bg-gradient-to-br ${directionGradient}`}></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>

                {/* Animated Glow Effect */}
                <div className={`absolute -inset-1 rounded-3xl blur-2xl opacity-30 ${isLong ? 'bg-emerald-500' : isShort ? 'bg-rose-500' : 'bg-gray-500'} group-hover:opacity-40 transition-opacity duration-500`}></div>

                <div className="relative p-4 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 z-10">
                    {/* Direction, Type, and Confidence - stacks vertically on mobile */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 w-full sm:w-auto">
                        {/* Row 1: Direction Badge + Trading Style */}
                        <div className="flex items-center gap-3 sm:gap-5">
                            <div className={`px-4 py-2.5 sm:px-6 sm:py-3.5 rounded-2xl font-black text-lg sm:text-2xl uppercase tracking-wide border-2 shadow-xl transition-transform duration-300 group-hover:scale-105 ${directionBg} ${directionColor}`}>
                                {safeDirectionString}
                            </div>
                            {/* Trade Type Badge - Always visible next to direction */}
                            {tradingStyle && (
                                <div className={`px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-widest border flex items-center gap-1.5 relative
                                    ${tradingStyle === 'scalp'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                        : 'bg-violet-500/10 text-violet-400 border-violet-500/30'}`}>
                                    <span>{tradingStyle === 'scalp' ? '⚡' : '🔄'}</span>
                                    <span>{tradingStyle.toUpperCase()}</span>
                                    {tradeTypeManualOverride && (
                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(6,182,212,0.8)]" title="Manually overridden by user"></span>
                                    )}
                                </div>
                            )}
                        </div>
                        {/* Row 2 on mobile: Confidence Section */}
                        <div className="flex flex-col justify-center">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-0.5">Confidence</span>
                            <span className={`text-lg sm:text-2xl font-mono font-bold leading-none ${confidence === 'High' ? 'text-emerald-400' :
                                confidence === 'Medium' ? 'text-yellow-400' :
                                    confidence === 'Low' ? 'text-orange-400' : 'text-red-500'
                                }`}>
                                {confidence} <span className="text-base sm:text-lg opacity-70 font-sans">({probability}%)</span>
                            </span>
                            {/* Calibrated Win Rate */}
                            {(() => {
                                const calibratedRate = getCalibratedWinRate(confidenceCalibration, confidence as ConfidenceLevel);
                                const sampleSize = getSampleSize(confidenceCalibration, confidence as ConfidenceLevel);
                                if (calibratedRate !== null) {
                                    return (
                                        <div className="mt-1 flex items-center gap-1.5">
                                            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Historical:</span>
                                            <span className={`text-xs font-bold ${calibratedRate >= 65 ? 'text-emerald-400' : calibratedRate >= 50 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                                {calibratedRate}% win
                                            </span>
                                            <span className="text-[8px] text-zinc-600">({sampleSize} trades)</span>
                                        </div>
                                    );
                                }
                                return sampleSize > 0 ? (
                                    <div className="mt-1 text-[9px] text-zinc-600 italic">Need {3 - sampleSize} more trades to calibrate</div>
                                ) : null;
                            })()}
                        </div>
                    </div>

                    <div className="flex items-center gap-4 self-start sm:self-auto">
                        {createdAt && (
                            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400/80 bg-black/20 px-3 py-2 rounded-lg sm:rounded-xl border border-white/5">
                                <span className="uppercase tracking-wider opacity-60">Analyzed</span>
                                <span className="text-zinc-300">{new Date(createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )}

                        {/* Validity Timer - only shows for pending trades awaiting entry */}
                        {showValidityTimer && (
                            <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1.5 rounded-lg border
                                ${isExpired ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
                                    isCloseToExpiry ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                                        'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'}`}>
                                <span>⏱️</span>
                                <span>{isExpired ? 'EXPIRED' : `${formatValidityDuration(remainingMinutes)} left`}</span>
                            </div>
                        )}

                        {/* ACTIVE badge - shows when entry has been triggered */}
                        {isTradeActive && outcome === TradeOutcome.PENDING && (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1.5 rounded-lg 
                                text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                                <span>🟢</span>
                                <span>ACTIVE</span>
                            </div>
                        )}
                        <div className={`p-2 rounded-full border border-white/10 bg-black/20 text-zinc-400 transition-transform duration-300 ${isDetailsVisible ? 'rotate-180' : 'group-hover:text-white group-hover:border-white/20'}`}>
                            <ChevronDownIcon className="w-4 h-4" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Data Grid (Collapsible) - Modern Glassmorphism */}
            <div className={`collapsible-content ${isDetailsVisible ? 'expanded' : ''} bg-zinc-900/70 backdrop-blur-xl border-2 ${isLong ? 'border-emerald-400/30' : isShort ? 'border-rose-400/30' : 'border-gray-400/30'} border-t-0 rounded-b-3xl sm:rounded-b-[2rem] shadow-inner`}>

                {/* Strategy Chips */}
                {activeStrategies && Array.isArray(activeStrategies) && activeStrategies.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-white/5 bg-white/5 flex flex-wrap gap-2 sm:gap-3">
                        {(activeStrategies || []).map((s, i) => (
                            <button
                                key={i}
                                onClick={() => onViewStrategy(s)}
                                className="text-[10px] sm:text-xs uppercase font-bold tracking-wide px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-zinc-800 hover:bg-cyan-900/30 text-zinc-400 hover:text-cyan-300 transition-colors border border-white/10 hover:border-cyan-500/30"
                            >
                                {s}
                            </button>
                        ))}
                        {activeStrategies.some(s => !activeFrameworks.includes(s)) && (
                            <button onClick={() => onApplyStrategy(activeStrategies[0])} className="text-[10px] sm:text-xs px-3 py-1.5 sm:px-4 sm:py-2 text-cyan-500 hover:underline opacity-80 font-medium">+ Add</button>
                        )}
                    </div>
                )}

                {/* Core Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                    {/* Entry */}
                    <div className="p-4 sm:p-6 space-y-3">
                        <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></div>
                                <span>Entry Zone</span>
                            </div>
                            {/* Entry Timing Score Badge */}
                            {analysisEntryTiming && (
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border shrink-0 ${analysisEntryTiming.score >= 70 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                    analysisEntryTiming.score >= 50 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                        analysisEntryTiming.score >= 35 ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                                            'bg-rose-500/20 text-rose-400 border-rose-500/30'
                                    }`} title={`Entry Quality: ${analysisEntryTiming.timingQuality}`}>
                                    Entry: {analysisEntryTiming.score}/100
                                </span>
                            )}
                        </div>
                        <div className="space-y-2">
                            {(entryPoints && entryPoints.length > 0) ? (entryPoints || []).map((ep, i) => (
                                <div key={i} className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-400/20 rounded-2xl sm:rounded-2xl p-4 backdrop-blur-sm shadow-lg hover:shadow-blue-500/10 transition-all duration-300 hover:scale-[1.02]">
                                    <div className="text-xl sm:text-3xl font-mono font-black text-blue-200 tracking-tight break-words drop-shadow-lg">{typeof ep.price === 'object' ? 'Invalid Price' : ep.price}</div>
                                    <div className="text-xs sm:text-sm text-blue-300/80 leading-tight mt-2 font-medium">{typeof ep.description === 'object' ? '' : ep.description}</div>
                                </div>
                            )) : <div className="text-zinc-600 text-xs sm:text-sm italic">No specific entry provided.</div>}
                        </div>
                        {/* Suggested Better Entry */}
                        {analysisEntryTiming?.suggestedEntry && (
                            <div className="mt-2 p-2 bg-cyan-950/30 border border-cyan-500/20 rounded-lg">
                                <div className="text-[9px] uppercase font-bold text-cyan-500 tracking-widest mb-1">💡 Better Entry Available</div>
                                <div className="text-xs text-cyan-200">
                                    <span className="font-mono font-bold">${analysisEntryTiming.suggestedEntry.price.toLocaleString()}</span>
                                    <span className="text-cyan-400/70 ml-2">({analysisEntryTiming.suggestedEntry.reason})</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stop Loss */}
                    <div className="p-4 sm:p-6 space-y-3 bg-rose-500/[0.02]">
                        <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></div> Stop Loss
                        </div>
                        <div className="bg-gradient-to-br from-rose-500/15 to-rose-600/5 border border-rose-400/25 rounded-2xl sm:rounded-2xl p-4 backdrop-blur-sm shadow-lg hover:shadow-rose-500/10 transition-all duration-300 hover:scale-[1.02]">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-2 sm:gap-3">
                                <span className="text-xl sm:text-3xl font-mono font-black text-rose-300 tracking-tight break-words drop-shadow-lg">{stopLoss || 'N/A'}</span>
                                <div className="flex flex-col items-end gap-1">
                                    {stopLossPercentage && <span className="text-xs font-mono font-bold text-rose-400 bg-rose-950/60 px-3 py-1.5 rounded-xl sm:rounded-xl border border-rose-400/20 shadow-inner">{stopLossPercentage}</span>}
                                    {originalStopLossPercentage && originalStopLossPercentage !== stopLossPercentage && (
                                        <span className="text-[10px] font-mono text-zinc-500 strike-through line-through opacity-60">
                                            {originalStopLossPercentage}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {hasValidRR && (
                                <div className="mt-3 pt-2 border-t border-rose-500/10 flex justify-between items-center relative">
                                    <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Risk/Reward</span>

                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowRRTooltip(!showRRTooltip); }}
                                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded-lg transition-all hover:scale-105 active:scale-95 cursor-help relative z-10 ${rrRatio! >= 2 ? 'text-emerald-400 bg-emerald-950/30' : rrRatio! >= 1.2 ? 'text-yellow-400 bg-yellow-950/30' : 'text-orange-400 bg-orange-950/30'}`}
                                    >
                                        1:{rrRatio}
                                    </button>

                                    {showRRTooltip && (
                                        <div className="absolute bottom-full right-0 mb-2 w-48 p-3 bg-zinc-900 border border-white/10 rounded-xl shadow-xl z-50 animate-fade-in text-[10px] text-zinc-300">
                                            <div className="font-bold text-zinc-200 mb-1 border-b border-white/5 pb-1">Calculation Formula</div>
                                            <div className="font-mono text-cyan-300 mb-2 text-center bg-black/20 p-1 rounded">Reward / Risk</div>
                                            <div className="space-y-1.5 opacity-90">
                                                <div className="flex justify-between"><span>Reward:</span> <span className="font-mono text-emerald-400">|TP - Entry|</span></div>
                                                <div className="flex justify-between"><span>Risk:</span> <span className="font-mono text-rose-400">|Entry - SL|</span></div>
                                            </div>
                                            <div className="mt-2 pt-2 border-t border-white/5 text-[9px] text-zinc-500 italic">
                                                Calculated using Entry Price and the nearest Take Profit target.
                                            </div>
                                            {/* Triangle pointer */}
                                            <div className="absolute -bottom-1 right-4 w-2 h-2 bg-zinc-900 border-r border-b border-white/10 transform rotate-45"></div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {/* Extended SL (150% Zone) */}
                            {(() => {
                                // Parse entry and SL to calculate extended SL
                                const parsePrice = (priceStr: string): number => {
                                    if (!priceStr || priceStr === 'N/A') return 0;
                                    const cleaned = priceStr.replace(/[$,\s]/g, '');
                                    const lower = cleaned.toLowerCase();
                                    if (cleaned.includes('-') || lower.includes('to')) {
                                        const parts = lower.includes('to') ? lower.split('to') : cleaned.split('-');
                                        if (parts.length === 2) {
                                            const p1 = parseFloat(parts[0].replace(/[^0-9.]/g, ''));
                                            const p2 = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
                                            if (!isNaN(p1) && !isNaN(p2)) return (p1 + p2) / 2;
                                        }
                                    }
                                    const num = parseFloat(cleaned.replace(/\s+/g, ''));
                                    return isNaN(num) ? 0 : num;
                                };

                                const entryPrice = entryPoints?.[0]?.price ? parsePrice(String(entryPoints[0].price)) : 0;
                                const slPrice = parsePrice(String(stopLoss));
                                const isLong = direction === 'Long';

                                if (entryPrice > 0 && slPrice > 0) {
                                    const slDistance = Math.abs(entryPrice - slPrice);
                                    // Extended SL is 150% of original SL distance from entry
                                    const extendedSlPrice = isLong
                                        ? slPrice - (slDistance * 0.5)  // 150% below entry for Long
                                        : slPrice + (slDistance * 0.5); // 150% above entry for Short

                                    return (
                                        <div className="mt-3 pt-2 border-t border-rose-500/10">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1">
                                                    <span className="text-amber-500">⚠️</span> Extended SL (150%)
                                                </span>
                                                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/30 px-2 py-0.5 rounded-lg">
                                                    ${extendedSlPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                            <p className="text-[8px] text-zinc-600 mt-1 italic">
                                                Max loss threshold used in backtest simulation
                                            </p>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </div>

                    {/* Take Profit */}
                    <div className="p-4 sm:p-6 space-y-3 bg-emerald-500/[0.03]">
                        <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_12px_#10b981]"></div> Targets
                        </div>
                        <div className="space-y-2.5">
                            {(takeProfit && takeProfit.length > 0) ? (takeProfit || []).map((tp, i) => (
                                <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-400/20 px-4 py-3 rounded-2xl sm:rounded-2xl group hover:scale-[1.02] hover:shadow-emerald-500/10 transition-all duration-300 backdrop-blur-sm shadow-lg">
                                    <span className="font-mono font-black text-xl sm:text-2xl text-emerald-300 break-words drop-shadow-lg">{typeof tp.price === 'object' ? 'Invalid' : tp.price}</span>
                                    {tp.percentage && <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-xl sm:rounded-xl self-start sm:self-auto border border-emerald-400/20 shadow-inner">{typeof tp.percentage === 'object' ? '' : tp.percentage}</span>}
                                </div>
                            )) : <div className="text-zinc-600 text-xs sm:text-sm italic">No targets defined.</div>}
                        </div>
                    </div>
                </div>

                {/* Market Classification Family Section */}
                {detectedPatternFamily && (
                    <div className={`px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 ${familyColorClass.split(' ').filter(c => c.startsWith('bg-')).join(' ')} bg-opacity-20`}>
                        <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-2 tracking-widest pl-1">
                            <BrainIcon className="w-3 h-3" /> Market Classification
                        </h4>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-lg sm:text-xl font-black uppercase tracking-tight ${familyColorClass.split(' ').find(c => c.startsWith('text-')) || 'text-zinc-200'}`}>
                                {detectedPatternFamily}
                            </span>
                            {familyData?.nickname && (
                                <span className="text-[10px] sm:text-xs font-medium text-zinc-400 italic border-l border-white/10 pl-2">
                                    "{familyData.nickname}"
                                </span>
                            )}
                            {/* Grade Badge */}
                            {grade && (
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wide border ml-auto
                                    ${grade === 'A' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shadow-[0_0_10px_-3px_rgba(16,185,129,0.4)]' :
                                        grade === 'B' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                                            grade === 'C' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' :
                                                grade === 'D' ? 'bg-orange-500/20 text-orange-300 border-orange-500/30' :
                                                    'bg-rose-500/20 text-rose-300 border-rose-500/30'}`}>
                                    Grade {grade}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Detected Patterns Section */}
                {detectedPatterns && detectedPatterns.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-2 tracking-widest">
                            <span>📊</span> Detected Patterns ({detectedPatterns.length})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {detectedPatterns.map((pattern, idx) => (
                                <div key={idx} className={`px-3 py-2 rounded-lg text-xs border backdrop-blur-sm
                                    ${pattern.type === 'Bullish' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                                        pattern.type === 'Bearish' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' :
                                            'bg-zinc-500/10 border-zinc-500/20 text-zinc-300'}`}>
                                    <div className="font-bold flex items-center gap-1.5">
                                        <span>{pattern.type === 'Bullish' ? '📈' : pattern.type === 'Bearish' ? '📉' : '➡️'}</span>
                                        {pattern.name}
                                    </div>
                                    <div className="text-[10px] opacity-70 mt-0.5">
                                        {pattern.timeframe} • {pattern.confidence || 'Medium'}
                                    </div>
                                    {pattern.description && (
                                        <div className="text-[9px] opacity-50 mt-1 italic">{pattern.description}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Key Levels Section */}
                {keyLevels && (keyLevels.support?.length > 0 || keyLevels.resistance?.length > 0) && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-2 tracking-widest">
                            <span>🎯</span> Key Levels
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Support Levels */}
                            {keyLevels.support && keyLevels.support.length > 0 && (
                                <div>
                                    <span className="text-[9px] uppercase font-bold text-emerald-500 tracking-wider block mb-1.5">Support</span>
                                    <div className="space-y-1">
                                        {keyLevels.support.slice(0, 3).map((level, idx) => (
                                            <div key={idx} className="text-xs font-mono text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                                                {level}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Resistance Levels */}
                            {keyLevels.resistance && keyLevels.resistance.length > 0 && (
                                <div>
                                    <span className="text-[9px] uppercase font-bold text-rose-500 tracking-wider block mb-1.5">Resistance</span>
                                    <div className="space-y-1">
                                        {keyLevels.resistance.slice(0, 3).map((level, idx) => (
                                            <div key={idx} className="text-xs font-mono text-rose-300 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20">
                                                {level}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Dual Scenario Analysis Section */}
                {dualScenarioAnalysis && (
                    <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10 bg-gradient-to-b from-indigo-950/20 to-transparent">
                        <h4 className="text-[10px] uppercase font-bold text-indigo-400 mb-3 flex items-center gap-2 tracking-widest">
                            <span className="text-base">⚖️</span> Dual Scenario Analysis
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                            {/* Bullish Scenario */}
                            <div className={`p-3 rounded-lg border ${dualScenarioAnalysis.selectedScenario === 'bullish'
                                ? 'bg-emerald-500/15 border-emerald-400/40 ring-2 ring-emerald-500/20'
                                : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-lg">📈</span>
                                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Bullish Scenario</span>
                                    {dualScenarioAnalysis.selectedScenario === 'bullish' && (
                                        <span className="ml-auto px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/30 text-emerald-300 border border-emerald-400/30">
                                            SELECTED
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-1.5 text-[10px]">
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Trigger:</span>
                                        <span className="text-emerald-200 font-mono">{dualScenarioAnalysis.bullish.trigger}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Confirm:</span>
                                        <span className="text-emerald-200/80">{dualScenarioAnalysis.bullish.confirmation}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Target:</span>
                                        <span className="text-emerald-300 font-mono font-bold">{dualScenarioAnalysis.bullish.target}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Invalidation:</span>
                                        <span className="text-rose-300 font-mono">{dualScenarioAnalysis.bullish.invalidation}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Bearish Scenario */}
                            <div className={`p-3 rounded-lg border ${dualScenarioAnalysis.selectedScenario === 'bearish'
                                ? 'bg-rose-500/15 border-rose-400/40 ring-2 ring-rose-500/20'
                                : 'bg-rose-500/5 border-rose-500/20'}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-lg">📉</span>
                                    <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Bearish Scenario</span>
                                    {dualScenarioAnalysis.selectedScenario === 'bearish' && (
                                        <span className="ml-auto px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/30 text-rose-300 border border-rose-400/30">
                                            SELECTED
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-1.5 text-[10px]">
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Trigger:</span>
                                        <span className="text-rose-200 font-mono">{dualScenarioAnalysis.bearish.trigger}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Confirm:</span>
                                        <span className="text-rose-200/80">{dualScenarioAnalysis.bearish.confirmation}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Target:</span>
                                        <span className="text-rose-300 font-mono font-bold">{dualScenarioAnalysis.bearish.target}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-zinc-500 w-20 shrink-0">Invalidation:</span>
                                        <span className="text-emerald-300 font-mono">{dualScenarioAnalysis.bearish.invalidation}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Selection Reasoning */}
                        <div className="bg-black/20 border border-indigo-500/20 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] uppercase font-bold text-indigo-400 tracking-wider">Selection Reasoning</span>
                                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${dualScenarioAnalysis.confidenceInSelection >= 70
                                    ? 'text-emerald-400 bg-emerald-500/20'
                                    : dualScenarioAnalysis.confidenceInSelection >= 50
                                        ? 'text-yellow-400 bg-yellow-500/20'
                                        : 'text-orange-400 bg-orange-500/20'}`}>
                                    {dualScenarioAnalysis.confidenceInSelection}% confident
                                </span>
                            </div>
                            <p className="text-xs text-indigo-200/80 leading-relaxed italic">
                                "{dualScenarioAnalysis.selectionReasoning}"
                            </p>
                        </div>
                    </div>
                )}

                {/* Multi-Timeframe Confluence Score */}
                {confluenceData && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10">
                        <ConfluenceScoreIndicator data={confluenceData} />
                    </div>
                )}

                {/* Gate Scan Results */}
                {analysis.gateResult && (
                    <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10 bg-gradient-to-b from-cyan-950/20 to-transparent">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[10px] uppercase font-bold text-cyan-400 tracking-widest flex items-center gap-2">
                                <span className="text-base">🚨</span> Gate Scan
                            </h4>
                            <div className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest ${analysis.gateResult.passed
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}>
                                {analysis.gateResult.passed ? 'PASSED' : 'BLOCKED'}
                            </div>
                        </div>

                        {/* Confidence Cap */}
                        <div className="flex items-center gap-4 mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] uppercase font-bold text-zinc-500">Confidence Cap:</span>
                                <span className={`text-lg font-mono font-bold ${analysis.gateResult.confidenceCap >= 0.7 ? 'text-emerald-400' :
                                    analysis.gateResult.confidenceCap >= 0.5 ? 'text-yellow-400' :
                                        analysis.gateResult.confidenceCap >= 0.35 ? 'text-orange-400' : 'text-rose-400'
                                    }`}>
                                    {(analysis.gateResult.confidenceCap * 100).toFixed(0)}%
                                </span>
                            </div>
                            {analysis.gateResult.penalties.effectiveTotal > 0 && (
                                <span className="text-[9px] text-zinc-500">
                                    (−{(analysis.gateResult.penalties.effectiveTotal * 100).toFixed(0)}% penalty)
                                </span>
                            )}
                        </div>

                        {/* Penalty Breakdown */}
                        {analysis.gateResult.penalties.effectiveTotal > 0 && (
                            <div className="mb-3 p-2 bg-black/20 rounded-lg border border-white/5">
                                <span className="text-[8px] uppercase font-bold text-zinc-600 tracking-wider block mb-1.5">Penalty Breakdown:</span>
                                <div className="flex flex-wrap gap-2">
                                    {analysis.gateResult.penalties.dataIntegrity > 0 && (
                                        <span className="text-[9px] font-mono text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                                            Data: −{(analysis.gateResult.penalties.dataIntegrity * 100).toFixed(0)}%
                                        </span>
                                    )}
                                    {analysis.gateResult.penalties.patternMemory > 0 && (
                                        <span className="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                                            Memory: −{(analysis.gateResult.penalties.patternMemory * 100).toFixed(0)}%
                                        </span>
                                    )}
                                    {analysis.gateResult.penalties.htfConflict > 0 && (
                                        <span className="text-[9px] font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">
                                            HTF: −{(analysis.gateResult.penalties.htfConflict * 100).toFixed(0)}%
                                        </span>
                                    )}
                                    {analysis.gateResult.penalties.volumeContext > 0 && (
                                        <span className="text-[9px] font-mono text-zinc-400 bg-zinc-500/10 px-1.5 py-0.5 rounded">
                                            Volume: −{(analysis.gateResult.penalties.volumeContext * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Family Bias */}
                        {analysis.gateResult.familyBias.reasoning.length > 0 && (
                            <div className="mb-3">
                                <span className="text-[8px] uppercase font-bold text-zinc-600 tracking-wider block mb-1.5">Family Bias:</span>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {(['A', 'B', 'C', 'Omega'] as const).map(f => {
                                        const bias = analysis.gateResult!.familyBias[f];
                                        if (bias === 0) return null;
                                        return (
                                            <span key={f} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${bias > 0
                                                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                                                : 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                                                }`}>
                                                {f === 'Omega' ? 'Ω' : f}: {bias > 0 ? '+' : ''}{(bias * 100).toFixed(0)}%
                                            </span>
                                        );
                                    })}
                                </div>
                                <div className="text-[9px] text-cyan-300/70 italic">
                                    {analysis.gateResult.familyBias.reasoning.slice(0, 2).join(' • ')}
                                </div>
                            </div>
                        )}

                        {/* Suggested Direction */}
                        {analysis.gateResult.suggestedDirection && analysis.gateResult.suggestedDirection !== 'Neutral' && (
                            <div className={`mb-3 p-2 rounded-lg border ${analysis.gateResult.suggestedDirection === 'Long'
                                ? 'bg-emerald-950/30 border-emerald-500/20'
                                : 'bg-rose-950/30 border-rose-500/20'
                                }`}>
                                <div className="flex items-center gap-2">
                                    <span className="text-base">{analysis.gateResult.suggestedDirection === 'Long' ? '📈' : '📉'}</span>
                                    <span className={`text-xs font-bold ${analysis.gateResult.suggestedDirection === 'Long' ? 'text-emerald-400' : 'text-rose-400'
                                        }`}>
                                        Pattern Memory suggests {analysis.gateResult.suggestedDirection}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Warnings */}
                        {analysis.gateResult.warnings.length > 0 && (
                            <div className="mb-2">
                                {analysis.gateResult.warnings.map((w, idx) => (
                                    <div key={idx} className="flex items-start gap-1.5 text-[10px] text-amber-300/80 mb-1">
                                        <span className="text-amber-500">•</span>
                                        <span>{w}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Insights */}
                        {analysis.gateResult.insights.length > 0 && (
                            <div>
                                {analysis.gateResult.insights.map((insight, idx) => (
                                    <div key={idx} className="flex items-start gap-1.5 text-[10px] text-cyan-300/80 mb-1">
                                        <span>💡</span>
                                        <span>{insight}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Historical Correlation */}
                {historicalCorrelation && historicalCorrelation !== 'N/A' && (
                    <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10 bg-gradient-to-b from-zinc-900 to-black/40">
                        <h4 className="text-[10px] uppercase font-bold text-cyan-600 mb-2 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div> Pattern Memory Insight
                        </h4>
                        <p className="text-xs sm:text-sm text-cyan-100/90 leading-relaxed italic border-l-2 border-cyan-500/30 pl-4">
                            "{historicalCorrelation}"
                        </p>
                    </div>
                )}

                {/* Confidence Adjustment Notice */}
                {originalConfidence && originalConfidence !== confidence && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 bg-gradient-to-r from-amber-950/30 to-transparent">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                ⚠️
                            </div>
                            <div>
                                <h4 className="text-[10px] uppercase font-bold text-amber-500 tracking-widest mb-0.5">Confidence Adjusted</h4>
                                <p className="text-xs text-amber-200/80">
                                    Original: <span className="font-bold text-amber-300">{originalConfidence}</span> →
                                    Adjusted: <span className="font-bold text-amber-400">{confidence}</span>
                                    <span className="text-amber-200/50 text-[10px] ml-2">(by validation gate)</span>
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Validation Warnings */}
                {validationWarnings && validationWarnings.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 bg-gradient-to-b from-orange-950/20 to-transparent">
                        <h4 className="text-[10px] uppercase font-bold text-orange-500 mb-2 flex items-center gap-2 tracking-widest">
                            <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div> Validation Warnings ({validationWarnings.length})
                        </h4>
                        <div className="space-y-2">
                            {validationWarnings.slice(0, 5).map((warning, idx) => (
                                <div key={idx} className="text-[10px] sm:text-xs text-orange-200/80 bg-orange-950/30 border border-orange-500/20 px-3 py-2 rounded-lg">
                                    {warning}
                                </div>
                            ))}
                            {validationWarnings.length > 5 && (
                                <div className="text-[9px] text-orange-400/60 italic">
                                    +{validationWarnings.length - 5} more warnings
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Devil's Advocate Section */}
                {devilsAdvocate && (
                    <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10 bg-gradient-to-b from-purple-950/20 to-transparent">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[10px] uppercase font-bold text-purple-400 tracking-widest flex items-center gap-2">
                                <span className="text-base">😈</span> Devil's Advocate Analysis
                            </h4>
                            <div className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest ${devilsAdvocate.riskScore >= 70 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                                devilsAdvocate.riskScore >= 50 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                    'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                }`}>
                                Risk Score: {devilsAdvocate.riskScore}/100
                            </div>
                        </div>

                        {/* Bear Case Reasons */}
                        {devilsAdvocate.bearCaseReasons && devilsAdvocate.bearCaseReasons.length > 0 && (
                            <div className="mb-3">
                                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block mb-1.5">Why This Trade Could Fail:</span>
                                <div className="space-y-1.5">
                                    {devilsAdvocate.bearCaseReasons.slice(0, 3).map((reason, idx) => (
                                        <div key={idx} className="flex items-start gap-2 text-xs text-purple-200/80">
                                            <span className="text-rose-400 shrink-0">•</span>
                                            <span>{reason}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Failure Scenarios */}
                        {devilsAdvocate.failureScenarios && devilsAdvocate.failureScenarios.length > 0 && (
                            <div className="mb-3">
                                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider block mb-1.5">Failure Scenarios:</span>
                                <div className="space-y-1">
                                    {devilsAdvocate.failureScenarios.slice(0, 2).map((scenario, idx) => (
                                        <div key={idx} className="text-[10px] text-purple-300/70 bg-purple-950/30 px-2 py-1.5 rounded border border-purple-500/10">
                                            {scenario}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Crowded Trade Warning */}
                        {devilsAdvocate.crowdedTradeWarning && (
                            <div className="mt-2 p-2 bg-rose-950/30 border border-rose-500/30 rounded-lg">
                                <div className="flex items-center gap-2 text-xs text-rose-300">
                                    <span className="text-rose-400">🚨</span>
                                    {devilsAdvocate.crowdedTradeWarning}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Strategy Description */}
                <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10">
                    <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">{strategy}</p>
                </div>

                {/* Market Conditions Toggle */}
                {marketConditions && (
                    <div className="border-t border-white/10">
                        <button
                            onClick={() => setIsConditionsVisible(!isConditionsVisible)}
                            className="w-full px-4 py-3 sm:px-6 sm:py-4 flex justify-between items-center hover:bg-white/5 transition-colors group"
                        >
                            <span className="uppercase tracking-widest font-bold text-[10px] sm:text-xs text-zinc-500 group-hover:text-cyan-400 transition-colors">Market Conditions Telemetry</span>
                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-300 ${isConditionsVisible ? 'rotate-180' : ''}`} />
                        </button>
                        <div className={`collapsible-content ${isConditionsVisible ? 'expanded' : ''} bg-zinc-950/50`}>

                            {/* Chart Telemetry Chips */}
                            {imageSummaries && imageSummaries.length > 0 && (
                                <div className="w-full border-b border-white/5 bg-black/20">
                                    <div className="px-4 py-3 sm:px-6 sm:py-4 flex flex-wrap gap-2 justify-start">
                                        {imageSummaries.map((summary, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-[10px] sm:text-xs font-mono text-cyan-100/90 bg-zinc-900/80 px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-cyan-900/30 shadow-sm">
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-cyan-500"></div>
                                                {summary}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="px-4 py-4 sm:px-6 sm:py-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 font-mono text-xs sm:text-sm">

                                {/* Timeframe Prices */}
                                {marketConditions.prices && Object.keys(marketConditions.prices).length > 0 && (
                                    <div className="grid grid-cols-1 gap-2 md:col-span-2 pb-3 border-b border-white/5">
                                        <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">Timeframe Prices</span>
                                        <div className="flex flex-wrap gap-3">
                                            {Object.entries(marketConditions.prices).map(([tf, price]) => (
                                                <div key={tf} className="flex gap-2 items-center bg-black/20 px-2 py-1 rounded">
                                                    <span className="text-[9px] text-zinc-500 uppercase font-bold">{tf}</span>
                                                    <span className="text-zinc-300 font-mono text-[10px]">{price}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Structure & Patterns */}
                                <div className="col-span-1 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-white/5">
                                    {/* Detected Patterns */}
                                    <div>
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest block mb-1">Structure & Patterns</span>
                                        {detectedPatterns.length > 0 ? (
                                            <div className="space-y-1.5">
                                                {detectedPatterns.map((p, i) => (
                                                    <div key={i} className="bg-white/5 p-2 rounded-lg border border-white/5">
                                                        <div className="flex justify-between items-start mb-0.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${p.type === 'Bullish' ? 'bg-emerald-500/20 text-emerald-400' : p.type === 'Bearish' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-700 text-zinc-300'}`}>
                                                                    {p.timeframe}
                                                                </span>
                                                                <span className="text-zinc-200 font-bold text-[10px]">{p.name}</span>
                                                            </div>
                                                            {p.confidence && <span className="text-[8px] text-zinc-400 font-mono bg-black/30 px-1 py-0.5 rounded">{p.confidence}</span>}
                                                        </div>
                                                        {p.description && <p className="text-[9px] text-zinc-500 leading-tight">{p.description}</p>}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : <span className="text-zinc-600 text-[10px] italic">No major patterns detected.</span>}
                                    </div>

                                    {/* Key Zones */}
                                    <div>
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest block mb-1">Key Zones</span>
                                        {keyLevels && (keyLevels.support.length > 0 || keyLevels.resistance.length > 0) ? (
                                            <div className="space-y-2">
                                                {keyLevels.resistance.length > 0 && (
                                                    <div>
                                                        <span className="text-[8px] font-bold text-rose-500 block mb-0.5">RESISTANCE</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {keyLevels.resistance.map((lvl, idx) => (
                                                                <span key={idx} className="bg-rose-900/20 text-rose-300 border border-rose-500/20 px-1.5 py-0.5 rounded text-[9px]">{lvl}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {keyLevels.support.length > 0 && (
                                                    <div>
                                                        <span className="text-[8px] font-bold text-emerald-500 block mb-0.5">SUPPORT</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {keyLevels.support.map((lvl, idx) => (
                                                                <span key={idx} className="bg-emerald-900/20 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[9px]">{lvl}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : <span className="text-zinc-600 text-[10px] italic">Levels pending confirmation.</span>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-1">
                                    <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">Pattern Structure</span>
                                    <span className="text-zinc-300 border-b border-white/5 pb-1">{marketConditions.pattern || 'N/A'}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">Candle Behavior</span>
                                    <span className="text-zinc-300 border-b border-white/5 pb-1">{marketConditions.candleBehavior || 'N/A'}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">RSI (Momentum)</span>
                                    <span className="text-zinc-300 border-b border-white/5 pb-1">{marketConditions.rsi || 'N/A'}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">MACD (Trend)</span>
                                    <span className="text-zinc-300 border-b border-white/5 pb-1">{marketConditions.macd || 'N/A'}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1 md:col-span-2">
                                    <span className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest">Market Sentiment</span>
                                    <span className="text-zinc-300 border-b border-white/5 pb-1">{marketConditions.sentiment || 'N/A'}</span>
                                </div>

                                {/* Enabled Playbooks - strategies available to AI */}
                                {activeFrameworks && activeFrameworks.length > 0 && (
                                    <div className="grid grid-cols-1 gap-1 md:col-span-2 pt-2 border-t border-white/5">
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">
                                            Enabled Playbooks
                                        </span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {activeFrameworks.slice(0, 6).map((fw, idx) => {
                                                // Check if this playbook is used in the trade (matches activeStrategies)
                                                const isUsed = activeStrategies?.some(strat =>
                                                    strat.toLowerCase().includes(fw.toLowerCase().replace(' trading', '')) ||
                                                    fw.toLowerCase().includes(strat.toLowerCase().replace(' trading', ''))
                                                ) || (strategy?.toLowerCase().includes(fw.toLowerCase().replace(' trading', '')));

                                                return (
                                                    <span
                                                        key={idx}
                                                        className={`text-[8px] px-1.5 py-0.5 rounded font-medium ${isUsed
                                                            ? 'bg-cyan-900/40 text-cyan-300 border border-cyan-500/40'
                                                            : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/30'
                                                            }`}
                                                    >
                                                        {isUsed && <span className="mr-1">✓</span>}
                                                        {fw}
                                                    </span>
                                                );
                                            })}
                                            {activeFrameworks.length > 6 && (
                                                <span className="text-[8px] text-zinc-500 italic">+{activeFrameworks.length - 6}</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* AI Detected Strategy - what the AI actually applied */}
                                {(strategy || (activeStrategies && activeStrategies.length > 0)) && (
                                    <div className="grid grid-cols-1 gap-1 md:col-span-2 pt-2 border-t border-white/5">
                                        <span className="text-[9px] uppercase font-bold text-cyan-600 tracking-widest flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></span>
                                            AI Detected Strategy
                                        </span>
                                        {/* Strategies identified from playbook */}
                                        {activeStrategies && activeStrategies.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mb-1">
                                                {activeStrategies.slice(0, 4).map((strat, idx) => (
                                                    <span key={idx} className="text-[9px] px-2 py-0.5 bg-cyan-900/30 text-cyan-300 border border-cyan-500/20 rounded-md font-medium">
                                                        {strat}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {/* AI's description */}
                                        {strategy && (
                                            <span className="text-[9px] text-zinc-400 italic">{strategy}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Action Bar */}
                <div className="p-3 sm:p-4 border-t border-white/10 bg-zinc-900/80 backdrop-blur-md">
                    {/* Backtest Result Display */}
                    {(backtestResult || backtestError) && (
                        <div className={`mb-3 p-3 rounded-xl border text-xs ${backtestResult?.outcome === 'WIN' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' :
                            backtestResult?.outcome === 'LOSS' ? 'bg-rose-950/30 border-rose-500/30 text-rose-300' :
                                backtestError ? 'bg-rose-950/30 border-rose-500/30 text-rose-300' :
                                    'bg-zinc-800/50 border-zinc-700 text-zinc-300'
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
                                                <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold border ${backtestResult.currentPnlPercent >= 0 ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
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
                                                +{backtestResult.currentPnlPercent}% PROFIT 🎯
                                            </span>
                                        ) : backtestResult.outcome === 'LOSS' ? (
                                            // LOSS - show realized loss
                                            <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                                {backtestResult.currentPnlPercent}% LOSS 💔
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
                                <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] bg-black/20 rounded-lg px-2 py-1.5">
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
                                        <span>{backtestResult.optimalEntry.improvement > 0.1 ? '⏱️' : '✅'}</span>
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
                                                💡 {backtestResult.optimalEntry.waitRecommendation}
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
                                <button onClick={() => validateAndLogOutcome(TradeOutcome.WIN)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold uppercase tracking-wide transition-colors active:scale-[0.98]">Win</button>
                                <button onClick={() => validateAndLogOutcome(TradeOutcome.LOSS)} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-3 rounded-xl font-bold uppercase tracking-wide transition-colors active:scale-[0.98]">Loss</button>
                            </div>
                            {/* Entry Selector for Backtest - shown when multiple entries exist */}
                            {hasMultipleEntries && (
                                <div className="mb-2 p-2 bg-zinc-800/50 rounded-lg border border-white/5">
                                    <div className="text-[9px] uppercase font-bold text-zinc-500 mb-1.5 flex items-center gap-1">
                                        <span>📍</span> Select entries to backtest
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
                                                    : 'bg-zinc-700/50 text-zinc-500 border border-white/5 hover:text-zinc-300'
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
                                <button onClick={() => onInitiateSkip(messageId)} className="flex-1 min-w-[60px] px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs font-medium transition-colors">Skip</button>
                                <button
                                    onClick={handleBacktest}
                                    disabled={isBacktesting}
                                    className="flex-1 min-w-[60px] px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                                    title="Run Backtest"
                                >
                                    {isBacktesting ? <LoadingIcon className="w-3 h-3" /> : <>📊 Test</>}
                                </button>
                                {onSimulate && (
                                    <button
                                        onClick={() => onSimulate(messageId)}
                                        className="flex-1 min-w-[60px] px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                                        title="Scenario Simulator"
                                    >
                                        🎮 <span className="hidden sm:inline">Simulate</span><span className="sm:hidden">Sim</span>
                                    </button>
                                )}
                                <button onClick={() => onSaveAnalysis(messageId)} disabled={isSaved} className={`px-3 py-2 rounded-lg transition-colors flex items-center justify-center ${isSaved ? 'text-purple-400 bg-purple-500/20' : 'text-zinc-300 bg-zinc-700 hover:bg-zinc-600'}`} title="Save Analysis">
                                    {isSaved ? <BookmarkSolidIcon className="w-4 h-4" /> : <BookmarkIcon className="w-4 h-4" />}
                                </button>
                                {/* Price Alert Toggle */}
                                <button
                                    onClick={() => {
                                        if (alertEnabled) {
                                            const alert = PriceAlertService.getAlertForTrade(messageId);
                                            if (alert) PriceAlertService.removeAlert(alert.id);
                                            setAlertEnabled(false);
                                        } else {
                                            PriceAlertService.createAlert(messageId, analysis, 0.5);
                                            setAlertEnabled(true);
                                        }
                                    }}
                                    className={`px-3 py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${alertEnabled ? 'text-amber-400 bg-amber-500/20 border border-amber-500/30' : 'text-zinc-300 bg-zinc-700 hover:bg-zinc-600'}`}
                                    title={alertEnabled ? 'Alerts ON' : 'Enable Price Alerts'}
                                >
                                    {alertEnabled ? '🔔' : '🔕'}
                                </button>
                                {/* Share Button */}
                                <button
                                    onClick={async () => {
                                        setIsSharing(true);
                                        setShareSuccess(null);
                                        try {
                                            const blob = await TradeShareService.generateTradeCard(analysis, outcome, {}, tradingStyle);
                                            const coinName = (analysis.coinName || 'trade').replace(/[^a-zA-Z0-9]/g, '');
                                            const filename = coinName + '-' + (analysis.direction || 'trade') + '.png';

                                            // Try GallerySaver first (saves to gallery on Android)
                                            const saved = await TradeShareService.downloadAsImage(blob, filename);
                                            if (saved) {
                                                setShareSuccess('Saved!');
                                            } else {
                                                // Fallback to clipboard
                                                const copied = await TradeShareService.copyToClipboard(blob);
                                                if (copied) {
                                                    setShareSuccess('Copied!');
                                                } else {
                                                    setShareSuccess('Failed');
                                                }
                                            }
                                        } catch (e) {
                                            console.error('Share error:', e);
                                            setShareSuccess('Error');
                                        }
                                        setIsSharing(false);
                                        setTimeout(() => setShareSuccess(null), 2000);
                                    }}
                                    disabled={isSharing}
                                    className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors flex items-center justify-center gap-1 relative"
                                    title="Share Trade Card"
                                >
                                    {isSharing ? <LoadingIcon className="w-4 h-4" /> : '📤'}
                                    {shareSuccess && (
                                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-emerald-600 text-white text-[10px] rounded whitespace-nowrap">
                                            {shareSuccess}
                                        </span>
                                    )}
                                </button>
                                {onUpdateTrade && (
                                    <button onClick={() => onUpdateTrade(messageId)} className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors flex items-center justify-center" title="Update Setup">
                                        <UpdateIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-3 py-1 sm:py-2">
                            <span className={`inline-block px-3 py-1.5 sm:px-5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest border ${outcome === TradeOutcome.WIN ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                                outcome === TradeOutcome.LOSS ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' :
                                    'border-zinc-700 text-zinc-500 bg-zinc-800/50'
                                }`}>
                                Outcome: {outcome}
                            </span>
                            {/* Backtest button for logged trades too */}
                            <button
                                onClick={handleBacktest}
                                disabled={isBacktesting}
                                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-800 hover:text-cyan-400 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                                title="Run Backtest Simulation"
                            >
                                {isBacktesting ? <LoadingIcon className="w-3 h-3" /> : '📊 Backtest'}
                            </button>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default React.memo(AnalysisResult);

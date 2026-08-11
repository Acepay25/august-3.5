
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TradeAnalysis, TradeOutcome, AccuracySubMode, ConfidenceCalibration, ConfluenceData, DualScenarioAnalysis, LevelProbabilities, ProbabilityReasoning, TradingStyle } from '../../types';
import { ChevronDownIcon, BookmarkIcon, BookmarkSolidIcon, BrainIcon, UpdateIcon, ActivityIcon, SkipIcon } from '../shared/Icons';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import { FAMILY_UI_DATA } from '../../constants/models';
import { ConfidenceLevel } from '../../services/validation/ConfidenceCalibrationService';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';
import { parsePrice } from '../../utils/analysisUtils';
import { simulateFromAnalysisTime } from '../../services/backtesting/BacktestingService';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';
import ConsensusPanel from './ConsensusPanel';
import { PriceAlertService } from '../../services/ui/PriceAlertService';
import ConfluenceScoreIndicator from './ConfluenceScoreIndicator';
import ProbabilityWidget from '../market/ProbabilityWidget';
import CalibrationWidget from './CalibrationWidget';
import CalibrationDriftNote from './CalibrationDriftNote';
import BacktestPanel from './BacktestPanel';
import PriceAlertToggle from './PriceAlertToggle';
import SetupWatchControl from './SetupWatchControl';
import ShareMenu from './ShareMenu';
import DecisionRecord from './DecisionRecord';

// ─── Shared countdown ticker ────────────────────────────────────────────────
// Every PENDING analysis card used to run its own setInterval(60s) + re-render
// its heavy body; with N pending trades that's N redundant re-renders per
// minute. One module-level interval fans out to subscribed cards and stops
// when the last card unsubscribes.
const countdownListeners = new Set<(now: number) => void>();
let countdownInterval: ReturnType<typeof setInterval> | null = null;

const subscribeCountdownTick = (listener: (now: number) => void): (() => void) => {
    countdownListeners.add(listener);
    if (!countdownInterval) {
        countdownInterval = setInterval(() => {
            const t = Date.now();
            countdownListeners.forEach(l => l(t));
        }, 60000);
    }
    return () => {
        countdownListeners.delete(listener);
        if (countdownListeners.size === 0 && countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    };
};


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
    /** F4: re-run the debate for this card with the same setup (also the
     *  retry path for failed debates / dropped analysts). */
    onReRunAnalysis?: (messageId: string) => void;
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
    // Outcome Autopilot — detected resolution for this message + handlers
    autopilotResolution?: AutopilotResolution;
    onConfirmAutopilot?: (messageId: string) => void;
    onDismissAutopilot?: (messageId: string) => void;
    /** Opens the side-by-side compare picker for this card. */
    onCompare?: (messageId: string) => void;
    /** Opens the Trading Journal Think tab focused on this card's reasoning. */
    onViewReasoning?: (messageId: string) => void;
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
    onReRunAnalysis,
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
    leverage = DEFAULT_LEVERAGE, // Default to 100x leverage for futures
    isLensMode,
    tradingStyle,
    onSelectForProbability,
    autopilotResolution,
    onConfirmAutopilot,
    onDismissAutopilot,
    onCompare,
    onViewReasoning
}) => {
    // One-click price alerts for entry/SL/TP levels (PriceAlertService).
    const [alertsSet, setAlertsSet] = React.useState(false);
    const handleSetAlerts = () => {
        if (alertsSet) return; // one alert set per card — avoid duplicate monitoring
        PriceAlertService.createAlert(messageId, analysis);
        setAlertsSet(true);
    };

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
        levelProbabilities,
        evidence = [],
        invalidationCriteria = []
    } = analysis || {};

    const [isConditionsVisible, setIsConditionsVisible] = useState(false);
    // Details grid starts collapsed — the card opens as the minimal chat-style
    // summary; the full grid (levels, patterns, scenarios, gate, calibration)
    // is one "Details" click away.
    const [isDetailsVisible, setIsDetailsVisible] = useState(false);
    const [showRRTooltip, setShowRRTooltip] = useState(false);

    // === AUTO-POLLING FOR ENTRY DETECTION ===
    const [autoEntryStatus, setAutoEntryStatus] = useState<{
        isActive: boolean;
        wasActiveBeforeExpiry: boolean; // Track if entry was hit within valid window
        lastChecked: Date | null;
    } | null>(null);

    // === VISIBILITY GATE FOR THE 30s ENTRY POLL ===
    // N pending cards used to run N independent 30s kline checks regardless
    // of whether the user could see them. Only poll cards that are actually
    // on screen (and the app is in the foreground) — a card that scrolls out
    // resumes on return, and a stale result self-corrects on the next check.
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [isCardOnScreen, setIsCardOnScreen] = useState(true);
    const [isPageForeground, setIsPageForeground] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'visible');

    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const el = cardRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => setIsCardOnScreen(entries.some((e) => e.isIntersecting)),
            { threshold: 0.05 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const onVisibility = () => setIsPageForeground(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // Live countdown timer state
    const [now, setNow] = useState(Date.now());

    // Auto-poll every 30 seconds for PENDING trades to detect entry
    useEffect(() => {
        if (outcome !== TradeOutcome.PENDING || !createdAt || !coinName) return;
        // Visibility gate: hidden cards (scrolled out / backgrounded app)
        // don't run their own kline check — see VISIBILITY GATE above.
        if (!isCardOnScreen || !isPageForeground) return;

        // Guarded setter: the poll used to set a FRESH object every 30s even
        // when nothing changed, re-rendering this 1300+ line card pointlessly.
        const setStatus = (next: { isActive: boolean; wasActiveBeforeExpiry: boolean }) => {
            setAutoEntryStatus(prev =>
                prev && prev.isActive === next.isActive && prev.wasActiveBeforeExpiry === next.wasActiveBeforeExpiry
                    ? prev
                    : { ...next, lastChecked: new Date() }
            );
        };

        const checkEntry = async () => {
            try {
                const validUntilMs = validityDurationMinutes
                    ? new Date(createdAt).getTime() + validityDurationMinutes * 60 * 1000
                    : null;
                const isNowExpired = validUntilMs ? Date.now() > validUntilMs : false;

                // If already marked as active before expiry, the trade is live —
                // stop polling entirely (the state can never change again).
                if (autoEntryStatus?.wasActiveBeforeExpiry) {
                    clearInterval(interval);
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
                        setStatus({ isActive: true, wasActiveBeforeExpiry: true });
                        return;
                    } else {
                        // Entry was hit AFTER validity expired - trade should remain expired
                        console.log(`[AnalysisResult] Entry triggered at ${result.entryTriggerTime}, but AFTER validity window expired`);
                    }
                }

                // Entry was NOT hit within validity window - check if timer expired
                if (isNowExpired) {
                    setStatus({ isActive: false, wasActiveBeforeExpiry: false });
                    // Expired with no entry → the outcome can never change; stop
                    // polling instead of hitting the kline API every 30s forever.
                    clearInterval(interval);
                } else {
                    // Timer not expired yet, entry not hit yet - keep polling
                    setStatus({ isActive: false, wasActiveBeforeExpiry: false });
                }
            } catch (e) {
                console.error('[AnalysisResult] Auto entry check failed:', e);
            }
        };

        // Declare the interval BEFORE the initial check: the first check can
        // hit clearInterval(interval) when the window already expired, which
        // threw a ReferenceError (TDZ) on the un-initialized const and left a
        // redundant 30s poll running.
        const interval = setInterval(checkEntry, 30000); // Poll every 30s
        checkEntry(); // Initial check
        return () => clearInterval(interval);
    }, [outcome, createdAt, coinName, analysis, leverage, validityDurationMinutes, autoEntryStatus?.wasActiveBeforeExpiry, isCardOnScreen, isPageForeground]);

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
        // Shared ticker (module-level, fan-out) — see subscribeCountdownTick.
        // N pending cards no longer run N setInterval(60s) re-renders.
        return subscribeCountdownTick(setNow);
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

    // Ensure direction is a valid string to prevent crashes if 'Neutral' object is passed
    const safeDirectionString = typeof direction === 'string' ? direction : 'Neutral';
    const isLong = safeDirectionString === 'Long';
    const isShort = safeDirectionString === 'Short';
    const isNeutral = !isLong && !isShort;

    const directionVisual = isLong
        ? { accent: '#34d399', border: 'rgba(52, 211, 153, 0.55)', surface: 'rgba(6, 78, 59, 0.32)', glow: 'rgba(16, 185, 129, 0.22)', gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(6, 78, 59, 0.12) 42%, transparent 78%)' }
        : isShort
            ? { accent: '#fb7185', border: 'rgba(251, 113, 133, 0.55)', surface: 'rgba(127, 29, 29, 0.32)', glow: 'rgba(244, 63, 94, 0.22)', gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.28), rgba(127, 29, 29, 0.12) 42%, transparent 78%)' }
            : { accent: '#8aabd8', border: 'rgba(138, 171, 216, 0.55)', surface: 'rgba(33, 47, 67, 0.38)', glow: 'rgba(100, 141, 198, 0.22)', gradient: 'linear-gradient(135deg, rgba(100, 141, 198, 0.28), rgba(33, 47, 67, 0.14) 42%, transparent 78%)' };

    // Helper to find family UI details
    const familyData = detectedPatternFamily ? FAMILY_UI_DATA.find(f =>
        detectedPatternFamily.toLowerCase().includes(f.name.toLowerCase()) ||
        detectedPatternFamily.toLowerCase().includes(f.tag.toLowerCase())
    ) : null;

    const familyColorClass = familyData?.color === 'red' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
        familyData?.color === 'emerald' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
            familyData?.color === 'blue' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                familyData?.color === 'purple' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
                    'text-zinc-400 bg-zinc-800 border-white/5';

    // Mode Badge Logic - All accuracy modes use cyan dark theme
    let modeBadge;
    if (isAccuracyMode) {
        modeBadge = (
            <span className="px-2 py-1 rounded text-[9px] font-black bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 uppercase tracking-widest shadow-[0_0_10px_-3px_rgba(176, 176, 182,0.4)] animate-pulse">
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
             LENS MODE
        </span>
    ) : null;

    // Safe RR check - check if it is defined and is a valid number > 0
    const hasValidRR = rrRatio !== undefined && rrRatio !== null && !isNaN(rrRatio) && rrRatio > 0;

    // Hybrid snapshot subset for the summary line (same shape the automation
    // cards use) — regime / confluence / session injected at analysis time.
    const summarySnapshot = (analysis?.marketSnapshot ?? undefined) as {
        regime?: { regime?: string; trendDirection?: string; adx?: number };
        confluence?: { score?: number; direction?: string; strength?: string };
        session?: { sessionName?: string; suggestedAction?: string };
    } | undefined;

    // Chat-style markdown summary — the "Trading workspace" presentation.
    const summaryMarkdown = useMemo(() => {
        const lines: string[] = [];
        lines.push(`**${coinName} · ${safeDirectionString} · ${confidence} (${probability}%)**`);
        lines.push('');
        lines.push(`- **Entry:** ${entryPoints?.[0]?.price ?? 'N/A'} · **SL:** ${stopLoss ?? 'N/A'} · **TP1:** ${takeProfit?.[0]?.price ?? 'N/A'}${hasValidRR ? ` · **R:R:** ${rrRatio}:1` : ''}`);
        if (summarySnapshot?.regime?.regime) {
            lines.push(`- **Regime:** ${summarySnapshot.regime.regime.replace(/_/g, ' ')}${typeof summarySnapshot.regime.adx === 'number' ? ` (ADX ${summarySnapshot.regime.adx.toFixed(1)})` : ''}${typeof summarySnapshot.confluence?.score === 'number' ? ` · **Confluence:** ${summarySnapshot.confluence.score}/100 ${summarySnapshot.confluence.direction ?? ''}` : ''}`);
        }
        if (summarySnapshot?.session?.sessionName) {
            lines.push(`- **Session:** ${summarySnapshot.session.sessionName}${summarySnapshot.session.suggestedAction ? ` — ${summarySnapshot.session.suggestedAction}` : ''}`);
        }
        if (strategy && strategy !== 'Analysis pending...') {
            lines.push('');
            lines.push(strategy.length > 400 ? `${strategy.slice(0, 400)}…` : strategy);
        }
        return lines.join('\n');
    }, [coinName, safeDirectionString, confidence, probability, entryPoints, stopLoss, takeProfit, rrRatio, hasValidRR, strategy, summarySnapshot]);

    return (
        <div
            ref={cardRef}
            tabIndex={0}
            onKeyDown={(e) => {
                // Signal-card hotkeys: W = log win, L = log loss, D = toggle
                // details. Only when the card is focused and the user is not
                // typing in a field.
                const target = e.target as HTMLElement;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
                if (e.key === 'd' || e.key === 'D') {
                    e.preventDefault();
                    setIsDetailsVisible(v => !v);
                } else if ((e.key === 'w' || e.key === 'W') && outcome === TradeOutcome.PENDING && !autopilotResolution) {
                    e.preventDefault();
                    onLogTrade(messageId, TradeOutcome.WIN);
                } else if ((e.key === 'l' || e.key === 'L') && outcome === TradeOutcome.PENDING && !autopilotResolution) {
                    e.preventDefault();
                    onLogTrade(messageId, TradeOutcome.LOSS);
                }
            }}
            className={`analysis-card mt-6 sm:mt-8 w-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 rounded-2xl ${isDetailsVisible ? 'pb-28 sm:pb-8' : 'pb-2 sm:pb-4'}`}
        >

            {/* Chat-style signal summary — the "Trading workspace" look */}
            <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-4 sm:p-5 shadow-lg">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {modeBadge}
                    {lensBadge}
                    <span className="font-black text-sm tracking-wider uppercase" style={{ color: directionVisual.accent }}>{safeDirectionString}</span>
                    <span className="font-mono text-xs font-bold text-zinc-300">{coinName}</span>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{confidence} ({probability}%)</span>
                    {(() => {
                        // Empirical trust badge — what this confidence tier has
                        // ACTUALLY won in the user's journal. When a tier is
                        // overconfident (actual < expected − 10), the badge
                        // shows the deterministic downgrade so the displayed
                        // confidence can't oversell the setup.
                        const tierKey = (typeof confidence === 'string' ? confidence : '').toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
                        const stats = confidenceCalibration?.[tierKey];
                        if (!stats || stats.total < 3 || tierKey === 'avoid') return null;
                        const expected = tierKey === 'high' ? 70 : tierKey === 'medium' ? 55 : 40;
                        const actual = (stats.wins / stats.total) * 100;
                        const overconfident = actual < expected - 10;
                        const downgrade = overconfident
                            ? (tierKey === 'high' ? 'Medium' : tierKey === 'medium' ? 'Low' : 'Avoid')
                            : null;
                        const tone = actual >= expected - 5 ? 'text-emerald-300' : actual >= expected - 15 ? 'text-amber-300' : 'text-rose-300';
                        return (
                            <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-950 border border-white/10 ${tone}`}
                                title={`This confidence tier historically wins ${actual.toFixed(0)}% (n=${stats.total}). ${overconfident ? 'Deterministically downgraded because the tier underdelivers.' : 'Calibrated against your own journal.'}`}
                            >
                                {downgrade ? `${confidence} → ${downgrade}` : `cal ${actual.toFixed(0)}%`} · n={stats.total}
                            </span>
                        );
                    })()}
                    {(() => {
                        // Divergence badge: raw analyst probabilities vs the
                        // harness-adjusted verdict probability (calibration +
                        // pattern memory applied). A meaningful gap means the
                        // harness adjusted the number — show it.
                        const rawProbs = (analysis?.analystConsensus?.entries ?? [])
                            .map(e => e.probability)
                            .filter((p): p is number => typeof p === 'number');
                        const rawAvg = rawProbs.length > 0 ? rawProbs.reduce((a, b) => a + b, 0) / rawProbs.length : null;
                        const adjusted = typeof analysis?.probability === 'number' ? analysis.probability : null;
                        if (rawAvg === null || adjusted === null || Math.abs(rawAvg - adjusted) < 8) return null;
                        return (
                            <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300"
                                title="Raw analyst probabilities vs the harness-adjusted verdict probability (calibration + pattern memory applied)."
                            >
                                raw {Math.round(rawAvg)}% → {Math.round(adjusted)}% adj
                            </span>
                        );
                    })()}
                    {(() => {
                        // Dissent flag — any analyst whose direction differs
                        // from the verdict.
                        const dissents = (analysis?.analystConsensus?.entries ?? [])
                            .filter(e => e.direction && e.direction !== safeDirectionString).length;
                        if (dissents === 0) return null;
                        return (
                            <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300"
                                title={`${dissents} analyst${dissents > 1 ? 's' : ''} ${dissents > 1 ? 'dissent' : 'dissents'} from the verdict direction`}
                            >
                                {dissents} dissent{dissents > 1 ? 's' : ''}
                            </span>
                        );
                    })()}
                    {isUpdate && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300 flex items-center gap-1">
                            <UpdateIcon className="w-3 h-3" /> Updated {updateInterval ? `(+${updateInterval})` : ''}
                        </span>
                    )}
                    <span className="ml-auto text-[10px] font-mono text-zinc-500">
                        {createdAt ? new Date(createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                </div>

                <div className="prose-sm">
                    <MarkdownRenderer content={summaryMarkdown} />
                </div>

                {/* Team verdicts — every analyst's call vs this verdict, so the
                    disagreement is visible in the chat itself (the full panel
                    opens from the analyst rows above the card). */}
                {(() => {
                    const entries = analysis?.analystConsensus?.entries ?? [];
                    if (entries.length === 0) return null;
                    return (
                        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mr-0.5">Team</span>
                            {entries.map((e, i) => {
                                const agrees = e.direction === safeDirectionString;
                                const short = (e.displayName || e.thoughtsKey || e.providerId || '?').split(' ').pop();
                                return (
                                    <span
                                        key={i}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-950 border border-white/5 text-[10px] font-mono"
                                        title={`${e.displayName}: ${e.direction ?? 'no call'} · ${e.confidence ?? ''}`}
                                    >
                                        <span className="text-zinc-400 max-w-[80px] truncate">{short}</span>
                                        <span className={e.direction === 'Long' ? 'text-emerald-400' : e.direction === 'Short' ? 'text-rose-400' : 'text-zinc-500'}>
                                            {e.direction === 'Long' ? '▲' : e.direction === 'Short' ? '▼' : '—'}
                                        </span>
                                        {typeof e.probability === 'number'
                                            ? <span className="text-zinc-300">{Math.round(e.probability)}%</span>
                                            : e.confidence ? <span className="text-zinc-300">{e.confidence}</span> : null}
                                        <span className={agrees ? 'text-emerald-400' : 'text-rose-400'} title={agrees ? 'Agrees with the verdict' : 'Dissents from the verdict'}>
                                            {agrees ? '✓' : '✗'}
                                        </span>
                                    </span>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* Outcome Autopilot — detected SL/TP hit, one-click confirmation.
                    Buttons styled like the workspace action buttons. */}
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
                    // Confidence tiers: which TP was hit and whether the SL was
                    // touched first — a "recovered" win is weaker than a clean one.
                    const winTier = isWin && r.hitTarget ? ` · ${r.hitTarget}${r.recoveredAfterSlTouch ? ' · recovered after SL touch' : ' · clean'}` : '';
                    const confirmLabel = r.expiredOpen
                        ? null
                        : r.outcome === TradeOutcome.ENTRY_NOT_HIT
                            ? 'Entry not hit'
                            : isWin
                                ? `WIN${r.pnlPercent !== undefined ? ` (+${r.pnlPercent}%)` : ''}${winTier}`
                                : `LOSS${r.pnlPercent !== undefined ? ` (${r.pnlPercent}%)` : ''}`;
                    return (
                        <div className={`mt-3 px-4 py-3 rounded-xl border ${tint}`}>
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
                <div className="mt-3 flex flex-wrap gap-2">
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
                    <button
                        onClick={() => setIsDetailsVisible(v => !v)}
                        className="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-bold bg-zinc-800 border border-white/10 text-zinc-400 uppercase tracking-widest hover:text-zinc-200 transition-colors flex items-center gap-1"
                        aria-expanded={isDetailsVisible}
                        title="Keyboard: D"
                    >
                        {isDetailsVisible ? 'Hide details' : 'Details'}
                        <ChevronDownIcon className={`w-3 h-3 transition-transform ${isDetailsVisible ? 'rotate-180' : ''}`} />
                    </button>
                    <span className="text-[9px] text-zinc-600 self-center hidden sm:inline" title="Focus the card, then: W = log win, L = log loss, D = toggle details">
                        <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10">W</kbd>
                        <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10 ml-1">L</kbd>
                        <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-white/10 ml-1">D</kbd>
                    </span>
                </div>
            </div>

            {/* Everything below is the "Details" layer — hidden by default so
                the card reads as a normal chat message, revealed via the
                Details button in the bubble's action row. */}
            {isDetailsVisible && (
                <div className="mt-4 space-y-4 details-enter">

            {/* Consensus explainability — audit the verdict against its analysts */}
            {analysis.analystConsensus && (
                <ConsensusPanel consensus={analysis.analystConsensus} verdict={analysis} />
            )}

            <DecisionRecord analysis={analysis} outcome={outcome} />

            {/* Hybrid data staleness — the packet claims real-time; show its age */}
            {analysis.marketSnapshot ? (() => {
                const snapshot = analysis.marketSnapshot as { dataTimestamp?: string } | undefined;
                if (!snapshot?.dataTimestamp) return null;
                const ageMin = Math.max(0, Math.round((Date.now() - new Date(snapshot.dataTimestamp).getTime()) / 60000));
                return (
                    <div className="mb-3 -mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
                        <span>Hybrid data</span>
                        <span className={`font-mono ${ageMin > 10 ? 'font-semibold text-amber-400' : 'text-zinc-400'}`}>
                            {new Date(snapshot.dataTimestamp).toLocaleTimeString()} · {ageMin}m ago{ageMin > 10 ? ' (stale)' : ''}
                        </span>
                    </div>
                );
            })() : null}

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
                className="relative overflow-hidden rounded-t-3xl sm:rounded-t-[2rem] border-b-0 border-2 bg-zinc-900 transition-all duration-500 group shadow-2xl"
                style={{ borderColor: directionVisual.border }}
            >
                {/* Premium Gradient Overlay */}
                <div className="absolute inset-0" style={{ background: directionVisual.gradient }}></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>

                {/* Animated Glow Effect */}
                <div className="absolute -inset-1 rounded-3xl blur-2xl opacity-30 group-hover:opacity-40 transition-opacity duration-500" style={{ backgroundColor: directionVisual.glow }}></div>

                <div className="relative p-4 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 z-10">
                    {/* Direction, Type, and Confidence - stacks vertically on mobile */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 w-full sm:w-auto">
                        {/* Row 1: Direction Badge + Trading Style */}
                        <div className="flex items-center gap-3 sm:gap-5">
                            <div className="px-4 py-2.5 sm:px-6 sm:py-3.5 rounded-2xl font-black text-lg sm:text-2xl uppercase tracking-wide border-2 shadow-xl transition-transform duration-300 group-hover:scale-105" style={{ color: directionVisual.accent, backgroundColor: directionVisual.surface, borderColor: directionVisual.border, boxShadow: `0 12px 30px ${directionVisual.glow}` }}>
                                {safeDirectionString}
                            </div>
                            {/* Trade Type Badge - Always visible next to direction */}
                            {tradingStyle && (
                                <div className={`px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-widest border flex items-center gap-1.5 relative
                                    ${tradingStyle === 'scalp'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                        : 'bg-violet-500/10 text-violet-400 border-violet-500/30'}`}>
                                    
                                    <span>{tradingStyle.toUpperCase()}</span>
                                    {tradeTypeManualOverride && (
                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(176, 176, 182,0.8)]" title="Manually overridden by user"></span>
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
                            <CalibrationWidget
                                confidence={confidence}
                                confidenceCalibration={confidenceCalibration}
                            />
                            {/* Calibration drift alert (over/under-confident) */}
                            <CalibrationDriftNote
                                confidence={confidence as ConfidenceLevel}
                                probability={probability}
                                confidenceCalibration={confidenceCalibration}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-4 self-start sm:self-auto">
                        {createdAt && (
                            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400/80 bg-zinc-800 px-3 py-2 rounded-lg sm:rounded-xl border border-white/5">
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
                                <span>⏱</span>
                                <span>{isExpired ? 'EXPIRED' : `${formatValidityDuration(remainingMinutes)} left`}</span>
                            </div>
                        )}

                        {/* ACTIVE badge - shows when entry has been triggered */}
                        {isTradeActive && outcome === TradeOutcome.PENDING && (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1.5 rounded-lg 
                                text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                                
                                <span>ACTIVE</span>
                            </div>
                        )}
                        <div className="p-2 rounded-full border border-white/10 bg-zinc-800 text-zinc-500">
                            <span className="text-[9px] font-bold uppercase tracking-widest">Details</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Data Grid (Collapsible) - Modern Glassmorphism */}
            <div className={`collapsible-content ${isDetailsVisible ? 'expanded' : ''} bg-zinc-900 border-2 ${isLong ? 'border-emerald-400/30' : isShort ? 'border-rose-400/30' : 'border-gray-400/30'} border-t-0 rounded-b-3xl sm:rounded-b-[2rem] shadow-inner`}>

                {/* Strategy Chips */}
                {activeStrategies && Array.isArray(activeStrategies) && activeStrategies.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-white/5 bg-zinc-800 flex flex-wrap gap-2 sm:gap-3">
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
                            // Add the FIRST strategy that isn't already applied —
                            // the old code applied activeStrategies[0], which was
                            // often the already-active one (a silent no-op).
                            <button onClick={() => onApplyStrategy(activeStrategies.find(s => !activeFrameworks.includes(s))!)} className="text-[10px] sm:text-xs px-3 py-1.5 sm:px-4 sm:py-2 text-cyan-500 hover:underline opacity-80 font-medium">+ Add</button>
                        )}
                    </div>
                )}

                {/* Core Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                    {/* Entry */}
                    <div className="p-4 sm:p-6 space-y-3">
                        <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                   <div className="w-2 h-2 rounded-full" style={{ backgroundColor: directionVisual.accent, boxShadow: `0 0 8px ${directionVisual.glow}` }}></div>
                                <span style={{ color: directionVisual.accent }}>Entry Zone</span>
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
                                <div key={i} className="rounded-2xl border p-4 shadow-lg transition-all duration-300 hover:scale-[1.02]" style={{ backgroundColor: directionVisual.surface, borderColor: directionVisual.border, boxShadow: `0 10px 24px ${directionVisual.glow}` }}>
                                     <div className="text-xl sm:text-3xl font-mono font-black tracking-tight break-words drop-shadow-lg" style={{ color: directionVisual.accent }}>{typeof ep.price === 'object' ? 'Invalid Price' : ep.price}</div>
                                     <div className="mt-2 text-xs font-medium leading-tight text-zinc-300/80 sm:text-sm">{typeof ep.description === 'object' ? '' : ep.description}</div>
                                 </div>
                            )) : <div className="text-zinc-600 text-xs sm:text-sm italic">No specific entry provided.</div>}
                        </div>
                        {/* Suggested Better Entry */}
                        {analysisEntryTiming?.suggestedEntry && (
                            <div className="mt-2 p-2 bg-cyan-950/30 border border-cyan-500/20 rounded-lg">
                                <div className="text-[9px] uppercase font-bold text-cyan-500 tracking-widest mb-1"> Better Entry Available</div>
                                <div className="text-xs text-cyan-200">
                                    <span className="font-mono font-bold">${analysisEntryTiming.suggestedEntry.price.toLocaleString()}</span>
                                    <span className="text-cyan-400/70 ml-2">({analysisEntryTiming.suggestedEntry.reason})</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stop Loss */}
                    <div className="p-4 sm:p-6 space-y-3 bg-rose-500/[0.02]">
                        <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 text-rose-300">
                             <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(251,113,133,0.7)]"></div> Stop Loss
                        </div>
                        <div className="bg-gradient-to-br from-rose-500/15 to-rose-600/5 border border-rose-400/25 rounded-2xl sm:rounded-2xl p-4 shadow-lg hover:shadow-rose-500/10 transition-all duration-300 hover:scale-[1.02]">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-2 sm:gap-3">
                                <span className="text-xl sm:text-3xl font-mono font-black tracking-tight break-words drop-shadow-lg" style={{ color: '#fb7185' }}>{stopLoss || 'N/A'}</span>
                                <div className="flex flex-col items-end gap-1">
                                    {stopLossPercentage && <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl sm:rounded-xl border shadow-inner" style={{ color: '#fb7185', backgroundColor: 'rgba(127, 29, 29, 0.42)', borderColor: 'rgba(251, 113, 133, 0.3)' }}>{stopLossPercentage}</span>}
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
                                            <div className="font-mono text-cyan-300 mb-2 text-center bg-zinc-800 p-1 rounded">Reward / Risk</div>
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
                                                     Extended SL (150%)
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
                        <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 text-emerald-300">
                             <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]"></div> Targets
                        </div>
                        <div className="space-y-2.5">
                            {(takeProfit && takeProfit.length > 0) ? (takeProfit || []).map((tp, i) => (
                                <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-all duration-300 group hover:scale-[1.02]" style={{ backgroundColor: 'rgba(6, 78, 59, 0.28)', borderColor: 'rgba(52, 211, 153, 0.3)' }}>
                                     <span className="font-mono font-black text-xl sm:text-2xl break-words drop-shadow-lg" style={{ color: '#6ee7b7' }}>{typeof tp.price === 'object' ? 'Invalid' : tp.price}</span>
                                     {tp.percentage && <span className="self-start rounded-xl border px-3 py-1.5 text-[10px] font-mono font-bold shadow-inner sm:self-auto" style={{ color: '#6ee7b7', backgroundColor: 'rgba(6, 78, 59, 0.48)', borderColor: 'rgba(52, 211, 153, 0.3)' }}>{typeof tp.percentage === 'object' ? '' : tp.percentage}</span>}
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
                                    ${grade === 'A' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shadow-[0_0_10px_-3px_rgba(176, 176, 182,0.4)]' :
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
                             Detected Patterns ({detectedPatterns.length})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {detectedPatterns.map((pattern, idx) => (
                                <div key={idx} className={`px-3 py-2 rounded-lg text-xs border
                                    ${pattern.type === 'Bullish' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                                        pattern.type === 'Bearish' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' :
                                            'bg-zinc-500/10 border-zinc-500/20 text-zinc-300'}`}>
                                    <div className="font-bold flex items-center gap-1.5">
                                        
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
                             Key Levels
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
                             Dual Scenario Analysis
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                            {/* Bullish Scenario */}
                            <div className={`p-3 rounded-lg border ${dualScenarioAnalysis.selectedScenario === 'bullish'
                                ? 'bg-emerald-500/15 border-emerald-400/40 ring-2 ring-emerald-500/20'
                                : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                <div className="flex items-center gap-2 mb-2">
                                    
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
                        <div className="bg-zinc-800 border border-indigo-500/20 rounded-lg p-3">
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

                {/* Gate Scan Results — the full-shape guard protects against
                    legacy/partial gateResult objects (missing penalties etc.) */}
                {analysis.gateResult && analysis.gateResult.penalties && analysis.gateResult.familyBias && (
                    <div className="px-4 py-4 sm:px-6 sm:py-5 border-t border-white/10 bg-gradient-to-b from-cyan-950/20 to-transparent">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-[10px] uppercase font-bold text-cyan-400 tracking-widest flex items-center gap-2">
                                 Gate Scan
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
                                    {((analysis.gateResult.confidenceCap ?? 0) * 100).toFixed(0)}%
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
                            <div className="mb-3 p-2 bg-zinc-800 rounded-lg border border-white/5">
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
                                    
                                    <span className={`text-xs font-bold ${analysis.gateResult.suggestedDirection === 'Long' ? 'text-emerald-400' : 'text-rose-400'
                                        }`}>
                                        Pattern Memory suggests {analysis.gateResult.suggestedDirection}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Warnings */}
                        {Array.isArray(analysis.gateResult.warnings) && analysis.gateResult.warnings.length > 0 && (
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

                {/* Invalidation Contract — what kills this setup */}
                {invalidationCriteria && invalidationCriteria.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 bg-gradient-to-b from-rose-950/20 to-transparent">
                        <h4 className="text-[10px] uppercase font-bold text-rose-400 mb-2 flex items-center gap-2 tracking-widest">
                            <div className="w-1.5 h-1.5 bg-rose-500 rounded-full"></div> Invalidation Contract ({invalidationCriteria.length})
                        </h4>
                        <div className="space-y-2">
                            {invalidationCriteria.map((item, idx) => (
                                <div key={idx} className="text-[10px] sm:text-xs border border-rose-500/25 bg-rose-950/30 px-3 py-2 rounded-lg text-rose-100/90">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-mono font-bold text-rose-300">{item.level}</span>
                                        {item.category && (
                                            <span className="shrink-0 uppercase tracking-wider text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/25 text-rose-300">
                                                {item.category}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 leading-snug">{item.condition}</div>
                                    {item.note && (
                                        <div className="mt-0.5 italic opacity-60">{item.note}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Evidence Provenance — which claims are verified vs inferred */}
                {evidence && evidence.length > 0 && (
                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 bg-gradient-to-b from-cyan-950/20 to-transparent">
                        <h4 className="text-[10px] uppercase font-bold text-cyan-500 mb-2 flex items-center gap-2 tracking-widest">
                            <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full"></div> Evidence Basis ({evidence.length})
                        </h4>
                        <div className="space-y-2">
                            {evidence.map((item, idx) => {
                                const stateStyle = item.state === 'observed'
                                    ? 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30'
                                    : item.state === 'partial'
                                        ? 'text-amber-300 bg-amber-950/40 border-amber-500/30'
                                        : 'text-red-300 bg-red-950/40 border-red-500/30';
                                const stateLabel = item.state === 'observed' ? '✓ Observed' : item.state === 'partial' ? '◐ Partial' : '✕ Unobserved';
                                return (
                                    <div key={idx} className={`text-[10px] sm:text-xs border px-3 py-2 rounded-lg ${stateStyle}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="font-medium leading-snug">{item.claim}</span>
                                            <span className="shrink-0 font-bold uppercase tracking-wider text-[9px]">{stateLabel}</span>
                                        </div>
                                        {item.sources.length > 0 && (
                                            <div className="mt-1 opacity-70">Sources: {item.sources.join(' · ')}</div>
                                        )}
                                        {item.note && (
                                            <div className="mt-0.5 italic opacity-60">{item.note}</div>
                                        )}
                                    </div>
                                );
                            })}
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
                                 Devil's Advocate Analysis
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
                            className="w-full px-4 py-3 sm:px-6 sm:py-4 flex justify-between items-center hover:bg-zinc-800 transition-colors group"
                        >
                            <span className="uppercase tracking-widest font-bold text-[10px] sm:text-xs text-zinc-500 group-hover:text-cyan-400 transition-colors">Market Conditions Telemetry</span>
                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-300 ${isConditionsVisible ? 'rotate-180' : ''}`} />
                        </button>
                        <div className={`collapsible-content ${isConditionsVisible ? 'expanded' : ''} bg-zinc-950`}>

                            {/* Chart Telemetry Chips */}
                            {imageSummaries && imageSummaries.length > 0 && (
                                <div className="w-full border-b border-white/5 bg-zinc-800">
                                    <div className="px-4 py-3 sm:px-6 sm:py-4 flex flex-wrap gap-2 justify-start">
                                        {imageSummaries.map((summary, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-[10px] sm:text-xs font-mono text-cyan-100/90 bg-zinc-900 px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-cyan-900/30 shadow-sm">
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
                                                <div key={tf} className="flex gap-2 items-center bg-zinc-800 px-2 py-1 rounded">
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
                                                    <div key={i} className="bg-zinc-800 p-2 rounded-lg border border-white/5">
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
                                                        <span className="text-[8px] font-bold text-rose-300 block mb-0.5">RESISTANCE</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {keyLevels.resistance.map((lvl, idx) => (
                                                                <span key={idx} className="rounded border px-1.5 py-0.5 text-[9px]" style={{ color: '#fda4af', backgroundColor: 'rgba(127, 29, 29, 0.3)', borderColor: 'rgba(251, 113, 133, 0.28)' }}>{lvl}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {keyLevels.support.length > 0 && (
                                                    <div>
                                                        <span className="text-[8px] font-bold text-emerald-300 block mb-0.5">SUPPORT</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {keyLevels.support.map((lvl, idx) => (
                                                                <span key={idx} className="rounded border px-1.5 py-0.5 text-[9px]" style={{ color: '#6ee7b7', backgroundColor: 'rgba(6, 78, 59, 0.3)', borderColor: 'rgba(52, 211, 153, 0.28)' }}>{lvl}</span>
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
                                                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700/30'
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
                <div className="p-3 sm:p-4 border-t border-white/10 bg-zinc-900">
                    <BacktestPanel
                        analysis={analysis}
                        coinName={coinName}
                        createdAt={createdAt}
                        leverage={leverage}
                        messageId={messageId}
                        outcome={outcome}
                        isLogging={isLogging}
                        onOutcomeValidated={onLogTrade}
                    >
                        {/* Secondary Actions: Grid layout for mobile */}
                        <button onClick={() => onInitiateSkip(messageId)} className="flex-1 min-w-[60px] px-3 py-2 rounded-lg border border-zinc-500/30 bg-zinc-700/80 text-zinc-200 transition-colors hover:border-zinc-300/40 hover:bg-zinc-600 text-xs font-medium flex items-center justify-center gap-1.5" title="Skip trade"><SkipIcon className="w-3.5 h-3.5" />Skip</button>
                        {onSimulate && (
                            <button
                                onClick={() => onSimulate(messageId)}
                                className="flex-1 min-w-[60px] px-3 py-2 rounded-lg border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 transition-colors hover:border-cyan-300/40 hover:bg-cyan-500/20 text-xs font-medium flex items-center justify-center gap-1.5"
                                title="Scenario Simulator"
                            >
                                 <ActivityIcon className="w-3.5 h-3.5" /><span className="hidden sm:inline">Simulate</span><span className="sm:hidden">Sim</span>
                            </button>
                        )}
                        {onReRunAnalysis && (
                            <button
                                onClick={() => onReRunAnalysis(messageId)}
                                className="flex-1 min-w-[60px] px-3 py-2 rounded-lg border border-white/10 bg-zinc-700/80 text-zinc-300 transition-colors hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200 text-xs font-medium flex items-center justify-center gap-1.5"
                                title="Re-run the debate with the same setup"
                            >
                                <ActivityIcon className="w-3.5 h-3.5 rotate-180" /><span className="hidden sm:inline">Re-run</span><span className="sm:hidden">Run</span>
                            </button>
                        )}
                        <button onClick={() => onSaveAnalysis(messageId)} disabled={isSaved} className={`px-3 py-2 rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${isSaved ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200' : 'border-white/10 bg-zinc-700/80 text-zinc-300 hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200'}`} title="Save Analysis">
                             {isSaved ? <BookmarkSolidIcon className="w-4 h-4" /> : <BookmarkIcon className="w-4 h-4" />}
                             <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">{isSaved ? 'Saved' : 'Save'}</span>
                         </button>
                        {onViewReasoning && (
                            <button onClick={() => onViewReasoning(messageId)} className="px-3 py-2 rounded-lg border border-white/10 bg-zinc-700/80 text-zinc-300 hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-200 transition-colors flex items-center justify-center gap-1.5" title="View model reasoning in the Trading Journal Think tab">
                                <BrainIcon className="w-4 h-4" />
                                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Think</span>
                            </button>
                        )}
                        {/* Price-triggered re-debate ("watch this setup") */}
                        <SetupWatchControl analysis={analysis} messageId={messageId} />
                        {/* Price Alert Toggle */}
                        <PriceAlertToggle analysis={analysis} messageId={messageId} />
                        {/* Share Button */}
                        <ShareMenu analysis={analysis} outcome={outcome} tradingStyle={tradingStyle} />
                        {onUpdateTrade && (
                            <button onClick={() => onUpdateTrade(messageId)} className="px-3 py-2 rounded-lg border border-violet-400/25 bg-violet-500/10 text-violet-200 hover:border-violet-300/40 hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-1.5" title="Update Setup">
                                 <UpdateIcon className="w-4 h-4" /><span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Update</span>
                             </button>
                        )}
                    </BacktestPanel>
                </div>

                </div>

                </div>
            )}

        </div>
    );
};

export default React.memo(AnalysisResult);

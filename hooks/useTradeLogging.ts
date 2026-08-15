import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, TradeOutcome, LoggedTrade, SavedAnalysis, TradeSummary, LearningRule, ImageMetadata, AIProvider } from '../types';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';
import { captureForPostMortem } from '../services/ui/AutoCaptureService';
import * as MemoryService from '../services/learning/MemoryService';
import { insightTextForTrade } from '../utils/tradeInsightBrief';
import { ProviderConfig } from '../types/provider';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import { storeRule, loadLearningRules, saveLearningRules } from '../services/learning/LearningRulesService';
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';
import { parsePrice } from '../utils/analysisUtils';
import { trackTradeOutcome, mapRegimeToKey } from '../services/backtesting/ModelPerformanceService';
import { trackConfluenceOutcome, calculateConfluenceScore } from '../services/analysis/TimeframeConfluenceService';
import { SLOptimizationData } from '../services/backtesting/StopLossOptimizerService';
import { ConfidenceLevel } from '../services/validation/ConfidenceCalibrationService';
import { syncClosedTradeToNotebook } from '../services/learning/SkillMemoryService';
import { appendWatchEpisode } from '../utils/watchList';
import { parseIfThenClauses } from '../utils/ifThenSkill';
import { tradeAdmitsTechnicalStrategyRule } from '../utils/rootCause';

// Maximum number of trade summaries (Recent Insights) to keep - enforces FIFO when limit reached
export const MAX_TRADE_SUMMARIES = 100;

export interface UseTradeLoggingParams {
    messages: Message[];
    // Latest-message ref (from useConversations). The four "initiate"
    // handlers feed chatContext, whose memoization would otherwise be
    // defeated every stream chunk by a fresh `messages` closure.
    messagesRef: { current: Message[] };
    updateMessages: (updater: (prev: Message[]) => Message[]) => void;
    activeConversationLeverage?: number;
    moderatorProviderId: string;
    moderatorModel: string;
    memoryModel: string;
    memoryConfig: ProviderConfig;
    useAlgorithmicInsights: boolean;
    /** Fired after a trade is logged AND its insight generation settles —
     *  App debounces this into an automatic AI Review (Pattern Memory)
     *  re-run so the journal stays fresh without manual regeneration. */
    onJournalAutoRefresh?: () => void;
    // UI state setters needed by handlers:
    setIsAutoCapturing: (v: boolean) => void;
    setIsHybridLoading: (v: boolean) => void;
    setIsEntryNotHitCapturing: (v: boolean) => void;
    setIsUpdateAutoCapturing: (v: boolean) => void;
    setIsInsightGenerating: (v: boolean) => void;
    // Market data setters:
    setCurrentHybridData: (v: any) => void;
    // Post-mortem trigger:
    startPostMortemAnalysis: (candidate: PostMortemCandidate, summaries?: string[], imageUrls?: string[]) => void;
    // Analysis trigger:
    handleSendMessage: (text?: string, images?: ImageMetadata[], context?: string, options?: any) => void;
    // Toast:
    toast: { error: (title: string, msg?: string) => void; success: (title: string, msg?: string) => void };
    // Additional setters needed by handlers:
    setPostMortemCandidate: (v: PostMortemCandidate | null) => void;
    setConfidenceCalibration: (v: any) => void;
}

export const useTradeLogging = (params: UseTradeLoggingParams) => {
    const {
        messages, messagesRef, updateMessages, activeConversationLeverage,
        moderatorProviderId, moderatorModel,
        memoryModel, memoryConfig, useAlgorithmicInsights,
        onJournalAutoRefresh,
        setIsAutoCapturing, setIsHybridLoading, setIsEntryNotHitCapturing,
        setIsUpdateAutoCapturing, setIsInsightGenerating,
        setCurrentHybridData, startPostMortemAnalysis, handleSendMessage,
        toast, setPostMortemCandidate, setConfidenceCalibration,
    } = params;

    // ─── State ────────────────────────────────────────────────────────────
    const [loggedTrades, setLoggedTrades] = useState<LoggedTrade[]>([]);
    const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
    const [tradeSummaries, setTradeSummaries] = useState<TradeSummary[]>([]);
    const [finalTradeSummary, setFinalTradeSummary] = useState<string | null>(null);
    const [skipCandidate, setSkipCandidate] = useState<Message | null>(null);
    const [updateCandidate, setUpdateCandidate] = useState<Message | null>(null);
    const [simulatorCandidate, setSimulatorCandidate] = useState<Message | null>(null);
    const [skipReason, setSkipReason] = useState<TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED | null>(null);
    const [correctedEntry, setCorrectedEntry] = useState<string>('');
    const [dataCaptureCandidate, setDataCaptureCandidate] = useState<PostMortemCandidate | null>(null);
    const [entryNotHitCandidate, setEntryNotHitCandidate] = useState<{ message: Message; correctedEntry?: string } | null>(null);
    const [newlyAddedInsightIds, setNewlyAddedInsightIds] = useState<Set<string>>(new Set());

    // ─── Helpers ──────────────────────────────────────────────────────────

    const calculateTimeDifference = (originalDate: string): string => {
        const now = new Date();
        const original = new Date(originalDate);
        const diffMs = now.getTime() - original.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 60) return `${diffMins}m`;
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        return `${hours}h ${mins}m`;
    };

    // Auto-learn from trade outcome (Phase 1 AI Learning)
    const autoLearnFromOutcome = (trade: LoggedTrade) => {
        if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;

        const isWin = trade.outcome === TradeOutcome.WIN;
        const analysis = trade.analysis;
        if (!analysis) return;

        // Track per-model performance — dynamic provider ids from modelsUsed,
        // with legacy per-provider fields as fallback for historical trades.
        const providers: AIProvider[] = trade.modelsUsed && Object.keys(trade.modelsUsed).length > 0
            ? Object.keys(trade.modelsUsed)
            : ([
                trade.geminiModelUsed ? AIProvider.GEMINI : null,
                trade.deepseekModelUsed ? AIProvider.DEEPSEEK : null,
                trade.groqModelUsed ? AIProvider.GROQ : null,
            ] as (string | null)[]).filter((p): p is string => p !== null);

        providers.forEach(p => {
            // Per-analyst credit assignment: the consensus entries record each
            // analyst's OWN directional call. Crediting every model with the
            // moderator's verdict made per-model accuracy and dynamic weights
            // pure noise (a bearish analyst was rewarded for a winning Long).
            // Agreeing analysts get the trade outcome; analysts who called the
            // OPPOSITE direction get the inverse (their call lost).
            const entry = analysis.analystConsensus?.entries.find(e => e.thoughtsKey === p || e.providerId === p);
            let creditedWin = isWin;
            const tradeDirection = trade.analysis?.direction;
            if (entry?.direction && tradeDirection) {
                const agreed = String(entry.direction).toLowerCase() === String(tradeDirection).toLowerCase();
                creditedWin = agreed ? isWin : !isWin;
            }
            trackTradeOutcome(p, creditedWin, analysis.detectedPatternFamily || '', trade.marketRegime || 'ranging', analysis.confidence || 'Medium', {
                direction: analysis.direction,
                // parsePrice handles commas + annotations; the old digit-strip
                // regex turned "94500 4h" into 945004 in the RL training signal.
                entryPrice: parsePrice(analysis.entryPoints?.[0]?.price || '') || 0,
                // Real trade id so ReinforcementSignalService can dedupe
                // re-logged/updated trades.
                id: trade.id,
            });
        });

        // Auto-create learning rule from LOSS
        if (trade.outcome === TradeOutcome.LOSS && analysis.coinName && (trade.postMortem || '').trim() && tradeAdmitsTechnicalStrategyRule(trade)) {
            try {
                const rulesStorage = loadLearningRules();
                const clause = parseIfThenClauses(trade.postMortem || '')[0];
                const newRule: LearningRule = {
                    id: `auto_${Date.now()}`,
                    ifCondition: clause?.ifCondition
                        || `${analysis.coinName} + ${analysis.direction} + ${analysis.detectedPatternFamily || 'unknown'}`,
                    thenAction: clause?.thenAction
                        || 'Apply extra scrutiny - similar setup recently lost',
                    sourceTradeId: trade.id,
                    outcome: 'LOSS',
                    coin: analysis.coinName,
                    pattern: analysis.detectedPatternFamily,
                    // Neutral/undefined directions can never match a rule —
                    // guard like createRule does instead of casting blindly.
                    direction: (analysis.direction === 'Long' || analysis.direction === 'Short') ? analysis.direction : undefined,
                    createdAt: new Date().toISOString(),
                    useCount: 0
                };
                const updatedStorage = storeRule(rulesStorage, newRule);
                saveLearningRules(updatedStorage);
                console.log('[AutoLearn] Created rule from loss:', newRule.ifCondition);
            } catch (e) {
                console.error('[AutoLearn] Failed to create rule:', e);
            }
        }
    };

    // ─── Recent Insights helper ────────────────────────────────────────────
    // Shared by logTradeWithFeedback and logEntryNotHitTrade (the block was
    // duplicated verbatim for ~40 lines). The 3s animation timer is tracked
    // so an unmount can't setState after teardown.
    const insightTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    useEffect(() => {
        return () => {
            insightTimersRef.current.forEach(t => clearTimeout(t));
            insightTimersRef.current.clear();
        };
    }, []);

    const autoAddRecentInsight = useCallback(async (loggedTrade: LoggedTrade) => {
        setIsInsightGenerating(true);
        try {
            // Use the user's preference for Algo vs AI insight generation
            const summary = insightTextForTrade(loggedTrade)
                || await MemoryService.summarizeTrade(
                    loggedTrade,
                    memoryModel,
                    memoryConfig,
                    useAlgorithmicInsights
                );
            const newSummary = {
                id: loggedTrade.id,
                summaryText: summary,
                timestamp: new Date().toISOString()
            };

            setTradeSummaries(prev => {
                // Check if already exists to prevent duplicates
                if (prev.some(s => s.id === loggedTrade.id)) {
                    return prev;
                }
                const updated = [...prev, newSummary];
                // FIFO: Remove oldest entries to maintain max limit
                return updated.slice(-MAX_TRADE_SUMMARIES);
            });

            // Track newly added insight for animation
            setNewlyAddedInsightIds(prev => new Set(prev).add(loggedTrade.id));
            // Clear animation after 3 seconds
            const timer = setTimeout(() => {
                insightTimersRef.current.delete(timer);
                setNewlyAddedInsightIds(prev => {
                    const next = new Set(prev);
                    next.delete(loggedTrade.id);
                    return next;
                });
            }, 3000);
            insightTimersRef.current.add(timer);

            console.log('[AutoInsight] Trade auto-added to Recent Insights:', loggedTrade.id);
        } catch (error) {
            // P2-14: Surface the failure so the user knows an insight
            // wasn't created — their trade was still logged successfully.
            console.error('[AutoInsight] Failed to generate insight:', error);
            toast.error(
                "Insight Generation Failed",
                "Your trade was logged, but the AI insight couldn't be generated."
            );
        } finally {
            setIsInsightGenerating(false);
            // The trade is logged — ask App to re-run the AI Review (debounced)
            // whether or not this insight landed.
            onJournalAutoRefresh?.();
        }
    }, [memoryModel, memoryConfig, useAlgorithmicInsights, toast, onJournalAutoRefresh]);

    // ─── Trade Logging ────────────────────────────────────────────────────

    // Helper function to log trade (called by all capture handlers)
    const logTradeWithFeedback = useCallback(async (message: Message, outcome: TradeOutcome.WIN | TradeOutcome.LOSS, feedback: { pnlAmount?: number; pnlPercent?: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; slOptimizationData?: SLOptimizationData; }) => {
        // Persist the market regime captured at analysis time (7-value
        // hybrid regime normalized to the 4-key trade regime). Falls back to
        // undefined when no snapshot exists.
        const marketRegime = (message.analysis?.marketSnapshot as any)?.regime?.regime
            ? mapRegimeToKey((message.analysis?.marketSnapshot as any).regime.regime as any)
            : undefined;

        const loggedTrade: LoggedTrade = {
            id: message.id,
            analysis: message.analysis!,
            outcome: outcome,
            timestamp: new Date().toISOString(),
            leverage: activeConversationLeverage || DEFAULT_LEVERAGE,
            investmentAmount: undefined,
            pnlAmount: feedback.pnlAmount,
            pnlPercent: feedback.pnlPercent,
            correctedStopLoss: feedback.correctedStopLoss,
            correctedTakeProfit: feedback.correctedTakeProfit,
            triggeredEntryIndices: feedback.selectedEntryIndices, // Store which entries were triggered
            marketSnapshot: message.analysis?.marketSnapshot, // Persist for Algo Mode
            marketRegime,
            slOptimizationData: feedback.slOptimizationData, // Autopilot-observed SL behavior
            modelsUsed: message.modelsUsed,
            thoughtProcesses: message.thoughtProcesses,

            ocrModelUsed: message.ocrModelUsed,
            moderatorProvider: moderatorProviderId,
            moderatorModel: moderatorModel,
            isAccuracyMode: message.isAccuracyMode,
            accuracySubMode: message.accuracySubMode,
            // Persist debate transcript for training data
            debateTurns: message.debateTurns,
            moderatorSynthesis: message.text,
            patternMemoryGate: message.patternMemoryGate,
            promptVersion: message.runStats?.promptVersion,
            promptLane: message.runStats?.promptLane,
        };

        setLoggedTrades(prev => prev.some(t => t.id === loggedTrade.id) ? prev : [loggedTrade, ...prev]);
        updateMessages(prev => prev.map(m => {
            if (m.id !== message.id) return m;
            const next = { ...m, outcome };
            return m.watched ? appendWatchEpisode(next, 'logged', outcome) : next;
        }));

        const notebookUser = localStorage.getItem('last_active_user') || 'default';
        void syncClosedTradeToNotebook(loggedTrade, [loggedTrade, ...loggedTrades.filter(t => t.id !== loggedTrade.id)], notebookUser)
            .catch(err => console.warn('[TraderNotebook] Closed-trade sync failed:', err));

        // === ThinkingStore: Update outcome for all thinking records of this trade ===
        // This correlates the stored reasoning with the actual outcome (WIN/LOSS),
        // enabling outcome-conditioned training data.
        try {
            const { updateThinkingOutcome, getThinkingTradeId } = await import('../services/infrastructure/ThinkingStoreService');
            // Canonical trade key — same formula as the save side, so the
            // outcome update lands on the records even when the analysis
            // createdAt is missing.
            const tradeId = getThinkingTradeId(loggedTrade.analysis?.createdAt, loggedTrade.id);
            // Pass the card (message) id so the outcome reaches the records
            // even if the timestamp key diverges from the logged trade.
            // PnL travels with the outcome — the corpus becomes risk-weighted
            // (a WIN at +4R is not the same as a WIN at +0.5R).
            updateThinkingOutcome(
                tradeId,
                outcome,
                message.id,
                localStorage.getItem('last_active_user') || 'default',
                { pnlAmount: loggedTrade.pnlAmount, pnlPercent: loggedTrade.pnlPercent }
            ).catch(err => {
                console.warn('[ThinkingStore] Failed to update outcome:', err);
            });
        } catch (err) {
            console.warn('[ThinkingStore] Failed to import updateThinkingOutcome:', err);
        }

        // Update confidence calibration
        if (message.analysis?.confidence) {
            const confidence = message.analysis.confidence as ConfidenceLevel;
            const coin = message.analysis.coinName ||
                (message.text?.match(/\b([A-Z]{2,10}USDT?)\b/)?.[1]) || undefined;
            const pattern = message.analysis.detectedPatternFamily || undefined;

            const provider = Object.keys(message.modelsUsed || {})[0];
            if (coin || pattern) {
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
                    coin: coin?.toUpperCase(),
                    pattern: typeof pattern === 'string' ? pattern : undefined,
                    timeframe: '4h',
                    // Use the regime captured at analysis time (was derived
                    // from the pattern family — wrong dimension).
                    regime: marketRegime,
                    provider
                });
            } else {
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
                    provider
                });
            }

            // Confluence historical stats (was never tracked — the debate's
            // "historical confluence insight" always showed empty).
            try {
                const direction = message.analysis?.direction as 'Long' | 'Short' | 'Neutral' | undefined;
                if (direction && direction !== 'Neutral') {
                    const score = calculateConfluenceScore(message.analysis, direction);
                    trackConfluenceOutcome(score.score, outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS');
                }
            } catch (e) {
                console.warn('[Confluence] Failed to track outcome:', e);
            }
            // Sync React state for UI
            setConfidenceCalibration(GlobalLearningService.getCalibration());
        }

        // Trigger auto-learning from this trade outcome
        autoLearnFromOutcome(loggedTrade);

        // Auto-add to Recent Insights with FIFO enforcement
        void autoAddRecentInsight(loggedTrade);

    }, [activeConversationLeverage, moderatorProviderId, moderatorModel, updateMessages, memoryModel, memoryConfig, useAlgorithmicInsights, toast, autoAddRecentInsight, loggedTrades]);

    // ─── Data Capture Modal Handlers ──────────────────────────────────────

    const handleDataCaptureUpload = (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => {
        // User chose to upload screenshot manually - log trade first, then proceed to PostTradeUploadModal
        if (dataCaptureCandidate) {
            logTradeWithFeedback(dataCaptureCandidate.message, dataCaptureCandidate.outcome as any, feedback);
            setPostMortemCandidate({ ...dataCaptureCandidate, feedback });
            setDataCaptureCandidate(null);
        }
    };

    // Temporary variable to store feedback during auto-capture
    const handleDataCaptureAuto = async (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => {
        // User chose auto-capture - fetch current market data
        if (!dataCaptureCandidate || !dataCaptureCandidate.message.analysis) {
            setDataCaptureCandidate(null);
            return;
        }

        setIsAutoCapturing(true);
        setIsHybridLoading(true); // Show loading animation on HybridDataPanel

        try {
            // Pass analysis timestamp and selected entry indices for historical TP/SL verification
            const result = await captureForPostMortem(
                dataCaptureCandidate.message.analysis,
                dataCaptureCandidate.message.createdAt, // Original analysis timestamp
                feedback.selectedEntryIndices // User-selected entry indices for multi-entry trades
            );

            if (result.success && result.comparisonBlock) {
                // Update HybridDataPanel with captured market data
                if (result.data) {
                    console.log('[AutoCapture] HybridDataPanel UPDATE:', {
                        symbol: result.data.symbol,
                        currentPrice: result.data.marketData?.currentPrice,
                        hasIndicators: !!result.data.indicators,
                        hasRegime: !!result.data.regime,
                        dataKeys: Object.keys(result.data)
                    });
                    setCurrentHybridData(result.data);
                } else {
                    console.warn('[AutoCapture] result.data is undefined!')
                }

                // Pass the auto-captured data as image summaries to post-mortem
                // This will be injected into all AI post-mortem prompts
                const autoCaptureSummary = result.comparisonBlock;

                console.log('[AutoCapture] Successfully captured market data');
                console.log('[AutoCapture] Comparison block length:', autoCaptureSummary.length);

                // Log the trade AFTER successful capture
                logTradeWithFeedback(dataCaptureCandidate.message, dataCaptureCandidate.outcome as any, feedback);

                // Start post-mortem with auto-captured data
                startPostMortemAnalysis(
                    { ...dataCaptureCandidate, feedback },
                    [autoCaptureSummary], // Pass as image summary for prompt injection
                    undefined // No image URLs
                );
            } else {
                console.error('[AutoCapture] Failed:', result.error);
                toast.error("Auto-Capture Failed", `${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
                // Fallback to upload modal
                setPostMortemCandidate(dataCaptureCandidate);
            }
        } catch (error) {
            console.error('[AutoCapture] Error:', error);
            toast.error("Auto-Capture Failed", "Please try uploading a screenshot instead.");
            setPostMortemCandidate(dataCaptureCandidate);
        } finally {
            setIsAutoCapturing(false);
            setIsHybridLoading(false); // Stop loading animation
            setDataCaptureCandidate(null);
        }
    };

    const handleDataCaptureSkip = (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => {
        // User chose to skip - log trade and start post-mortem without additional data
        if (dataCaptureCandidate) {
            logTradeWithFeedback(dataCaptureCandidate.message, dataCaptureCandidate.outcome as any, feedback);
            startPostMortemAnalysis({ ...dataCaptureCandidate, feedback }, undefined, undefined);
            setDataCaptureCandidate(null);
        }
    };

    // ─── Log / Skip / Update Initiation ───────────────────────────────────

    const handleInitiateLogTrade = useCallback((messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (msg) {
            // Open DataCaptureModal directly - trade will only be logged after capture confirmation
            setDataCaptureCandidate({ message: msg, outcome, feedback: undefined });
        }
    }, [messagesRef]);

    const handleInitiateSkipTrade = useCallback((messageId: string) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (msg) {
            setSkipCandidate(msg);
            setSkipReason(TradeOutcome.SKIPPED);
            setCorrectedEntry('');
        }
    }, [messagesRef]);

    const handleConfirmSkipTrade = useCallback((reason: TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED) => {
        if (!skipCandidate) return;
        const outcome = reason;

        if (outcome === TradeOutcome.ENTRY_NOT_HIT && skipCandidate.analysis) {
            // DON'T log trade yet - defer until user confirms capture option in EntryNotHitCaptureModal
            // Just show the modal for capture options
            setEntryNotHitCandidate({
                message: skipCandidate,
                correctedEntry: correctedEntry || undefined
            });
        } else {
            // For SKIPPED outcome, update message immediately (no capture modal needed)
            updateMessages(prev => prev.map(m => m.id === skipCandidate.id ? { ...m, outcome, correctedEntry: correctedEntry || undefined } : m));
        }

        setSkipCandidate(null);
        setSkipReason(null);
        setCorrectedEntry('');
    }, [skipCandidate, correctedEntry]);

    // ─── Entry Not Hit Capture Handlers ───────────────────────────────────

    // Helper to log Entry Not Hit trade (called when user confirms capture choice)
    const logEntryNotHitTrade = useCallback(async (candidate: { message: Message; correctedEntry?: string }) => {
        if (!candidate.message.analysis) return;

        // Update message outcome
        updateMessages(prev => prev.map(m =>
            m.id === candidate.message.id
                ? { ...m, outcome: TradeOutcome.ENTRY_NOT_HIT, correctedEntry: candidate.correctedEntry }
                : m
        ));

        // Log the trade
        const loggedTrade: LoggedTrade = {
            id: candidate.message.id,
            analysis: candidate.message.analysis,
            outcome: TradeOutcome.ENTRY_NOT_HIT,
            timestamp: new Date().toISOString(),
            leverage: activeConversationLeverage || DEFAULT_LEVERAGE,
            correctedEntry: candidate.correctedEntry,
            modelsUsed: candidate.message.modelsUsed,
            isAccuracyMode: candidate.message.isAccuracyMode,
            accuracySubMode: candidate.message.accuracySubMode,
            patternMemoryGate: candidate.message.patternMemoryGate,
            promptVersion: candidate.message.runStats?.promptVersion,
        };
        // Dedupe by id — a double-confirm (e.g. retrying after a capture
        // failure that actually logged) previously appended a second row
        // with the same id, skewing every dashboard stat.
        setLoggedTrades(prev => prev.some(t => t.id === loggedTrade.id) ? prev : [loggedTrade, ...prev]);

        // === ThinkingStore: Update outcome for all thinking records of this trade ===
        // ENTRY_NOT_HIT resolves the reasoning set the same way a WIN/LOSS
        // does — without this the training records stayed PENDING forever and
        // the per-trade browser never showed the entry was missed.
        try {
            const { updateThinkingOutcome, getThinkingTradeId } = await import('../services/infrastructure/ThinkingStoreService');
            const tradeId = getThinkingTradeId(loggedTrade.analysis?.createdAt, loggedTrade.id);
            updateThinkingOutcome(tradeId, TradeOutcome.ENTRY_NOT_HIT, candidate.message.id, localStorage.getItem('last_active_user') || 'default').catch(err => {
                console.warn('[ThinkingStore] Failed to update outcome:', err);
            });
        } catch (err) {
            console.warn('[ThinkingStore] Failed to import updateThinkingOutcome:', err);
        }

        // Auto-add to Recent Insights with FIFO enforcement
        (async () => {
            setIsInsightGenerating(true);
            try {
                // Use the user's preference for Algo vs AI insight generation
                const summary = insightTextForTrade(loggedTrade)
                    || await MemoryService.summarizeTrade(
                        loggedTrade,
                        memoryModel,
                        memoryConfig,
                        useAlgorithmicInsights
                    );
                const newSummary = {
                    id: loggedTrade.id,
                    summaryText: summary,
                    timestamp: new Date().toISOString()
                };

                setTradeSummaries(prev => {
                    if (prev.some(s => s.id === loggedTrade.id)) return prev;
                    return [...prev, newSummary].slice(-MAX_TRADE_SUMMARIES);
                });

                setNewlyAddedInsightIds(prev => new Set(prev).add(loggedTrade.id));
                const timer = setTimeout(() => {
                    insightTimersRef.current.delete(timer);
                    setNewlyAddedInsightIds(prev => {
                        const next = new Set(prev);
                        next.delete(loggedTrade.id);
                        return next;
                    });
                }, 3000);
                insightTimersRef.current.add(timer);

                console.log('[AutoInsight] Entry Not Hit logged to Recent Insights:', loggedTrade.id);
            } catch (error) {
                // P2-14: Surface the failure so the user knows an insight
                // wasn't created — their trade was still logged successfully.
                console.error('[AutoInsight] Failed to generate insight:', error);
                toast.error(
                    "Insight Generation Failed",
                    "Your trade was logged, but the AI insight couldn't be generated."
                );
            } finally {
                setIsInsightGenerating(false);
                // ENTRY_NOT_HIT is a logged trade too — refresh the AI Review.
                onJournalAutoRefresh?.();
            }
        })();
    }, [activeConversationLeverage, memoryModel, memoryConfig, useAlgorithmicInsights, toast, onJournalAutoRefresh]);

    // ─── Outcome Autopilot confirmation ───────────────────────────────────
    // One-click logging of autopilot-detected outcomes. Funnels through the
    // same writers as the manual modals so calibration/autoLearn/insight
    // side-effects fire exactly once.

    const confirmAutopilotOutcome = useCallback((
        message: Message,
        outcome: TradeOutcome.WIN | TradeOutcome.LOSS,
        pnlPercent?: number,
        slOptimizationData?: SLOptimizationData
    ) => {
        // pnlPercent is a PERCENT (e.g. +200), not dollars — it must not be
        // written into pnlAmount, which dashboards sum as USD. It is carried
        // on pnlPercent instead; dollar PnL stays unset (Not Captured).
        void logTradeWithFeedback(message, outcome, {
            pnlPercent,
            slOptimizationData,
        });
        // Every other logging path (capture modal auto/skip, entry-not-hit)
        // starts the post-mortem right after logging — the autopilot
        // one-click confirm must do the same, or a confirmed outcome never
        // gets its post-mortem analysis.
        startPostMortemAnalysis(
            { message, outcome, feedback: undefined },
            undefined,
            undefined
        );
    }, [logTradeWithFeedback, startPostMortemAnalysis]);

    const confirmAutopilotEntryNotHit = useCallback((message: Message) => {
        logEntryNotHitTrade({ message });
        // Mirror handleEntryNotHitSkip: a confirmed no-entry also triggers
        // the entry-not-hit post-mortem (it never did from this path).
        startPostMortemAnalysis(
            { message, outcome: TradeOutcome.ENTRY_NOT_HIT, feedback: undefined },
            undefined,
            undefined
        );
    }, [logEntryNotHitTrade, startPostMortemAnalysis]);

    const handleEntryNotHitAutoCapture = useCallback(async () => {
        if (!entryNotHitCandidate || !entryNotHitCandidate.message.analysis) {
            setEntryNotHitCandidate(null);
            return;
        }

        // Log trade NOW since user confirmed their choice
        logEntryNotHitTrade(entryNotHitCandidate);

        setIsEntryNotHitCapturing(true);
        setIsHybridLoading(true);

        try {
            const result = await captureForPostMortem(
                entryNotHitCandidate.message.analysis,
                entryNotHitCandidate.message.createdAt
            );

            if (result.success && result.comparisonBlock) {
                if (result.data) {
                    console.log('[EntryNotHitCapture] HybridDataPanel UPDATE:', {
                        symbol: result.data.symbol,
                        currentPrice: result.data.marketData?.currentPrice,
                    });
                    setCurrentHybridData(result.data);
                }

                const autoCaptureSummary = result.comparisonBlock;
                console.log('[EntryNotHitCapture] Successfully captured market data');

                // Start post-mortem with auto-captured data for Entry Not Hit analysis
                startPostMortemAnalysis(
                    {
                        message: entryNotHitCandidate.message,
                        outcome: TradeOutcome.ENTRY_NOT_HIT,
                        feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
                    },
                    [autoCaptureSummary],
                    undefined
                );
            } else {
                console.error('[EntryNotHitCapture] Failed:', result.error);
                toast.error("Auto-Capture Failed", `${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
                // Fallback to upload modal
                setPostMortemCandidate({
                    message: entryNotHitCandidate.message,
                    outcome: TradeOutcome.ENTRY_NOT_HIT,
                    feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
                });
            }
        } catch (error) {
            console.error('[EntryNotHitCapture] Error:', error);
            toast.error("Auto-Capture Failed", "Please try uploading a screenshot instead.");
            setPostMortemCandidate({
                message: entryNotHitCandidate.message,
                outcome: TradeOutcome.ENTRY_NOT_HIT,
                feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
            });
        } finally {
            setIsEntryNotHitCapturing(false);
            setIsHybridLoading(false);
            setEntryNotHitCandidate(null);
        }
    }, [entryNotHitCandidate, logEntryNotHitTrade]);

    const handleEntryNotHitUpload = useCallback(() => {
        if (entryNotHitCandidate) {
            // Log trade NOW since user confirmed their choice
            logEntryNotHitTrade(entryNotHitCandidate);

            // Open the PostTradeUploadModal for manual screenshot upload
            setPostMortemCandidate({
                message: entryNotHitCandidate.message,
                outcome: TradeOutcome.ENTRY_NOT_HIT,
                feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
            });
            setEntryNotHitCandidate(null);
        }
    }, [entryNotHitCandidate, logEntryNotHitTrade]);

    const handleEntryNotHitSkip = useCallback(() => {
        if (entryNotHitCandidate) {
            // Log trade NOW since user confirmed their choice
            logEntryNotHitTrade(entryNotHitCandidate);

            // Start post-mortem without additional data
            startPostMortemAnalysis(
                {
                    message: entryNotHitCandidate.message,
                    outcome: TradeOutcome.ENTRY_NOT_HIT,
                    feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
                },
                undefined,
                undefined
            );
            setEntryNotHitCandidate(null);
        }
    }, [entryNotHitCandidate, logEntryNotHitTrade]);

    // ─── Update Trade Logic ───────────────────────────────────────────────

    const handleInitiateUpdateTrade = useCallback((messageId: string) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            setUpdateCandidate(msg);
        }
    }, [messagesRef]);

    // ─── Scenario Simulator Logic ─────────────────────────────────────────

    const handleInitiateSimulator = useCallback((messageId: string) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            setSimulatorCandidate(msg);
        }
    }, [messagesRef]);

    const handleConfirmUpdateTrade = useCallback((text: string, images: ImageMetadata[]) => {
        if (!updateCandidate || !updateCandidate.analysis) return;

        const originalAnalysis = updateCandidate.analysis;
        const originalCreatedAt = originalAnalysis.createdAt || updateCandidate.createdAt;

        // Calculate time interval
        let updateIntervalString = '';
        if (originalCreatedAt) {
            updateIntervalString = calculateTimeDifference(originalCreatedAt);
        }

        // We use the full ImageMetadata objects passed from the modal, which contain the real File objects
        const metaImages = images;

        // Construct Hidden Context to guide the AI
        const context = `**SYSTEM NOTICE: TRADE UPDATE EVENT**
**PREVIOUS SETUP (CONTEXT):**
${JSON.stringify(originalAnalysis, null, 2)}

**INSTRUCTIONS:**
1. Compare the NEW chart data/text against the ORIGINAL plan.
2. Decide: Maintain, Modify (tighten SL, move TP), or Abort.
3. Output the *Updated* JSON Plan.`;

        setUpdateCandidate(null);

        // Trigger analysis with User Text + Hidden Context AND Update Flag with interval
        handleSendMessage(text, metaImages, context, { isUpdate: true, updateInterval: updateIntervalString });

    }, [updateCandidate, handleSendMessage]);

    // Auto-capture handler for trade updates
    const handleUpdateAutoCapture = useCallback(async () => {
        if (!updateCandidate || !updateCandidate.analysis) {
            return;
        }

        setIsUpdateAutoCapturing(true);
        setIsHybridLoading(true); // Show loading animation on HybridDataPanel

        try {
            const originalAnalysis = updateCandidate.analysis;
            const originalCreatedAt = originalAnalysis.createdAt || updateCandidate.createdAt;

            // Capture current market data
            const result = await captureForPostMortem(
                originalAnalysis,
                originalCreatedAt // Pass original analysis timestamp
            );

            // DEBUG: Log full result status
            console.log('[UpdateAutoCapture] Result check:', {
                success: result.success,
                hasComparisonBlock: !!result.comparisonBlock,
                hasData: !!result.data,
                dataSymbol: result.data?.symbol,
                error: result.error
            });

            if (result.success && result.comparisonBlock) {
                console.log('[UpdateAutoCapture] Successfully captured market data:', {
                    symbol: result.data?.symbol,
                    price: result.data?.marketData?.currentPrice
                });

                // Calculate time interval
                let updateIntervalString = '';
                if (originalCreatedAt) {
                    updateIntervalString = calculateTimeDifference(originalCreatedAt);
                }

                // Construct context with captured data
                const context = `**SYSTEM NOTICE: TRADE UPDATE EVENT (AUTO-CAPTURE)**
**PREVIOUS SETUP (CONTEXT):**
${JSON.stringify(originalAnalysis, null, 2)}

**LIVE MARKET DATA (AUTO-CAPTURED):**
${result.comparisonBlock}

**INSTRUCTIONS:**
1. Compare the LIVE MARKET DATA against the ORIGINAL plan.
2. Decide: Maintain, Modify (tighten SL, move TP), or Abort.
3. Output the *Updated* JSON Plan.`;

                setUpdateCandidate(null);

                // Trigger analysis with auto-captured data - pass hybrid data directly to avoid state timing issues
                handleSendMessage('Update trade with current market data', [], context, {
                    isUpdate: true,
                    updateInterval: updateIntervalString,
                    presetHybridData: result.data // Pass directly to handleSendMessage 
                });
            } else {
                console.error('[UpdateAutoCapture] Failed:', result.error);
                toast.error("Auto-Capture Failed", `${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
            }
        } catch (error) {
            console.error('[UpdateAutoCapture] Error:', error);
            toast.error("Auto-Capture Failed", "Please try uploading a screenshot instead.");
        } finally {
            setIsUpdateAutoCapturing(false);
            setIsHybridLoading(false); // Stop loading animation
        }
    }, [updateCandidate, handleSendMessage]);

    // ─── Return ───────────────────────────────────────────────────────────

    return {
        // State values and setters
        loggedTrades, setLoggedTrades,
        savedAnalyses, setSavedAnalyses,
        tradeSummaries, setTradeSummaries,
        finalTradeSummary, setFinalTradeSummary,
        skipCandidate, setSkipCandidate,
        updateCandidate, setUpdateCandidate,
        simulatorCandidate, setSimulatorCandidate,
        skipReason, setSkipReason,
        correctedEntry, setCorrectedEntry,
        dataCaptureCandidate, setDataCaptureCandidate,
        entryNotHitCandidate, setEntryNotHitCandidate,
        newlyAddedInsightIds, setNewlyAddedInsightIds,
        // Handler functions
        logTradeWithFeedback,
        autoLearnFromOutcome,
        confirmAutopilotOutcome,
        confirmAutopilotEntryNotHit,
        handleDataCaptureUpload,
        handleDataCaptureAuto,
        handleDataCaptureSkip,
        handleInitiateLogTrade,
        handleInitiateSkipTrade,
        handleConfirmSkipTrade,
        logEntryNotHitTrade,
        handleEntryNotHitAutoCapture,
        handleEntryNotHitUpload,
        handleEntryNotHitSkip,
        handleInitiateUpdateTrade,
        handleInitiateSimulator,
        handleConfirmUpdateTrade,
        handleUpdateAutoCapture,
        calculateTimeDifference,
    };
};

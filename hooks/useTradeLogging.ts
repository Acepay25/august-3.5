import { useState, useCallback } from 'react';
import { Message, TradeOutcome, LoggedTrade, SavedAnalysis, TradeSummary, AIProvider, LearningRule, ImageMetadata } from '../types';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';
import { captureForPostMortem } from '../services/ui/AutoCaptureService';
import * as MemoryService from '../services/learning/MemoryService';
import { MemoryProvider } from '../services/learning/MemoryService';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import { storeRule, loadLearningRules, saveLearningRules } from '../services/learning/LearningRulesService';
import { trackTradeOutcome } from '../services/backtesting/ModelPerformanceService';
import { ConfidenceLevel } from '../services/validation/ConfidenceCalibrationService';

// Maximum number of trade summaries (Recent Insights) to keep - enforces FIFO when limit reached
export const MAX_TRADE_SUMMARIES = 100;

export interface UseTradeLoggingParams {
    messages: Message[];
    updateMessages: (updater: (prev: Message[]) => Message[]) => void;
    activeConversationLeverage?: number;
    moderatorProvider: AIProvider;
    moderatorModel: string;
    memoryModel: string;
    memoryProvider: MemoryProvider;
    useAlgorithmicInsights: boolean;
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
        messages, updateMessages, activeConversationLeverage,
        moderatorProvider, moderatorModel,
        memoryModel, memoryProvider, useAlgorithmicInsights,
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
    const [loggingTradeId, setLoggingTradeId] = useState<string | null>(null);
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

        // Track per-model performance
        const providers: AIProvider[] = [];
        if (trade.geminiModelUsed) providers.push(AIProvider.GEMINI);
        if (trade.deepseekModelUsed) providers.push(AIProvider.DEEPSEEK);
        if (trade.groqModelUsed) providers.push(AIProvider.GROQ);
        // Add other providers as needed if they are tracked in LoggedTrade

        providers.forEach(p => {
            trackTradeOutcome(p, isWin, analysis.detectedPatternFamily || '', 'ranging', analysis.confidence || 'Medium');
        });

        // Auto-create learning rule from LOSS
        if (trade.outcome === TradeOutcome.LOSS && analysis.coinName) {
            try {
                const rulesStorage = loadLearningRules();
                const newRule: LearningRule = {
                    id: `auto_${Date.now()}`,
                    ifCondition: `${analysis.coinName} + ${analysis.direction} + ${analysis.detectedPatternFamily || 'unknown'}`,
                    thenAction: 'Apply extra scrutiny - similar setup recently lost',
                    sourceTradeId: trade.id,
                    outcome: 'LOSS',
                    coin: analysis.coinName,
                    pattern: analysis.detectedPatternFamily,
                    direction: analysis.direction as 'Long' | 'Short',
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

    // ─── Trade Logging ────────────────────────────────────────────────────

    // Helper function to log trade (called by all capture handlers)
    const logTradeWithFeedback = useCallback(async (message: Message, outcome: TradeOutcome.WIN | TradeOutcome.LOSS, feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => {
        const loggedTrade: LoggedTrade = {
            id: message.id,
            analysis: message.analysis!,
            outcome: outcome,
            timestamp: new Date().toISOString(),
            leverage: activeConversationLeverage || 100,
            investmentAmount: undefined,
            pnlAmount: feedback.pnlAmount,
            correctedStopLoss: feedback.correctedStopLoss,
            correctedTakeProfit: feedback.correctedTakeProfit,
            triggeredEntryIndices: feedback.selectedEntryIndices, // Store which entries were triggered
            marketSnapshot: message.analysis?.marketSnapshot, // Persist for Algo Mode
            geminiModelUsed: message.geminiModelUsed,
            deepseekModelUsed: message.deepseekModelUsed,
            zhipuModelUsed: message.zhipuModelUsed,
            groqModelUsed: message.groqModelUsed,
            groqNewModelUsed: message.groqNewModelUsed,
            groqAlt2ModelUsed: message.groqAlt2ModelUsed,
            openrouterModelUsed: message.openrouterModelUsed,

            geminiThoughtProcess: message.geminiThoughtProcess,
            deepseekThoughtProcess: message.deepseekThoughtProcess,
            zhipuThoughtProcess: message.zhipuThoughtProcess,
            groqThoughtProcess: message.groqThoughtProcess,
            groqNewThoughtProcess: message.groqNewThoughtProcess,
            groqAlt2ThoughtProcess: message.groqAlt2ThoughtProcess,
            openrouterThoughtProcess: message.openrouterThoughtProcess,

            ocrModelUsed: message.ocrModelUsed,
            moderatorProvider: moderatorProvider,
            moderatorModel: moderatorModel,
            isAccuracyMode: message.isAccuracyMode,
            accuracySubMode: message.accuracySubMode
        };

        setLoggedTrades(prev => [loggedTrade, ...prev]);
        updateMessages(prev => prev.map(m => m.id === message.id ? { ...m, outcome } : m));

        // Update confidence calibration
        if (message.analysis?.confidence) {
            const confidence = message.analysis.confidence as ConfidenceLevel;
            const coin = message.analysis.coinName ||
                (message.text?.match(/\b([A-Z]{2,10}USDT?)\b/)?.[1]) || undefined;
            const pattern = message.analysis.detectedPatternFamily || undefined;

            if (coin || pattern) {
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
                    coin: coin?.toUpperCase(),
                    pattern: typeof pattern === 'string' ? pattern : undefined,
                    timeframe: '4h',
                    regime: message.analysis?.detectedPatternFamily?.toLowerCase().includes('trend') ? 'trending' :
                        message.analysis?.detectedPatternFamily?.toLowerCase().includes('range') ? 'ranging' : undefined
                });
            } else {
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
                });
            }
            // Sync React state for UI
            setConfidenceCalibration(GlobalLearningService.getCalibration());
        }

        // Trigger auto-learning from this trade outcome
        autoLearnFromOutcome(loggedTrade);

        // Auto-add to Recent Insights with FIFO enforcement
        (async () => {
            setIsInsightGenerating(true);
            try {
                // Use the user's preference for Algo vs AI insight generation
                const summary = await MemoryService.summarizeTrade(
                    loggedTrade,
                    memoryModel,
                    memoryProvider,
                    useAlgorithmicInsights // Pass the toggle state
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
                setTimeout(() => {
                    setNewlyAddedInsightIds(prev => {
                        const next = new Set(prev);
                        next.delete(loggedTrade.id);
                        return next;
                    });
                }, 3000);

                console.log('[AutoInsight] Trade auto-added to Recent Insights:', loggedTrade.id);
            } catch (error) {
                console.error('[AutoInsight] Failed to generate insight:', error);
            } finally {
                setIsInsightGenerating(false);
            }
        })();
    }, [activeConversationLeverage, moderatorProvider, moderatorModel, updateMessages, memoryModel, memoryProvider, useAlgorithmicInsights]);

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
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
            // Open DataCaptureModal directly - trade will only be logged after capture confirmation
            setDataCaptureCandidate({ message: msg, outcome, feedback: undefined });
        }
    }, [messages]);

    const handleInitiateSkipTrade = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
            setSkipCandidate(msg);
            setSkipReason(TradeOutcome.SKIPPED);
            setCorrectedEntry('');
        }
    }, [messages]);

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
    const logEntryNotHitTrade = useCallback((candidate: { message: Message; correctedEntry?: string }) => {
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
            leverage: activeConversationLeverage || 100,
            correctedEntry: candidate.correctedEntry,
            geminiModelUsed: candidate.message.geminiModelUsed,
            isAccuracyMode: candidate.message.isAccuracyMode,
            accuracySubMode: candidate.message.accuracySubMode
        };
        setLoggedTrades(prev => [loggedTrade, ...prev]);

        // Auto-add to Recent Insights with FIFO enforcement
        (async () => {
            setIsInsightGenerating(true);
            try {
                // Use the user's preference for Algo vs AI insight generation
                const summary = await MemoryService.summarizeTrade(
                    loggedTrade,
                    memoryModel,
                    memoryProvider,
                    useAlgorithmicInsights // Pass the toggle state
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
                setTimeout(() => {
                    setNewlyAddedInsightIds(prev => {
                        const next = new Set(prev);
                        next.delete(loggedTrade.id);
                        return next;
                    });
                }, 3000);

                console.log('[AutoInsight] Entry Not Hit logged to Recent Insights:', loggedTrade.id);
            } catch (error) {
                console.error('[AutoInsight] Failed to generate insight:', error);
            } finally {
                setIsInsightGenerating(false);
            }
        })();
    }, [activeConversationLeverage, memoryModel, memoryProvider, useAlgorithmicInsights]);

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
        const msg = messages.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            setUpdateCandidate(msg);
        }
    }, [messages]);

    // ─── Scenario Simulator Logic ─────────────────────────────────────────

    const handleInitiateSimulator = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            setSimulatorCandidate(msg);
        }
    }, [messages]);

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
        loggingTradeId, setLoggingTradeId,
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

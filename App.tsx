
// ... existing imports ...
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata, AIProvider, DebateTurn, Conversation, UserProfile, SavedAnalysis, LiveThoughts, TradeAnalysis, TradeSummary, GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction, AnalystLensConfig, LearningRule } from './types';
import * as geminiService from './services/geminiService';
import * as deepseekService from './services/deepseekService';
import * as zhipuService from './services/zhipuService';
import * as groqService from './services/groqService';
import * as groqNewService from './services/groqNewService';
import * as groqAlt2Service from './services/groqAlt2Service';
import * as openrouterService from './services/openrouterService';
import * as openaiService from './services/openaiService';
import * as grokNativeService from './services/grokNativeService';

import * as ensembleService from './services/ensembleService';
import * as dbService from './services/dbService';
import { fetchRecentLiquidations, fetchOHLCV, LiquidationData, Kline } from './services/MarketDataService';
import { ProbabilityEngineService } from './services/ProbabilityEngineService';

// Accuracy Mode Services
import * as geminiAccuracyService from './services/accuracy/geminiAccuracyService';
import * as deepseekAccuracyService from './services/accuracy/deepseekAccuracyService';
import * as zhipuAccuracyService from './services/accuracy/zhipuAccuracyService';
import * as groqAccuracyService from './services/accuracy/groqAccuracyService';
import * as groqNewAccuracyService from './services/accuracy/groqNewAccuracyService';
import * as groqAlt2AccuracyService from './services/accuracy/groqAlt2AccuracyService';
import * as openrouterAccuracyService from './services/accuracy/openrouterAccuracyService';
import * as openaiAccuracyService from './services/accuracy/openaiAccuracyService';
import * as grokNativeAccuracyService from './services/accuracy/grokNativeAccuracyService';

import * as ensembleAccuracyService from './services/accuracy/ensembleAccuracyService';


// Modular Imports
import { ChatContextProps } from './components/MessageItem';
import { Header } from './components/Header';
import { ChatArea } from './components/ChatArea';
import { Journal } from './components/Journal';
import StrategySearch from './components/StrategySearch';
import ConversationHistory from './components/ConversationHistory';
import UserProfileManager from './components/UserProfileManager';
import SavedAnalyses from './components/SavedAnalyses';
import Settings from './components/Settings';
import SettingsMenu from './components/SettingsMenu';
import LiveAnalysisView from './components/LiveAnalysisView';
import LivePostMortemView from './components/LivePostMortemView';
import { LogTradeModal } from './components/LogTradeModal';
import { PostTradeUploadModal, PostMortemCandidate } from './components/PostTradeUploadModal';
import { SkipTradeModal } from './components/SkipTradeModal';
import { DataCaptureModal } from './components/DataCaptureModal';
import { EntryNotHitCaptureModal } from './components/EntryNotHitCaptureModal';
import OutcomeMismatchModal from './components/OutcomeMismatchModal';
// import ScenarioSimulatorModal from './components/ScenarioSimulatorModal'; // Not created yet
import { captureForPostMortem, AutoCaptureResult } from './services/AutoCaptureService';
import { UpdateTradeModal } from './components/UpdateTradeModal';
import VisionDataViewer from './components/VisionDataViewer';
import LiveMarket from './components/LiveMarket';
import { AccuracyModeModal } from './components/AccuracyModeModal';
import HybridDataPanel from './components/HybridDataPanel';
import AdvancedAnalyticsSidePanel from './components/AdvancedAnalyticsSidePanel';
import ScenarioSimulator from './components/ScenarioSimulator';
import UpdateNotification from './components/UpdateNotification';
import MistakeWarningBanner from './components/MistakeWarningBanner';
import { setUpdateNotificationHandler, activateWaitingWorker } from './index';

import { GEMINI_MODELS, DEEPSEEK_MODELS, ZHIPU_MODELS, GROQ_MODELS, GROQ_NEW_MODELS, GROQ_ALT2_MODELS, OPENROUTER_MODELS, OPENAI_MODELS, GROK_MODELS, OCR_MODELS, modelIdToName, ocrModelIdToName, DEFAULT_FRAMEWORKS, ACCURACY_MODE_DEFAULTS } from './constants/models';
import { createNewConversation } from './utils/conversationUtils';
import { isQuotaError } from './utils/errorUtils';
import { isValidUserProfile } from './utils/profileUtils';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis } from './utils/analysisUtils';
import { processImagesForSummarization } from './utils/imageProcessor';
import { extractLastJson } from './utils/jsonUtils';
import { sanitizeAIResponse } from './utils/sanitizers';
import { tryFetchHybridDataFromPrompt, tryFetchHybridDataFromPromptWithCalibration, HybridDataPacket, runMonteCarloForSetup } from './services/HybridIntelligenceService';
import { MonteCarloResult, LabeledMonteCarloResult } from './services/MonteCarloService';
import { backtestSimilarSetups, LiveBacktestResult } from './services/LiveBacktestService';
import { pingBinanceAPI } from './services/MarketDataService';
import { updateCalibration, updateGranularCalibration, initializeCalibration, ConfidenceLevel } from './services/ConfidenceCalibrationService';
import { runValidationGate, TradeValidationOutput } from './services/TradeValidationGate';
import { validateTradeOutcome, TradeOutcomeValidation } from './services/BacktestingService';
import { SLOptimization } from './services/StopLossOptimizerService';
import { ConfidenceCalibration, InsightKnowledgeBase } from './types';
import useNetworkStatus from './hooks/useNetworkStatus';
import { offlineQueue, QueuedRequest } from './services/OfflineQueueService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { generateLearningFromPrompt, isLearningEnabled } from './services/LearningPromptService';
import { generatePersonalizedInjection } from './services/PersonalizedPromptService';
import { extractInsightsFromPostMortem, storeInsights, initializeKnowledgeBase } from './services/InsightExtractionService';
import * as MemoryService from './services/MemoryService';
import { MemoryProvider, MEMORY_PROVIDER_OPTIONS, MEMORY_MODELS, getDefaultModelForProvider } from './services/MemoryService';
import { getTradingWeaknesses } from './services/MistakePatternService';
import { syncFromTradeLog, syncRollingWindowFromTradeLog, initModelPerformanceService, trackTradeOutcome } from './services/ModelPerformanceService';
import { buildUnifiedLearningContext } from './services/UnifiedLearningBuilder';
import { loadLensConfig, saveLensConfig, getDefaultLensAssignments, getLensPromptForStyle, initAnalystLensService } from './services/AnalystLensService';
import { detectTradingStyle, getEffectiveStyle, generateMasterPromptStyleInjection } from './services/TradingStyleDetector';
import { getGateAnalysis, GateOutput } from './services/GateKeeperService';
import { exportDataAsFile, exportPreferencesData } from './services/ExportService';
import { checkDataIntegrity, createStartupBackup, updateTradeCount, logIntegrityEvent, runMigrations } from './services/DataIntegrityService';
import { initInvalidationRuleService, loadInvalidationRules } from './services/InvalidationRuleService';
import { storeRule, loadLearningRules, saveLearningRules } from './services/LearningRulesService';
import { PriceAlertService } from './services/PriceAlertService';
import { initConfluenceService } from './services/TimeframeConfluenceService';
import { initPatternMemoryService } from './services/PatternMemorySynthesisService';
import GlobalLearningService from './services/GlobalLearningService';
import { jobQueue, JobType } from './services/JobQueueService';
import { VersionHistoryDashboard } from './components/VersionHistoryDashboard';

// Maximum number of trade summaries (Recent Insights) to keep - enforces FIFO when limit reached
const MAX_TRADE_SUMMARIES = 100;

const App: React.FC = () => {
    // ... (All existing state definitions remain unchanged) ...
    // User Profile State
    const [activeUsername, setActiveUsername] = useState<string | null>(null);
    const [existingUsernames, setExistingUsernames] = useState<string[]>([]);
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'SAVED' | 'SAVING' | 'ERROR'>('SAVED');
    const [isLoading, setIsLoading] = useState(false);


    // Master state for all conversation data.
    const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    // Derived state for the active conversation.
    const activeConversation = useMemo(() =>
        conversationHistory.find(c => c.id === activeConversationId),
        [conversationHistory, activeConversationId]);

    const messages = activeConversation?.messages || [];

    // Ref to hold the latest messages for async access to prevent stale closures
    const messagesRef = useRef<Message[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const selectedGeminiModel = activeConversation?.geminiModel || GEMINI_MODELS[0].id;
    const selectedDeepSeekModel = activeConversation?.deepseekModel || DEEPSEEK_MODELS[0].id;
    const selectedZhipuModel = activeConversation?.zhipuModel || ZHIPU_MODELS[0].id;
    const selectedGroqModel = activeConversation?.groqModel || GROQ_MODELS[0].id;
    const selectedGroqNewModel = activeConversation?.groqNewModel || GROQ_NEW_MODELS[0].id;
    const selectedGroqAlt2Model = activeConversation?.groqAlt2Model || GROQ_ALT2_MODELS[0].id
    const selectedOpenrouterModel = activeConversation?.openrouterModel || OPENROUTER_MODELS[0].id;
    const selectedOcrModel = activeConversation?.ocrModel || OCR_MODELS[0].id;
    const isGeminiEnabled = activeConversation?.isGeminiEnabled ?? true;
    const isDeepSeekEnabled = activeConversation?.isDeepSeekEnabled ?? true;
    const isZhipuEnabled = activeConversation?.isZhipuEnabled ?? false; // Zhipu Disabled by default
    const isGroqEnabled = activeConversation?.isGroqEnabled ?? false;
    const isGroqNewEnabled = activeConversation?.isGroqNewEnabled ?? false;
    const isGroqAlt2Enabled = activeConversation?.isGroqAlt2Enabled ?? false;
    const isOpenrouterEnabled = activeConversation?.isOpenrouterEnabled ?? false;
    const isOpenaiEnabled = activeConversation?.isOpenaiEnabled ?? false;
    const selectedOpenaiModel = activeConversation?.openaiModel || OPENAI_MODELS[0].id;
    const isGrokNativeEnabled = activeConversation?.isGrokNativeEnabled ?? false;
    const selectedGrokNativeModel = activeConversation?.grokNativeModel || GROK_MODELS[0].id;
    const moderatorProvider = activeConversation?.moderatorProvider || AIProvider.GEMINI;
    const moderatorModel = activeConversation?.moderatorModel || 'gemini-2.5-pro';

    // UI and other state
    const [loggedTrades, setLoggedTrades] = useState<LoggedTrade[]>([]);
    const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
    const [tradeSummaries, setTradeSummaries] = useState<TradeSummary[]>([]);
    const [finalTradeSummary, setFinalTradeSummary] = useState<string | null>(null);

    // Layer 3: Global Long-Term Memory
    const [globalMemory, setGlobalMemory] = useState<GlobalMemory | undefined>(undefined);

    // Memory Provider Selection (for compressChatHistory and updateGlobalMemory)
    const [memoryProvider, setMemoryProvider] = useState<MemoryProvider>('gemini');
    const [memoryModel, setMemoryModel] = useState<string>('gemini-2.5-flash');
    const [isGlobalMemoryEnabled, setIsGlobalMemoryEnabled] = useState<boolean>(true);

    // Accuracy Mode State
    const [isAccuracyModeEnabled, setIsAccuracyModeEnabled] = useState<boolean>(false);
    const [accuracySubMode, setAccuracySubMode] = useState<AccuracySubMode>('original');
    const [showAccuracyModal, setShowAccuracyModal] = useState<boolean>(false);

    // Custom AI Behavior
    const [customInstructions, setCustomInstructions] = useState<CustomInstructionsMap>({
        general: [],
        accuracyOriginal: [],
        accuracyPure: []
    });
    const [isPlaybookEnabledInPureAI, setIsPlaybookEnabledInPureAI] = useState<boolean>(false);
    const [isFamiliesEnabledInPureAI, setIsFamiliesEnabledInPureAI] = useState<boolean>(false);
    const [isMemoryEnabledInPureAI, setIsMemoryEnabledInPureAI] = useState<boolean>(false);
    const [isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled] = useState<boolean>(false);

    // Analyst Lens Configuration - specialized roles for ensemble debates
    const [lensConfig, setLensConfig] = useState<AnalystLensConfig>(() => loadLensConfig());


    const [currentHybridData, setCurrentHybridData] = useState<HybridDataPacket | null>(null);
    const [isHybridLoading, setIsHybridLoading] = useState<boolean>(false);
    const [hybridConnectionStatus, setHybridConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [latestMonteCarloResult, setLatestMonteCarloResult] = useState<MonteCarloResult | null>(null);
    const [latestBacktestResult, setLatestBacktestResult] = useState<LiveBacktestResult | null>(null);
    const [perAIMonteCarloResults, setPerAIMonteCarloResults] = useState<LabeledMonteCarloResult[]>([]);
    const [currentSlOptimization, setCurrentSlOptimization] = useState<SLOptimization | null>(null);
    const [currentSuggestedEntryPrice, setCurrentSuggestedEntryPrice] = useState<number | null>(null);
    const [currentEntryTimingScore, setCurrentEntryTimingScore] = useState<{
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null>(null);

    // Confidence Calibration - tracks AI confidence vs actual outcomes
    const [confidenceCalibration, setConfidenceCalibration] = useState<ConfidenceCalibration | undefined>(undefined);

    // AI Learning - Knowledge base for extracted insights from post-mortems
    const [insightKnowledgeBase, setInsightKnowledgeBase] = useState<InsightKnowledgeBase | undefined>(undefined);

    // Network status and offline queue
    const { isOnline, wasOffline } = useNetworkStatus();
    const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);

    // Live Market Conditions (fetched periodically for Global Sessions display)
    const [liveMarketConditions, setLiveMarketConditions] = useState<{
        volatility: 'High' | 'Medium' | 'Low';
        liquidation: 'High' | 'Medium' | 'Low';
        lastUpdated: string;
    } | null>(null);

    const [activeFrameworks, setActiveFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
    const [summaryCharLimit, setSummaryCharLimit] = useState<number>(4000);
    const [summarizationProvider, setSummarizationProvider] = useState<AIProvider>(AIProvider.GEMINI);
    const [summarizationModel, setSummarizationModel] = useState<string>(GEMINI_MODELS[0].id);
    const [useAlgorithmicSummary, setUseAlgorithmicSummary] = useState<boolean>(true); // Default to Algo (saves tokens)
    const [useAlgorithmicInsights, setUseAlgorithmicInsights] = useState<boolean>(true); // NEW: Toggle for individual insights (Algo vs AI)

    // Model Selection for ChatInput (user-facing quick selectors)
    const [inputEnsembleModel, setInputEnsembleModel] = useState<string>('gemini-2.0-flash');
    const [inputModeratorModel, setInputModeratorModel] = useState<string>('gemini-2.5-pro');
    const [inputSummaryModel, setInputSummaryModel] = useState<string>('gemini-2.0-flash');


    const [input, setInput] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [loggingTradeId, setLoggingTradeId] = useState<string | null>(null);

    const [journalState, setJournalState] = useState<{ isOpen: boolean, tab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' }>({ isOpen: false, tab: 'log' });

    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const [isStrategySearchVisible, setIsStrategySearchVisible] = useState(false);
    const [isSavedAnalysesVisible, setIsSavedAnalysesVisible] = useState(false);
    const [isSettingsVisible, setIsSettingsVisible] = useState(false);
    const [isSettingsMenuVisible, setIsSettingsMenuVisible] = useState(false);
    const [isLiveMarketVisible, setIsLiveMarketVisible] = useState(false);
    const [isAdvancedAnalyticsOpen, setIsAdvancedAnalyticsOpen] = useState(false);
    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null); // Trade selection for AI Probability panel
    const [isCalculatingAIProbabilities, setIsCalculatingAIProbabilities] = useState<boolean>(false);
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [isVersionHistoryVisible, setIsVersionHistoryVisible] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [isRateLimited, setIsRateLimited] = useState(false);
    const [isDeepAnalysis, setIsDeepAnalysis] = useState<boolean>(false);
    const [quotaExceededModels, setQuotaExceededModels] = useState<Set<string>>(new Set());
    const [skipCandidate, setSkipCandidate] = useState<Message | null>(null);
    const [updateCandidate, setUpdateCandidate] = useState<Message | null>(null); // Update trade modal
    const [simulatorCandidate, setSimulatorCandidate] = useState<Message | null>(null); // Scenario Simulator modal
    const [skipReason, setSkipReason] = useState<TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED | null>(null);
    const [correctedEntry, setCorrectedEntry] = useState<string>('');
    const [showScrollDown, setShowScrollDown] = useState(false);
    const [showScrollUp, setShowScrollUp] = useState(false);
    const [highlightedAnalysisId, setHighlightedAnalysisId] = useState<string | null>(null);
    const [expandedIndividualThoughts, setExpandedIndividualThoughts] = useState<Record<string, boolean>>({});
    const [expandedDebateTranscripts, setExpandedDebateTranscripts] = useState<Record<string, boolean>>({});
    const [expandedPostMortemImages, setExpandedPostMortemImages] = useState<Record<string, boolean>>({});
    const [expandedPostMortems, setExpandedPostMortems] = useState<Record<string, boolean>>({});
    const [collapsedUserMessages, setCollapsedUserMessages] = useState<Record<string, boolean>>({});
    const [isLiveAnalysisVisible, setIsLiveAnalysisVisible] = useState(false);
    const [liveThoughts, setLiveThoughts] = useState<LiveThoughts>({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
    const [livePostMortemThoughts, setLivePostMortemThoughts] = useState<LiveThoughts>({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
    const [isLivePostMortemVisible, setIsLivePostMortemVisible] = useState(false);
    const [isAnalysisTypingComplete, setIsAnalysisTypingComplete] = useState(false);
    const [isPostMortemTypingComplete, setIsPostMortemTypingComplete] = useState(false);
    const [isAnalysisInProgress, setIsAnalysisInProgress] = useState(false);
    const [currentGateResult, setCurrentGateResult] = useState<GateOutput | null>(null); // Gate Scan result
    const [isPostMortemInProgress, setIsPostMortemInProgress] = useState(false);
    const [isSummaryInProgress, setIsSummaryInProgress] = useState(false);
    const [isInsightGenerating, setIsInsightGenerating] = useState<boolean>(false); // For auto-insight generation on trade log
    const [newlyAddedInsightIds, setNewlyAddedInsightIds] = useState<Set<string>>(new Set()); // For animation tracking
    const [typingMessageState, setTypingMessageState] = useState<{ id: string; fullText: string; field: 'postMortem' } | null>(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [logTradeState, setLogTradeState] = useState<{ message: Message; outcome: TradeOutcome.WIN | TradeOutcome.LOSS } | null>(null);
    const [postMortemCandidate, setPostMortemCandidate] = useState<PostMortemCandidate | null>(null);
    // State for the data capture choice modal (shown after trade is logged)
    const [dataCaptureCandidate, setDataCaptureCandidate] = useState<PostMortemCandidate | null>(null);
    const [isAutoCapturing, setIsAutoCapturing] = useState<boolean>(false);
    const [isUpdateAutoCapturing, setIsUpdateAutoCapturing] = useState<boolean>(false);
    // Entry Not Hit capture state
    const [entryNotHitCandidate, setEntryNotHitCandidate] = useState<{ message: Message; correctedEntry?: string } | null>(null);
    const [isEntryNotHitCapturing, setIsEntryNotHitCapturing] = useState<boolean>(false);

    // Mismatch Resolution State
    const [showMismatchModal, setShowMismatchModal] = useState(false);
    const [mismatchData, setMismatchData] = useState<{ candidate: PostMortemCandidate; validation: TradeOutcomeValidation } | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [leverageInput, setLeverageInput] = useState<string>('100');
    const [isLeverageDropdownOpen, setIsLeverageDropdownOpen] = useState(false);
    const [currentVisionData, setCurrentVisionData] = useState<string[]>([]);
    const [isVisionDataVisible, setIsVisionDataVisible] = useState(false);
    const [showUpdateNotification, setShowUpdateNotification] = useState(false);
    const appRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const analysisAbortController = useRef<AbortController | null>(null);
    const mobileMenuRef = useRef<HTMLDivElement>(null);
    const leverageRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<boolean>(false);

    // Register SW update notification handler
    useEffect(() => {
        setUpdateNotificationHandler(() => setShowUpdateNotification(true));
    }, []);

    // ... (Rest of existing hooks/functions) ...
    const analysisMessages = useMemo(() => messages.filter(m => m.analysis || m.isDebating), [messages]);
    const currentInsightIds = useMemo(() => tradeSummaries.map(s => s.id), [tradeSummaries]);

    const isImageUploadDisabled = isAnalysisInProgress || isPostMortemInProgress;
    const isSummarizing = images.some(img => img.isLoading);
    const isAnyProviderEnabled = isGeminiEnabled || isDeepSeekEnabled || isZhipuEnabled || isGroqEnabled || isGroqNewEnabled || isGroqAlt2Enabled || isOpenrouterEnabled || isOpenaiEnabled || isGrokNativeEnabled || isAccuracyModeEnabled;

    const familyWinRates = useMemo(() => {
        // ... (same implementation) ...
        const stats: Record<string, { total: number; wins: number; winRate: number }> = {
            'Family A': { total: 0, wins: 0, winRate: 0 },
            'Family B': { total: 0, wins: 0, winRate: 0 },
            'Family C': { total: 0, wins: 0, winRate: 0 },
            'Family Omega': { total: 0, wins: 0, winRate: 0 },
        };

        loggedTrades.forEach(trade => {
            if (trade.outcome === TradeOutcome.PENDING || trade.outcome === TradeOutcome.SKIPPED || trade.outcome === TradeOutcome.ENTRY_NOT_HIT) return;

            let family = trade.analysis.detectedPatternFamily;

            if (!family) {
                const pat = (trade.analysis.marketConditions?.pattern || '').toUpperCase();
                if (pat.includes('FAMILY A')) family = 'Family A';
                else if (pat.includes('FAMILY B')) family = 'Family B';
                else if (pat.includes('FAMILY C')) family = 'Family C';
                else if (pat.includes('OMEGA')) family = 'Family Omega';
            }

            let key = '';
            if (family?.toUpperCase().includes('FAMILY A')) key = 'Family A';
            else if (family?.toUpperCase().includes('FAMILY B')) key = 'Family B';
            else if (family?.toUpperCase().includes('FAMILY C')) key = 'Family C';
            else if (family?.toUpperCase().includes('OMEGA')) key = 'Family Omega';

            if (key && stats[key]) {
                stats[key].total++;
                if (trade.outcome === TradeOutcome.WIN) {
                    stats[key].wins++;
                }
            }
        });

        Object.keys(stats).forEach(key => {
            const s = stats[key];
            if (s.total > 0) {
                s.winRate = Math.round((s.wins / s.total) * 100);
            }
        });

        return stats;
    }, [loggedTrades]);

    // ... (useEffects) ...
    useEffect(() => {
        if (activeConversation) {
            setLeverageInput(String(activeConversation.leverage));
        }
    }, [activeConversation?.id, activeConversation?.leverage]);

    // Fetch live market conditions periodically for Global Sessions display
    useEffect(() => {
        const fetchLiveMarketConditions = async () => {
            try {
                // Fetch liquidation data
                const liquidationData = await fetchRecentLiquidations('BTCUSDT');

                // Fetch recent candles to calculate volatility (ATR approximation)
                const candles = await fetchOHLCV('BTCUSDT', '1h', 20);

                // Calculate average true range for volatility
                let volatility: 'High' | 'Medium' | 'Low' = 'Medium';
                if (candles && candles.length >= 14) {
                    const recentCandles = candles.slice(-14);
                    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
                    const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
                    const volatilityPercent = (avgRange / avgPrice) * 100;

                    // Classify volatility based on percentage range
                    if (volatilityPercent > 2) volatility = 'High';
                    else if (volatilityPercent > 0.8) volatility = 'Medium';
                    else volatility = 'Low';
                }

                // Map liquidation pressure
                const liquidation = liquidationData.liquidationPressure === 'high' ? 'High' :
                    liquidationData.liquidationPressure === 'medium' ? 'Medium' : 'Low';

                setLiveMarketConditions({
                    volatility,
                    liquidation,
                    lastUpdated: new Date().toISOString()
                });
            } catch (error) {
                console.error('[LiveMarketConditions] Failed to fetch:', error);
            }
        };

        // Fetch immediately on mount
        fetchLiveMarketConditions();

        // Then refresh every 60 seconds
        const interval = setInterval(fetchLiveMarketConditions, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isMobileMenuOpen && mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
                setIsMobileMenuOpen(false);
            }
            if (isLeverageDropdownOpen && leverageRef.current && !leverageRef.current.contains(event.target as Node)) {
                setIsLeverageDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMobileMenuOpen, isLeverageDropdownOpen]);

    // Check Binance API connection when Hybrid Intelligence is enabled
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        let retryCount = 0;

        const checkConnection = async () => {
            if (isHybridIntelligenceEnabled) {
                // Only show "connecting" if we are currently disconnected or in error state
                // This prevents flickering "connecting..." when we are already connected
                setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));

                try {
                    const isConnected = await pingBinanceAPI();

                    if (isConnected) {
                        setHybridConnectionStatus('connected');
                        retryCount = 0; // Reset retries on success
                    } else {
                        // Soft failure handling: Don't show error immediately, retry once
                        if (retryCount < 1) {
                            retryCount++;
                            console.log('[Hybrid Intelligence] Connection check failed, retrying silently...');
                            setTimeout(checkConnection, 1000); // Quick retry
                        } else {
                            setHybridConnectionStatus('error');
                        }
                    }
                } catch {
                    setHybridConnectionStatus('error');
                }
            } else {
                setHybridConnectionStatus('disconnected');
            }
        };

        if (isHybridIntelligenceEnabled) {
            checkConnection();
            // Re-check connection every 60 seconds (less aggressive than 30s)
            intervalId = setInterval(checkConnection, 60000);
        } else {
            setHybridConnectionStatus('disconnected');
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isHybridIntelligenceEnabled]);

    // Offline Queue: Sync when coming back online
    useEffect(() => {
        const updateQueueCount = async () => {
            try {
                const count = await offlineQueue.getCount();
                setPendingQueueCount(count);
            } catch (e) {
                console.error('[OfflineQueue] Failed to get queue count:', e);
            }
        };

        // Load initial queue count
        updateQueueCount();

        // When coming back online, process the queue
        if (wasOffline && isOnline) {
            console.log('[OfflineQueue] Back online, processing queued requests...');
            offlineQueue.process({
                onItemProcessed: () => updateQueueCount(),
                onQueueEmpty: () => setPendingQueueCount(0)
            });
        }
    }, [isOnline, wasOffline]);

    const updateMessages = useCallback((updater: (prevMessages: Message[]) => Message[]) => {
        setConversationHistory(prevHistory => {
            return prevHistory.map(conv => {
                if (conv.id === activeConversationId) {
                    return { ...conv, messages: updater(conv.messages) };
                }
                return conv;
            });
        });
    }, [activeConversationId]);

    const updateActiveConversation = useCallback((updater: (conv: Conversation) => Conversation) => {
        setConversationHistory(prev => prev.map(c =>
            c.id === activeConversationId ? updater(c) : c
        ));
    }, [activeConversationId]);

    // --- AUTOMATIC MEMORY COMPRESSION --- DISABLED to save tokens
    // Thread Memory (Layer 2) is no longer used, so no need to compress chat history
    // useEffect(() => {
    //     const compressMemory = async () => {
    //         if (!activeConversationId || !activeConversation || messages.length === 0) return;
    //         if (messages.length > 5 && messages.length % 8 === 0) {
    //             try {
    //                 const newSummary = await MemoryService.compressChatHistory(messages, activeConversation.threadSummary || '', memoryProvider);
    //                 updateActiveConversation(c => ({
    //                     ...c,
    //                     threadSummary: newSummary
    //                 }));
    //             } catch (e) {
    //                 console.error("Memory compression failed:", e);
    //             }
    //         }
    //     };
    //     compressMemory();
    // }, [messages.length, activeConversationId]);

    // ... (resetAppState, loadUserData) ...
    const resetAppState = async () => {
        const newConv = createNewConversation();
        setConversationHistory([newConv]);
        setActiveConversationId(newConv.id);
        setLoggedTrades([]);
        setSavedAnalyses([]);
        setTradeSummaries([]);
        setFinalTradeSummary(null);
        setGlobalMemory(undefined);
        setIsGlobalMemoryEnabled(true);
        setIsAccuracyModeEnabled(false);
        setAccuracySubMode('original');
        setCustomInstructions({ general: [], accuracyOriginal: [], accuracyPure: [] });
        setIsPlaybookEnabledInPureAI(false);
        setIsFamiliesEnabledInPureAI(false);
        setIsMemoryEnabledInPureAI(false);
        setIsHybridIntelligenceEnabled(false);
        setActiveFrameworks(DEFAULT_FRAMEWORKS);
        setSummaryCharLimit(4000);
        setSummarizationProvider(AIProvider.GEMINI);
        setSummarizationModel(GEMINI_MODELS[0].id);
        setInput('');
        setImages([]);
        setExpandedIndividualThoughts({});
        setExpandedDebateTranscripts({});
        setExpandedPostMortems({});
        setCollapsedUserMessages({});

        if (activeUsername) {
            await dbService.saveUserProfile(activeUsername, {
                conversations: [newConv],
                tradeLog: [],
                savedAnalyses: [],
                tradeSummaries: [],
                finalTradeSummary: null,
                globalMemory: undefined,
                settings: { activeFrameworks: DEFAULT_FRAMEWORKS, summaryCharLimit: 4000, summarizationProvider: AIProvider.GEMINI, summarizationModel: GEMINI_MODELS[0].id, isGlobalMemoryEnabled: true, isAccuracyModeEnabled: false, accuracySubMode: 'original', customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] }, isPlaybookEnabledInPureAI: false, isFamiliesEnabledInPureAI: false, isMemoryEnabledInPureAI: false, isHybridIntelligenceEnabled: false },
                lastActiveConversationId: newConv.id
            });
        }
    };

    const loadUserData = async (username: string) => {
        setIsLoading(true);

        // Initialize database (SQLite on native, IndexedDB on web)
        await dbService.initDatabase();
        // Initialize service caches
        await initModelPerformanceService();
        await initAnalystLensService();
        await initInvalidationRuleService();
        await PriceAlertService.init();
        await initConfluenceService();
        await initPatternMemoryService();
        await GlobalLearningService.initialize();

        const profile = await dbService.getUserProfile(username);
        if (profile) {
            const correctedConvs = (profile.conversations || []).map(conv => {
                const leverage = conv.leverage || 100;
                const correctedMessages = (conv.messages || []).map(msg => {
                    if (msg.analysis) {
                        return { ...msg, analysis: recalculateAnalysisMetrics(msg.analysis, leverage) };
                    }
                    return msg;
                });
                return { ...conv, leverage, messages: correctedMessages };
            });

            const convs = correctedConvs.length > 0 ? correctedConvs : [createNewConversation()];

            setConversationHistory(convs);
            setLoggedTrades((profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || 100 })));
            setSavedAnalyses(profile.savedAnalyses || []);
            setTradeSummaries((profile.tradeSummaries || []).slice(-MAX_TRADE_SUMMARIES));  // Keep most recent entries
            setFinalTradeSummary(profile.finalTradeSummary || null);
            setGlobalMemory(profile.globalMemory);
            setActiveFrameworks(profile.settings?.activeFrameworks || DEFAULT_FRAMEWORKS);
            setSummaryCharLimit(profile.settings?.summaryCharLimit || 4000);
            setSummarizationProvider(profile.settings?.summarizationProvider || AIProvider.GEMINI);
            setSummarizationModel(profile.settings?.summarizationModel || GEMINI_MODELS[0].id);
            setIsGlobalMemoryEnabled(profile.settings?.isGlobalMemoryEnabled ?? true);
            setIsAccuracyModeEnabled(profile.settings?.isAccuracyModeEnabled ?? false);
            setAccuracySubMode(profile.settings?.accuracySubMode || 'original');

            const loadedInstructions = profile.settings?.customInstructions;
            const defaultMap: CustomInstructionsMap = { general: [], accuracyOriginal: [], accuracyPure: [] };

            if (loadedInstructions) {
                if (typeof (loadedInstructions as any).general === 'string') {
                    const legacyGeneral = (loadedInstructions as any).general;
                    const legacyOriginal = (loadedInstructions as any).accuracyOriginal;
                    const legacyPure = (loadedInstructions as any).accuracyPure;

                    if (legacyGeneral) defaultMap.general.push({ id: 'migrated-gen', title: 'Legacy General', content: legacyGeneral, isActive: true });
                    if (legacyOriginal) defaultMap.accuracyOriginal.push({ id: 'migrated-orig', title: 'Legacy Accuracy', content: legacyOriginal, isActive: true });
                    if (legacyPure) defaultMap.accuracyPure.push({ id: 'migrated-pure', title: 'Legacy Pure', content: legacyPure, isActive: true });

                    setCustomInstructions(defaultMap);
                } else {
                    setCustomInstructions({
                        general: loadedInstructions.general || [],
                        accuracyOriginal: loadedInstructions.accuracyOriginal || [],
                        accuracyPure: loadedInstructions.accuracyPure || []
                    });
                }
            } else {
                setCustomInstructions(defaultMap);
            }

            setIsPlaybookEnabledInPureAI(profile.settings?.isPlaybookEnabledInPureAI ?? false);
            setIsFamiliesEnabledInPureAI(profile.settings?.isFamiliesEnabledInPureAI ?? false);
            setIsMemoryEnabledInPureAI(profile.settings?.isMemoryEnabledInPureAI ?? false);
            setIsHybridIntelligenceEnabled(profile.settings?.isHybridIntelligenceEnabled ?? false);
            setConfidenceCalibration(profile.settings?.confidenceCalibration);
            setMemoryProvider((profile.settings?.memoryProvider as any) || 'gemini');
            setMemoryModel(profile.settings?.memoryModel || 'gemini-2.5-flash');

            // AI Learning: Load knowledge base
            setInsightKnowledgeBase(profile.insightKnowledgeBase);

            // Sync model performance data from trade log
            const tradeLogData = (profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || 100 }));
            syncFromTradeLog(tradeLogData);
            syncRollingWindowFromTradeLog(tradeLogData);
            console.log('[App] Synced model performance data from trade log');

            const lastActive = convs.find(c => c.id === profile.lastActiveConversationId) || convs[0];
            setActiveConversationId(lastActive.id);

            // Data Integrity: Run migrations if needed
            await runMigrations(username);

            // Data Integrity: Create startup backup before any operations
            const tradeCount = (profile.tradeLog || []).length;
            createStartupBackup(username).catch(err =>
                console.warn('[DataIntegrity] Startup backup failed:', err)
            );

            // Data Integrity: Check for data loss
            const integrityCheck = await checkDataIntegrity(username, tradeCount);
            if (!integrityCheck.valid && integrityCheck.tradeCountChanged) {
                logIntegrityEvent('DATA_LOSS_DETECTED', integrityCheck);
                const message = `⚠️ Data Issue Detected\n\n` +
                    `Your trade log appears to have fewer trades than before ` +
                    `(${integrityCheck.previousTradeCount} → ${integrityCheck.currentTradeCount}).\n\n` +
                    (integrityCheck.hasBackups && integrityCheck.latestBackup
                        ? `A backup with ${integrityCheck.latestBackup.tradeCount} trades is available from ${new Date(integrityCheck.latestBackup.timestamp).toLocaleString()}.\n\nGo to Settings → Export Data to restore from backup.`
                        : 'Consider exporting your data regularly to prevent future data loss.');
                setTimeout(() => alert(message), 500);
            }
        } else {
            resetAppState();
        }
        setActiveUsername(username);
        sessionStorage.setItem('activeUsername', username);
        setIsUserModalOpen(false);
        setHighlightedAnalysisId(null);
        setCollapsedUserMessages({});
        setIsLoading(false);
    };

    useEffect(() => {
        let isMounted = true;
        const initializeApp = async () => {
            const users = await dbService.getAllUsernames();
            if (!isMounted) return;
            setExistingUsernames(users);
            const sessionUser = sessionStorage.getItem('activeUsername');
            if (sessionUser && users.includes(sessionUser)) {
                loadUserData(sessionUser);
            } else {
                setIsUserModalOpen(true);
            }
        };
        initializeApp();
        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        if (!activeUsername) return;

        setSaveStatus('SAVING');

        const handler = setTimeout(async () => {
            try {
                const profileData: Partial<Omit<UserProfile, 'username'>> = {
                    conversations: conversationHistory,
                    tradeLog: loggedTrades,
                    savedAnalyses: savedAnalyses,
                    tradeSummaries: tradeSummaries,
                    finalTradeSummary: finalTradeSummary,
                    globalMemory: globalMemory,
                    settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, memoryProvider, memoryModel },
                    lastActiveConversationId: activeConversationId || undefined,
                    // AI Learning data
                    insightKnowledgeBase: insightKnowledgeBase,
                };
                await dbService.saveUserProfile(activeUsername, profileData);
                setSaveStatus('SAVED');
            } catch (err) {
                console.error("Failed to save user profile:", err);
                setSaveStatus('ERROR');
            }
        }, 1500);

        return () => {
            clearTimeout(handler);
        };
    }, [conversationHistory, loggedTrades, activeFrameworks, activeUsername, activeConversationId, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, insightKnowledgeBase, memoryProvider, memoryModel]);

    // --- ACCURACY MODE THEME HANDLER ---
    // Maintain consistent dark theme regardless of mode
    useEffect(() => {
        if (appRef.current) {
            // Remove all legacy theme classes and use consistent dark theme
            appRef.current.classList.remove('bg-zinc-950', 'bg-[#1A0000]', 'bg-[#00121F]');
            appRef.current.classList.add('bg-zinc-950');
        }
    }, [isAccuracyModeEnabled, accuracySubMode]);

    const handleToggleAccuracyMode = () => {
        setShowAccuracyModal(true);
    };

    const handleConfirmAccuracyMode = () => {
        setIsAccuracyModeEnabled(!isAccuracyModeEnabled);
        setShowAccuracyModal(false);

        if (!isAccuracyModeEnabled) { // Enabling Accuracy Mode
            updateActiveConversation(conv => ({
                ...conv,
                isGeminiEnabled: true,
                isDeepSeekEnabled: true,
                isZhipuEnabled: false, // Ensure Zhipu is Disabled
                isGroqEnabled: true,
                isGroqNewEnabled: false,
                geminiModel: ACCURACY_MODE_DEFAULTS.GEMINI,
                deepseekModel: ACCURACY_MODE_DEFAULTS.DEEPSEEK,
                zhipuModel: ACCURACY_MODE_DEFAULTS.ZHIPU,
                groqModel: ACCURACY_MODE_DEFAULTS.GROQ,
                groqNewModel: GROQ_NEW_MODELS[0].id,
                moderatorProvider: ACCURACY_MODE_DEFAULTS.MODERATOR_PROVIDER,
                moderatorModel: ACCURACY_MODE_DEFAULTS.MODERATOR_MODEL,
                ocrModel: ACCURACY_MODE_DEFAULTS.VISION
            }));
            if (!accuracySubMode) setAccuracySubMode('original');
        }
    };

    // AI Provider Toggle Handlers (for ChatInput Ensemble Configuration)
    const handleSetIsGeminiEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGeminiEnabled: enabled }));
    const handleSetIsDeepSeekEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isDeepSeekEnabled: enabled }));
    const handleSetIsZhipuEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isZhipuEnabled: enabled }));
    const handleSetIsGroqEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqEnabled: enabled }));
    const handleSetIsGroqNewEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqNewEnabled: enabled }));
    const handleSetIsGroqAlt2Enabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqAlt2Enabled: enabled }));

    const handleSetIsOpenrouterEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isOpenrouterEnabled: enabled }));
    const handleSetIsOpenaiEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isOpenaiEnabled: enabled }));
    const handleSetIsGrokNativeEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGrokNativeEnabled: enabled }));
    const handleSetVisionModel = (modelId: string) => updateActiveConversation(c => ({ ...c, ocrModel: modelId }));

    // Analyst Lens config handler - updates state and persists to storage
    const handleSetLensConfig = useCallback((newConfig: AnalystLensConfig) => {
        setLensConfig(newConfig);
        saveLensConfig(newConfig);
    }, []);

    const handleQuotaExceeded = useCallback((modelId: string) => {
        setQuotaExceededModels(prev => new Set(prev).add(modelId));
    }, []);

    const getActiveCustomInstructions = () => {
        let instructionsList: CustomInstruction[] = [];

        if (isAccuracyModeEnabled) {
            instructionsList = accuracySubMode === 'pure_ai' ? customInstructions.accuracyPure : customInstructions.accuracyOriginal;
        } else {
            instructionsList = customInstructions.general;
        }

        // Combine all active instructions into one prompt string
        return instructionsList
            .filter(inst => inst.isActive)
            .map(inst => `[${inst.title}]\n${inst.content}`)
            .join('\n\n');
    };

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

    // Helper function to route Puter models to their specific sub-provider services




    // ========== Standard Ensemble ANALYSIS HANDLER ==========
    const handleSendMessage = useCallback(async (customPrompt?: string, customImages?: ImageMetadata[], hiddenContext?: string, options?: { isUpdate?: boolean; updateInterval?: string; presetHybridData?: HybridDataPacket | null }) => {
        const isSummarizing = images.some(img => img.isLoading);

        if (isAnalysisInProgress) return;

        // --- Standard Ensemble MODE ROUTING ---
        // If Standard Ensemble is enabled and properly configured, route to the new service


        // --- ROUTING LOGIC: Standard vs Accuracy Mode ---
        let enabledProviders: any[] = [];

        if (isAccuracyModeEnabled) {
            if (isGeminiEnabled) {
                enabledProviders.push({ name: 'Gemini', service: geminiAccuracyService, model: selectedGeminiModel, useImages: true, thoughtsKey: 'gemini' as const, aiProvider: AIProvider.GEMINI });
            }
            if (isDeepSeekEnabled) {
                enabledProviders.push({ name: 'DeepSeek', service: deepseekAccuracyService, model: selectedDeepSeekModel, useImages: false, thoughtsKey: 'deepseek' as const, aiProvider: AIProvider.DEEPSEEK });
            }
            if (isGroqEnabled) {
                enabledProviders.push({ name: 'Groq', service: groqAccuracyService, model: selectedGroqModel, useImages: false, thoughtsKey: 'groq' as const, aiProvider: AIProvider.GROQ });
            }
            if (isZhipuEnabled) {
                enabledProviders.push({ name: 'Zhipu', service: zhipuAccuracyService, model: selectedZhipuModel, useImages: true, thoughtsKey: 'zhipu' as const, aiProvider: AIProvider.ZHIPU });
            }
            if (isGroqNewEnabled) {
                enabledProviders.push({ name: 'Groq (Alt)', service: groqNewAccuracyService, model: selectedGroqNewModel, useImages: false, thoughtsKey: 'groqNew' as const, aiProvider: AIProvider.GROQ_NEW });
            }
            if (isGroqAlt2Enabled) {
                enabledProviders.push({ name: 'Groq (Alt 2)', service: groqAlt2AccuracyService, model: selectedGroqAlt2Model, useImages: false, thoughtsKey: 'groqAlt2' as const, aiProvider: AIProvider.GROQ_ALT2 });
            }

            if (isOpenrouterEnabled) {
                enabledProviders.push({ name: 'OpenRouter', service: openrouterAccuracyService, model: selectedOpenrouterModel, useImages: false, thoughtsKey: 'openrouter' as const, aiProvider: AIProvider.OPENROUTER });
            }
            if (isOpenaiEnabled) {
                enabledProviders.push({ name: 'OpenAI', service: openaiAccuracyService, model: selectedOpenaiModel, useImages: false, thoughtsKey: 'openai' as const, aiProvider: AIProvider.OPENAI });
            }
            if (isGrokNativeEnabled) {
                enabledProviders.push({ name: 'Grok', service: grokNativeAccuracyService, model: selectedGrokNativeModel, useImages: false, thoughtsKey: 'grokNative' as const, aiProvider: AIProvider.GROK });
            }

        } else {
            enabledProviders = [
                isGeminiEnabled && { name: 'Gemini', service: geminiService, model: selectedGeminiModel, useImages: true, thoughtsKey: 'gemini' as const, aiProvider: AIProvider.GEMINI },
                isDeepSeekEnabled && { name: 'DeepSeek', service: deepseekService, model: selectedDeepSeekModel, useImages: false, thoughtsKey: 'deepseek' as const, aiProvider: AIProvider.DEEPSEEK },
                isZhipuEnabled && { name: 'Zhipu', service: zhipuService, model: selectedZhipuModel, useImages: true, thoughtsKey: 'zhipu' as const, aiProvider: AIProvider.ZHIPU },
                isGroqEnabled && { name: 'Groq', service: groqService, model: selectedGroqModel, useImages: false, thoughtsKey: 'groq' as const, aiProvider: AIProvider.GROQ },
                isGroqNewEnabled && { name: 'Groq (Alt)', service: groqNewService, model: selectedGroqNewModel, useImages: false, thoughtsKey: 'groqNew' as const, aiProvider: AIProvider.GROQ_NEW },
                isGroqAlt2Enabled && { name: 'Groq (Alt 2)', service: groqAlt2Service, model: selectedGroqAlt2Model, useImages: false, thoughtsKey: 'groqAlt2' as const, aiProvider: AIProvider.GROQ_ALT2 },
                isOpenrouterEnabled && { name: 'OpenRouter', service: openrouterService, model: selectedOpenrouterModel, useImages: false, thoughtsKey: 'openrouter' as const, aiProvider: AIProvider.OPENROUTER },
                isOpenaiEnabled && { name: 'OpenAI', service: openaiService, model: selectedOpenaiModel, useImages: false, thoughtsKey: 'openai' as const, aiProvider: AIProvider.OPENAI },
                isGrokNativeEnabled && { name: 'Grok', service: grokNativeService, model: selectedGrokNativeModel, useImages: false, thoughtsKey: 'grokNative' as const, aiProvider: AIProvider.GROK },

            ].filter(Boolean) as any[];
        }

        let effectiveInput = '';
        if (typeof customPrompt === 'string') {
            effectiveInput = customPrompt;
        } else if (typeof input === 'string') {
            effectiveInput = input;
        }

        // Determine images source (state or override)
        const imagesToUse = customImages || images;

        if (loadingMessage || isSummarizing || (!effectiveInput.trim() && imagesToUse.length === 0) || isRateLimited || enabledProviders.length === 0) return;

        if (!isAccuracyModeEnabled && enabledProviders.length > 3) {
            alert("A maximum of 3 AI providers can be enabled for an ensemble debate in Standard Mode. Please disable at least one.");
            return;
        }

        setHighlightedAnalysisId(null);
        setIsRateLimited(false);
        analysisAbortController.current?.abort();
        const currentAbortController = new AbortController();
        analysisAbortController.current = currentAbortController;
        abortRef.current = false;

        if (imagesToUse.length > 0) {
            const visionData = imagesToUse.map(img => img.fullAnalysisText || `Chart ${imagesToUse.indexOf(img) + 1}: No analysis text available.`);
            setCurrentVisionData(visionData);
        }

        const imageFiles = imagesToUse.map(meta => meta.file);
        const dataURLs = imagesToUse.map(meta => meta.dataURL);
        // UI displays the user input, but API may receive enhanced context
        const originalPrompt = effectiveInput;
        const promptToSend = hiddenContext ? `${hiddenContext}\n\nUser Input: "${effectiveInput}"` : effectiveInput;

        const ocrModelsUsed = [...new Set(imagesToUse.map(meta => meta.ocrModelUsed).filter(Boolean) as string[])];

        // IMMEDIATELY show hybrid loading indicator if enabled (before message appears)
        // BUT skip if preset hybrid data was passed (from auto-capture)
        if (isHybridIntelligenceEnabled && !currentHybridData && !options?.presetHybridData) {
            // Only show loading and clear data if we are currently disconnected or in error state
            // This prevents flickering "connecting..." when we are already connected
            setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));
            setIsHybridLoading(true);
            setCurrentHybridData(null);
        }
        // If preset hybrid data was passed, use it immediately
        if (options?.presetHybridData) {
            setCurrentHybridData(options.presetHybridData);
            setIsHybridLoading(false);
        }

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: MessageRole.USER,
            text: originalPrompt,
            createdAt: new Date().toISOString(),
            images: dataURLs,
            imageSummaries: imagesToUse.map(meta => meta.summary).filter(Boolean) as string[],
            ocrModelUsed: ocrModelsUsed.join(', '),
        };

        updateMessages(prev => [...prev, userMessage]);
        setInput('');
        setImages([]);

        try {
            const currentMessages = messagesRef.current;
            const currentThreadSummary = activeConversation?.threadSummary;
            const memoryToInject = isGlobalMemoryEnabled ? globalMemory : undefined;
            const instructionsToUse = getActiveCustomInstructions();

            // HYBRID INTELLIGENCE: Inject real-time market data if enabled
            // Skip fetching if preset data was already passed (from auto-capture)
            let hybridDataInjection = '';
            console.warn('[Hybrid Intelligence] ======= START =======');
            console.warn('[Hybrid Intelligence] Enabled:', isHybridIntelligenceEnabled);
            console.warn('[Hybrid Intelligence] HasPresetData:', !!options?.presetHybridData);
            console.warn('[Hybrid Intelligence] User prompt:', effectiveInput);
            if (isHybridIntelligenceEnabled && !options?.presetHybridData) {
                try {
                    console.warn('[Hybrid Intelligence] Attempting to fetch data for prompt:', effectiveInput);
                    setLoadingMessage('Fetching real-time market data...');
                    const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(
                        effectiveInput,
                        GlobalLearningService.getCalibration()
                    );
                    setIsHybridLoading(false);
                    if (hybridResult) {
                        // Use enhanced injection which includes calibration data
                        hybridDataInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
                        setCurrentHybridData(hybridResult.data); // Store for UI display

                        // Store correlation risk if available - helpful for UI later
                        if (hybridResult.correlationRisk) {
                            console.log('[Hybrid Intelligence] Correlation Risk Score:', hybridResult.correlationRisk.correlationRiskScore);
                        }

                        console.warn('[Hybrid Intelligence] SUCCESS - Got data for:', hybridResult.data.symbol);

                        console.warn('[Hybrid Intelligence] Injection length:', hybridDataInjection.length);
                        console.warn('[Hybrid Intelligence] Injection preview:', hybridDataInjection.substring(0, 500));
                    } else {
                        console.warn('[Hybrid Intelligence] FAILED - No symbol detected in prompt');
                    }
                } catch (hybridError) {
                    setIsHybridLoading(false);
                    console.error('[Hybrid Intelligence] ERROR fetching market data:', hybridError);
                }
            } else if (options?.presetHybridData) {
                console.warn('[Hybrid Intelligence] SKIPPED - Using preset data from auto-capture');
            } else {
                console.warn('[Hybrid Intelligence] SKIPPED - Feature not enabled');
            }

            // AI LEARNING: Generate UNIFIED learning context from all 6 learning services
            let learningInjection = '';
            let moderatorLearningContext = ''; // NEW: Separate context for moderator

            // Use UnifiedLearningBuilder to consolidate all learning services
            const unifiedLearning = buildUnifiedLearningContext(
                loggedTrades,
                {
                    coin: effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?)?/i)?.[1]?.toUpperCase(),
                    pattern: undefined,
                    direction: effectiveInput.toLowerCase().includes('long') ? 'Long' :
                        effectiveInput.toLowerCase().includes('short') ? 'Short' : 'Neutral'
                },
                enabledProviders.map(p => p.aiProvider).filter(Boolean) as AIProvider[]
            );

            if (!unifiedLearning.isEmpty) {
                learningInjection = unifiedLearning.forAnalysts;
                moderatorLearningContext = unifiedLearning.forModerator; // Store for moderator
                console.log('[AI Learning] Unified context generated - Analyst:', learningInjection.length, 'chars, Moderator:', moderatorLearningContext.length, 'chars');
            } else if (loggedTrades.length >= 3) {
                // Fallback to legacy personalized injection if unified fails
                try {
                    learningInjection = generatePersonalizedInjection(
                        loggedTrades,
                        effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?)?/i)?.[1]?.toUpperCase(),
                        effectiveInput.toLowerCase().includes('long') ? 'Long' :
                            effectiveInput.toLowerCase().includes('short') ? 'Short' : 'Neutral'
                    );
                    if (learningInjection) {
                        console.log('[AI Learning] Fallback: personalized injection, length:', learningInjection.length);
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate personalized context:', learningError);
                }
            } else if (isLearningEnabled(loggedTrades)) {
                // Legacy fallback
                try {
                    learningInjection = generateLearningFromPrompt(
                        effectiveInput,
                        loggedTrades,
                        insightKnowledgeBase
                    );
                    if (learningInjection) {
                        console.log('[AI Learning] Fallback: legacy injection, length:', learningInjection.length);
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate learning context:', learningError);
                }
            }

            // PATTERN MEMORY: Use finalTradeSummary as the source for synthesized pattern memory
            let enhancedFinalTradeSummary = finalTradeSummary;

            // RECENT INSIGHTS: Construct string from individual trade summaries
            let recentInsightsString: string | null = null;
            if (tradeSummaries && tradeSummaries.length > 0) {
                const top10Summaries = tradeSummaries.slice(0, 10);
                recentInsightsString = top10Summaries.map((s, idx) => `${idx + 1}. [${new Date(s.timestamp).toLocaleDateString()}] ${s.summaryText}`).join('\n\n');
                console.log('[Recent Insights] Generated from tradeSummaries array, length:', recentInsightsString.length);
            }

            // Enhance prompt with hybrid data AND learning context if available
            let enhancedPrompt = promptToSend;
            if (hybridDataInjection || learningInjection) {
                const contextParts: string[] = [];
                if (hybridDataInjection) contextParts.push(hybridDataInjection);
                if (learningInjection) contextParts.push(learningInjection);
                enhancedPrompt = `${contextParts.join('\n\n')}\n\n${promptToSend}`;
            }

            // ========== GATE KEEPER: Two-Stage Gate Scan ==========
            // Extract symbol from prompt for Gate analysis
            // Exclude common command words that might be mistaken for symbols
            const commonWords = ['ANALYZE', 'CHECK', 'LOOK', 'REVIEW', 'SHOW', 'TELL', 'GIVE', 'WHAT', 'HOW', 'WHEN', 'WHERE', 'SHOULD', 'COULD', 'WOULD', 'PLEASE', 'HELP', 'FIND', 'GET', 'SET', 'RUN', 'TEST', 'TRADE', 'LONG', 'SHORT', 'BUY', 'SELL', 'SETUP', 'ENTRY', 'EXIT', 'STOP', 'TAKE', 'PROFIT', 'LOSS', 'CHART', 'PRICE', 'MARKET', 'UPDATE', 'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'ABOUT', 'LIKE', 'JUST', 'SOME', 'MORE', 'VERY', 'ALSO', 'EVEN', 'ONLY', 'SUCH', 'HERE', 'THERE', 'WELL', 'THAN', 'THEM', 'THEN', 'BEEN', 'HAVE', 'WILL', 'DOES', 'DONE', 'MAKE', 'MADE', 'WANT', 'NEED', 'MUST', 'TIME', 'DATA', 'INFO'];
            // Match crypto symbols: prioritize those ending in USDT/PERP, then standalone 2-5 letter symbols
            const symbolMatches = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?|PERP)\b/gi) ||
                effectiveInput.match(/\b([A-Z]{2,5})\b/gi) || [];
            const detectedSymbol = symbolMatches
                .map(m => m.replace(/USDT?|PERP/gi, '').toUpperCase())
                .find(s => s.length >= 2 && s.length <= 10 && !commonWords.includes(s));
            const finalSymbol = detectedSymbol ? `${detectedSymbol}USDT` : null;

            let gateInjection = '';
            let capturedGateResult: typeof currentGateResult = null; // Local variable to avoid state closure issue
            if (finalSymbol && isHybridIntelligenceEnabled) {
                try {
                    console.log(`[GateKeeper] Running Gate check for ${finalSymbol}...`);
                    setLoadingMessage('Running Gate Scan...');

                    const gateResult = await getGateAnalysis(finalSymbol, loggedTrades);
                    capturedGateResult = gateResult.gateOutput; // Capture locally for processNewAnalysis
                    setCurrentGateResult(gateResult.gateOutput);

                    if (gateResult.shouldProceed) {
                        gateInjection = gateResult.promptPrefix;
                        console.log(`[GateKeeper] ✅ Gate PASSED: Confidence cap ${(gateResult.gateOutput.confidenceCap * 100).toFixed(0)}%`);
                        if (gateResult.gateOutput.suggestedDirection) {
                            console.log(`[GateKeeper] Pattern Memory suggests: ${gateResult.gateOutput.suggestedDirection}`);
                        }
                    } else {
                        console.log(`[GateKeeper] ⚠️ Gate BLOCKED: ${gateResult.rejectionReason}`);
                        // Even if blocked, still proceed but with max penalty applied
                        gateInjection = `\n⚠️ GATE WARNING: ${gateResult.rejectionReason}\n`;
                    }
                } catch (gateError) {
                    console.error('[GateKeeper] Gate check failed:', gateError);
                    // Fail-open: proceed without Gate constraints
                }
            }

            // Prepend Gate injection to enhanced prompt if available
            if (gateInjection) {
                enhancedPrompt = `${gateInjection}${enhancedPrompt}`;
                console.log('[GateKeeper] Gate constraints injected into prompt');
            }
            // ========== END GATE KEEPER ==========

            console.warn('[Hybrid Intelligence] Enhanced prompt length:', enhancedPrompt.length);
            console.warn('[Hybrid Intelligence] Has injection:', hybridDataInjection.length > 0);
            console.warn('[AI Learning] Has learning injection:', learningInjection.length > 0);
            console.warn('[Hybrid Intelligence] ======= END =======');

            // Check if it's an update request via hiddenContext or other triggers
            const isUpdate = !!hiddenContext;

            if (imageFiles.length > 0 || originalPrompt.includes("LIVE MARKET STRATEGY EXTRACTION") || originalPrompt.includes("LIVE MARKET") || originalPrompt.includes("**LIVE MARKET DATA**") || isUpdate || hybridDataInjection || isHybridIntelligenceEnabled) {
                const summaries = imagesToUse.map(meta => meta.fullAnalysisText).filter(Boolean) as string[];
                const processNewAnalysis = (analysis: TradeAnalysis): TradeAnalysis => {
                    let finalAnalysis = sanitizeTradeAnalysis(analysis);
                    finalAnalysis.originalStopLossPercentage = finalAnalysis.stopLossPercentage;
                    finalAnalysis.takeProfit = Array.isArray(finalAnalysis.takeProfit)
                        ? finalAnalysis.takeProfit.map(tp => ({ ...tp, originalPercentage: tp.percentage }))
                        : [];

                    // Explicitly inject isUpdate flag if this was an update action
                    if (options?.isUpdate) {
                        finalAnalysis.isUpdate = true;
                        if (options.updateInterval) {
                            finalAnalysis.updateInterval = options.updateInterval;
                        }
                    }

                    // ========== GATE KEEPER RESULT ==========
                    // Store Gate result in analysis for UI display
                    if (capturedGateResult) {
                        finalAnalysis.gateResult = {
                            passed: capturedGateResult.pass,
                            confidenceCap: capturedGateResult.confidenceCap,
                            penalties: capturedGateResult.confidencePenalties,
                            familyBias: capturedGateResult.familyBias,
                            suggestedDirection: capturedGateResult.suggestedDirection,
                            warnings: capturedGateResult.warnings.slice(0, 3),
                            insights: capturedGateResult.insights.slice(0, 2)
                        };
                        console.log(`[GateKeeper] Result stored in analysis: cap=${(capturedGateResult.confidenceCap * 100).toFixed(0)}%`);
                    }
                    // ========== END GATE KEEPER RESULT ==========

                    // ========== ACCURACY VALIDATION GATE ==========
                    // Always run validation gate to ensure quality checks
                    // The gate will handle gracefully when hybridData is null
                    try {
                        const validationResult = runValidationGate({
                            analysis: finalAnalysis,
                            hybridData: currentHybridData, // May be null in non-hybrid mode
                            calibration: GlobalLearningService.getCalibration(), // Use global persistent calibration
                            tradeHistory: loggedTrades
                        });

                        // Store original confidence if adjusted
                        if (validationResult.confidenceWasAdjusted) {
                            finalAnalysis.originalConfidence = validationResult.originalConfidence;
                            finalAnalysis.confidence = validationResult.adjustedConfidence;
                            console.log(`[ValidationGate] Confidence adjusted: ${validationResult.originalConfidence} → ${validationResult.adjustedConfidence}`);
                        }

                        // Store validation warnings
                        if (validationResult.warnings.length > 0) {
                            finalAnalysis.validationWarnings = validationResult.warnings;
                            console.log(`[ValidationGate] ${validationResult.warnings.length} warnings added to analysis`);
                        }

                        // Store Devil's Advocate data if available
                        if (validationResult.devilsAdvocate) {
                            finalAnalysis.devilsAdvocate = {
                                bearCaseReasons: validationResult.devilsAdvocate.bearCaseReasons,
                                failureScenarios: validationResult.devilsAdvocate.tradeFailureScenarios,
                                crowdedTradeWarning: validationResult.crowdedTradeWarning,
                                riskScore: validationResult.devilsAdvocate.overallRiskScore
                            };
                        }

                        // Store Entry Timing Score for display in trade card
                        if (validationResult.entryTiming) {
                            finalAnalysis.entryTimingScore = {
                                score: validationResult.entryTiming.score,
                                timingQuality: validationResult.entryTiming.timing,
                                suggestedEntry: validationResult.entryTiming.suggestedEntry
                            };
                            console.log(`[ValidationGate] Entry Timing Score: ${validationResult.entryTiming.score}/100 (${validationResult.entryTiming.timing})`);

                            // Store Entry Timing Score for HybridDataPanel display
                            setCurrentEntryTimingScore({
                                score: validationResult.entryTiming.score,
                                timingQuality: validationResult.entryTiming.timing,
                                suggestedEntry: validationResult.entryTiming.suggestedEntry
                            });

                            // Store suggested entry price for HybridDataPanel SL Optimization display
                            if (validationResult.entryTiming.suggestedEntry?.price) {
                                setCurrentSuggestedEntryPrice(validationResult.entryTiming.suggestedEntry.price);
                                console.log(`[ValidationGate] Suggested Entry Price: $${validationResult.entryTiming.suggestedEntry.price}`);
                            }
                        }

                        // Store SL Optimization for HybridDataPanel display
                        if (validationResult.slOptimization) {
                            setCurrentSlOptimization(validationResult.slOptimization);
                            console.log(`[ValidationGate] SL Optimization: Recommended multiplier ${(validationResult.slOptimization.recommendedMultiplier * 100).toFixed(0)}%, Missed wins: ${validationResult.slOptimization.missedWinRate.toFixed(0)}%`);
                        }

                        // Log validation report (for debugging)
                        const modeStr = isAccuracyModeEnabled
                            ? (accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Accuracy Original')
                            : 'Standard';
                        console.log(`[ValidationGate] Mode: ${modeStr} | Hybrid: ${isHybridIntelligenceEnabled}`);
                        console.log('[ValidationGate] Full Report:\n', validationResult.validationReport);

                        // ========== MONTE CARLO SIMULATION ==========
                        // Run simulation if we have hybrid data and a trade setup
                        console.log('[MonteCarlo] Conditions check:', {
                            hasHybridData: !!currentHybridData,
                            hybridDataSymbol: currentHybridData?.symbol || 'none',
                            hybridData1hATR: currentHybridData?.indicators?.['1h']?.atr || 'none',
                            hasEntryPoints: !!finalAnalysis.entryPoints?.length,
                            entryPointsLength: finalAnalysis.entryPoints?.length || 0,
                            hasStopLoss: !!finalAnalysis.stopLoss,
                            stopLoss: finalAnalysis.stopLoss,
                            hasTakeProfit: !!finalAnalysis.takeProfit?.length,
                            direction: finalAnalysis.direction
                        });

                        // Run if we have entry points and stop loss (Hybrid data is optional - will use fallback ATR)
                        if (finalAnalysis.entryPoints?.length && finalAnalysis.stopLoss) {
                            try {
                                const mcResult = runMonteCarloForSetup({
                                    direction: finalAnalysis.direction,
                                    entryPoints: finalAnalysis.entryPoints,
                                    stopLoss: finalAnalysis.stopLoss,
                                    takeProfit: finalAnalysis.takeProfit
                                }, currentHybridData || {
                                    // Fallback minimal hybrid data when Hybrid Intelligence is off
                                    indicators: {},
                                    regime: { detected: 'unknown', trendDirection: 'neutral' }
                                } as any);

                                if (mcResult) {
                                    setLatestMonteCarloResult(mcResult);
                                    // Also add to perAI results as the final moderator result
                                    // Uses functional update to ensure it appends to current per-AI results
                                    setPerAIMonteCarloResults(current => [
                                        ...current.filter(r => !r.isModeratorFinal), // Remove any previous moderator
                                        {
                                            provider: '🏛️ MODERATOR (Final)',
                                            result: mcResult,
                                            isModeratorFinal: true
                                        }
                                    ]);
                                    console.log(`[MonteCarlo] ✅ Simulation complete: WinRate=${mcResult.winRate}%, EV=${mcResult.expectedValue}%`);
                                } else {
                                    console.log('[MonteCarlo] ⚠️ Simulation returned null - insufficient trade data');
                                }
                            } catch (mcError) {
                                console.error('[MonteCarlo] ❌ Simulation failed:', mcError);
                            }
                        } else {
                            console.log('[MonteCarlo] ⏭️ Skipped - missing conditions:', {
                                needsEntryPoints: !finalAnalysis.entryPoints?.length ? 'No entry points in analysis' : '✓',
                                needsStopLoss: !finalAnalysis.stopLoss ? 'No stop loss in analysis' : '✓'
                            });
                        }
                        // ========== END MONTE CARLO ==========

                        // ========== LIVE BACKTEST ==========
                        // Run backtest if we have trade history
                        console.log('[LiveBacktest] Conditions check:', {
                            loggedTradesCount: loggedTrades.length,
                            needsMinTrades: 3,
                            hasCoinName: !!finalAnalysis.coinName,
                            coinName: finalAnalysis.coinName
                        });

                        if (loggedTrades.length >= 3 && finalAnalysis.coinName) {
                            try {
                                const btResult = backtestSimilarSetups(
                                    finalAnalysis,
                                    loggedTrades,
                                    currentHybridData?.regime?.regime
                                );

                                if (btResult && btResult.totalMatches > 0) {
                                    setLatestBacktestResult(btResult);
                                    console.log(`[LiveBacktest] ✅ Found ${btResult.totalMatches} matches: WinRate=${btResult.winRate.toFixed(1)}%, EV=${btResult.expectedValue.toFixed(2)}%`);
                                } else {
                                    console.log('[LiveBacktest] ⚠️ No similar trades found in history');
                                }
                            } catch (btError) {
                                console.error('[LiveBacktest] ❌ Backtest failed:', btError);
                            }
                        } else {
                            console.log('[LiveBacktest] ⏭️ Skipped - missing conditions:', {
                                needsMoreTrades: loggedTrades.length < 3 ? `Need ${3 - loggedTrades.length} more logged trades` : '✓',
                                needsCoinName: !finalAnalysis.coinName ? 'No coin detected in analysis' : '✓'
                            });
                        }
                        // ========== END LIVE BACKTEST ==========

                    } catch (validationError) {
                        console.error('[ValidationGate] Validation failed:', validationError);
                    }
                    // ========== END VALIDATION GATE ==========

                    return recalculateAnalysisMetrics(finalAnalysis, activeConversation?.leverage || 100);
                };

                if (enabledProviders.length > 1) {
                    setLoadingMessage("Thinking...");
                    setIsAnalysisInProgress(true);
                    // Clear previous Monte Carlo results for fresh analysis
                    setPerAIMonteCarloResults([]);
                    setLatestMonteCarloResult(null);
                    setLatestBacktestResult(null);
                    setLiveThoughts({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
                    setIsAnalysisTypingComplete(false);
                    setIsLiveAnalysisVisible(true);

                    const analysisPromises = enabledProviders.map(provider =>
                        provider.service.analyzeTradingView(
                            enhancedPrompt,
                            provider.useImages ? imageFiles : [],
                            summaries,
                            currentMessages,
                            enhancedFinalTradeSummary, // Pattern Memory (Synthesis)
                            recentInsightsString,      // Recent Insights (Individual)
                            provider.model,
                            isAccuracyModeEnabled ? activeFrameworks : activeFrameworks,
                            isDeepAnalysis,
                            memoryToInject,
                            currentThreadSummary,
                            isAccuracyModeEnabled ? accuracySubMode : undefined,
                            instructionsToUse,
                            isPlaybookEnabledInPureAI,
                            isFamiliesEnabledInPureAI,
                            isMemoryEnabledInPureAI,
                            // Analyst Lens: pass role-specific prompt based on trading style
                            lensConfig.enabled && provider.aiProvider
                                ? getLensPromptForStyle(
                                    provider.aiProvider,
                                    lensConfig.assignments,
                                    // For auto mode, use swing as default (will be detected per-call with hybrid data)
                                    lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                                )
                                : undefined
                        )
                            .catch((err: any) => {
                                const errorMsg = err instanceof Error ? err.message : String(err);
                                setLiveThoughts(prev => ({ ...prev, [provider.thoughtsKey]: errorMsg }));

                                throw err;
                            })
                    );

                    const results = await Promise.all(analysisPromises);
                    if (abortRef.current) return;
                    setLoadingMessage(null);

                    const thoughtMap: Record<string, string> = {};
                    results.forEach((res, index) => {
                        const providerKey = enabledProviders[index].thoughtsKey;
                        thoughtMap[providerKey] = res.thoughtProcess;
                    });

                    // FIX: Populate liveThoughts for LiveAnalysisView display
                    setLiveThoughts(prev => ({
                        ...prev,
                        ...thoughtMap
                    } as LiveThoughts));

                    // ========== PER-AI MONTE CARLO ==========
                    // Run Monte Carlo on each AI's proposed setup BEFORE moderation
                    const perAIMC: LabeledMonteCarloResult[] = [];
                    const hybridDataForMC = currentHybridData || {
                        indicators: {},
                        regime: { detected: 'unknown', trendDirection: 'neutral' }
                    } as any;

                    results.forEach((res, index) => {
                        const providerName = enabledProviders[index]?.name || `Unknown-${index}`;
                        const analysis = res.analysis;

                        console.log(`[PerAI-MonteCarlo] Checking ${providerName}...`);

                        if (!analysis) {
                            console.warn(`[PerAI-MonteCarlo] ${providerName} - Missing analysis object`);
                            return;
                        }

                        // Validate specific fields
                        const hasEntry = analysis.entryPoints && analysis.entryPoints.length > 0;
                        const hasSL = !!analysis.stopLoss;
                        const hasTP = analysis.takeProfit && analysis.takeProfit.length > 0;

                        if (hasEntry && hasSL && hasTP) {
                            try {
                                const mcResult = runMonteCarloForSetup({
                                    direction: analysis.direction,
                                    entryPoints: analysis.entryPoints,
                                    stopLoss: analysis.stopLoss,
                                    takeProfit: analysis.takeProfit
                                }, hybridDataForMC);

                                if (mcResult) {
                                    perAIMC.push({
                                        provider: providerName,
                                        result: mcResult,
                                        isModeratorFinal: false
                                    });
                                    console.log(`[PerAI-MonteCarlo] ${providerName}: Success (WinRate=${mcResult.winRate}%)`);
                                }
                            } catch (err) {
                                console.error(`[PerAI-MonteCarlo] ${providerName} failed execution:`, err);
                            }
                        } else {
                            console.warn(`[PerAI-MonteCarlo] ${providerName} - Skipped (Missing components: Entry=${hasEntry}, SL=${hasSL}, TP=${hasTP})`);
                        }
                    });

                    // Store per-AI Monte Carlo results
                    if (perAIMC.length > 0) {
                        setPerAIMonteCarloResults(perAIMC);
                        console.log(`[PerAI-MonteCarlo] Completed ${perAIMC.length} simulations`);
                    }
                    // ========== END PER-AI MONTE CARLO ==========

                    const debateMessageId = `debate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    const debatePlaceholder: Message = {
                        id: debateMessageId, role: MessageRole.AI, text: '', createdAt: new Date().toISOString(), isDebating: true, debateTurns: [], ocrModelUsed: userMessage.ocrModelUsed,
                        imageSummaries: userMessage.imageSummaries,
                        geminiModelUsed: isGeminiEnabled ? selectedGeminiModel : undefined,
                        deepseekModelUsed: isDeepSeekEnabled ? selectedDeepSeekModel : undefined,
                        zhipuModelUsed: isZhipuEnabled ? selectedZhipuModel : undefined,
                        groqModelUsed: isGroqEnabled ? selectedGroqModel : undefined,
                        groqNewModelUsed: isGroqNewEnabled ? selectedGroqNewModel : undefined,
                        groqAlt2ModelUsed: isGroqAlt2Enabled ? selectedGroqAlt2Model : undefined,
                        openrouterModelUsed: isOpenrouterEnabled ? selectedOpenrouterModel : undefined,

                        // Add individual thought processes so all analysts appear in UI
                        geminiThoughtProcess: thoughtMap['gemini'] || undefined,
                        deepseekThoughtProcess: thoughtMap['deepseek'] || undefined,
                        zhipuThoughtProcess: thoughtMap['zhipu'] || undefined,
                        groqThoughtProcess: thoughtMap['groq'] || undefined,
                        groqNewThoughtProcess: thoughtMap['groqNew'] || undefined,
                        groqAlt2ThoughtProcess: thoughtMap['groqAlt2'] || undefined,
                        openrouterThoughtProcess: thoughtMap['openrouter'] || undefined,

                        isAccuracyMode: isAccuracyModeEnabled,
                        isLensMode: lensConfig?.enabled ?? false,
                        accuracySubMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
                        tradingStyle: (lensConfig?.enabled && lensConfig.tradingStyle !== 'auto') ? (lensConfig.tradingStyle as any) : (lensConfig?.enabled ? 'swing' : undefined)
                    };

                    // Prevent Duplicate Keys: Check if message ID already exists
                    updateMessages(prev => {
                        if (prev.some(m => m.id === debateMessageId)) return prev;
                        return [...prev, debatePlaceholder];
                    });

                    // --- ENSEMBLE ROUTING ---
                    let debateStream;

                    const activeModProvider = moderatorProvider;
                    const activeModModel = moderatorModel;

                    if (isAccuracyModeEnabled) {
                        // ACCURACY MODE
                        debateStream = ensembleAccuracyService.conductDebate(
                            results,
                            enabledProviders.map(p => p.name),
                            enhancedPrompt,
                            finalTradeSummary,
                            accuracySubMode,
                            instructionsToUse,
                            activeModProvider,
                            activeModModel,
                            isFamiliesEnabledInPureAI,
                            isMemoryEnabledInPureAI,
                            currentGateResult, // Gate result for reconciliation
                            tradeSummaries, // Recent Insights
                            moderatorLearningContext // Unified learning context for moderator
                        );
                    } else {
                        // STANDARD MODE
                        if (enabledProviders.length === 2) {
                            debateStream = ensembleService.conductTwoWayDebate(
                                results[0], results[1],
                                enabledProviders[0].name, enabledProviders[1].name,
                                enhancedPrompt, finalTradeSummary,
                                activeModProvider, activeModModel, instructionsToUse, perAIMC,
                                lensConfig.enabled ? lensConfig : undefined, // lensConfig
                                lensConfig.enabled ? enabledProviders.map(p => p.aiProvider).filter(Boolean) as AIProvider[] : undefined, // analystProviders
                                activeFrameworks, // playbook
                                tradeSummaries, // recent insights for pattern matching
                                currentGateResult, // Gate result
                                moderatorLearningContext // NEW: Unified learning context for moderator
                            );
                        } else if (enabledProviders.length === 3) {
                            debateStream = ensembleService.conductThreeWayDebate(
                                results[0], results[1], results[2],
                                enabledProviders[0].name, enabledProviders[1].name, enabledProviders[2].name,
                                enhancedPrompt, finalTradeSummary,
                                activeModProvider, activeModModel, instructionsToUse,
                                undefined, // trades
                                undefined, // enabledProviders (for weighted voting)
                                perAIMC,   // monteCarloResults
                                lensConfig.enabled ? lensConfig : undefined, // lensConfig
                                lensConfig.enabled ? enabledProviders.map(p => p.aiProvider).filter(Boolean) as AIProvider[] : undefined, // analystProviders
                                activeFrameworks, // playbook
                                tradeSummaries, // recent insights for pattern matching
                                currentGateResult, // Gate result
                                moderatorLearningContext // NEW: Unified learning context for moderator
                            );
                        } else {
                            throw new Error("Unsupported number of debate participants for Standard Mode.");
                        }
                    }

                    let fullResponseText = '';
                    // Updated regex to include Puter model names (Claude, GPT, Grok, etc.) and OpenRouter
                    const turnRegex = /(?:^|\n)\s*(?:[\*_~]*)(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Moderator|Master Strategist|Claude[^:]*|GPT[^:]*|Grok[^:]*|Mistral[^:]*|Kimi[^:]*|Qwen[^:]*|LLaMA[^:]*|Puter[^:]*)[^\n]*?(?:[\*_~]*)\s*:\s*([\s\S]*?)(?=(?:^|\n)\s*(?:[\*_~]*)(?:Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Moderator|Master Strategist|Claude|GPT|Grok|Mistral|Kimi|Qwen|LLaMA|Puter)[^\n]*?(?:[\*_~]*)\s*:|$)/gi;

                    for await (const chunk of debateStream) {
                        if (abortRef.current) break;
                        fullResponseText += chunk;

                        const startTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?DEBATE_START(?:>|>\*\*|`|\*\* >|>\*_)*/i;
                        const endTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?\/?(?:DEBATE_END|\/DEBATE_START)(?:>|>\*\*|`|\*\* >|>\*_)*/i;

                        const startMatch = fullResponseText.match(startTagRegex);
                        let debateContent = '';
                        let synthesisContent = '';

                        if (startMatch) {
                            const startIndex = startMatch.index! + startMatch[0].length;
                            const endMatch = fullResponseText.slice(startIndex).match(endTagRegex);
                            if (endMatch) {
                                debateContent = fullResponseText.slice(startIndex, startIndex + endMatch.index!);
                                const endTagLength = endMatch[0].length;
                                const contentAfterDebate = fullResponseText.slice(startIndex + endMatch.index! + endTagLength);
                                const jsonStart = contentAfterDebate.match(/<JSON_PLAN>|```json/i);
                                if (jsonStart) {
                                    synthesisContent = contentAfterDebate.substring(0, jsonStart.index).trim();
                                } else {
                                    synthesisContent = contentAfterDebate.trim();
                                }
                            } else {
                                debateContent = fullResponseText.slice(startIndex);
                            }
                        } else {
                            if (/(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Moderator|Master Strategist).*:/.test(fullResponseText)) {
                                const jsonStart = fullResponseText.match(/<JSON_PLAN>|```json/i);
                                if (jsonStart) {
                                    debateContent = fullResponseText.substring(0, jsonStart.index);
                                } else {
                                    debateContent = fullResponseText;
                                }
                            }
                        }

                        const currentTurns: DebateTurn[] = [];
                        const matches = [...debateContent.matchAll(turnRegex)];
                        for (const m of matches) {
                            let speaker = m[1].trim();
                            if (speaker === "Master Strategist") speaker = "Moderator";
                            speaker = speaker.charAt(0).toUpperCase() + speaker.slice(1);
                            currentTurns.push({ speaker: speaker as DebateTurn['speaker'], text: sanitizeAIResponse(m[2].trim()) });
                        }

                        if (synthesisContent) {
                            const cleanSynthesis = synthesisContent.replace(/^(?:[\*_~]*)(Moderator|Master Strategist)[^:\n]*?:\s*/i, '');
                            const lastTurn = currentTurns[currentTurns.length - 1];
                            if (cleanSynthesis && (!lastTurn || lastTurn.text !== cleanSynthesis)) {
                                currentTurns.push({ speaker: 'Moderator', text: sanitizeAIResponse(cleanSynthesis) });
                            }
                        }

                        updateMessages(prev => {
                            const messageIndex = prev.findIndex(m => m.id === debateMessageId);
                            if (messageIndex === -1) return prev;
                            const updatedMessage = {
                                ...prev[messageIndex],
                                debateTurns: currentTurns,
                                geminiThoughtProcess: thoughtMap['gemini'],
                                deepseekThoughtProcess: thoughtMap['deepseek'],
                                zhipuThoughtProcess: thoughtMap['zhipu'],
                                groqThoughtProcess: thoughtMap['groq'],
                                groqNewThoughtProcess: thoughtMap['groqNew']
                            };
                            const newMessages = [...prev];
                            newMessages[messageIndex] = updatedMessage;
                            return newMessages;
                        });
                    }
                    if (abortRef.current) return;

                    let finalAnalysis: TradeAnalysis;
                    try {
                        // Check if the response contains a moderator error
                        const moderatorErrorMatch = fullResponseText.match(/<MODERATOR_ERROR>([\s\S]*?)<\/MODERATOR_ERROR>/);
                        if (moderatorErrorMatch) {
                            throw new Error(`Moderator Error: ${moderatorErrorMatch[1]}`);
                        }
                        finalAnalysis = extractLastJson(fullResponseText);
                    } catch (e) {
                        console.error("Failed to parse final debate JSON:", e);
                        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                        const isModeratorError = errorMessage.includes('Moderator Error');
                        finalAnalysis = sanitizeTradeAnalysis({
                            strategy: isModeratorError
                                ? `Connection Error: ${errorMessage}. Please try again.`
                                : 'Parsing Error: The moderator failed to generate a valid JSON plan. Please review the debate transcript above for the consensus.',
                            direction: 'Neutral',
                            confidence: 'Low'
                        });
                    }

                    finalAnalysis = sanitizeTradeAnalysis(finalAnalysis);

                    updateMessages(prev => {
                        const messageIndex = prev.findIndex(m => m.id === debateMessageId);
                        if (messageIndex === -1) return prev;

                        const existingMessage = prev[messageIndex];
                        const updatedMessage = {
                            ...existingMessage,
                            isDebating: false,
                            text: `The ensemble has concluded its debate.`,
                            analysis: processNewAnalysis(finalAnalysis),
                            outcome: TradeOutcome.PENDING,
                            debateTurns: existingMessage.debateTurns,
                            geminiThoughtProcess: thoughtMap['gemini'],
                            deepseekThoughtProcess: thoughtMap['deepseek'],
                            zhipuThoughtProcess: thoughtMap['zhipu'],
                            groqThoughtProcess: thoughtMap['groq'],
                            groqNewThoughtProcess: thoughtMap['groqNew'],
                            // Multi-Timeframe Confluence from Hybrid Intelligence
                            confluenceData: currentHybridData?.confluence ? {
                                score: currentHybridData.confluence.score,
                                direction: currentHybridData.confluence.direction,
                                strength: currentHybridData.confluence.strength,
                                alignedSignals: currentHybridData.confluence.alignment,
                                conflictingSignals: currentHybridData.confluence.conflicts,
                                timeframeCount: 4 // 5m, 15m, 1h, 4h
                            } : undefined,
                            isLensMode: lensConfig?.enabled ?? false,
                            // Always set tradingStyle regardless of Lens mode
                            tradingStyle: lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                        };

                        // Inject market snapshot if available (for Algo Mode & Regeneration)
                        if (currentHybridData && updatedMessage.analysis) {
                            updatedMessage.analysis.marketSnapshot = currentHybridData;
                        }

                        const newMessages = [...prev];
                        newMessages[messageIndex] = updatedMessage;
                        return newMessages;
                    });

                } else if (enabledProviders.length === 1) {
                    const provider = enabledProviders[0];
                    setLoadingMessage(isAccuracyModeEnabled ? `Running High-Precision Analysis...` : `Analyzing with ${provider.name}...`);
                    const result = await provider.service.analyzeTradingView(
                        enhancedPrompt, // Fixed: was promptToSend, now uses enhancedPrompt with Hybrid data
                        provider.useImages ? imageFiles : [],
                        summaries,
                        currentMessages,
                        finalTradeSummary,
                        provider.model,
                        isAccuracyModeEnabled ? activeFrameworks : activeFrameworks,
                        isDeepAnalysis,
                        memoryToInject,
                        currentThreadSummary,
                        isAccuracyModeEnabled ? accuracySubMode : undefined,
                        instructionsToUse,
                        isPlaybookEnabledInPureAI,
                        isFamiliesEnabledInPureAI,
                        isMemoryEnabledInPureAI,
                        // Analyst Lens: pass role-specific prompt based on trading style
                        lensConfig.enabled && provider.aiProvider
                            ? getLensPromptForStyle(
                                provider.aiProvider,
                                lensConfig.assignments,
                                lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                            )
                            : undefined
                    );
                    if (abortRef.current) return;
                    const soloAiMessage: Message = {
                        id: `ai-${Date.now()}`, role: MessageRole.AI, text: result.thoughtProcess, createdAt: new Date().toISOString(), analysis: processNewAnalysis(result.analysis), sources: result.sources || [], outcome: TradeOutcome.PENDING, ocrModelUsed: userMessage.ocrModelUsed,
                        imageSummaries: userMessage.imageSummaries,
                        [provider.thoughtsKey + 'ModelUsed']: provider.model,
                        [provider.thoughtsKey + 'ThoughtProcess']: result.thoughtProcess,
                        isAccuracyMode: isAccuracyModeEnabled,
                        isLensMode: lensConfig?.enabled ?? false,
                        // Always set tradingStyle regardless of Lens mode
                        tradingStyle: lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle,
                        accuracySubMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
                        // Multi-Timeframe Confluence from Hybrid Intelligence
                        confluenceData: currentHybridData?.confluence ? {
                            score: currentHybridData.confluence.score,
                            direction: currentHybridData.confluence.direction,
                            strength: currentHybridData.confluence.strength,
                            alignedSignals: currentHybridData.confluence.alignment,
                            conflictingSignals: currentHybridData.confluence.conflicts,
                            timeframeCount: 4 // 5m, 15m, 1h, 4h
                        } : undefined,
                    };
                    // Inject snapshot if available
                    if (currentHybridData) {
                        soloAiMessage.analysis!.marketSnapshot = currentHybridData;
                    }
                    updateMessages(prev => [...prev, soloAiMessage]);
                }
            } else {
                if (enabledProviders.length > 1) {
                    updateMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: "Quick responses are not supported in ensemble mode. Please select a single AI provider." }]);
                    return;
                }
                const provider = enabledProviders[0];
                setLoadingMessage("Thinking...");
                const responseText = await provider.service.getQuickResponse(promptToSend, [...currentMessages, userMessage], provider.model);
                if (abortRef.current) return;
                updateMessages(prev => [...prev, { id: `ai-${Date.now()}`, role: MessageRole.AI, text: responseText, createdAt: new Date().toISOString(), [provider.thoughtsKey + 'ModelUsed']: provider.model }]);
            }
        } catch (error: any) {
            if (abortRef.current) return;
            updateMessages(prev => prev.filter(m => !m.isDebating));

            if (isQuotaError(error)) {
                let flaggedModel = '';
                enabledProviders.forEach(p => {
                    if (error.message.toLowerCase().includes(p.name.toLowerCase()) || p.model === selectedOcrModel) {
                        setQuotaExceededModels(prev => new Set(prev).add(modelIdToName[p.model] || p.model));
                        flaggedModel = modelIdToName[p.model];
                    }
                });
                updateMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: `Model "${flaggedModel || 'an enabled AI'}" has exceeded its usage quota.` }]);
                return;
            }

            if (error.status === 429 || (error.message && error.message.includes('Too Many Requests'))) return setIsRateLimited(true);
            updateMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: error instanceof Error ? error.message : "An unknown error occurred." }]);
        } finally {
            if (analysisAbortController.current === currentAbortController) {
                setLoadingMessage(null);
                analysisAbortController.current = null;
                setIsAnalysisInProgress(false);
            }
        }
    }, [input, images, loadingMessage, finalTradeSummary, activeFrameworks, isRateLimited, selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel, selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model, selectedOpenrouterModel, selectedOpenaiModel, selectedGrokNativeModel, isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled, isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled, isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled, isDeepAnalysis, selectedOcrModel, updateMessages, moderatorProvider, moderatorModel, activeConversationId, activeConversation, isAnalysisInProgress, globalMemory, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, lensConfig, isHybridIntelligenceEnabled, loggedTrades, confidenceCalibration, insightKnowledgeBase, currentHybridData]);

    // ... (handleAssistantChat remains unchanged) ...

    // REFACTORED Post-Mortem Analysis Logic to include DEBATE and SEPARATE BUBBLE
    const startPostMortemAnalysis = async (candidate: PostMortemCandidate, summaries?: string[], imageUrls?: string[], resolvedValidation?: TradeOutcomeValidation) => {
        setPostMortemCandidate(null);
        setIsPostMortemInProgress(true);
        setLoadingMessage("Thinking...");
        setIsLivePostMortemVisible(true);
        setLivePostMortemThoughts({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
        setIsPostMortemTypingComplete(false);

        const postMortemMessageId = `pm-${Date.now()}`;
        const placeholderMsg: Message = {
            id: postMortemMessageId,
            role: MessageRole.AI,
            text: '',
            createdAt: new Date().toISOString(),
            isDebating: false, // Updated if debate
            isPostMortem: true, // NEW: Identify this as a Post-Mortem Bubble
        };

        setExpandedPostMortems(prev => ({ ...prev, [postMortemMessageId]: true })); // Auto-expand by default
        updateMessages(prev => [...prev, placeholderMsg]);

        try {
            // Pass empty history to reduce context size and prevent 400 error
            const history: Message[] = [];

            let enabledProviders: any[] = [];

            if (isAccuracyModeEnabled) {
                if (isGeminiEnabled) enabledProviders.push({ name: 'Gemini', service: geminiAccuracyService, model: selectedGeminiModel, thoughtsKey: 'gemini' as const });
                if (isDeepSeekEnabled) enabledProviders.push({ name: 'DeepSeek', service: deepseekAccuracyService, model: selectedDeepSeekModel, thoughtsKey: 'deepseek' as const });
                if (isGroqEnabled) enabledProviders.push({ name: 'Groq', service: groqAccuracyService, model: selectedGroqModel, thoughtsKey: 'groq' as const });
                if (isZhipuEnabled) enabledProviders.push({ name: 'Zhipu', service: zhipuAccuracyService, model: selectedZhipuModel, thoughtsKey: 'zhipu' as const });
                if (isGroqNewEnabled) enabledProviders.push({ name: 'Groq (Alt)', service: groqNewAccuracyService, model: selectedGroqNewModel, thoughtsKey: 'groqNew' as const });
                if (isGroqAlt2Enabled) enabledProviders.push({ name: 'Groq (Alt 2)', service: groqAlt2AccuracyService, model: selectedGroqAlt2Model, thoughtsKey: 'groqAlt2' as const });
                if (isOpenrouterEnabled) enabledProviders.push({ name: 'OpenRouter', service: openrouterAccuracyService, model: selectedOpenrouterModel, thoughtsKey: 'openrouter' as const });
                if (isOpenaiEnabled) enabledProviders.push({ name: 'OpenAI', service: openaiAccuracyService, model: selectedOpenaiModel, thoughtsKey: 'openai' as const });

            } else {
                if (isGeminiEnabled) enabledProviders.push({ name: 'Gemini', service: geminiService, model: selectedGeminiModel, thoughtsKey: 'gemini' as const });
                if (isDeepSeekEnabled) enabledProviders.push({ name: 'DeepSeek', service: deepseekService, model: selectedDeepSeekModel, thoughtsKey: 'deepseek' as const });
                if (isZhipuEnabled) enabledProviders.push({ name: 'Zhipu', service: zhipuService, model: selectedZhipuModel, thoughtsKey: 'zhipu' as const });
                if (isGroqEnabled) enabledProviders.push({ name: 'Groq', service: groqService, model: selectedGroqModel, thoughtsKey: 'groq' as const });
                if (isGroqNewEnabled) enabledProviders.push({ name: 'Groq (Alt)', service: groqNewService, model: selectedGroqNewModel, thoughtsKey: 'groqNew' as const });
                if (isGroqAlt2Enabled) enabledProviders.push({ name: 'Groq (Alt 2)', service: groqAlt2Service, model: selectedGroqAlt2Model, thoughtsKey: 'groqAlt2' as const });
                if (isOpenrouterEnabled) enabledProviders.push({ name: 'OpenRouter', service: openrouterService, model: selectedOpenrouterModel, thoughtsKey: 'openrouter' as const });
                if (isOpenaiEnabled) enabledProviders.push({ name: 'OpenAI', service: openaiService, model: selectedOpenaiModel, thoughtsKey: 'openai' as const });

            }

            let finalPostMortemReport = "";

            // --- PRICE-BASED OUTCOME VALIDATION (Before AI Analysis) ---
            // Validates trade outcome using historical OHLC data (same as backtesting)
            // Uses ORIGINAL SL (not 150% extended zone)
            let priceValidation: TradeOutcomeValidation | null = null;
            let priceValidationInjection = "";

            if (candidate.message.analysis) {
                // Extract symbol from analysis
                const symbol = candidate.message.analysis.coinName ||
                    candidate.message.text?.match(/\b([A-Z]{2,10}USDT?)\b/)?.[1] ||
                    candidate.message.text?.match(/\b([A-Z]{2,10})\/USDT\b/)?.[1];

                if (symbol) {
                    try {
                        console.log(`[PostMortem] Running price validation for ${symbol}...`);
                        setLoadingMessage("Validating trade outcome against price data...");

                        if (resolvedValidation) {
                            // Use the user-resolved validation
                            priceValidation = resolvedValidation;
                        } else {
                            priceValidation = await validateTradeOutcome(
                                candidate.message.analysis,
                                symbol.toUpperCase().replace('/', ''),
                                candidate.message.createdAt,
                                candidate.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
                            );
                        }

                        // Check Mismatch (User says LOSS but TP hit FIRST -> isMismatch=true)
                        if (priceValidation.isMismatch) {
                            console.log('[PostMortem] Outcome Mismatch Detected. Pausing for user resolution.');
                            setMismatchData({ candidate, validation: priceValidation });
                            setShowMismatchModal(true);
                            setLoadingMessage(null);
                            setIsPostMortemInProgress(false); // Pause progress
                            return; // STOP EXECUTION to wait for user input
                        }

                        console.log(`[PostMortem] Price validation result:`, priceValidation.outcome, priceValidation.hitTarget);

                        // Generate injection for AI context
                        priceValidationInjection = `
═══════════════════════════════════════════════════════════════
📊 PRICE-VALIDATED TRADE OUTCOME (HISTORICAL DATA)
═══════════════════════════════════════════════════════════════
${priceValidation.validationSummary}

⚠️ **IMPORTANT:** This outcome is calculated from ACTUAL PRICE DATA, not interpretation.
Use this as the ground truth for your analysis.

Data Range: ${priceValidation.dataRange}
Candles Evaluated: ${priceValidation.candlesEvaluated}
═══════════════════════════════════════════════════════════════
`;

                        // Check for mismatch between user-reported outcome and price-validated outcome
                        if (priceValidation.outcome !== 'OPEN' && priceValidation.outcome !== 'ENTRY_NOT_HIT') {
                            const userOutcome = candidate.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS';
                            if (priceValidation.outcome !== userOutcome) {
                                priceValidationInjection += `
⚠️ **MISMATCH DETECTED:**
- User reported: ${userOutcome}
- Price data shows: ${priceValidation.outcome}
Please investigate this discrepancy in your analysis.
`;
                                console.warn(`[PostMortem] Outcome mismatch! User: ${userOutcome}, Price: ${priceValidation.outcome}`);
                            }
                        }

                        setLoadingMessage("Conducting Post-Mortem Ensemble Analysis...");
                    } catch (err) {
                        console.warn('[PostMortem] Price validation failed:', err);
                        // Continue without price validation if it fails
                    }
                }
            }

            // --- ROLE-BASED POST-MORTEM BRANCH ---
            if (true) {
                // --- STANDARD POST-MORTEM FLOW ---

                // Force Gemini if no providers selected (Standard Mode fallback)
                if (enabledProviders.length === 0 && !isAccuracyModeEnabled) {
                    enabledProviders.push({ name: 'Gemini', service: geminiService, model: selectedGeminiModel, thoughtsKey: 'gemini' as const });
                }

                // Inject price validation data into summaries
                const enhancedSummaries = priceValidationInjection
                    ? [...(summaries || []), priceValidationInjection]
                    : summaries;

                const analysisPromises = enabledProviders.map(p =>
                    p.service.conductPostMortem(
                        candidate.message, candidate.outcome, history, finalTradeSummary, p.model, candidate.feedback, enhancedSummaries
                    ).then((res: string) => {
                        if (false) {

                            setLivePostMortemThoughts(prev => ({ ...prev, [p.thoughtsKey]: res }));
                        }
                        return { provider: p.name, result: res };
                    })
                );

                const results = await Promise.all(analysisPromises);

                // Step 2: Determine if Debate is needed
                if (results.length > 1) {
                    // Conduct Ensemble Debate
                    setLoadingMessage("Ensemble Debate in progress...");
                    updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? { ...m, isDebating: true, text: 'Ensemble is analyzing trade outcome...' } : m));

                    let debateStream;

                    if (results.length === 2) {
                        debateStream = ensembleService.conductTwoWayPostMortemDebate(candidate.message, candidate.outcome, results[0].result, results[1].result, results[0].provider, results[1].provider, finalTradeSummary, moderatorProvider, moderatorModel, imageUrls);
                    } else {
                        // Default to first 3 if more than 3
                        const r1 = results[0];
                        const r2 = results[1];
                        const r3 = results[2] || results[0];
                        debateStream = ensembleService.conductThreeWayPostMortemDebate(candidate.message, candidate.outcome, r1.result, r2.result, r3.result, r1.provider, r2.provider, r3.provider, finalTradeSummary, moderatorProvider, moderatorModel, imageUrls);
                    }

                    let fullDebateText = "";
                    const turnRegex = /(?:^|\n)\s*(?:[\*_~]*)(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Claude[^\n:]*|GPT[^\n:]*|Grok[^\n:]*|O1|O3|O4|Puter|Moderator)[^\n:]*?(?:[\*_~]*)\s*:\s*([\s\S]*?)(?=(?:^|\n)\s*(?:[\*_~]*)(?:Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Claude[^\n:]*|GPT[^\n:]*|Grok[^\n:]*|O1|O3|O4|Puter|Moderator)[^\n:]*?(?:[\*_~]*)\s*:|$)/gi;

                    for await (const chunk of debateStream) {
                        fullDebateText += chunk;

                        // Extract Debate Turns for Real-time UI
                        const startMatch = fullDebateText.match(/<DEBATE_START>/i);
                        const endMatch = fullDebateText.match(/<\/DEBATE_END>/i);

                        if (startMatch) {
                            const startIndex = startMatch.index! + startMatch[0].length;
                            const endIndex = endMatch ? endMatch.index! : fullDebateText.length;
                            const debateContent = fullDebateText.slice(startIndex, endIndex);

                            const currentTurns: DebateTurn[] = [];
                            const matches = [...debateContent.matchAll(turnRegex)];
                            for (const m of matches) {
                                currentTurns.push({ speaker: m[1] as any, text: sanitizeAIResponse(m[2].trim()) });
                            }

                            updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? { ...m, debateTurns: currentTurns } : m));
                        }

                        // Extract Final Report if streaming
                        const reportStart = fullDebateText.match(/<FINAL_REPORT_START>/i);
                        const reportEnd = fullDebateText.match(/<\/FINAL_REPORT_END>/i);
                        if (reportStart) {
                            const rStart = reportStart.index! + reportStart[0].length;
                            const rEnd = reportEnd ? reportEnd.index! : fullDebateText.length;
                            setTypingMessageState({ id: postMortemMessageId, fullText: fullDebateText.slice(rStart, rEnd).trim(), field: 'postMortem' });
                        }
                    }

                    // Finalize Report Extraction
                    const reportStart = fullDebateText.match(/<FINAL_REPORT_START>/i);
                    const debateEnd = fullDebateText.match(/<\/DEBATE_END>/i);

                    if (reportStart) {
                        const reportEnd = fullDebateText.match(/<\/FINAL_REPORT_END>/i);
                        finalPostMortemReport = fullDebateText.slice(reportStart.index! + reportStart[0].length, reportEnd ? reportEnd.index : undefined).trim();
                    } else if (debateEnd) {
                        let contentAfterDebate = fullDebateText.slice(debateEnd.index! + debateEnd[0].length).trim();
                        if (!contentAfterDebate) {
                            const lastPart = fullDebateText.slice(-2000);
                            const headingMatch = lastPart.match(/(?:^|\n)\s*(?:[\*_#]*)\s*FINAL REPORT\s*(?:[\*_#]*)/i);
                            if (headingMatch) {
                                finalPostMortemReport = lastPart.slice(headingMatch.index! + headingMatch[0].length).trim();
                            }
                        } else {
                            finalPostMortemReport = contentAfterDebate;
                        }
                        if (finalPostMortemReport) {
                            finalPostMortemReport = finalPostMortemReport.replace(/^(?:[-=_*]*\s*)?(?:2\.\s*)?FINAL REPORT(?:[-=_*]*\s*)?/i, '').trim();
                        }
                    } else {
                        const headingMatch = fullDebateText.match(/(?:^|\n)\s*(?:[\*_#]*)\s*FINAL REPORT\s*(?:[\*_#]*)/i);
                        if (headingMatch) {
                            finalPostMortemReport = fullDebateText.slice(headingMatch.index! + headingMatch[0].length).trim();
                        }
                    }

                    if (!finalPostMortemReport) {
                        finalPostMortemReport = "Debate concluded, but final report format was missing. Please review the transcript above for details.";
                    }

                } else {
                    // Single Analyst Mode
                    finalPostMortemReport = results[0].result;
                }
            }

            // Step 3: Finalize Message Text (Separate Bubble)
            updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? {
                ...m,
                text: finalPostMortemReport, // Set main text
                isDebating: false, // Turn off debate UI loader
                postMortemDebateTurns: undefined, // Clear PM specific field, standard debateTurns used
            } : m));

            // Step 4: Update Trade Log with the report (Keeping database record)
            setLoggedTrades(prev => prev.map(t => t.analysis.createdAt === candidate.message.analysis?.createdAt ? {
                ...t,
                postMortem: finalPostMortemReport,
                postMortemCreatedAt: new Date().toISOString(),
                postMortemImages: imageUrls
            } : t));

            const tradeToUpdate = loggedTrades.find(t => t.analysis.createdAt === candidate.message.analysis?.createdAt);
            if (tradeToUpdate) {
                const summary = await MemoryService.summarizeTrade({ ...tradeToUpdate, postMortem: finalPostMortemReport }, memoryModel, memoryProvider);
                // Enforce FIFO: if at limit, remove oldest (first) entry before adding new one
                setTradeSummaries(prev => {
                    const newSummary = { id: tradeToUpdate.id, summaryText: summary, timestamp: new Date().toISOString() };
                    const updated = [...prev, newSummary];
                    // Remove oldest entries from the beginning to maintain max limit
                    return updated.slice(-MAX_TRADE_SUMMARIES);
                });

                const newMemory = await MemoryService.updateGlobalMemory([tradeToUpdate], globalMemory, memoryProvider);
                setGlobalMemory(newMemory);

                // AI LEARNING: Extract insights and rules in BACKGROUND
                try {
                    const tradeWithPM = { ...tradeToUpdate, postMortem: finalPostMortemReport };

                    // 1. Queue Insight Extraction
                    jobQueue.addJob(JobType.EXTRACT_INSIGHTS, tradeWithPM);

                    // 2. Queue Rule Extraction (Item 3.1 Feature)
                    jobQueue.addJob(JobType.EXTRACT_RULES, tradeWithPM);

                } catch (insightError) {
                    console.error('[AI Learning] Failed to queue background jobs:', insightError);
                }

                // Update trading weaknesses based on latest trade log
                try {
                    const updatedWeaknesses = getTradingWeaknesses(loggedTrades);
                    console.log('[AI Learning] Updated trading weaknesses analysis');
                    // Note: TradingWeaknesses is now accessible via getTradingWeaknesses function
                    // We could potentially store this but it's computed dynamically from trade log
                } catch (weaknessError) {
                    console.error('[AI Learning] Failed to update weaknesses:', weaknessError);
                }
            }

        } catch (e: any) {
            console.error("Post Mortem Failed", e);
            // Store the failed candidate data so user can retry
            updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? {
                ...m,
                text: `Post-Mortem Failed: ${e.message}`,
                role: MessageRole.SYSTEM,
                postMortemFailedCandidate: {
                    message: candidate.message,
                    outcome: candidate.outcome,
                    feedback: candidate.feedback,
                    summaries,
                    imageUrls
                }
            } : m));
        } finally {
            setIsPostMortemInProgress(false);
            setLoadingMessage(null);
            setTypingMessageState(null);
        }
    };

    const handleLiveMarketAnalyze = (data: string) => {
        setIsLiveMarketVisible(false);
        setInput(data); // PREFILL INPUT, DO NOT SEND IMMEDIATELY
    };

    // Missing Handlers Implementation Start
    const handleAllAnalysisTypingComplete = useCallback(() => {
        setIsAnalysisTypingComplete(true);
    }, []);

    const handleAllPostMortemTypingComplete = useCallback(() => {
        setIsPostMortemTypingComplete(true);
    }, []);

    // Handler to retry a failed post-mortem analysis
    const handleRetryPostMortem = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg?.postMortemFailedCandidate) {
            const { message, outcome, feedback, summaries, imageUrls } = msg.postMortemFailedCandidate;
            // Remove the failed message first
            updateMessages(prev => prev.filter(m => m.id !== messageId));
            // Re-trigger the analysis with the stored candidate
            startPostMortemAnalysis({ message, outcome, feedback }, summaries, imageUrls);
        }
    }, [messages, updateMessages, startPostMortemAnalysis]);

    const handleImportData = async (fileContent: string) => {
        try {
            const data = JSON.parse(fileContent);
            if (isValidUserProfile(data)) {
                await dbService.overwriteUserProfile(data);
                alert("Profile imported successfully. Please select the user to log in.");
                const users = await dbService.getAllUsernames();
                setExistingUsernames(users);
            } else {
                alert("Invalid profile data format.");
            }
        } catch (e) {
            alert("Failed to parse import file.");
        }
    };

    const handleDeleteUser = async (username: string) => {
        if (confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`)) {
            await dbService.deleteUserProfile(username);
            setExistingUsernames(prev => prev.filter(u => u !== username));
            if (activeUsername === username) {
                setActiveUsername(null);
                resetAppState();
                setIsUserModalOpen(true);
            }
        }
    };

    const handleSwitchUser = () => {
        setIsUserModalOpen(true);
        setIsSettingsVisible(false);
    };

    const handleExportData = async () => {
        if (!activeUsername) return;
        const profile = await dbService.getUserProfile(activeUsername);
        if (profile) {
            // Create comprehensive backup including preferences settings
            const fullBackup = {
                ...profile,
                _exportedAt: new Date().toISOString(),
                _appVersion: '3.5',
                _preferencesBackup: await exportPreferencesData(),
            };

            const filename = `august_backup_${activeUsername}_${new Date().toISOString().split('T')[0]}.json`;
            const result = await exportDataAsFile(fullBackup, filename);

            if (!result.success) {
                alert(`Export failed: ${result.error}`);
            }
        }
    };

    const handleConfirmLogTrade = async (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => {
        if (!logTradeState) return;

        const { message, outcome } = logTradeState;
        setLoggingTradeId(message.id);
        setLogTradeState(null);

        const loggedTrade: LoggedTrade = {
            id: message.id,
            analysis: message.analysis!,
            outcome: outcome,
            timestamp: new Date().toISOString(),
            leverage: activeConversation?.leverage || 100,
            investmentAmount: undefined,
            pnlAmount: feedback.pnlAmount,
            correctedStopLoss: feedback.correctedStopLoss,
            correctedTakeProfit: feedback.correctedTakeProfit,
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

        // Update confidence calibration stats (enhanced with granular tracking)
        if (message.analysis?.confidence) {
            const confidence = message.analysis.confidence as ConfidenceLevel;

            // Extract granular context from the analysis for multi-dimensional tracking
            const coin = message.analysis.coinName ||
                (message.text?.match(/\b([A-Z]{2,10}USDT?)\b/)?.[1]) || undefined;
            const pattern = message.analysis.marketConditions?.pattern || undefined;

            // Use granular calibration if we have context, otherwise fall back to simple
            if (coin || pattern) {
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
                    coin: coin?.toUpperCase(),
                    pattern: typeof pattern === 'string' ? pattern : undefined,
                    timeframe: '4h', // Default analysis timeframe
                    // Detect regime from pattern family or description
                    regime: message.analysis?.marketConditions?.pattern?.toLowerCase().includes('trend') ? 'trending' :
                        message.analysis?.marketConditions?.pattern?.toLowerCase().includes('range') ? 'ranging' :
                            undefined
                });
            } else {
                // Fallback to simple calibration
                const currentCal = GlobalLearningService.getCalibration();
                const newCal = updateCalibration(currentCal, confidence, outcome);
                // We need to manually save this case if not using the granular update helper that auto-saves
                // But GlobalLearningService.updateCalibration handles granular entry which updates the whole object
                // So let's construct a minimal granular entry for compatibility or add a dedicated method
                // For now, simpler to just use the granular entry with minimal fields
                await GlobalLearningService.updateCalibration({
                    timestamp: new Date().toISOString(),
                    confidence,
                    outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
                });
            }
            // Sync React state for UI
            setConfidenceCalibration(GlobalLearningService.getCalibration());
        }

        // Instead of directly triggering post-mortem, show the data capture choice modal
        setDataCaptureCandidate({ message, outcome, feedback });
        setLoggingTradeId(null);
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

    // Data Capture Modal handlers
    // Helper function to log trade (called by all capture handlers)
    const logTradeWithFeedback = useCallback(async (message: Message, outcome: TradeOutcome.WIN | TradeOutcome.LOSS, feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => {
        const loggedTrade: LoggedTrade = {
            id: message.id,
            analysis: message.analysis!,
            outcome: outcome,
            timestamp: new Date().toISOString(),
            leverage: activeConversation?.leverage || 100,
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
    }, [activeConversation?.leverage, moderatorProvider, moderatorModel, updateMessages, memoryModel, memoryProvider, useAlgorithmicInsights]);

    const handleDataCaptureUpload = (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => {
        // User chose to upload screenshot manually - log trade first, then proceed to PostTradeUploadModal
        if (dataCaptureCandidate) {
            logTradeWithFeedback(dataCaptureCandidate.message, dataCaptureCandidate.outcome as any, feedback);
            setPostMortemCandidate({ ...dataCaptureCandidate, feedback });
            setDataCaptureCandidate(null);
        }
    };

    // Temporary variable to store feedback during auto-capture
    const [pendingFeedback, setPendingFeedback] = useState<{ pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; } | null>(null);

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
                alert(`Auto-capture failed: ${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
                // Fallback to upload modal
                setPostMortemCandidate(dataCaptureCandidate);
            }
        } catch (error) {
            console.error('[AutoCapture] Error:', error);
            alert('Auto-capture failed. Please try uploading a screenshot instead.');
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

    // --- ENTRY NOT HIT CAPTURE HANDLERS ---
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
            leverage: activeConversation?.leverage || 100,
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
    }, [activeConversation?.leverage, memoryModel, memoryProvider, useAlgorithmicInsights]);

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
                alert(`Auto-capture failed: ${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
                // Fallback to upload modal
                setPostMortemCandidate({
                    message: entryNotHitCandidate.message,
                    outcome: TradeOutcome.ENTRY_NOT_HIT,
                    feedback: { correctedEntry: entryNotHitCandidate.correctedEntry }
                });
            }
        } catch (error) {
            console.error('[EntryNotHitCapture] Error:', error);
            alert('Auto-capture failed. Please try uploading a screenshot instead.');
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

    // --- UPDATE TRADE LOGIC ---
    const handleInitiateUpdateTrade = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            setUpdateCandidate(msg);
        }
    }, [messages]);


    // --- SCENARIO SIMULATOR LOGIC ---
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
                alert(`Auto-capture failed: ${result.error || 'Unknown error'}. Please try uploading a screenshot instead.`);
            }
        } catch (error) {
            console.error('[UpdateAutoCapture] Error:', error);
            alert('Auto-capture failed. Please try uploading a screenshot instead.');
        } finally {
            setIsUpdateAutoCapturing(false);
            setIsHybridLoading(false); // Stop loading animation
        }
    }, [updateCandidate, handleSendMessage]);

    const handleSetSelectedGeminiModel = (id: string) => updateActiveConversation(c => ({ ...c, geminiModel: id }));
    const handleSetSelectedDeepSeekModel = (id: string) => updateActiveConversation(c => ({ ...c, deepseekModel: id }));
    const handleSetSelectedZhipuModel = (id: string) => updateActiveConversation(c => ({ ...c, zhipuModel: id }));
    const handleSetSelectedGroqModel = (id: string) => updateActiveConversation(c => ({ ...c, groqModel: id }));
    const handleSetSelectedGroqNewModel = (id: string) => updateActiveConversation(c => ({ ...c, groqNewModel: id }));
    const handleSetSelectedGroqAlt2Model = (id: string) => updateActiveConversation(c => ({ ...c, groqAlt2Model: id }));
    const handleSetSelectedOpenrouterModel = (id: string) => updateActiveConversation(c => ({ ...c, openrouterModel: id }));

    const handleSetSelectedOcrModel = (id: string) => updateActiveConversation(c => ({ ...c, ocrModel: id }));
    const handleSetSelectedOpenaiModel = (id: string) => updateActiveConversation(c => ({ ...c, openaiModel: id }));
    const handleSetSelectedGrokNativeModel = (id: string) => updateActiveConversation(c => ({ ...c, grokNativeModel: id }));

    const handleToggleProvider = (provider: 'gemini' | 'deepseek' | 'zhipu' | 'groq' | 'groqNew' | 'groqAlt2' | 'openrouter' | 'openai' | 'grokNative') => {
        updateActiveConversation(c => {
            const key = provider === 'gemini' ? 'isGeminiEnabled' :
                provider === 'deepseek' ? 'isDeepSeekEnabled' :
                    provider === 'zhipu' ? 'isZhipuEnabled' :
                        provider === 'groq' ? 'isGroqEnabled' :
                            provider === 'groqNew' ? 'isGroqNewEnabled' :
                                provider === 'groqAlt2' ? 'isGroqAlt2Enabled' :
                                    provider === 'openrouter' ? 'isOpenrouterEnabled' :
                                        provider === 'grokNative' ? 'isGrokNativeEnabled' : 'isOpenaiEnabled';
            return { ...c, [key]: !c[key] };
        });
    };

    const handleSetModeratorProvider = (provider: AIProvider) => updateActiveConversation(c => ({ ...c, moderatorProvider: provider }));
    const handleSetModeratorModel = (id: string) => updateActiveConversation(c => ({ ...c, moderatorModel: id }));

    const handleSetSummarizationProvider = (provider: AIProvider) => setSummarizationProvider(provider);
    const handleSetSummarizationModel = (id: string) => setSummarizationModel(id);
    const handleUpdateSummaryCharLimit = (limit: number) => setSummaryCharLimit(limit);

    const handleClearChat = () => {
        if (confirm('Clear current chat messages?')) {
            updateMessages(() => []);
        }
    };

    const handleDeleteMessages = (ids: string[]) => {
        if (confirm(`Delete ${ids.length} messages?`)) {
            updateMessages(prev => prev.filter(m => !ids.includes(m.id)));
        }
    };

    const handleToggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => { });
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => { });
        }
    };

    const handleDeleteTrades = (ids: string[]) => {
        setLoggedTrades(prev => prev.filter(t => !ids.includes(t.id)));
        setTradeSummaries(prev => prev.filter(s => !ids.includes(s.id)));
    };

    const handleClearAllTrades = () => {
        if (confirm('Delete all trade history?')) {
            setLoggedTrades([]);
            setTradeSummaries([]);
            setFinalTradeSummary(null);
        }
    };

    const handleManualInsightsUpdate = async (ids: string[]) => {
        // Find trades that need summaries generated (not already in tradeSummaries)
        const existingIds = new Set(tradeSummaries.map(s => s.id));
        const newTrades = loggedTrades.filter(t => ids.includes(t.id) && !existingIds.has(t.id));
        const alreadyAddedCount = ids.length - newTrades.length;

        if (newTrades.length === 0) {
            console.log('[ManualInsights] All selected trades are already in Recent Insights');
            return; // No new trades to process
        }

        setIsSummaryInProgress(true);

        try {
            // Generate summaries for each new trade
            const newSummaries: TradeSummary[] = [];

            for (const trade of newTrades) {
                // Use the user's preference for Algo vs AI insight generation
                const summary = await MemoryService.summarizeTrade(trade, memoryModel, memoryProvider, useAlgorithmicInsights);
                newSummaries.push({
                    id: trade.id,
                    summaryText: summary,
                    timestamp: new Date().toISOString()
                });
            }

            // Add new summaries with FIFO enforcement and robust deduplication
            setTradeSummaries(prev => {
                // Re-check for duplicates to prevent race conditions
                const prevIds = new Set(prev.map(s => s.id));
                const uniqueNewSummaries = newSummaries.filter(s => !prevIds.has(s.id));

                if (uniqueNewSummaries.length < newSummaries.length) {
                    console.warn(`[ManualInsights] Filtered ${newSummaries.length - uniqueNewSummaries.length} duplicates during update.`);
                }

                const updated = [...prev, ...uniqueNewSummaries];
                // Remove oldest entries from the beginning to maintain max limit
                return updated.slice(-MAX_TRADE_SUMMARIES);
            });

            // Track newly added insights for animation
            const addedIds = newSummaries.map(s => s.id);
            setNewlyAddedInsightIds(prev => {
                const next = new Set(prev);
                addedIds.forEach(id => next.add(id));
                return next;
            });
            // Clear animation after 3 seconds
            setTimeout(() => {
                setNewlyAddedInsightIds(prev => {
                    const next = new Set(prev);
                    addedIds.forEach(id => next.delete(id));
                    return next;
                });
            }, 3000);

            console.log(`[ManualInsights] Processed ${newSummaries.length} trades for insights.`);
            if (alreadyAddedCount > 0) {
                console.log(`[ManualInsights] ${alreadyAddedCount} trades were already in Recent Insights (pre-check)`);
            }
        } catch (e) {
            console.error('[ManualInsights] Failed to generate summaries:', e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    // Delete individual insight from Recent Insights
    const handleDeleteInsight = (id: string) => {
        setTradeSummaries(prev => prev.filter(s => s.id !== id));
        console.log(`[ManualInsights] Removed insight with id: ${id}`);
    };

    // Rewrite insights with AI - regenerates summaries using AI provider
    // If ids is empty/undefined, rewrites ALL insights
    const handleRewriteInsightsWithAI = async (ids?: string[]) => {
        const targetIds = ids && ids.length > 0 ? ids : tradeSummaries.map(s => s.id);

        if (targetIds.length === 0) {
            console.log('[AIRewrite] No insights to rewrite');
            return;
        }

        setIsSummaryInProgress(true);
        console.log(`[AIRewrite] Rewriting ${targetIds.length} insights with AI...`);

        try {
            const updatedSummaries: TradeSummary[] = [];

            for (const id of targetIds) {
                const trade = loggedTrades.find(t => t.id === id);
                console.log(`[AIRewrite] Looking for trade with id: ${id}, found: ${!!trade}`);
                if (trade) {
                    // Convert AIProvider enum to MemoryProvider string
                    const providerMap: Record<string, MemoryProvider> = {
                        'gemini': 'gemini',
                        'deepseek': 'deepseek',
                        'groq': 'groq',
                        'groq_new': 'groq', // Map groq_new to groq
                        'groq_alt2': 'groq-alt2', // Note: AIProvider uses underscore, MemoryProvider uses hyphen
                        'zhipu': 'zhipu',
                        'openrouter': 'openrouter',
                        'openai': 'openai',
                        'grok': 'grok-native', // AIProvider.GROK maps to MemoryProvider 'grok-native'
                    };
                    const provider = providerMap[summarizationProvider] || 'gemini';
                    console.log(`[AIRewrite] Calling MemoryService.summarizeTrade with provider: ${provider} (from UI: ${summarizationProvider}), model: ${summarizationModel}, useAlgorithmic: false`);
                    // Force AI mode (false = use AI, not algo)
                    const summary = await MemoryService.summarizeTrade(trade, summarizationModel, provider, false);
                    console.log(`[AIRewrite] Got summary for ${id}:`, summary?.substring(0, 100));
                    updatedSummaries.push({
                        id: trade.id,
                        summaryText: summary,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.warn(`[AIRewrite] Trade not found for id: ${id}. Available trade ids:`, loggedTrades.map(t => t.id));
                }
            }

            // Replace existing summaries with AI-generated ones
            setTradeSummaries(prev => {
                const unchangedSummaries = prev.filter(s => !targetIds.includes(s.id));
                return [...unchangedSummaries, ...updatedSummaries].slice(-MAX_TRADE_SUMMARIES);
            });

            // Show animation for rewritten insights
            setNewlyAddedInsightIds(prev => {
                const next = new Set(prev);
                updatedSummaries.forEach(s => next.add(s.id));
                return next;
            });
            setTimeout(() => {
                setNewlyAddedInsightIds(prev => {
                    const next = new Set(prev);
                    updatedSummaries.forEach(s => next.delete(s.id));
                    return next;
                });
            }, 3000);

            console.log(`[AIRewrite] Successfully rewrote ${updatedSummaries.length} insights with AI`);
        } catch (e) {
            console.error('[AIRewrite] Failed to rewrite insights:', e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    const handleUpdateTradeLeverage = (id: string, leverage: number) => {
        setLoggedTrades(prev => prev.map(t => {
            if (t.id === id) {
                const updatedAnalysis = recalculateAnalysisMetrics(t.analysis, leverage);
                return { ...t, leverage, analysis: updatedAnalysis };
            }
            return t;
        }));
    };

    const handleRegenerateFinalSummary = async () => {
        setIsSummaryInProgress(true);
        try {
            let summary = '';

            if (useAlgorithmicSummary) {
                // Use algorithmic generation (Fast, Free, No tokens)
                const { generatePatternMemorySynthesis } = await import('./services/AlgorithmicSummaryService');
                summary = generatePatternMemorySynthesis(loggedTrades);
            } else {
                // Use AI generation (Slower, Tokens)
                switch (summarizationProvider) {
                    case AIProvider.DEEPSEEK:
                        summary = await deepseekService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.ZHIPU:
                        summary = await zhipuService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GROQ:
                        summary = await groqService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GROQ_NEW:
                        summary = await groqNewService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GEMINI:
                    default:
                        summary = await geminiService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                }
            }

            setFinalTradeSummary(summary);
        } catch (e) {
            console.error("Summary regeneration failed", e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    const handleMismatchResolution = async (outcome: 'WIN' | 'LOSS') => {
        if (!mismatchData) return;

        console.log(`[PostMortem] User resolved mismatch to: ${outcome}`);

        let finalValidation = mismatchData.validation;

        if (outcome === 'LOSS') {
            // User confirms LOSS (meaning they confirm they missed the TP)
            // We must FORCE LOSS outcome logic (Override TP)

            // We can manually patch the validation object based on SL data
            finalValidation = {
                ...finalValidation,
                outcome: 'LOSS',
                hitTarget: 'SL',
                // Use SL touch price if available, else Extended SL price if that was the fail
                exitPrice: finalValidation.slTouched ? (finalValidation.slTouchPrice ?? finalValidation.stopLoss) : (finalValidation.entryPrice * 0.9), // fallback if extended not calculated?
                // Actually, if we are here, we know TP hit first. Did SL hit later?
                // If isMismatch=true, it implies TP hit first.
                // We need to find if SL hit later.
                // But we didn't populate SL hit details in 'outcome' fields.

                // However, we DO have `slMatched`, `slTouchTime`, `extendedSlExceeded` in the object.
                exitTime: finalValidation.slTouched ? finalValidation.slTouchTime : (finalValidation.exitTime), // Fallback
                isMismatch: false, // Resolved

                // CRITICAL: Rewrite Summary to force AI compliance
                validationSummary: finalValidation.validationSummary + `\n\n═══════════════════════════════════════════════════════════════\n⚠️ **USER CONFIRMED OUTCOME: LOSS**\n═══════════════════════════════════════════════════════════════\nAlthough price data shows a TP hit first, the USER has explicitly CONFIRMED this trade as a LOSS.\n\n**MANDATORY INSTRUCTION FOR ANALYSTS:**\n1. You MUST accept LOSS as the ground truth.\n2. Do NOT argue that it "should have been a win".\n3. Assume the user missed the TP or manually closed in loss.\n4. Analyze the failure based on the SL hit or manual exit.`
            };
        } else {
            // User Confirms WIN (They accepted the TP hit)
            // Validation object is already WIN. Just clear mismatch flag.
            finalValidation = {
                ...finalValidation,
                outcome: 'WIN', // Ensure it says WIN
                isMismatch: false,

                // Add note to confirm validity
                validationSummary: finalValidation.validationSummary + `\n\n✅ **USER CONFIRMED OUTCOME: WIN**\nUser verified that the TP hit was valid.`
            };
        }

        // Update Candidate Outcome if needed?
        // Context depends on `candidate.outcome`.
        // If user changed to WIN, we should treat candidate as WIN for AI context.
        const updatedCandidate = {
            ...mismatchData.candidate,
            outcome: outcome === 'WIN' ? TradeOutcome.WIN : TradeOutcome.LOSS
        };

        setShowMismatchModal(false);
        setMismatchData(null);

        // Resume Analysis
        await startPostMortemAnalysis(updatedCandidate, undefined, undefined, finalValidation);
    };

    const handleClearAllConversations = () => {
        if (confirm('Clear all conversation history?')) {
            const newConv = createNewConversation();
            setConversationHistory([newConv]);
            setActiveConversationId(newConv.id);
        }
    };

    const handleLoadConversation = (id: string) => {
        if (id !== activeConversationId) {
            setActiveConversationId(id);
            setIsHistoryVisible(false);
        }
    };

    const handleDeleteConversations = (ids: string[]) => {
        setConversationHistory(prev => prev.filter(c => !ids.includes(c.id)));
        if (activeConversationId && ids.includes(activeConversationId)) {
            const remaining = conversationHistory.filter(c => !ids.includes(c.id));
            if (remaining.length > 0) {
                setActiveConversationId(remaining[0].id);
            } else {
                handleStartNewConversation();
            }
        }
    };

    const handleStartNewConversation = () => {
        const newConv = createNewConversation();
        if (activeConversation) {
            newConv.geminiModel = activeConversation.geminiModel;
            newConv.deepseekModel = activeConversation.deepseekModel;
            newConv.zhipuModel = activeConversation.zhipuModel;
            newConv.groqModel = activeConversation.groqModel;
            newConv.groqNewModel = activeConversation.groqNewModel;
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.isGeminiEnabled = activeConversation.isGeminiEnabled;
            newConv.isDeepSeekEnabled = activeConversation.isDeepSeekEnabled;
            newConv.isZhipuEnabled = activeConversation.isZhipuEnabled;
            newConv.isGroqEnabled = activeConversation.isGroqEnabled;
            newConv.isGroqNewEnabled = activeConversation.isGroqNewEnabled;
            newConv.moderatorProvider = activeConversation.moderatorProvider;
            newConv.moderatorModel = activeConversation.moderatorModel;
            newConv.leverage = activeConversation.leverage;
        }
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        setIsHistoryVisible(false);
    };

    const handleApplyStrategy = (strategyName: string) => {
        if (!activeFrameworks.includes(strategyName)) {
            setActiveFrameworks(prev => [...prev, strategyName]);
        }
    };

    const handleRemoveStrategy = (strategyName: string) => {
        setActiveFrameworks(prev => prev.filter(s => s !== strategyName));
    };

    const handleDeleteSavedAnalyses = (ids: string[]) => {
        setSavedAnalyses(prev => prev.filter(a => !ids.includes(a.id)));
    };

    const handleClearAllSavedAnalyses = () => {
        if (confirm('Clear all saved analyses?')) {
            setSavedAnalyses([]);
        }
    };

    const handleCycleAnalysisUp = () => {
        if (analysisMessages.length === 0) return;
        let nextIndex = analysisMessages.length - 1;
        if (highlightedAnalysisId) {
            const currentIndex = analysisMessages.findIndex(m => m.id === highlightedAnalysisId);
            if (currentIndex > 0) {
                nextIndex = currentIndex - 1;
            } else {
                nextIndex = analysisMessages.length - 1;
            }
        }
        const nextId = analysisMessages[nextIndex].id;
        setHighlightedAnalysisId(nextId);
        virtuosoRef.current?.scrollIntoView({ index: messages.findIndex(m => m.id === nextId), behavior: 'smooth', align: 'start' });
    };

    const handleScrollToBottom = () => {
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
        setHighlightedAnalysisId(null);
    };

    const handleCancelAnalysis = () => {
        if (analysisAbortController.current) {
            analysisAbortController.current.abort();
            abortRef.current = true;
            setLoadingMessage(null);
            setIsAnalysisInProgress(false);
            setIsPostMortemInProgress(false);
            setIsLiveAnalysisVisible(false);
            setIsLivePostMortemVisible(false);
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleLeverageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLeverageInput(e.target.value);
    };

    const handleLeverageBlur = () => {
        let val = parseInt(leverageInput, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 125) val = 125;
        setLeverageInput(String(val));

        updateActiveConversation(c => {
            const updatedMessages = c.messages.map(m => {
                if (m.analysis) {
                    return { ...m, analysis: recalculateAnalysisMetrics(m.analysis, val) };
                }
                return m;
            });
            return { ...c, leverage: val, messages: updatedMessages };
        });
    };

    const handlePresetLeverage = (val: number) => {
        setLeverageInput(String(val));

        updateActiveConversation(c => {
            const updatedMessages = c.messages.map(m => {
                if (m.analysis) {
                    return { ...m, analysis: recalculateAnalysisMetrics(m.analysis, val) };
                }
                return m;
            });
            return { ...c, leverage: val, messages: updatedMessages };
        });

        setIsLeverageDropdownOpen(false);
    };

    const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles: File[] = Array.from(event.target.files);
            const remainingSlots = 5 - images.length;
            if (remainingSlots <= 0) return;
            const filesToProcess = newFiles.slice(0, remainingSlots);
            const placeholderMetadata: ImageMetadata[] = filesToProcess.map(file => ({ file, dataURL: '', isLoading: true }));
            setImages(prev => [...prev, ...placeholderMetadata]);
            processImagesForSummarization(filesToProcess, images.length, selectedOcrModel, setImages, handleQuotaExceeded);
            if (event.target) event.target.value = '';
        }
    };

    const handleTypingComplete = useCallback(() => {
        if (typingMessageState) {
            const { id, fullText, field } = typingMessageState;
            updateMessages(prev => prev.map(m => m.id === id ? { ...m, [field]: fullText } : m));
            setTypingMessageState(null);
        }
    }, [typingMessageState]);

    const handleCopy = (message: Message) => {
        if (message.text) {
            navigator.clipboard.writeText(message.text);
            setCopiedMessageId(message.id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        }
    };

    const handleViewStrategyDetails = (name: string) => {
        setStrategyToView(name);
        setIsStrategySearchVisible(true);
    };

    const handleSaveAnalysis = (messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg && msg.analysis) {
            const saved: SavedAnalysis = {
                id: msg.id,
                analysis: msg.analysis,
                userPrompt: messages.find(m => m.id === `user-${msg.id.split('-')[1]}`)?.text || "Unknown Request",
                timestamp: new Date().toISOString(),
                geminiModelUsed: msg.geminiModelUsed,
                deepseekModelUsed: msg.deepseekModelUsed,
                zhipuModelUsed: msg.zhipuModelUsed,
                groqModelUsed: msg.groqModelUsed,
                groqNewModelUsed: msg.groqNewModelUsed,
                groqAlt2ModelUsed: msg.groqAlt2ModelUsed,

                ocrModelUsed: msg.ocrModelUsed,
                moderatorProvider,
                moderatorModel
            };
            setSavedAnalyses(prev => {
                if (prev.some(s => s.id === saved.id)) return prev;
                return [...prev, saved];
            });
        }
    };

    const handleCalculateAIProbabilities = async (messageId: string, mode: 'AI' | 'Algo' = 'AI') => {
        const msg = messages.find(m => m.id === messageId);
        if (!msg || !msg.analysis) return;

        // Algo Mode Logic
        if (mode === 'Algo') {
            if (msg.analysis.marketSnapshot) {
                const algoProbs = ProbabilityEngineService.calculateAlgoProbabilities(
                    msg.analysis.marketSnapshot,
                    loggedTrades,
                    msg.analysis.direction as 'Long' | 'Short' | 'Neutral'
                );
                updateMessages(prev => prev.map(m =>
                    m.id === messageId
                        ? { ...m, analysis: { ...m.analysis!, levelProbabilities: algoProbs } }
                        : m
                ));
            } else {
                console.warn('Cannot run Algo mode: No snapshot available for trade', messageId);
            }
            return;
        }

        // AI Mode Logic
        setIsCalculatingAIProbabilities(true);
        try {
            const stream = ensembleService.recalculateProbabilities(
                msg.analysis,
                moderatorProvider,
                moderatorModel,
                msg.analysis.marketSnapshot // Pass snapshot for historical consistency
            );

            let fullJson = '';
            for await (const chunk of stream) {
                fullJson += chunk;
            }

            const parsed = extractLastJson(fullJson);
            if (parsed) {
                // Determine if 'parsed' is the levelProbabilities object or if it's wrapped
                const probs = parsed.levelProbabilities || (parsed.slProbability ? parsed : null);

                if (probs) {
                    // Tag with mode
                    probs.calculationMode = 'AI';

                    updateMessages(prev => prev.map(m =>
                        m.id === messageId
                            ? { ...m, analysis: { ...m.analysis!, levelProbabilities: probs } }
                            : m
                    ));
                    console.log('Successfully updated AI probabilities for:', messageId);
                } else {
                    console.warn('Parsed JSON did not contain expected probability fields:', parsed);
                }
            } else {
                console.warn('Failed to extract valid JSON from AI response:', fullJson);
            }
        } catch (error) {
            console.error('Failed to calculate AI probabilities:', error);
        } finally {
            setIsCalculatingAIProbabilities(false);
        }
    };

    const chatContext: ChatContextProps = useMemo(() => ({
        typingMessageState,
        setTypingMessageState,
        handleTypingComplete,
        highlightedAnalysisId,
        expandedPostMortems,
        setExpandedPostMortems,
        expandedPostMortemImages,
        setExpandedPostMortemImages,
        expandedIndividualThoughts,
        setExpandedIndividualThoughts,
        expandedDebateTranscripts,
        setExpandedDebateTranscripts,
        collapsedUserMessages,
        setCollapsedUserMessages,
        savedAnalyses,
        loggingTradeId,
        activeFrameworks,
        activeConversation,
        copiedMessageId,
        modelIdToName,
        ocrModelIdToName,
        handleInitiateLogTrade,
        handleInitiateSkipTrade,
        handleViewStrategyDetails,
        handleApplyStrategy,
        handleSaveAnalysis,
        handleCopy,
        handleInitiateUpdateTrade,
        handleInitiateSimulator, // Scenario Simulator
        confidenceCalibration, // Confidence calibration stats
        onRetryPostMortem: handleRetryPostMortem, // Retry failed post-mortem
        lensConfig, // Analyst lens configuration for debate visualization
        leverage: parseInt(leverageInput, 10) || 100 // Leverage for backtest P&L calculations
    }), [typingMessageState, highlightedAnalysisId, expandedPostMortems, expandedPostMortemImages, expandedIndividualThoughts, expandedDebateTranscripts, collapsedUserMessages, savedAnalyses, loggingTradeId, activeFrameworks, activeConversation, copiedMessageId, handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy, handleSaveAnalysis, handleCopy, handleTypingComplete, handleInitiateUpdateTrade, confidenceCalibration, handleRetryPostMortem, lensConfig, leverageInput]);

    // ... (Rest of component remains unchanged) ...
    return (
        // ... (JSX Return)
        <div ref={appRef} className="flex flex-col bg-zinc-950 text-zinc-100 font-sans h-full overflow-hidden transition-colors duration-500">
            {isVersionHistoryVisible && (
                <VersionHistoryDashboard onClose={() => setIsVersionHistoryVisible(false)} />
            )}

            {/* SW Update Notification */}
            {showUpdateNotification && (
                <UpdateNotification
                    onRefresh={() => {
                        activateWaitingWorker();
                    }}
                    onDismiss={() => setShowUpdateNotification(false)}
                />
            )}
            <LiveAnalysisView
                isVisible={isLiveAnalysisVisible}
                onClose={() => setIsLiveAnalysisVisible(false)}
                thoughts={liveThoughts}
                geminiModelName={isAccuracyModeEnabled ? (isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined) : (isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined)}
                deepseekModelName={isAccuracyModeEnabled ? (isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined) : (isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined)}
                zhipuModelName={isAccuracyModeEnabled ? undefined : (isZhipuEnabled ? modelIdToName[selectedZhipuModel] : undefined)}
                groqModelName={isAccuracyModeEnabled ? (isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined) : (isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined)}
                groqNewModelName={isAccuracyModeEnabled ? (isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined) : (isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined)}
                groqAlt2ModelName={isAccuracyModeEnabled ? (isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined) : (isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined)}
                openrouterModelName={isOpenrouterEnabled ? modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel : undefined}

                onAllTypingComplete={handleAllAnalysisTypingComplete}


            />
            <LivePostMortemView
                isVisible={isLivePostMortemVisible}
                onClose={() => setIsLivePostMortemVisible(false)}
                thoughts={livePostMortemThoughts}
                geminiModelName={isAccuracyModeEnabled ? (isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined) : (isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined)}
                deepseekModelName={isAccuracyModeEnabled ? (isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined) : (isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined)}
                zhipuModelName={isAccuracyModeEnabled ? undefined : (isZhipuEnabled ? modelIdToName[selectedZhipuModel] : undefined)}
                groqModelName={isAccuracyModeEnabled ? (isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined) : (isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined)}
                groqNewModelName={isAccuracyModeEnabled ? (isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined) : (isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined)}
                groqAlt2ModelName={isAccuracyModeEnabled ? (isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined) : (isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined)}
                openrouterModelName={isOpenrouterEnabled ? modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel : undefined}

                onAllTypingComplete={handleAllPostMortemTypingComplete}
            />
            <UserProfileManager isVisible={isUserModalOpen} onUserSelect={loadUserData} existingUsers={existingUsernames} onImportProfile={handleImportData} onDeleteUser={handleDeleteUser} />
            <AccuracyModeModal isOpen={showAccuracyModal} onClose={() => setShowAccuracyModal(false)} onConfirm={handleConfirmAccuracyMode} isEnabling={!isAccuracyModeEnabled} />
            <LiveMarket isVisible={isLiveMarketVisible} onClose={() => setIsLiveMarketVisible(false)} onAnalyze={handleLiveMarketAnalyze} />
            {dataCaptureCandidate && (
                <DataCaptureModal
                    message={dataCaptureCandidate.message}
                    outcome={dataCaptureCandidate.outcome}
                    onClose={() => setDataCaptureCandidate(null)}
                    onUploadScreenshot={handleDataCaptureUpload}
                    onAutoCapture={handleDataCaptureAuto}
                    onSkip={handleDataCaptureSkip}
                    isCapturing={isAutoCapturing}
                />
            )}
            {entryNotHitCandidate && (
                <EntryNotHitCaptureModal
                    message={entryNotHitCandidate.message}
                    correctedEntry={entryNotHitCandidate.correctedEntry}
                    onClose={() => setEntryNotHitCandidate(null)}
                    onAutoCapture={handleEntryNotHitAutoCapture}
                    onUploadScreenshot={handleEntryNotHitUpload}
                    onSkip={handleEntryNotHitSkip}
                    isCapturing={isEntryNotHitCapturing}
                />
            )}
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} ocrModel={isAccuracyModeEnabled ? selectedOcrModel : (postMortemCandidate.message.ocrModelUsed?.split(',')[0].trim() || selectedOcrModel)} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateAutoCapturing} ocrModel={isAccuracyModeEnabled ? selectedOcrModel : (updateCandidate.ocrModelUsed?.split(',')[0].trim() || selectedOcrModel)} onQuotaExceeded={handleQuotaExceeded} />}
            {simulatorCandidate && (
                <ScenarioSimulator
                    message={simulatorCandidate}
                    loggedTrades={loggedTrades}
                    leverage={activeConversation?.leverage || 100}
                    onClose={() => setSimulatorCandidate(null)}
                />
            )}
            <SettingsMenu
                isVisible={isSettingsMenuVisible}
                onClose={() => setIsSettingsMenuVisible(false)}
                isLoading={isLoading}
                onOpenSavedAnalyses={() => { setIsSavedAnalysesVisible(true); setIsSettingsMenuVisible(false); }}
                onOpenStrategySearch={() => { setIsStrategySearchVisible(true); setIsSettingsMenuVisible(false); }}
                onSwitchUser={handleSwitchUser}
                onExportData={handleExportData}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                onToggleAccuracyMode={handleToggleAccuracyMode}
                accuracySubMode={accuracySubMode}
                setAccuracySubMode={setAccuracySubMode}
                isHybridIntelligenceEnabled={isHybridIntelligenceEnabled}
                setIsHybridIntelligenceEnabled={setIsHybridIntelligenceEnabled}
                isGlobalMemoryEnabled={isGlobalMemoryEnabled}
                setIsGlobalMemoryEnabled={setIsGlobalMemoryEnabled}
                memoryProvider={memoryProvider}
                setMemoryProvider={setMemoryProvider}
                memoryModel={memoryModel}
                setMemoryModel={setMemoryModel}
                isPlaybookEnabledInPureAI={isPlaybookEnabledInPureAI}
                setIsPlaybookEnabledInPureAI={setIsPlaybookEnabledInPureAI}
                isFamiliesEnabledInPureAI={isFamiliesEnabledInPureAI}
                setIsFamiliesEnabledInPureAI={setIsFamiliesEnabledInPureAI}
                isMemoryEnabledInPureAI={isMemoryEnabledInPureAI}
                setIsMemoryEnabledInPureAI={setIsMemoryEnabledInPureAI}
                customInstructions={customInstructions}
                setCustomInstructions={setCustomInstructions}
                lensConfig={lensConfig}
                onSetLensConfig={handleSetLensConfig}
                geminiModels={GEMINI_MODELS}
                deepseekModels={DEEPSEEK_MODELS}
                zhipuModels={ZHIPU_MODELS}
                groqModels={GROQ_MODELS}
                groqNewModels={GROQ_NEW_MODELS}
                groqAlt2Models={GROQ_ALT2_MODELS}
                openrouterModels={OPENROUTER_MODELS}
                openaiModels={OPENAI_MODELS}
                grokNativeModels={GROK_MODELS}

                selectedGeminiModel={selectedGeminiModel}
                selectedDeepSeekModel={selectedDeepSeekModel}
                selectedZhipuModel={selectedZhipuModel}
                selectedGroqModel={selectedGroqModel}
                selectedGroqNewModel={selectedGroqNewModel}
                selectedGroqAlt2Model={selectedGroqAlt2Model}
                selectedOpenrouterModel={selectedOpenrouterModel}
                selectedOpenaiModel={selectedOpenaiModel}
                selectedGrokNativeModel={selectedGrokNativeModel}

                onSetGeminiModel={handleSetSelectedGeminiModel}
                onSetDeepseekModel={handleSetSelectedDeepSeekModel}
                onSetZhipuModel={handleSetSelectedZhipuModel}
                onSetGroqModel={handleSetSelectedGroqModel}
                onSetGroqNewModel={handleSetSelectedGroqNewModel}
                onSetGroqAlt2Model={handleSetSelectedGroqAlt2Model}
                onSetOpenrouterModel={handleSetSelectedOpenrouterModel}
                onSetOpenaiModel={handleSetSelectedOpenaiModel}
                onSetGrokNativeModel={handleSetSelectedGrokNativeModel}

                isGeminiEnabled={isGeminiEnabled}
                isDeepSeekEnabled={isDeepSeekEnabled}
                isZhipuEnabled={isZhipuEnabled}
                isGroqEnabled={isGroqEnabled}
                isGroqNewEnabled={isGroqNewEnabled}
                isGroqAlt2Enabled={isGroqAlt2Enabled}
                isOpenrouterEnabled={isOpenrouterEnabled}
                isOpenaiEnabled={isOpenaiEnabled}
                isGrokNativeEnabled={isGrokNativeEnabled}

                onToggleProvider={handleToggleProvider}
                ocrModels={OCR_MODELS}
                selectedOcrModel={selectedOcrModel}
                onSetOcrModel={handleSetSelectedOcrModel}
                moderatorProvider={moderatorProvider}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={handleSetModeratorProvider}
                onSetModeratorModel={handleSetModeratorModel}
                onOpenFullSettings={() => { setIsSettingsMenuVisible(false); setIsSettingsVisible(true); }}
            />
            <Settings isVisible={isSettingsVisible} isLoading={isLoading} onClose={() => setIsSettingsVisible(false)} onExportData={handleExportData} onSwitchUser={handleSwitchUser} onOpenSavedAnalyses={() => { setIsSavedAnalysesVisible(true); setIsSettingsVisible(false); }} onOpenStrategySearch={() => { setIsStrategySearchVisible(true); setIsSettingsVisible(false); }} geminiModels={GEMINI_MODELS} deepseekModels={DEEPSEEK_MODELS} zhipuModels={ZHIPU_MODELS} groqModels={GROQ_MODELS} groqNewModels={GROQ_NEW_MODELS} groqAlt2Models={GROQ_ALT2_MODELS} openrouterModels={OPENROUTER_MODELS} openaiModels={OPENAI_MODELS} ocrModels={OCR_MODELS} selectedGeminiModel={selectedGeminiModel} selectedDeepSeekModel={selectedDeepSeekModel} selectedZhipuModel={selectedZhipuModel} selectedGroqModel={selectedGroqModel} selectedGroqNewModel={selectedGroqNewModel} selectedGroqAlt2Model={selectedGroqAlt2Model} selectedOpenrouterModel={selectedOpenrouterModel} selectedOpenaiModel={selectedOpenaiModel} selectedOcrModel={selectedOcrModel} onSetGeminiModel={handleSetSelectedGeminiModel} onSetDeepseekModel={handleSetSelectedDeepSeekModel} onSetZhipuModel={handleSetSelectedZhipuModel} onSetGroqModel={handleSetSelectedGroqModel} onSetGroqNewModel={handleSetSelectedGroqNewModel} onSetGroqAlt2Model={handleSetSelectedGroqAlt2Model} onSetOpenrouterModel={handleSetSelectedOpenrouterModel} onSetOpenaiModel={handleSetSelectedOpenaiModel} onSetOcrModel={handleSetSelectedOcrModel} isGeminiEnabled={isGeminiEnabled} isDeepSeekEnabled={isDeepSeekEnabled} isZhipuEnabled={isZhipuEnabled} isGroqEnabled={isGroqEnabled} isGroqNewEnabled={isGroqNewEnabled} isGroqAlt2Enabled={isGroqAlt2Enabled} isOpenrouterEnabled={isOpenrouterEnabled} isOpenaiEnabled={isOpenaiEnabled} onToggleProvider={handleToggleProvider} quotaExceededModels={quotaExceededModels} ocrModelIdToName={ocrModelIdToName} moderatorProvider={moderatorProvider} moderatorModel={moderatorModel} onSetModeratorProvider={handleSetModeratorProvider} onSetModeratorModel={handleSetModeratorModel} isGlobalMemoryEnabled={isGlobalMemoryEnabled} setIsGlobalMemoryEnabled={setIsGlobalMemoryEnabled} isAccuracyModeEnabled={isAccuracyModeEnabled} onToggleAccuracyMode={handleToggleAccuracyMode} accuracySubMode={accuracySubMode} setAccuracySubMode={setAccuracySubMode} customInstructions={customInstructions} setCustomInstructions={setCustomInstructions} isPlaybookEnabledInPureAI={isPlaybookEnabledInPureAI} setIsPlaybookEnabledInPureAI={setIsPlaybookEnabledInPureAI} isFamiliesEnabledInPureAI={isFamiliesEnabledInPureAI} setIsFamiliesEnabledInPureAI={setIsFamiliesEnabledInPureAI} isMemoryEnabledInPureAI={isMemoryEnabledInPureAI} setIsMemoryEnabledInPureAI={setIsMemoryEnabledInPureAI} isHybridIntelligenceEnabled={isHybridIntelligenceEnabled} setIsHybridIntelligenceEnabled={setIsHybridIntelligenceEnabled} memoryProvider={memoryProvider} setMemoryProvider={setMemoryProvider} memoryModel={memoryModel} setMemoryModel={setMemoryModel} lensConfig={lensConfig} onSetLensConfig={handleSetLensConfig} grokModels={GROK_MODELS} selectedGrokNativeModel={selectedGrokNativeModel} onSetGrokNativeModel={handleSetSelectedGrokNativeModel} isGrokNativeEnabled={isGrokNativeEnabled} />
            <VisionDataViewer isVisible={isVisionDataVisible} onClose={() => setIsVisionDataVisible(false)} visionData={currentVisionData} />


            <Header
                activeUsername={activeUsername}
                saveStatus={saveStatus}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                currentVisionData={currentVisionData}
                isFullscreen={isFullscreen}
                onOpenVersionHistory={() => setIsVersionHistoryVisible(true)}
                isMobileMenuOpen={isMobileMenuOpen}
                mobileMenuRef={mobileMenuRef}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                setIsVisionDataVisible={setIsVisionDataVisible}
                handleClearChat={handleClearChat}
                setJournalState={setJournalState}
                setIsHistoryVisible={setIsHistoryVisible}
                handleToggleFullscreen={handleToggleFullscreen}
                setIsSettingsVisible={setIsSettingsMenuVisible}
                setIsLiveAnalysisVisible={setIsLiveAnalysisVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                isLoading={isLoading}
                isRateLimited={isRateLimited}
                onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                isOnline={isOnline}
                pendingQueueCount={pendingQueueCount}
                liveMarketConditions={liveMarketConditions}
            />

            <Journal
                isVisible={journalState.isOpen}
                onClose={() => setJournalState(prev => ({ ...prev, isOpen: false }))}
                initialTab={journalState.tab}
                trades={loggedTrades}
                enabledProviders={[
                    ...(isGeminiEnabled ? [AIProvider.GEMINI] : []),
                    ...(isDeepSeekEnabled ? [AIProvider.DEEPSEEK] : []),
                    ...(isZhipuEnabled ? [AIProvider.ZHIPU] : []),
                    ...(isGroqEnabled ? [AIProvider.GROQ] : []),
                    ...(isGroqNewEnabled ? [AIProvider.GROQ_NEW] : []),
                    ...(isGroqAlt2Enabled ? [AIProvider.GROQ_ALT2] : []),

                    ...(isOpenrouterEnabled ? [AIProvider.OPENROUTER] : []),
                ]}
                selectedModels={{
                    [AIProvider.GEMINI]: modelIdToName[selectedGeminiModel] || selectedGeminiModel,
                    [AIProvider.DEEPSEEK]: modelIdToName[selectedDeepSeekModel] || selectedDeepSeekModel,
                    [AIProvider.ZHIPU]: modelIdToName[selectedZhipuModel] || selectedZhipuModel,
                    [AIProvider.GROQ]: modelIdToName[selectedGroqModel] || selectedGroqModel,
                    [AIProvider.GROQ_NEW]: modelIdToName[selectedGroqNewModel] || selectedGroqNewModel,
                    [AIProvider.GROQ_ALT2]: modelIdToName[selectedGroqAlt2Model] || selectedGroqAlt2Model,

                    [AIProvider.OPENROUTER]: modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel,
                }}
                onDeleteTrades={handleDeleteTrades}
                onClearAllTrades={handleClearAllTrades}
                modelIdToName={modelIdToName}
                ocrModelIdToName={ocrModelIdToName}
                onUpdateInsights={handleManualInsightsUpdate}
                isSummarizing={isSummarizing}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                familyWinRates={familyWinRates}
                globalMemory={globalMemory}
                threadSummary={activeConversation?.threadSummary}

                finalSummary={finalTradeSummary}
                individualSummaries={tradeSummaries}
                isLoading={isSummaryInProgress}
                isInsightGenerating={isInsightGenerating}
                newlyAddedInsightIds={newlyAddedInsightIds}
                summarizationProvider={summarizationProvider}
                summarizationModel={summarizationModel}
                onSetSummarizationProvider={handleSetSummarizationProvider}
                onSetSummarizationModel={handleSetSummarizationModel}
                geminiModels={GEMINI_MODELS}
                deepseekModels={DEEPSEEK_MODELS}
                zhipuModels={ZHIPU_MODELS}
                groqModels={GROQ_MODELS}
                groqNewModels={GROQ_NEW_MODELS}
                groqAlt2Models={GROQ_ALT2_MODELS}

                summaryCharLimit={summaryCharLimit}
                onUpdateSummaryCharLimit={handleUpdateSummaryCharLimit}
                onRegenerateSummary={handleRegenerateFinalSummary}
                onDeleteInsight={handleDeleteInsight}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={setUseAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={setUseAlgorithmicInsights}
                onRewriteInsightsWithAI={handleRewriteInsightsWithAI}
            />

            <StrategySearch isVisible={isStrategySearchVisible} onClose={() => { setIsStrategySearchVisible(false); setStrategyToView(null); }} onApplyStrategy={handleApplyStrategy} onRemoveStrategy={handleRemoveStrategy} geminiModel={selectedGeminiModel} activeFrameworks={activeFrameworks} defaultFrameworks={DEFAULT_FRAMEWORKS} initialViewStrategy={strategyToView} onQuotaExceeded={handleQuotaExceeded} familyWinRates={familyWinRates} />
            <SavedAnalyses analyses={savedAnalyses} isVisible={isSavedAnalysesVisible} onClose={() => setIsSavedAnalysesVisible(false)} onDelete={handleDeleteSavedAnalyses} onClearAll={handleClearAllSavedAnalyses} modelIdToName={modelIdToName} ocrModelIdToName={ocrModelIdToName} />
            {skipCandidate && <SkipTradeModal onClose={() => setSkipCandidate(null)} onConfirm={handleConfirmSkipTrade} skipReason={skipReason} setSkipReason={setSkipReason} correctedEntry={correctedEntry} setCorrectedEntry={setCorrectedEntry} />}
            {showMismatchModal && mismatchData && (
                <OutcomeMismatchModal
                    isVisible={showMismatchModal}
                    onClose={() => setShowMismatchModal(false)}
                    userOutcome={mismatchData.candidate.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'}
                    priceValidation={mismatchData.validation}
                    onResolve={handleMismatchResolution}
                />
            )}

            <ConversationHistory conversations={conversationHistory} activeConversationId={activeConversationId} isVisible={isHistoryVisible} onClose={() => setIsHistoryVisible(false)} onLoadConversation={handleLoadConversation} onDelete={handleDeleteConversations} onClearAll={handleClearAllConversations} onStartNew={handleStartNewConversation} />

            {/* Advanced Analytics Side Panel - Fixed on right edge */}
            <AdvancedAnalyticsSidePanel
                enabledProviders={[
                    ...(isGeminiEnabled ? [AIProvider.GEMINI] : []),
                    ...(isDeepSeekEnabled ? [AIProvider.DEEPSEEK] : []),
                    ...(isZhipuEnabled ? [AIProvider.ZHIPU] : []),
                    ...(isGroqEnabled ? [AIProvider.GROQ] : []),
                    ...(isGroqNewEnabled ? [AIProvider.GROQ_NEW] : []),
                    ...(isGroqAlt2Enabled ? [AIProvider.GROQ_ALT2] : []),

                    ...(isOpenrouterEnabled ? [AIProvider.OPENROUTER] : []),
                ]}
                monteCarloResult={latestMonteCarloResult}
                backtestResult={latestBacktestResult}
                isCalculating={isAnalysisInProgress || isCalculatingAIProbabilities}
                perAIMonteCarloResults={perAIMonteCarloResults}
                entryTimingScore={currentEntryTimingScore}
                slOptimization={currentSlOptimization}
                levelProbabilities={(() => {
                    // Use selected message if available, otherwise fall back to latest
                    const selectedMsg = selectedProbabilityMessageId
                        ? analysisMessages.find(m => m.id === selectedProbabilityMessageId)
                        : null;
                    const targetMsg = selectedMsg || (analysisMessages.length > 0 ? analysisMessages[analysisMessages.length - 1] : null);
                    return targetMsg?.analysis?.levelProbabilities || null;
                })()}
                selectedCoinName={(() => {
                    const selectedMsg = selectedProbabilityMessageId
                        ? analysisMessages.find(m => m.id === selectedProbabilityMessageId)
                        : null;
                    return selectedMsg?.analysis?.coinName || null;
                })()}
                onClearSelection={() => setSelectedProbabilityMessageId(null)}
                isExternallyOpen={isAdvancedAnalyticsOpen}
                onClose={() => setIsAdvancedAnalyticsOpen(false)}
            />

            {/* Mistake Warning Banner - Global Risk Reminder */}
            {loggedTrades.length > 0 && (
                <MistakeWarningBanner
                    tradeLog={loggedTrades}
                />
            )}

            <ChatArea
                messages={messages}
                onSelectMessageForProbability={(id) => {
                    setSelectedProbabilityMessageId(id);
                    setIsAdvancedAnalyticsOpen(true);
                    handleCalculateAIProbabilities(id);
                }}
                chatContext={chatContext}
                virtuosoRef={virtuosoRef}
                isRateLimited={isRateLimited}
                setIsRateLimited={setIsRateLimited}
                showScrollDown={showScrollDown}
                setShowScrollDown={setShowScrollDown}
                showScrollUp={showScrollUp}
                setShowScrollUp={setShowScrollUp}
                handleCycleAnalysisUp={handleCycleAnalysisUp}
                handleScrollToBottom={handleScrollToBottom}
                highlightedAnalysisId={highlightedAnalysisId}
                setHighlightedAnalysisId={setHighlightedAnalysisId}
                analysisMessages={analysisMessages}
                loadingMessage={loadingMessage}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                setIsLiveAnalysisVisible={setIsLiveAnalysisVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                handleCancelAnalysis={handleCancelAnalysis}
                onDeleteMessages={handleDeleteMessages}
                // ChatInput props
                lensConfig={lensConfig}
                setLensConfig={handleSetLensConfig}
                images={images}
                removeImage={removeImage}
                leverageRef={leverageRef}
                setIsLeverageDropdownOpen={setIsLeverageDropdownOpen}
                leverageInput={leverageInput}
                handleLeverageChange={handleLeverageChange}
                handleLeverageBlur={handleLeverageBlur}
                isLeverageDropdownOpen={isLeverageDropdownOpen}
                handlePresetLeverage={handlePresetLeverage}
                fileInputRef={fileInputRef}
                isImageUploadDisabled={isImageUploadDisabled}
                handleImageUpload={handleImageUpload}
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                isSummarizing={isSummarizing}
                isAnyProviderEnabled={isAnyProviderEnabled}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                accuracySubMode={accuracySubMode}
                isGeminiEnabled={isGeminiEnabled}
                setIsGeminiEnabled={handleSetIsGeminiEnabled}
                isDeepSeekEnabled={isDeepSeekEnabled}
                setIsDeepSeekEnabled={handleSetIsDeepSeekEnabled}
                isZhipuEnabled={isZhipuEnabled}
                setIsZhipuEnabled={handleSetIsZhipuEnabled}
                isGroqEnabled={isGroqEnabled}
                setIsGroqEnabled={handleSetIsGroqEnabled}
                isGroqNewEnabled={isGroqNewEnabled}
                setIsGroqNewEnabled={handleSetIsGroqNewEnabled}
                isGroqAlt2Enabled={isGroqAlt2Enabled}
                setIsGroqAlt2Enabled={handleSetIsGroqAlt2Enabled}
                isOpenrouterEnabled={isOpenrouterEnabled}
                setIsOpenrouterEnabled={handleSetIsOpenrouterEnabled}
                isOpenaiEnabled={isOpenaiEnabled}
                setIsOpenaiEnabled={handleSetIsOpenaiEnabled}
                isGrokNativeEnabled={isGrokNativeEnabled}
                setIsGrokNativeEnabled={handleSetIsGrokNativeEnabled}


                selectedVisionModel={selectedOcrModel}
                setSelectedVisionModel={handleSetVisionModel}
                hybridData={currentHybridData}
                isHybridLoading={isHybridLoading}
                hybridConnectionStatus={hybridConnectionStatus}
                slOptimization={currentSlOptimization}
                suggestedEntryPrice={currentSuggestedEntryPrice}
                entryTimingScore={currentEntryTimingScore}
                onNewConversation={handleStartNewConversation}
                onOpenJournal={() => setJournalState({ isOpen: true, tab: 'log' })}
                onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                onOpenAnalytics={() => setIsAdvancedAnalyticsOpen(true)}
                onInteract={() => {
                    if (isAdvancedAnalyticsOpen) setIsAdvancedAnalyticsOpen(false);
                }}
            />
        </div>
    );
};

export default App;




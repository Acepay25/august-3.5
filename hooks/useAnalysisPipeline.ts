import React, { useState, useRef, useCallback } from 'react';
import {
    Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata, AIProvider,
    DebateTurn, Conversation, LiveThoughts, TradeAnalysis, TradeSummary,
    GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction,
    AnalystLensConfig, AnalysisStep, InsightKnowledgeBase, ConfidenceCalibration,
} from '../types';

// Provider services (standard mode)
import * as geminiService from '../services/providers/geminiService';
import * as deepseekService from '../services/providers/deepseekService';
import * as zhipuService from '../services/providers/zhipuService';
import * as groqService from '../services/providers/groqService';
import * as groqNewService from '../services/providers/groqNewService';
import * as groqAlt2Service from '../services/providers/groqAlt2Service';
import * as openrouterService from '../services/providers/openrouterService';
import * as openaiService from '../services/providers/openaiService';
import * as grokNativeService from '../services/providers/grokNativeService';
import * as ensembleService from '../services/providers/ensembleService';

// Accuracy mode services
import * as geminiAccuracyService from '../services/providers/accuracy/geminiAccuracyService';
import * as deepseekAccuracyService from '../services/providers/accuracy/deepseekAccuracyService';
import * as zhipuAccuracyService from '../services/providers/accuracy/zhipuAccuracyService';
import * as groqAccuracyService from '../services/providers/accuracy/groqAccuracyService';
import * as groqNewAccuracyService from '../services/providers/accuracy/groqNewAccuracyService';
import * as groqAlt2AccuracyService from '../services/providers/accuracy/groqAlt2AccuracyService';
import * as openrouterAccuracyService from '../services/providers/accuracy/openrouterAccuracyService';
import * as openaiAccuracyService from '../services/providers/accuracy/openaiAccuracyService';
import * as grokNativeAccuracyService from '../services/providers/accuracy/grokNativeAccuracyService';
import * as ensembleAccuracyService from '../services/providers/accuracy/ensembleAccuracyService';

// Analysis / validation / backtesting services
import { tryFetchHybridDataFromPromptWithCalibration, HybridDataPacket, runMonteCarloForSetup } from '../services/analysis/HybridIntelligenceService';
import { LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import { runValidationGate } from '../services/validation/TradeValidationGate';
import { getGateAnalysis, GateOutput } from '../services/validation/GateKeeperService';

// Utils
import { isQuotaError } from '../utils/errorUtils';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis } from '../utils/analysisUtils';
import { extractLastJson } from '../utils/jsonUtils';
import { sanitizeAIResponse } from '../utils/sanitizers';
import { modelIdToName } from '../constants/models';

// Learning services
import { generateLearningFromPrompt, isLearningEnabled } from '../services/learning/LearningPromptService';
import { generatePersonalizedInjection } from '../services/ui/PersonalizedPromptService';
import { buildUnifiedLearningContext } from '../services/learning/UnifiedLearningBuilder';
import { getLensPromptForStyle } from '../services/ui/AnalystLensService';
import GlobalLearningService from '../services/learning/GlobalLearningService';

// ─── Params Interface ──────────────────────────────────────────────────────────

export interface UseAnalysisPipelineParams {
    // From conversations:
    messages: Message[];
    messagesRef: React.MutableRefObject<Message[]>;
    updateMessages: (updater: (prev: Message[]) => Message[]) => void;
    activeConversation: Conversation | undefined;
    activeConversationId: string | null;

    // All model/provider values:
    selectedGeminiModel: string;
    selectedDeepSeekModel: string;
    selectedZhipuModel: string;
    selectedGroqModel: string;
    selectedGroqNewModel: string;
    selectedGroqAlt2Model: string;
    selectedOpenrouterModel: string;
    selectedOpenaiModel: string;
    selectedGrokNativeModel: string;
    selectedOcrModel: string;
    isGeminiEnabled: boolean;
    isDeepSeekEnabled: boolean;
    isZhipuEnabled: boolean;
    isGroqEnabled: boolean;
    isGroqNewEnabled: boolean;
    isGroqAlt2Enabled: boolean;
    isOpenrouterEnabled: boolean;
    isOpenaiEnabled: boolean;
    isGrokNativeEnabled: boolean;
    moderatorProvider: AIProvider;
    moderatorModel: string;

    // From memory/trade:
    finalTradeSummary: string | null;
    loggedTrades: LoggedTrade[];
    tradeSummaries: TradeSummary[];
    globalMemory: GlobalMemory | undefined;
    insightKnowledgeBase: InsightKnowledgeBase | undefined;
    confidenceCalibration: ConfidenceCalibration | undefined;

    // From market data:
    currentHybridData: HybridDataPacket | null;
    setCurrentHybridData: (v: HybridDataPacket | null) => void;
    setLatestMonteCarloResult: (v: any) => void;
    setLatestBacktestResult: (v: any) => void;
    setPerAIMonteCarloResults: React.Dispatch<React.SetStateAction<LabeledMonteCarloResult[]>>;
    setCurrentSlOptimization: (v: any) => void;
    setCurrentSuggestedEntryPrice: (v: number | null) => void;
    setCurrentEntryTimingScore: (v: any) => void;
    setHybridConnectionStatus: React.Dispatch<React.SetStateAction<any>>;

    // From UI state:
    isAnalysisInProgress: boolean;
    setIsAnalysisInProgress: (v: boolean) => void;
    isHybridLoading: boolean;
    setIsHybridLoading: (v: boolean) => void;
    isRateLimited: boolean;
    setIsRateLimited: (v: boolean) => void;
    setIsLiveAnalysisVisible: (v: boolean) => void;
    setIsAnalysisTypingComplete: (v: boolean) => void;
    setHighlightedAnalysisId: (v: string | null) => void;
    setIsPostMortemInProgress: (v: boolean) => void;
    setIsLivePostMortemVisible: (v: boolean) => void;

    // Settings:
    isAccuracyModeEnabled: boolean;
    accuracySubMode: AccuracySubMode;
    isGlobalMemoryEnabled: boolean;
    customInstructions: CustomInstructionsMap;
    isPlaybookEnabledInPureAI: boolean;
    isFamiliesEnabledInPureAI: boolean;
    isMemoryEnabledInPureAI: boolean;
    isHybridIntelligenceEnabled: boolean;
    lensConfig: AnalystLensConfig;
    activeFrameworks: string[];

    // Toast:
    toast: { warning: (t: string, m?: string) => void };
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalysisPipeline(params: UseAnalysisPipelineParams) {
    const {
        messages, messagesRef, updateMessages, activeConversation, activeConversationId,
        selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel,
        selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model,
        selectedOpenrouterModel, selectedOpenaiModel, selectedGrokNativeModel,
        selectedOcrModel,
        isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled,
        isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled,
        isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled,
        moderatorProvider, moderatorModel,
        finalTradeSummary, loggedTrades, tradeSummaries,
        globalMemory, insightKnowledgeBase, confidenceCalibration,
        currentHybridData, setCurrentHybridData,
        setLatestMonteCarloResult, setLatestBacktestResult,
        setPerAIMonteCarloResults, setCurrentSlOptimization,
        setCurrentSuggestedEntryPrice, setCurrentEntryTimingScore,
        setHybridConnectionStatus,
        isAnalysisInProgress, setIsAnalysisInProgress,
        isHybridLoading, setIsHybridLoading,
        isRateLimited, setIsRateLimited,
        setIsLiveAnalysisVisible, setIsAnalysisTypingComplete,
        setHighlightedAnalysisId,
        setIsPostMortemInProgress, setIsLivePostMortemVisible,
        isAccuracyModeEnabled, accuracySubMode,
        isGlobalMemoryEnabled, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, lensConfig, activeFrameworks,
        toast,
    } = params;

    // ─── State ─────────────────────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
    const [liveThoughts, setLiveThoughts] = useState<LiveThoughts>({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
    const [currentGateResult, setCurrentGateResult] = useState<GateOutput | null>(null);
    const [currentVisionData, setCurrentVisionData] = useState<string[]>([]);
    const [isDeepAnalysis, setIsDeepAnalysis] = useState<boolean>(false);
    const [quotaExceededModels, setQuotaExceededModels] = useState<Set<string>>(new Set());

    // ─── Refs ──────────────────────────────────────────────────────────────
    const analysisAbortController = useRef<AbortController | null>(null);
    const abortRef = useRef<boolean>(false);

    // ─── Analysis Pipeline Step Tracking ───────────────────────────────────
    const initAnalysisSteps = (steps: AnalysisStep[]) => {
        setAnalysisSteps(steps.map(s => ({ ...s, status: 'pending' as const, startTime: undefined, endTime: undefined })));
    };

    const startStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'running' as const, startTime: Date.now() } : s));
    };

    const completeStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'complete' as const, endTime: Date.now() } : s));
    };

    const failStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'error' as const, endTime: Date.now() } : s));
    };

    const addSubStep = (id: string, subStep: { label: string; detail?: string; filename?: string }) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, subSteps: [...(s.subSteps || []), subStep] } : s));
    };

    // ─── Helper: active custom instructions ────────────────────────────────
    const getActiveCustomInstructions = () => {
        let instructionsList: CustomInstruction[] = [];

        if (isAccuracyModeEnabled) {
            instructionsList = accuracySubMode === 'pure_ai' ? customInstructions.accuracyPure : customInstructions.accuracyOriginal;
        } else {
            instructionsList = customInstructions.general;
        }

        return instructionsList
            .filter(inst => inst.isActive)
            .map(inst => `[${inst.title}]\n${inst.content}`)
            .join('\n\n');
    };

    // ─── Main Analysis Handler ─────────────────────────────────────────────
    const handleSendMessage = useCallback(async (customPrompt?: string, customImages?: ImageMetadata[], hiddenContext?: string, options?: { isUpdate?: boolean; updateInterval?: string; presetHybridData?: HybridDataPacket | null }) => {
        const isSummarizing = images.some(img => img.isLoading);

        if (isAnalysisInProgress) return;

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
            toast.warning("Provider Limit", "A maximum of 3 AI providers can be enabled for an ensemble debate in Standard Mode. Please disable at least one.");
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
        // Local copy of the freshest hybrid data - the closure-captured `currentHybridData`
        // stays stale after setCurrentHybridData, so all downstream code must use this variable.
        let freshHybridData: HybridDataPacket | null = currentHybridData;
        // If preset hybrid data was passed, use it immediately
        if (options?.presetHybridData) {
            setCurrentHybridData(options.presetHybridData);
            freshHybridData = options.presetHybridData;
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

            // Initialize analysis pipeline steps
            initAnalysisSteps([
                { id: 'market-data', title: 'Fetching market data', status: 'pending' },
                { id: 'gate-scan', title: 'Running pattern gate scan', status: 'pending' },
                { id: 'analysis', title: 'Analyzing charts', status: 'pending' },
                { id: 'debate', title: 'Ensemble debate', status: 'pending' },
            ]);

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
                    startStep('market-data');
                    const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(
                        effectiveInput,
                        GlobalLearningService.getCalibration()
                    );
                    setIsHybridLoading(false);
                    if (hybridResult) {
                        // Use enhanced injection which includes calibration data
                        hybridDataInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
                        setCurrentHybridData(hybridResult.data); // Store for UI display
                        freshHybridData = hybridResult.data; // Use local var downstream (state is stale in this closure)

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

            // Coin detection for learning context: match only uppercase tickers (no /i flag,
            // which would match any word) and exclude common command words, mirroring the
            // GateKeeper commonWords exclusion list further below.
            const learningCommonWords = ['ANALYZE', 'CHECK', 'LOOK', 'REVIEW', 'SHOW', 'TELL', 'GIVE', 'WHAT', 'HOW', 'WHEN', 'WHERE', 'SHOULD', 'COULD', 'WOULD', 'PLEASE', 'HELP', 'FIND', 'GET', 'SET', 'RUN', 'TEST', 'TRADE', 'LONG', 'SHORT', 'BUY', 'SELL', 'SETUP', 'ENTRY', 'EXIT', 'STOP', 'TAKE', 'PROFIT', 'LOSS', 'CHART', 'PRICE', 'MARKET', 'UPDATE', 'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'ABOUT', 'LIKE', 'JUST', 'SOME', 'MORE', 'VERY', 'ALSO', 'EVEN', 'ONLY', 'SUCH', 'HERE', 'THERE', 'WELL', 'THAN', 'THEM', 'THEN', 'BEEN', 'HAVE', 'WILL', 'DOES', 'DONE', 'MAKE', 'MADE', 'WANT', 'NEED', 'MUST', 'TIME', 'DATA', 'INFO'];
            const detectedCoinRaw = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?)?/)?.[1]?.toUpperCase();
            const detectedLearningCoin = detectedCoinRaw && !learningCommonWords.includes(detectedCoinRaw) ? detectedCoinRaw : undefined;

            // Use UnifiedLearningBuilder to consolidate all learning services
            const unifiedLearning = buildUnifiedLearningContext(
                loggedTrades,
                {
                    coin: detectedLearningCoin,
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
                        detectedLearningCoin,
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
                    completeStep('market-data'); startStep('gate-scan');

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
                            hybridData: freshHybridData, // May be null in non-hybrid mode
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
                            hasHybridData: !!freshHybridData,
                            hybridDataSymbol: freshHybridData?.symbol || 'none',
                            hybridData1hATR: freshHybridData?.indicators?.['1h']?.atr || 'none',
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
                                }, freshHybridData || {
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
                                    freshHybridData?.regime?.regime
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
                    completeStep('gate-scan'); startStep('analysis');
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${enabledProviders.map(p => p.name).join(', ')}` } : s));
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
                            activeFrameworks,
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

                    const settledResults = await Promise.allSettled(analysisPromises);
                    if (abortRef.current) return;
                    setLoadingMessage(null);
                    completeStep('analysis');

                    // Log analysts that failed, then keep only fulfilled results for downstream processing
                    settledResults.forEach((settled, index) => {
                        if (settled.status === 'rejected') {
                            console.warn(`[Ensemble] Analyst "${enabledProviders[index]?.name || `#${index}`}" failed:`, settled.reason);
                        }
                    });
                    const results = settledResults
                        .filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled')
                        .map(s => s.value);

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
                    const hybridDataForMC = freshHybridData || {
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
                    startStep('debate');

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
                            confluenceData: freshHybridData?.confluence ? {
                                score: freshHybridData.confluence.score,
                                direction: freshHybridData.confluence.direction,
                                strength: freshHybridData.confluence.strength,
                                alignedSignals: freshHybridData.confluence.alignment,
                                conflictingSignals: freshHybridData.confluence.conflicts,
                                timeframeCount: 4 // 5m, 15m, 1h, 4h
                            } : undefined,
                            isLensMode: lensConfig?.enabled ?? false,
                            // Always set tradingStyle regardless of Lens mode
                            tradingStyle: lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                        };

                        // Inject market snapshot if available (for Algo Mode & Regeneration)
                        if (freshHybridData && updatedMessage.analysis) {
                            updatedMessage.analysis.marketSnapshot = freshHybridData;
                        }

                        const newMessages = [...prev];
                        newMessages[messageIndex] = updatedMessage;
                        return newMessages;
                    });

                } else if (enabledProviders.length === 1) {
                    const provider = enabledProviders[0];
                    setLoadingMessage(isAccuracyModeEnabled ? `Running High-Precision Analysis...` : `Analyzing with ${provider.name}...`);
                    completeStep('gate-scan'); startStep('analysis');
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${provider.name}` } : s));
                    const result = await provider.service.analyzeTradingView(
                        enhancedPrompt, // Fixed: was promptToSend, now uses enhancedPrompt with Hybrid data
                        provider.useImages ? imageFiles : [],
                        summaries,
                        currentMessages,
                        finalTradeSummary,
                        recentInsightsString,      // Recent Insights (Individual) - must match multi-provider arg order
                        provider.model,
                        activeFrameworks,
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
                        confluenceData: freshHybridData?.confluence ? {
                            score: freshHybridData.confluence.score,
                            direction: freshHybridData.confluence.direction,
                            strength: freshHybridData.confluence.strength,
                            alignedSignals: freshHybridData.confluence.alignment,
                            conflictingSignals: freshHybridData.confluence.conflicts,
                            timeframeCount: 4 // 5m, 15m, 1h, 4h
                        } : undefined,
                    };
                    // Inject snapshot if available
                    if (freshHybridData) {
                        soloAiMessage.analysis!.marketSnapshot = freshHybridData;
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
                startStep('analysis');
                const responseText = await provider.service.getQuickResponse(promptToSend, [...currentMessages, userMessage], provider.model);
                if (abortRef.current) return;
                updateMessages(prev => [...prev, { id: `ai-${Date.now()}`, role: MessageRole.AI, text: responseText, createdAt: new Date().toISOString(), [provider.thoughtsKey + 'ModelUsed']: provider.model }]);
            }
        } catch (error: any) {
            if (abortRef.current) return;
            failStep('analysis');
            updateMessages(prev => prev.filter(m => !m.isDebating));

            if (isQuotaError(error)) {
                let flaggedModel = '';
                enabledProviders.forEach(p => {
                    if (error.message.toLowerCase().includes(p.name.toLowerCase()) || error.model === p.model) {
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
                completeStep('debate');
                // Mark any still-running steps as complete
                setAnalysisSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'complete' as const, endTime: Date.now() } : s));
                analysisAbortController.current = null;
                setIsAnalysisInProgress(false);
            }
        }
    }, [input, images, loadingMessage, finalTradeSummary, activeFrameworks, isRateLimited, selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel, selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model, selectedOpenrouterModel, selectedOpenaiModel, selectedGrokNativeModel, isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled, isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled, isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled, isDeepAnalysis, selectedOcrModel, updateMessages, moderatorProvider, moderatorModel, activeConversationId, activeConversation, isAnalysisInProgress, globalMemory, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, lensConfig, isHybridIntelligenceEnabled, loggedTrades, confidenceCalibration, insightKnowledgeBase, currentHybridData]);

    // ─── Cancel Analysis ───────────────────────────────────────────────────
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

    // ─── Chat Management ───────────────────────────────────────────────────
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

    return {
        // State
        input, setInput,
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        liveThoughts, setLiveThoughts,
        currentGateResult, setCurrentGateResult,
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,
        quotaExceededModels, setQuotaExceededModels,

        // Refs
        analysisAbortController,
        abortRef,

        // Step tracking helpers
        initAnalysisSteps,
        startStep,
        completeStep,
        failStep,
        addSubStep,

        // Handlers
        handleSendMessage,
        handleCancelAnalysis,
        handleClearChat,
        handleDeleteMessages,
        getActiveCustomInstructions,
    };
}

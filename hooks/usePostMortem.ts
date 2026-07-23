import { useState, useCallback } from 'react';
import { Message, MessageRole, TradeOutcome, LoggedTrade, DebateTurn, LiveThoughts, TradeSummary, GlobalMemory, AnalysisStep } from '../types';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';
import { validateTradeOutcome, TradeOutcomeValidation } from '../services/backtesting/BacktestingService';
import { sanitizeAIResponse } from '../utils/sanitizers';
import * as ensembleService from '../services/providers/ensembleService';
import * as MemoryService from '../services/learning/MemoryService';
import { MemoryProvider } from '../services/learning/MemoryService';
import { getTradingWeaknesses } from '../services/learning/MistakePatternService';
import { jobQueue, JobType } from '../services/infrastructure/JobQueueService';
import { MAX_TRADE_SUMMARIES } from './useTradeLogging';

// Provider services (standard mode)
import * as geminiService from '../services/providers/geminiService';
import * as deepseekService from '../services/providers/deepseekService';
import * as zhipuService from '../services/providers/zhipuService';
import * as groqService from '../services/providers/groqService';
import * as groqNewService from '../services/providers/groqNewService';
import * as groqAlt2Service from '../services/providers/groqAlt2Service';
import * as openrouterService from '../services/providers/openrouterService';
import * as openaiService from '../services/providers/openaiService';

// Provider services (accuracy mode)
import * as geminiAccuracyService from '../services/providers/accuracy/geminiAccuracyService';
import * as deepseekAccuracyService from '../services/providers/accuracy/deepseekAccuracyService';
import * as zhipuAccuracyService from '../services/providers/accuracy/zhipuAccuracyService';
import * as groqAccuracyService from '../services/providers/accuracy/groqAccuracyService';
import * as groqNewAccuracyService from '../services/providers/accuracy/groqNewAccuracyService';
import * as groqAlt2AccuracyService from '../services/providers/accuracy/groqAlt2AccuracyService';
import * as openrouterAccuracyService from '../services/providers/accuracy/openrouterAccuracyService';
import * as openaiAccuracyService from '../services/providers/accuracy/openaiAccuracyService';

export interface UsePostMortemParams {
    // Conversation state
    messages: Message[];
    updateMessages: (updater: (prev: Message[]) => Message[]) => void;
    isAccuracyModeEnabled: boolean;
    accuracySubMode: string;
    isGeminiEnabled: boolean;
    isDeepSeekEnabled: boolean;
    isZhipuEnabled: boolean;
    isGroqEnabled: boolean;
    isGroqNewEnabled: boolean;
    isGroqAlt2Enabled: boolean;
    isOpenrouterEnabled: boolean;
    isOpenaiEnabled: boolean;
    isGrokNativeEnabled: boolean;
    selectedGeminiModel: string;
    selectedDeepSeekModel: string;
    selectedZhipuModel: string;
    selectedGroqModel: string;
    selectedGroqNewModel: string;
    selectedGroqAlt2Model: string;
    selectedOpenrouterModel: string;
    selectedOpenaiModel: string;
    selectedGrokNativeModel: string;
    moderatorProvider: any;
    moderatorModel: string;

    // Trade/memory state
    finalTradeSummary: string | null;
    loggedTrades: LoggedTrade[];
    setLoggedTrades: (updater: (prev: LoggedTrade[]) => LoggedTrade[]) => void;
    globalMemory: GlobalMemory | undefined;
    setGlobalMemory: (v: GlobalMemory | undefined) => void;
    memoryModel: string;
    memoryProvider: MemoryProvider;
    tradeSummaries: TradeSummary[];
    setTradeSummaries: (updater: (prev: TradeSummary[]) => TradeSummary[]) => void;

    // UI state setters
    setIsPostMortemInProgress: (v: boolean) => void;
    setIsLivePostMortemVisible: (v: boolean) => void;
    setLoadingMessage: (v: string | null) => void;
    setIsPostMortemTypingComplete: (v: boolean) => void;
    setShowMismatchModal: (v: boolean) => void;
    setExpandedPostMortems: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;

    // Analysis step tracking
    initAnalysisSteps: (steps: AnalysisStep[]) => void;
    startStep: (id: string) => void;
    completeStep: (id: string) => void;
    setAnalysisSteps: (updater: (prev: AnalysisStep[]) => AnalysisStep[]) => void;

    // Post-mortem candidate state (managed in App.tsx for useTradeLogging compatibility)
    setPostMortemCandidate: (v: PostMortemCandidate | null) => void;
}

export const usePostMortem = (params: UsePostMortemParams) => {
    const {
        messages, updateMessages,
        isAccuracyModeEnabled,
        isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled,
        isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled,
        isOpenrouterEnabled, isOpenaiEnabled,
        selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel,
        selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model,
        selectedOpenrouterModel, selectedOpenaiModel,
        moderatorProvider, moderatorModel,
        finalTradeSummary, loggedTrades, setLoggedTrades,
        globalMemory, setGlobalMemory,
        memoryModel, memoryProvider,
        tradeSummaries, setTradeSummaries,
        setIsPostMortemInProgress, setIsLivePostMortemVisible,
        setLoadingMessage, setIsPostMortemTypingComplete,
        setShowMismatchModal, setExpandedPostMortems,
        initAnalysisSteps, startStep, completeStep, setAnalysisSteps,
        setPostMortemCandidate,
    } = params;

    // ─── State ────────────────────────────────────────────────────────────
    const [mismatchData, setMismatchData] = useState<{ candidate: PostMortemCandidate; validation: TradeOutcomeValidation } | null>(null);
    const [typingMessageState, setTypingMessageState] = useState<{ id: string; fullText: string; field: 'postMortem' } | null>(null);
    const [livePostMortemThoughts, setLivePostMortemThoughts] = useState<LiveThoughts>({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });

    // ─── Main Analysis Function ───────────────────────────────────────────
    const startPostMortemAnalysis = async (candidate: PostMortemCandidate, summaries?: string[], imageUrls?: string[], resolvedValidation?: TradeOutcomeValidation) => {
        setPostMortemCandidate(null);
        setIsPostMortemInProgress(true);
        initAnalysisSteps([
            { id: 'validation', title: 'Validating trade outcome', status: 'pending' },
            { id: 'analysis', title: 'Post-mortem analysis', status: 'pending' },
            { id: 'debate', title: 'Ensemble debate', status: 'pending' },
        ]);
        setLoadingMessage("Thinking...");
        startStep('validation');
        setIsLivePostMortemVisible(true);
        setLivePostMortemThoughts({ gemini: null, deepseek: null, zhipu: null, groq: null, groqNew: null, groqAlt2: null, openrouter: null, openai: null, grokNative: null });
        setIsPostMortemTypingComplete(false);

        const postMortemMessageId = `pm-${Date.now()}`;
        const placeholderMsg: Message = {
            id: postMortemMessageId,
            role: MessageRole.AI,
            text: '',
            createdAt: new Date().toISOString(),
            isDebating: false,
            isPostMortem: true,
        };

        setExpandedPostMortems(prev => ({ ...prev, [postMortemMessageId]: true }));
        updateMessages(prev => [...prev, placeholderMsg]);

        try {
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

            // Guard: Accuracy Mode has no fallback provider
            if (isAccuracyModeEnabled && enabledProviders.length === 0) {
                updateMessages(prev => [
                    ...prev.filter(m => m.id !== postMortemMessageId),
                    { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: "Post-Mortem analysis requires at least one enabled AI provider. Please enable a provider and try again." }
                ]);
                setIsPostMortemInProgress(false);
                setIsLivePostMortemVisible(false);
                setLoadingMessage(null);
                return;
            }

            let finalPostMortemReport = "";

            // --- PRICE-BASED OUTCOME VALIDATION ---
            let priceValidation: TradeOutcomeValidation | null = null;
            let priceValidationInjection = "";

            if (candidate.message.analysis) {
                const symbol = candidate.message.analysis.coinName ||
                    candidate.message.text?.match(/\b([A-Z]{2,10}USDT?)\b/)?.[1] ||
                    candidate.message.text?.match(/\b([A-Z]{2,10})\/USDT\b/)?.[1];

                if (symbol) {
                    try {
                        console.log(`[PostMortem] Running price validation for ${symbol}...`);
                        setLoadingMessage("Validating trade outcome against price data...");

                        if (resolvedValidation) {
                            priceValidation = resolvedValidation;
                        } else {
                            priceValidation = await validateTradeOutcome(
                                candidate.message.analysis,
                                symbol.toUpperCase().replace('/', ''),
                                candidate.message.createdAt,
                                candidate.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
                            );
                        }

                        if (priceValidation.isMismatch) {
                            console.log('[PostMortem] Outcome Mismatch Detected. Pausing for user resolution.');
                            setMismatchData({ candidate, validation: priceValidation });
                            setShowMismatchModal(true);
                            setLoadingMessage(null);
                            setIsPostMortemInProgress(false);
                            return;
                        }

                        console.log(`[PostMortem] Price validation result:`, priceValidation.outcome, priceValidation.hitTarget);

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
                        completeStep('validation'); startStep('analysis');
                    } catch (err) {
                        console.warn('[PostMortem] Price validation failed:', err);
                    }
                }
            }

            // --- STANDARD POST-MORTEM FLOW ---
            if (enabledProviders.length === 0 && !isAccuracyModeEnabled) {
                enabledProviders.push({ name: 'Gemini', service: geminiService, model: selectedGeminiModel, thoughtsKey: 'gemini' as const });
            }

            const enhancedSummaries = priceValidationInjection
                ? [...(summaries || []), priceValidationInjection]
                : summaries;

            const analysisPromises = enabledProviders.map(p =>
                p.service.conductPostMortem(
                    candidate.message, candidate.outcome, history, finalTradeSummary, p.model, candidate.feedback, enhancedSummaries
                ).then((res: string) => {
                    return { provider: p.name, result: res };
                })
            );

            const results = await Promise.all(analysisPromises);

            if (results.length > 1) {
                setLoadingMessage("Ensemble Debate in progress...");
                completeStep('analysis'); startStep('debate');
                updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? { ...m, isDebating: true, text: 'Ensemble is analyzing trade outcome...' } : m));

                let debateStream;

                if (results.length === 2) {
                    debateStream = ensembleService.conductTwoWayPostMortemDebate(candidate.message, candidate.outcome, results[0].result, results[1].result, results[0].provider, results[1].provider, finalTradeSummary, moderatorProvider, moderatorModel, imageUrls);
                } else {
                    const r1 = results[0];
                    const r2 = results[1];
                    const r3 = results[2] || results[0];
                    debateStream = ensembleService.conductThreeWayPostMortemDebate(candidate.message, candidate.outcome, r1.result, r2.result, r3.result, r1.provider, r2.provider, r3.provider, finalTradeSummary, moderatorProvider, moderatorModel, imageUrls);
                }

                let fullDebateText = "";
                const turnRegex = /(?:^|\n)\s*(?:[\*_~]*)(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Claude[^\n:]*|GPT[^\n:]*|Grok[^\n:]*|O1|O3|O4|Puter|Moderator)[^\n:]*?(?:[\*_~]*)\s*:\s*([\s\S]*?)(?=(?:^|\n)\s*(?:[\*_~]*)(?:Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Groq \(Alt 2\)|OpenRouter|Claude[^\n:]*|GPT[^\n:]*|Grok[^\n:]*|O1|O3|O4|Puter|Moderator)[^\n:]*?(?:[\*_~]*)\s*:|$)/gi;

                for await (const chunk of debateStream) {
                    fullDebateText += chunk;

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
                finalPostMortemReport = results[0].result;
            }

            // Finalize Message Text
            updateMessages(prev => prev.map(m => m.id === postMortemMessageId ? {
                ...m,
                text: finalPostMortemReport,
                isDebating: false,
                postMortemDebateTurns: undefined,
            } : m));

            // Update Trade Log
            setLoggedTrades(prev => prev.map(t => t.analysis.createdAt === candidate.message.analysis?.createdAt ? {
                ...t,
                postMortem: finalPostMortemReport,
                postMortemCreatedAt: new Date().toISOString(),
                postMortemImages: imageUrls
            } : t));

            const tradeToUpdate = loggedTrades.find(t => t.analysis.createdAt === candidate.message.analysis?.createdAt);
            if (tradeToUpdate) {
                const summary = await MemoryService.summarizeTrade({ ...tradeToUpdate, postMortem: finalPostMortemReport }, memoryModel, memoryProvider);
                setTradeSummaries(prev => {
                    const newSummary = { id: tradeToUpdate.id, summaryText: summary, timestamp: new Date().toISOString() };
                    const updated = [...prev, newSummary];
                    return updated.slice(-MAX_TRADE_SUMMARIES);
                });

                const newMemory = await MemoryService.updateGlobalMemory([tradeToUpdate], globalMemory, memoryProvider);
                setGlobalMemory(newMemory);

                // AI LEARNING: Extract insights and rules in BACKGROUND
                try {
                    const tradeWithPM = { ...tradeToUpdate, postMortem: finalPostMortemReport };
                    jobQueue.addJob(JobType.EXTRACT_INSIGHTS, tradeWithPM);
                    jobQueue.addJob(JobType.EXTRACT_RULES, tradeWithPM);
                } catch (insightError) {
                    console.error('[AI Learning] Failed to queue background jobs:', insightError);
                }

                // Update trading weaknesses
                try {
                    const updatedWeaknesses = getTradingWeaknesses(loggedTrades);
                    console.log('[AI Learning] Updated trading weaknesses analysis');
                } catch (weaknessError) {
                    console.error('[AI Learning] Failed to update weaknesses:', weaknessError);
                }
            }

        } catch (e: any) {
            console.error("Post Mortem Failed", e);
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
            completeStep('debate');
            setAnalysisSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'complete' as const, endTime: Date.now() } : s));
            setTypingMessageState(null);
        }
    };

    // ─── Handlers ─────────────────────────────────────────────────────────
    const handleAllPostMortemTypingComplete = useCallback(() => {
        setIsPostMortemTypingComplete(true);
    }, [setIsPostMortemTypingComplete]);

    const handleRetryPostMortem = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg?.postMortemFailedCandidate) {
            const { message, outcome, feedback, summaries, imageUrls } = msg.postMortemFailedCandidate;
            updateMessages(prev => prev.filter(m => m.id !== messageId));
            startPostMortemAnalysis({ message, outcome, feedback }, summaries, imageUrls);
        }
    }, [messages, updateMessages, startPostMortemAnalysis]);

    const handleMismatchResolution = async (outcome: 'WIN' | 'LOSS') => {
        if (!mismatchData) return;

        console.log(`[PostMortem] User resolved mismatch to: ${outcome}`);

        let finalValidation = mismatchData.validation;

        if (outcome === 'LOSS') {
            finalValidation = {
                ...finalValidation,
                outcome: 'LOSS',
                hitTarget: 'SL',
                exitPrice: finalValidation.slTouched ? (finalValidation.slTouchPrice ?? finalValidation.stopLoss) : (finalValidation.entryPrice * 0.9),
                exitTime: finalValidation.slTouched ? finalValidation.slTouchTime : (finalValidation.exitTime),
                isMismatch: false,
                validationSummary: finalValidation.validationSummary + `\n\n═══════════════════════════════════════════════════════════════\n⚠️ **USER CONFIRMED OUTCOME: LOSS**\n═══════════════════════════════════════════════════════════════\nAlthough price data shows a TP hit first, the USER has explicitly CONFIRMED this trade as a LOSS.\n\n**MANDATORY INSTRUCTION FOR ANALYSTS:**\n1. You MUST accept LOSS as the ground truth.\n2. Do NOT argue that it "should have been a win".\n3. Assume the user missed the TP or manually closed in loss.\n4. Analyze the failure based on the SL hit or manual exit.`
            };
        } else {
            finalValidation = {
                ...finalValidation,
                outcome: 'WIN',
                isMismatch: false,
                validationSummary: finalValidation.validationSummary + `\n\n✅ **USER CONFIRMED OUTCOME: WIN**\nUser verified that the TP hit was valid.`
            };
        }

        const updatedCandidate = {
            ...mismatchData.candidate,
            outcome: outcome === 'WIN' ? TradeOutcome.WIN : TradeOutcome.LOSS
        };

        setShowMismatchModal(false);
        setMismatchData(null);

        await startPostMortemAnalysis(updatedCandidate, undefined, undefined, finalValidation);
    };

    return {
        // State
        mismatchData,
        setMismatchData,
        typingMessageState,
        setTypingMessageState,
        livePostMortemThoughts,
        setLivePostMortemThoughts,

        // Functions
        startPostMortemAnalysis,
        handleRetryPostMortem,
        handleAllPostMortemTypingComplete,
        handleMismatchResolution,
    };
};

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { Message, MessageRole, TradeOutcome, LoggedTrade, DebateTurn, LiveThoughts, TradeSummary, GlobalMemory, AnalysisStep, TodayReassessment } from '../types';
import { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';
import { validateTradeOutcome, TradeOutcomeValidation } from '../services/backtesting/BacktestingService';
import { sanitizeAIResponse } from '../utils/sanitizers';
import * as ensembleService from '../services/providers/ensembleService';
import * as MemoryService from '../services/learning/MemoryService';
import { jobQueue, JobType } from '../services/infrastructure/JobQueueService';
import { buildSeverityPostMortemContext } from '../services/learning/InsightExtractionService';
import { writeModelNote } from '../services/learning/MemoryFilesService';
import { syncClosedTradeToNotebook } from '../services/learning/SkillMemoryService';
import { applyOutcomeToRules } from '../services/learning/LearningRulesService';
import { writeNotebookNoteFromPostMortem } from '../services/learning/NotebookWriterService';
import { MAX_TRADE_SUMMARIES } from './useTradeLogging';
import { saveThinkingBatch, buildThinkingRecordId, getThinkingTradeId } from '../services/infrastructure/ThinkingStoreService';
import { lensFromSpeakerName } from '../utils/thinkingLens';
import { ProviderConfig } from '../types/provider';
import { conductPostMortem, conductTodayReassessment, writePostMortemMarkdownReport } from '../services/providers/GenericAnalysisService';
import { extractPostMortemFinalReport } from '../utils/postMortemReport';
import { fetchMarketData, normalizeSymbol } from '../services/analysis/MarketDataService';
import { PriceAlertService } from '../services/ui/PriceAlertService';

export interface UsePostMortemParams {
    // Conversation state
    messages: Message[];
    activeConversationId: string | null;
    messagesRef: MutableRefObject<Message[]>;
    updateMessages: (updater: (prev: Message[]) => Message[], conversationId?: string | null) => void;
    isAccuracyModeEnabled: boolean;
    accuracySubMode: string;
    // P0-2: activeUsername is used to cancel in-flight post-mortem work
    // when the user switches accounts, preventing the old user's results
    // from being written into the new user's trade log. Passed as a ref
    // because this hook is instantiated before App.tsx destructures
    // activeUsername from useUserProfiles.
    activeUsernameRef: MutableRefObject<string | null>;
    providerConfigs: ProviderConfig[];
    moderatorConfig: ProviderConfig;
    moderatorModel: string;

    // Trade/memory state
    finalTradeSummary: string | null;
    loggedTrades: LoggedTrade[];
    /**
     * Freshest logged-trades array. Capture flows log the trade and start the
     * post-mortem in the same tick, so the `loggedTrades` prop closure is
     * stale when the post-mortem resolves — this ref always holds the latest
     * rows (updated every render by App).
     */
    loggedTradesRef: MutableRefObject<LoggedTrade[]>;
    setLoggedTrades: (updater: (prev: LoggedTrade[]) => LoggedTrade[]) => void;
    globalMemory: GlobalMemory | undefined;
    setGlobalMemory: (v: GlobalMemory | undefined) => void;
    memoryConfig: ProviderConfig | null;
    memoryModel: string;
    useAlgorithmicInsights: boolean;
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
        messages, activeConversationId, messagesRef, updateMessages,
        isAccuracyModeEnabled,
        activeUsernameRef,
        providerConfigs,
        moderatorConfig, moderatorModel,
        finalTradeSummary, loggedTrades, loggedTradesRef, setLoggedTrades,
        globalMemory, setGlobalMemory,
        memoryConfig, memoryModel,
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
    const [livePostMortemThoughts, setLivePostMortemThoughts] = useState<LiveThoughts>({});
    /** Post-mortem message id currently running a "what would I do today?" re-assessment. */
    const [todayReassessmentInFlight, setTodayReassessmentInFlight] = useState<string | null>(null);

    // ─── P0-2: Cancellation guard for in-flight post-mortem work ──────────
    // When the user switches accounts, any async post-mortem analysis still
    // running for the OLD user would otherwise resolve and call
    // setLoggedTrades/setTradeSummaries/setGlobalMemory — clobbering the NEW
    // user's data. Each run captures the current runId; if the user changes,
    // runId is bumped and stale runs early-return before mutating state.
    const postMortemRunIdRef = useRef<number>(0);
    const postMortemAbortControllerRef = useRef<AbortController | null>(null);
    const lastSeenUsernameRef = useRef<string | null>(activeUsernameRef.current);
    const lastSeenConversationIdRef = useRef<string | null>(activeConversationId);
    useEffect(() => {
        // Bump the run id whenever the active account or conversation changes.
        if (
            activeUsernameRef.current !== lastSeenUsernameRef.current
            || activeConversationId !== lastSeenConversationIdRef.current
        ) {
            lastSeenUsernameRef.current = activeUsernameRef.current;
            lastSeenConversationIdRef.current = activeConversationId;
            postMortemRunIdRef.current += 1;
        }
    });

    /**
     * Helper: returns true if the calling run is still the active one.
     * Capture `const myRunId = postMortemRunIdRef.current` at the start of
     * an async path, then call `isRunStale(myRunId)` before each state write.
     */
    const isRunStale = useCallback((runId: number): boolean => {
        return runId !== postMortemRunIdRef.current;
    }, []);

    const invalidatePostMortemRuns = useCallback((): void => {
        postMortemRunIdRef.current += 1;
        postMortemAbortControllerRef.current?.abort();
        postMortemAbortControllerRef.current = null;
    }, []);

    // ─── Main Analysis Function ───────────────────────────────────────────
    const startPostMortemAnalysis = async (candidate: PostMortemCandidate, summaries?: string[], imageUrls?: string[], resolvedValidation?: TradeOutcomeValidation) => {
        // Capture the run id at the start. If the user switches accounts while
        // this async function is in flight, the ref will be bumped and our
        // subsequent state writes will be skipped (see isRunStale checks).
        const myRunId = postMortemRunIdRef.current;
        postMortemAbortControllerRef.current?.abort();
        const currentAbortController = new AbortController();
        postMortemAbortControllerRef.current = currentAbortController;

        setPostMortemCandidate(null);
        setIsPostMortemInProgress(true);
        initAnalysisSteps([
            { id: 'validation', title: 'Validating trade outcome', status: 'pending' },
            { id: 'analysis', title: 'Post-mortem analysis', status: 'pending' },
            { id: 'debate', title: 'Ensemble debate', status: 'pending' },
            { id: 'report', title: 'Moderator final report', status: 'pending' },
        ]);
        setLoadingMessage("Thinking...");
        startStep('validation');
        setIsLivePostMortemVisible(true);
        // Keyed by provider id — LiveStreamView panels use the same keys, so
        // each analyst's report lands in its own panel as it resolves.
        setLivePostMortemThoughts({});
        setIsPostMortemTypingComplete(false);

        const postMortemMessageId = `pm-${Date.now()}`;
        const requestConversationId = activeConversationId;
        const updatePostMortemMessages = (updater: (prev: Message[]) => Message[]): void => {
            updateMessages(updater, requestConversationId);
        };
        const placeholderMsg: Message = {
            id: postMortemMessageId,
            role: MessageRole.AI,
            text: '',
            createdAt: new Date().toISOString(),
            isDebating: false,
            isPostMortem: true,
        };

        setExpandedPostMortems(prev => ({ ...prev, [postMortemMessageId]: true }));
        updatePostMortemMessages(prev => [...prev, placeholderMsg]);

        // Tracks whether the run finished successfully — the finally block marks
        // still-running steps 'complete' on success but 'error' on failure
        // (mirroring useAnalysisPipeline, which never force-completes failures).
        let postMortemSucceeded = true;
        try {
            const history: Message[] = [...messagesRef.current];
            const enabledProviders = providerConfigs
                .filter(config => config.isEnabled && config.apiKey && config.selectedModel)
                .map(config => ({ config, name: config.name, model: config.selectedModel }));

            // Guard: no providers → nothing can run (accurate for ALL modes,
            // not just Accuracy Mode — previously Standard Mode underflowed
            // `results[0]` when `enabledProviders` was empty).
            if (enabledProviders.length === 0) {
                updatePostMortemMessages(prev => [
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
                            // Remove the empty placeholder bubble — the user's
                            // resolution starts a fresh run (with its own
                            // placeholder). Leaving this one behind produced a
                            // permanently blank post-mortem bubble in the chat.
                            updatePostMortemMessages(prev => prev.filter(m => m.id !== postMortemMessageId));
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
            const enhancedSummaries = priceValidationInjection
                ? [...(summaries || []), priceValidationInjection]
                : summaries;

            // Captured chain-of-thought per analyst (keyed by provider id) —
            // attached to the post-mortem message like the moderator's debate
            // reasoning below, so the Thinking modal can show it. Populated in
            // both the debate and single-report paths (the analyst reports
            // always run first).
            const postMortemReasoning: Record<string, string> = {};

            // R-severity context for the post-mortem generation: the trade's
            // historical cluster (same numbers the gate quotes pre-trade).
            // The trade's id equals the candidate message id (capture flows
            // log it in the same tick); fall back to a synthetic trade so the
            // cluster still computes against history if the save hasn't
            // flushed yet. Empty string when the cluster is shallow — the
            // post-mortem prompt then looks exactly as before.
            const severityTrade = loggedTradesRef.current.find(t => t.id === candidate.message.id)
                ?? ({ id: candidate.message.id, outcome: candidate.outcome, analysis: candidate.message.analysis } as LoggedTrade);
            const severityContext = buildSeverityPostMortemContext(severityTrade, loggedTradesRef.current);

            const analysisPromises = enabledProviders.map(p =>
                conductPostMortem(
                    p.config,
                    {
                        previousMessage: candidate.message,
                        outcome: candidate.outcome,
                        history,
                        finalTradeSummary,
                        severityContext,
                        feedback: candidate.feedback ? {
                            correctedEntry: candidate.feedback.correctedEntry,
                            correctedStopLoss: candidate.feedback.correctedStopLoss,
                            correctedTakeProfit: candidate.feedback.correctedTakeProfit,
                        } : undefined,
                        postTradeImageSummaries: enhancedSummaries,
                        // Wire the abort controller so account/conversation
                        // switches actually cancel in-flight API calls instead
                        // of only suppressing their state writes.
                        signal: currentAbortController.signal,
                        // Capture each analyst's chain of thought (all wire
                        // formats) so it survives onto the post-mortem message
                        // alongside the moderator's debate reasoning.
                        onReasoning: (reasoning: string) => {
                            postMortemReasoning[p.config.id] = (postMortemReasoning[p.config.id] || '') + reasoning;
                        },
                    }
                ).then((res: string) => {
                    if (!isRunStale(myRunId)) {
                        // Feed the live overlay panel as each analyst report lands.
                        setLivePostMortemThoughts(prev => ({ ...prev, [p.config.id]: res }));
                    }
                    return { provider: p.name, result: res };
                })
            );

            // allSettled: one provider failing (quota/network) must not fail
            // the whole post-mortem — the debate continues with whoever
            // succeeded (mirrors the analysis pipeline's N-1 handling).
            const settled = await Promise.allSettled(analysisPromises);
            const results = settled
                .filter((r): r is PromiseFulfilledResult<{ provider: string; result: string }> => r.status === 'fulfilled')
                .map(r => r.value);

            // Per-provider analyst reports (keyed by display name) — persisted
            // on the trade so the EXTRACT_INSIGHTS job can attribute KB
            // insights to whichever AI actually produced the lesson.
            const postMortemContributions: Record<string, string> = Object.fromEntries(
                results.filter(r => r.result && r.result.trim()).map(r => [r.provider, r.result])
            );

            // Re-check after the await — the user may have switched during the analyst calls.
            if (isRunStale(myRunId)) return;

            if (results.length === 0) {
                throw new Error('All AI providers failed during post-mortem analysis. Please check your provider configuration and try again.');
            }

            // messagesRef only syncs via a post-commit effect (useConversations),
            // so reading it right after the final updatePostMortemMessages below
            // would miss the last streamed turns. Capture the freshest parsed
            // turns here during streaming instead, and fall back to the ref only
            // when no turns were hoisted (e.g. non-debate path).
            let latestDebateTurns: DebateTurn[] | undefined;
            // Captured moderator chain-of-thought during the debate stream.
            // Declared at run scope so the finalize path (outside the debate
            // branch) can attach it to the message; empty on the non-debate path.
            let moderatorReasoning = "";

            if (results.length > 1) {
                setLoadingMessage("Ensemble Debate in progress...");
                completeStep('analysis'); startStep('debate');
                updatePostMortemMessages(prev => prev.map(m => m.id === postMortemMessageId ? { ...m, isDebating: true, text: 'Ensemble is analyzing trade outcome...' } : m));

                let debateStream;
                // The post-mortem debate is a single moderator-driven stream,
                // so any chain-of-thought captured from it keys to lowercase
                // 'moderator' — the same key DebateChat.getReasoning reads for
                // the Master Strategist (harness-style thinking blocks).

                if (results.length === 2) {
                    debateStream = ensembleService.conductTwoWayPostMortemDebate(candidate.message, candidate.outcome, results[0].result, results[1].result, results[0].provider, results[1].provider, finalTradeSummary, moderatorConfig, moderatorModel, imageUrls, undefined, currentAbortController.signal, (delta) => { moderatorReasoning += delta; });
                } else {
                    const r1 = results[0];
                    const r2 = results[1];
                    const r3 = results[2] || results[0];
                    debateStream = ensembleService.conductThreeWayPostMortemDebate(candidate.message, candidate.outcome, r1.result, r2.result, r3.result, r1.provider, r2.provider, r3.provider, finalTradeSummary, moderatorConfig, moderatorModel, imageUrls, currentAbortController.signal, (delta) => { moderatorReasoning += delta; });
                }

                let fullDebateText = "";
                // Speaker regex built from the ACTUAL participating providers
                // (runtime-configured provider names) plus the established
                // model aliases — the old hardcoded list silently dropped
                // every analyst turn from custom providers.
                const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const resultProviderNames = results.map(r => r.provider).filter(Boolean).map(escapeRegExp);
                const speakerNames = [...new Set([
                    ...resultProviderNames,
                    'Gemini', 'DeepSeek', 'Zhipu', 'Groq', 'Groq \\(Alt\\)', 'Groq \\(Alt 2\\)', 'OpenRouter',
                    'Moderator', 'Master Strategist', 'Claude[^:]*', 'GPT[^:]*', 'Grok[^:]*', 'Mistral[^:]*',
                    'Kimi[^:]*', 'Qwen[^:]*', 'LLaMA[^:]*', 'O1[^:]*', 'O3[^:]*', 'O4[^:]*', 'Puter[^:]*'
                ])].sort((a, b) => b.length - a.length);
                const speakerPattern = speakerNames.join('|');
                const turnRegex = new RegExp(`(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:\\s*([\\s\\S]*?)(?=(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:|$)`, 'gi');

                for await (const chunk of debateStream) {
                    // P0-2: abort the stream if the user switched accounts
                    if (isRunStale(myRunId)) {
                        console.log('[PostMortem] Aborting debate stream — user switched');
                        return;
                    }
                    fullDebateText += chunk;

                    const startMatch = fullDebateText.match(/<DEBATE_START>/i);
                    const endMatch = fullDebateText.match(/<\/DEBATE_END>/i);

                    if (startMatch) {
                        const startIndex = startMatch.index! + startMatch[0].length;
                        const endIndex = endMatch ? endMatch.index! : fullDebateText.length;
                        const debateContent = fullDebateText.slice(startIndex, endIndex);

                        const currentTurns: DebateTurn[] = [];
                        const matches = [...debateContent.matchAll(turnRegex)];
                        // Autoplayed post-mortem transcripts carry no explicit
                        // rounds — derive them the same way as accuracy mode:
                        // each moderator turn starts a new round so the
                        // messenger chat keeps its separators + verdict badge.
                        let autoplayRound = 0;
                        for (const m of matches) {
                            let speaker = m[1].trim();
                            if (speaker === 'Master Strategist') speaker = 'Moderator';
                            if (speaker === 'Moderator') autoplayRound++;
                            currentTurns.push({
                                speaker: speaker as any,
                                round: autoplayRound > 0 ? autoplayRound : undefined,
                                text: sanitizeAIResponse(m[2].trim()),
                            });
                        }

                        // Only hoist non-empty parses — a mid-stream chunk can
                        // yield zero matches and must not shadow earlier turns.
                        if (currentTurns.length > 0) latestDebateTurns = currentTurns;

                        updatePostMortemMessages(prev => prev.map(m => m.id === postMortemMessageId ? { ...m, debateTurns: currentTurns, postMortemDebateTurns: currentTurns, reasoningProcesses: { ...(m.reasoningProcesses ?? {}), ...(moderatorReasoning ? { moderator: moderatorReasoning } : {}) } } : m));
                    }

                    const reportStart = fullDebateText.match(/<FINAL_REPORT_START>/i);
                    const reportEnd = fullDebateText.match(/<\/FINAL_REPORT_END>/i);
                    if (reportStart) {
                        const rStart = reportStart.index! + reportStart[0].length;
                        const rEnd = reportEnd ? reportEnd.index! : fullDebateText.length;
                        setTypingMessageState({ id: postMortemMessageId, fullText: fullDebateText.slice(rStart, rEnd).trim(), field: 'postMortem' });
                    }
                }

                finalPostMortemReport = extractPostMortemFinalReport(fullDebateText);

            } else {
                finalPostMortemReport = results[0].result;
            }

            if (isRunStale(myRunId)) return;
            completeStep('debate');
            startStep('report');
            setLoadingMessage('Moderator writing final report...');

            const debateTranscript = (latestDebateTurns && latestDebateTurns.length > 0)
                ? latestDebateTurns.map(t => `**${t.speaker}:** ${t.text}`).join('\n\n')
                : '';
            const analystReports = results
                .map(r => `### ${r.provider}\n${r.result}`)
                .join('\n\n');
            const setupBrief = candidate.message.analysis
                ? [
                    `Asset: ${candidate.message.analysis.coinName || 'Unknown'}`,
                    `Direction: ${candidate.message.analysis.direction}`,
                    `Confidence: ${candidate.message.analysis.confidence}`,
                    `Entry: ${(candidate.message.analysis.entryPoints || []).map(e => e.price).join(', ')}`,
                    `SL: ${candidate.message.analysis.stopLoss}`,
                    `TP: ${(candidate.message.analysis.takeProfit || []).map(t => t.price).join(', ')}`,
                    `Strategy: ${candidate.message.analysis.strategy || ''}`,
                ].join('\n')
                : (candidate.message.text || '').slice(0, 1500);

            try {
                const reportConfig: ProviderConfig = {
                    ...moderatorConfig,
                    selectedModel: moderatorModel || moderatorConfig.selectedModel,
                };
                const markdownReport = await writePostMortemMarkdownReport(reportConfig, {
                    outcome: String(candidate.outcome),
                    setupBrief,
                    analystReports,
                    debateTranscript: debateTranscript || finalPostMortemReport,
                    signal: currentAbortController.signal,
                });
                if (markdownReport.trim().length > 40) {
                    finalPostMortemReport = markdownReport.trim();
                }
            } catch (reportError) {
                console.warn('[PostMortem] Moderator markdown report failed; using debate extract:', reportError);
            }

            if (!finalPostMortemReport.trim()) {
                finalPostMortemReport = results[0]?.result
                    || 'Debate concluded, but the moderator report could not be generated.';
            }

            // Finalize Message Text
            if (isRunStale(myRunId)) return;
            // Persist post-mortem debate turns to ThinkingStore before clearing from message
            const postMortemTradeId = getThinkingTradeId(candidate.message.analysis?.createdAt, candidate.message.id);
            const postMortemTurns = latestDebateTurns ?? messagesRef.current.find(m => m.id === postMortemMessageId)?.postMortemDebateTurns;
            if (postMortemTurns && postMortemTurns.length > 0) {
                try {
                    // LOW #10: static import — this module is already in the
                    // main bundle (useAnalysisPipeline imports it statically),
                    // so the dynamic import gave zero code-splitting benefit.
                    const username = localStorage.getItem('last_active_user') || 'default';
                    const now = new Date().toISOString();
                    const turnRecords = postMortemTurns.map((turn, idx) => ({
                        id: buildThinkingRecordId(postMortemTradeId, turn.speaker.toLowerCase().includes('moderator') ? 'moderator' : turn.speaker.toLowerCase(), 'debate_turn', idx),
                        tradeId: postMortemTradeId,
                        username,
                        provider: turn.speaker.toLowerCase().includes('moderator') ? 'moderator' : turn.speaker.toLowerCase(),
                        role: 'debate_turn' as const,
                        debateTurnIndex: idx,
                        debateTurnSpeaker: turn.speaker,
                        reasoning: turn.text,
                        // Card linkage: post-mortem turns belong to the card
                        // the analysis message id resolves to.
                        messageId: candidate.message.id,
                        analystLens: lensFromSpeakerName(turn.speaker) ?? 'normal',
                        createdAt: now,
                    }));
                    saveThinkingBatch(turnRecords).catch(err => {
                        console.warn('[ThinkingStore] Failed to save post-mortem turns:', err);
                    });
                } catch (err) {
                    console.warn('[ThinkingStore] Failed to persist post-mortem turns:', err);
                }
            }

            updatePostMortemMessages(prev => prev.map(m => m.id === postMortemMessageId ? {
                ...m,
                text: finalPostMortemReport,
                isDebating: false,
                debateTurns: latestDebateTurns ?? m.debateTurns,
                postMortemDebateTurns: latestDebateTurns ?? m.postMortemDebateTurns,
                // Keep captured chain of thought on the message — the
                // moderator's debate reasoning plus each analyst's post-mortem
                // reasoning (merging so pre-existing analysis reasoning is
                // preserved).
                ...((moderatorReasoning || Object.keys(postMortemReasoning).length > 0) ? { reasoningProcesses: { ...(m.reasoningProcesses ?? {}), ...(moderatorReasoning ? { moderator: moderatorReasoning } : {}), ...postMortemReasoning } } : {}),
            } : m));

            // P0-2: If the user switched accounts while the post-mortem was
            // running, do NOT write the old user's results into the new
            // user's trade log / summaries / global memory. This is the
            // critical guard — without it, the in-flight setters clobber the
            // new user's data.
            if (isRunStale(myRunId)) {
                console.log('[PostMortem] Discarding results — user switched during analysis');
                return;
            }

            // Update Trade Log. The trade row is matched by the card
            // (message) id — the analysis createdAt can be shared by two
            // trades and previously matched the wrong rows (or none).
            setLoggedTrades(prev => prev.map(t => t.id === candidate.message.id ? {
                ...t,
                postMortem: finalPostMortemReport,
                postMortemCreatedAt: new Date().toISOString(),
                postMortemImages: imageUrls,
                postMortemByProvider: postMortemContributions
            } : t));

            // The trade was logged in the same tick that started this
            // post-mortem (capture flows: logTradeWithFeedback → setLoggedTrades
            // → startPostMortemAnalysis), so the `loggedTrades` prop closure
            // still holds the PRE-log array here. The ref always has the
            // freshest rows.
            const tradeToUpdate = loggedTradesRef.current.find(t => t.id === candidate.message.id);
            if (tradeToUpdate) {
                // Memory/learning steps are BEST-EFFORT: the report is already
                // written to the chat + trade log above, so a failure here must
                // never turn a completed post-mortem into "Post-Mortem Failed".
                try {
                    if (isRunStale(myRunId)) {
                        console.log('[PostMortem] Discarding summary — user switched during summarizeTrade');
                        return;
                    }
                    setTradeSummaries(prev => {
                        const newSummary = {
                            id: tradeToUpdate.id,
                            summaryText: finalPostMortemReport,
                            timestamp: new Date().toISOString(),
                        };
                        const updated = prev.some(s => s.id === tradeToUpdate.id)
                            ? prev.map(s => s.id === tradeToUpdate.id ? newSummary : s)
                            : [...prev, newSummary];
                        return updated.slice(-MAX_TRADE_SUMMARIES);
                    });

                    const insightConfig = memoryConfig ?? moderatorConfig;
                    if (insightConfig) {
                        const newMemory = await MemoryService.updateGlobalMemory([{ ...tradeToUpdate, postMortem: finalPostMortemReport }], globalMemory, insightConfig);
                        // Re-check after the await
                        if (isRunStale(myRunId)) {
                            console.log('[PostMortem] Discarding global memory update — user switched');
                            return;
                        }
                        setGlobalMemory(newMemory);
                    } else {
                        console.warn('[PostMortem] No memory provider configured — skipping global memory update (non-fatal).');
                    }
                } catch (memoryError) {
                    console.warn('[PostMortem] Memory/learning step failed (non-fatal):', memoryError);
                }

                // AI LEARNING: Extract insights and rules in BACKGROUND
                try {
                    const tradeWithPM = {
                        ...tradeToUpdate,
                        postMortem: finalPostMortemReport,
                        postMortemByProvider: postMortemContributions
                    };
                    jobQueue.addJob(JobType.EXTRACT_INSIGHTS, tradeWithPM);
                    jobQueue.addJob(JobType.EXTRACT_RULES, tradeWithPM);
                } catch (insightError) {
                    console.error('[AI Learning] Failed to queue background jobs:', insightError);
                }

                // TRADER NOTEBOOK (memory files): append the closed trade to
                // its symbol diary and re-sync the recurring-mistakes file so
                // the NEXT analysis reads the accumulated outcome. Best-effort
                // — the report is already saved, a diary failure must never
                // fail the post-mortem.
                try {
                    const notebookUser = localStorage.getItem('last_active_user') || 'default';
                    const closed = { ...tradeToUpdate, postMortem: finalPostMortemReport };
                    await syncClosedTradeToNotebook(closed, loggedTradesRef.current, notebookUser);
                    applyOutcomeToRules(closed);
                } catch (notebookError) {
                    console.warn('[TraderNotebook] Memory-file sync failed (non-fatal):', notebookError);
                }

                // TRADER NOTEBOOK (AI writer): distill the post-mortem into a
                // timeless knowledge note — the model may create its own
                // folder and file (sanitized + deduped by writeModelNote).
                // Uses the memory provider when configured, else the first
                // ready analyst provider. Best-effort: the diary above is the
                // guaranteed record.
                try {
                    const notebookUser = localStorage.getItem('last_active_user') || 'default';
                    const writerConfig = memoryConfig ?? enabledProviders[0]?.config;
                    if (writerConfig) {
                        const note = await writeNotebookNoteFromPostMortem(
                            { ...tradeToUpdate, postMortem: finalPostMortemReport },
                            writerConfig
                        );
                        if (note) {
                            const created = await writeModelNote(note, notebookUser);
                            console.log('[TraderNotebook] AI wrote notebook note:', created.name, 'in', note.folder);
                        }
                    }
                } catch (notebookError) {
                    console.warn('[TraderNotebook] AI note write failed (non-fatal):', notebookError);
                }
            }

        } catch (e: any) {
            postMortemSucceeded = false;
            if (isRunStale(myRunId)) return;
            console.error("Post Mortem Failed", e);
            // P2-15: Keep the role as AI (not SYSTEM) so the message renders
            // consistently and the persisted record isn't a data-shape
            // mutation (an AI bubble becoming a SYSTEM message). The
            // postMortemFailedCandidate payload drives the retry button,
            // which handleRetryPostMortem wires up — so a failed post-mortem
            // now renders as an AI message with the error text + a retry CTA.
            updatePostMortemMessages(prev => prev.map(m => m.id === postMortemMessageId ? {
                ...m,
                text: `Post-Mortem Failed: ${e.message}`,
                role: MessageRole.AI,
                postMortemFailedCandidate: {
                    message: candidate.message,
                    outcome: candidate.outcome,
                    feedback: candidate.feedback,
                    summaries,
                    imageUrls
                }
            } : m));
        } finally {
            if (!isRunStale(myRunId)) {
                setIsPostMortemInProgress(false);
                setLoadingMessage(null);
                // Fail-safe close: the overlay must never stay up forever even
                // if typing-complete never fires (e.g. all analysts failed).
                setIsLivePostMortemVisible(false);
                completeStep('debate');
                completeStep('report');
                setAnalysisSteps(prev => prev.map(s => s.status === 'running'
                    ? { ...s, status: postMortemSucceeded ? ('complete' as const) : ('error' as const), endTime: Date.now() }
                    : s));
                setTypingMessageState(null);
            }
        }
    };

    // ─── Handlers ─────────────────────────────────────────────────────────
    const handleAllPostMortemTypingComplete = useCallback(() => {
        setIsPostMortemTypingComplete(true);
        // All analyst panels finished typing — dismiss the overlay (LiveStreamView
        // already waited 800ms after the last panel completed).
        setIsLivePostMortemVisible(false);
    }, [setIsPostMortemTypingComplete, setIsLivePostMortemVisible]);

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
            // When price data showed a TP hit first but the user confirms a
            // LOSS, use the ACTUAL stop-loss level as the exit reference —
            // previously a made-up `entryPrice * 0.9` (-10%) was injected
            // into every analyst's prompt as "ground truth".
            const exitRef = finalValidation.slTouched
                ? (finalValidation.slTouchPrice ?? finalValidation.stopLoss)
                : (finalValidation.stopLoss ?? finalValidation.entryPrice * 0.9);
            finalValidation = {
                ...finalValidation,
                outcome: 'LOSS',
                hitTarget: 'SL',
                exitPrice: exitRef,
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

    /**
     * "What would I do today?" — re-assesses a closed trade's setup against
     * the CURRENT market price, answering forward-looking whether the setup
     * would still be a valid trade today (hindsight known, verdict fresh).
     * Rides the post-mortem run-id/abort guards so account/conversation
     * switches cancel it like any other post-mortem work.
     */
    const startTodayReassessment = async (messageId: string): Promise<void> => {
        if (todayReassessmentInFlight) return;

        // Synchronous validation FIRST — never abort other post-mortem work
        // for a request that cannot run.
        const msgs = messagesRef.current;
        const pmIndex = msgs.findIndex(m => m.id === messageId);
        const pmMessage = pmIndex >= 0 ? msgs[pmIndex] : undefined;
        if (!pmMessage?.isPostMortem) return;

        // The original analysis card is the nearest preceding message with one.
        let card: Message | undefined;
        for (let i = pmIndex - 1; i >= 0; i--) {
            if (msgs[i].analysis) { card = msgs[i]; break; }
        }
        if (!card?.analysis) {
            console.warn('[TodayReassessment] No source analysis found for post-mortem', messageId);
            return;
        }

        const provider = providerConfigs.find(c => c.isEnabled && c.apiKey && c.selectedModel);
        if (!provider) {
            console.warn('[TodayReassessment] No enabled provider configured');
            return;
        }

        // Bump the run id BEFORE aborting so the aborted post-mortem run's
        // catch/finally see a stale id and discard SILENTLY — without the
        // bump it would write "Post-Mortem Failed" + postMortemFailedCandidate
        // over its partial transcript. The bump precedes the capture so THIS
        // run stays current (isRunStale uses the fresh id).
        postMortemRunIdRef.current += 1;
        const myRunId = postMortemRunIdRef.current;
        postMortemAbortControllerRef.current?.abort();
        const currentAbortController = new AbortController();
        postMortemAbortControllerRef.current = currentAbortController;
        // The aborted run's stale finally skips UI cleanup — close the
        // streaming overlay explicitly so it can't stay up after the takeover.
        setIsPostMortemInProgress(false);
        setIsLivePostMortemVisible(false);
        setLoadingMessage(null);

        // Claim the slot before the first await — a double-click must not
        // start two fetches (the second would abort the first).
        setTodayReassessmentInFlight(messageId);

        // Live price: cached socket price first, else a fresh ticker fetch.
        let currentPrice = 0;
        const symbol = normalizeSymbol(card.analysis.coinName || '');
        if (symbol) {
            try {
                currentPrice = PriceAlertService.getCurrentPrice(symbol) ?? (await fetchMarketData(symbol)).currentPrice;
            } catch (e) {
                console.warn('[TodayReassessment] Price fetch failed — reasoning from levels only:', e);
            }
        }

        try {
            const { verdict, text } = await conductTodayReassessment(provider, {
                analysis: card.analysis,
                postMortem: pmMessage.postMortem || pmMessage.text || '',
                outcome: card.outcome ?? pmMessage.outcome,
                currentPrice,
                signal: currentAbortController.signal,
            });
            if (isRunStale(myRunId)) return;
            const reassessment: TodayReassessment = {
                verdict,
                text,
                price: currentPrice,
                createdAt: new Date().toISOString(),
            };
            updateMessages(
                prev => prev.map(m => m.id === messageId ? { ...m, todayReassessment: reassessment } : m),
                activeConversationId,
            );
        } catch (e: any) {
            if (isRunStale(myRunId) || e?.name === 'AbortError') return;
            console.error('[TodayReassessment] Failed:', e);
        } finally {
            // Unconditional — a stale run must still release the in-flight
            // slot, or the button stays disabled until the app reloads.
            setTodayReassessmentInFlight(prev => (prev === messageId ? null : prev));
        }
    };

    return {
        // State
        mismatchData,
        setMismatchData,
        typingMessageState,
        setTypingMessageState,
        livePostMortemThoughts,
        setLivePostMortemThoughts,
        todayReassessmentInFlight,
        setTodayReassessmentInFlight,

        // Functions
        startPostMortemAnalysis,
        startTodayReassessment,
        invalidatePostMortemRuns,
        handleRetryPostMortem,
        handleAllPostMortemTypingComplete,
        handleMismatchResolution,
    };
};

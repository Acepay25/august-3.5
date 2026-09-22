import type {
    DebateTurn,
    DebateRunEvent,
    LoggedTrade,
    Message,
    TradeAnalysis,
    TradingStyle,
} from '../../types';
import type { ProviderConfig } from '../../types/provider';
import type { HybridDataPacket } from '../../services/analysis/HybridIntelligenceService';
import type { LabeledMonteCarloResult } from '../../services/analysis/MonteCarloService';
import type { LiveBacktestResult } from '../../services/backtesting/LiveBacktestService';
import type { AgentTeamSeat } from '../../services/agents/agentRoster';
import type { AnalystLensConfig } from '../../types';
import type { TokenUsage } from '../../utils/tokenUsage';
import type { ToolAction } from '../../types/message';
import type { MemoryRetrievalQuery } from '../../services/learning/MemoryGraph';
import { TradeOutcome } from '../../types/enums';

// Analysis / verdict helpers
import {
    parseMarkdownTradePlan,
    isBindingMarkdownPlan,
    tradePlanToAnalysis,
    stripPlanTags,
    parseProseTradePlan,
    sanitizeTradeAnalysis,
    clampProbabilityToGate,
} from '../../utils/analysisUtils';
import { flagBannedVocabulary } from '../../services/providers/debateScience';
import { parseKeptAnalyst } from '../../utils/keptAnalyst';
import { buildRecommendationContract } from '../../utils/recommendationContract';
import { buildRunContractStages } from '../../utils/runContract';
import {
    buildVerdictEvidencePack,
    deriveSetupQueryFromPrompt,
} from '../../services/learning/EvidencePackService';
import { annotateVerdictCitations } from '../../services/learning/MemoryInjectionService';
import { maybeQueueVerdictSkillDraft } from '../../utils/verdictSkillDraft';
import { appendSessionUsage } from '../../utils/sessionUsage';
import { withDetectedTradeType } from '../../services/analysis/ScalpDetectionService';
import { peekTruncations } from '../../utils/finishReason';
import { estimateCostUsd } from '../../utils/tokenUsage';
import { notifyAnalysisComplete } from '../../services/infrastructure/CompletionNotifications';
import { VetoLedgerService } from '../../services/ui/VetoLedgerService';
import {
    ANALYST_ROLE_DEFINITIONS,
} from '../../services/ui/AnalystLensService';
import { GENERAL_DIMENSION_TAGS } from '../../services/agents/seatPersonas';
import { AnalystRole } from '../../types/enums';
import { shouldSkillHoldout } from '../../utils/skillHoldout';

import * as ensembleService from '../../services/providers/ensembleService';
import type { RealDebateAnalyst } from '../../services/providers/ensembleService';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PromptLane = 'live' | 'control';
export type TradingStyleEffective = Exclude<TradingStyle, 'auto'>;

export type VetoRecordParams = Parameters<typeof VetoLedgerService.recordVeto>[0];

export interface VerdictFinalizerInput {
    /** The user's prompt message — its id is the runId on the runStats ledger
     *  and the join key for citation/injection records. */
    userMessage: Message;

    /** The existing (placeholder) AI message row the verdict replaces. The
     *  hook finds it by `debateMessageId` and passes it in so the finalizer
     *  can spread it (preserves any fields the cluster doesn't overwrite). */
    existingMessage: Message;

    /** The moderator's full streamed text (includes the final verdict). */
    fullResponseText: string;

    /** Refs captured during the debate. All are read-only — the cluster
     *  never mutates them (the cluster owns `processedAnalysis` and the
     *  message-updater return value, never the refs). */
    debateTurnsRef: { current: DebateTurn[] };
    debateRunLogRef: { current: DebateRunEvent[] };
    reasoningMapRef: { current: Record<string, string> };
    toolActionsRef: { current: ToolAction[] };
    automationMessagesRef: { current: Message[] };

    /** Cancellation + race guards. */
    isCurrentRequest: () => boolean;
    abortSignal: AbortSignal;

    /** The active user's username (skill drafts, citations). */
    getActiveUsername: () => string;

    /** The hook's per-run configuration (mirror of `handleSendMessage`'s locals). */
    effectiveInput: string;
    freshHybridData: HybridDataPacket | null;
    moderatorContextBundle: string;
    effectiveTradingStyle: TradingStyleEffective;
    finalSymbol: string | null | undefined;
    capturedGateResult: { confidenceCap?: number } | null | undefined;
    /** Ceiling implied by a fired AVOID skill predicate (0-1). Taken as a hard
     *  minimum alongside the gate's own cap, because `confidenceCap` is built
     *  by SUBTRACTING penalties from a base and cannot express "no higher
     *  than 40%". Undefined leaves verdict grading exactly as it was. */
    predicateCeiling?: number;

    /** Roster + assignments. */
    teamSeatFor: (configId: string, model: string) => AgentTeamSeat | undefined;
    runGroupMemberPersonas: AgentTeamSeat[];

    /** Notebook retrieval / journal. */
    memoryQuery: MemoryRetrievalQuery | undefined;
    memoryRetrieved: Array<{ path: string; kind: string }> | undefined;
    memoryAsOfMs: number | undefined;
    loggedTrades: LoggedTrade[];

    /** Per-provider timing / token ledgers. */
    analystTimings: Map<string, { durationMs: number; charsOut: number }>;
    tokenByProvider: Map<string, TokenUsage>;
    providerConfigs: ProviderConfig[];

    /** Monte Carlo / backtest summaries. */
    liveBtResult: LiveBacktestResult | undefined;
    perAIMC: LabeledMonteCarloResult[];

    /** Message identity + closure-supplied maps. */
    debateMessageId: string;
    thoughtMap: Record<string, string>;

    /** Optional veto ledger params (set by the hook when a skill veto applies). */
    vetoRecordParams: VetoRecordParams | null;

    /** Analyst settlement (consensus panel). */
    allFulfilledAnalysts: RealDebateAnalyst[];

    /** Run-scoped config (closure values from handleSendMessage). */
    runAccuracyMode: boolean;
    runLensConfig: AnalystLensConfig;
    runModeratorConfig: ProviderConfig;
    runModeratorModel: string;
    runEnsembleEnabled: boolean;
    runStartedAt: number;

    /** Settings (closure values from useAnalysisPipelineParams). */
    isHybridIntelligenceEnabled: boolean;
    lensConfig: AnalystLensConfig;
    isPlaybookEnabledInPureAI: boolean;
    isFamiliesEnabledInPureAI: boolean;
    isMemoryEnabledInPureAI: boolean;
    customEnsemblePrompt: string | null | undefined;
    promptLane: PromptLane;
    isAutomationRun: boolean;
    options?: {
        automation?: {
            automationId: string;
            conversation: unknown;
            overrides?: unknown;
            onMessage?: (run: { userMessage: Message; aiMessage: Message }) => void;
            onError?: (error: string) => void;
        };
    };

    /** The hook's closure — performs gate caps, notebook skill application,
     *  R:R recomputation, ticket sizing, etc. Captures the gate result,
     *  update options, hybrid data, calibration, harness settings, the live
     *  Monte Carlo + backtest hooks, etc. (See processAnalysisResult.) */
    processNewAnalysis: (analysis: TradeAnalysis) => TradeAnalysis;

    /** Applies the state update. The cluster calls this AFTER it builds the
     *  new message so the automation dispatch (which looks up the message
     *  from `automationMessagesRef.current`) can find the settled row.
     *  The hook wires this to its `updateRequestMessages` helper so automation
     *  runs write to the private ref and interactive runs write to
     *  `updateMessages`. */
    applyUpdate: (updater: (prev: Message[]) => Message[]) => void;
}

export interface VerdictFinalizerResult {
    /** The new message row — the hook applies this via updateMessages. */
    updatedMessage: Message;
    /** The processed TradeAnalysis (after processNewAnalysis, gate cap, hybrid
     *  snapshot, consensus + contract). The hook may use this for downstream
     *  slices (e.g. the thinking-records tail). */
    processedAnalysis: TradeAnalysis;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Stable fingerprint of the effective prompt layers for a run — lets prompt
 * edits be measured against outcomes. Inlined here so the finalizer is
 * self-contained (the hook has its own private copy that this duplicates).
 */
const computePromptVersion = (parts: Record<string, unknown>): string => {
    let hash = 5381;
    const payload = JSON.stringify(parts) || '';
    for (let i = 0; i < payload.length; i++) {
        hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
    }
    return `v${hash.toString(36)}`;
};

// ─── Main entry ────────────────────────────────────────────────────────────

export async function finalizeVerdict(input: VerdictFinalizerInput): Promise<VerdictFinalizerResult> {
    const {
        userMessage,
        fullResponseText,
        debateTurnsRef,
        debateRunLogRef,
        reasoningMapRef,
        toolActionsRef,
        automationMessagesRef,
        isCurrentRequest,
        abortSignal: currentAbortControllerSignal,
        effectiveInput,
        freshHybridData,
        moderatorContextBundle,
        effectiveTradingStyle,
        finalSymbol,
        capturedGateResult,
        teamSeatFor,
        runGroupMemberPersonas,
        memoryQuery,
        memoryRetrieved,
        memoryAsOfMs,
        loggedTrades,
        analystTimings,
        tokenByProvider,
        providerConfigs,
        perAIMC,
        debateMessageId,
        thoughtMap,
        vetoRecordParams,
        allFulfilledAnalysts,
        runAccuracyMode,
        runLensConfig,
        runModeratorConfig,
        runModeratorModel,
        runEnsembleEnabled,
        runStartedAt,
        isHybridIntelligenceEnabled,
        lensConfig,
        isPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI,
        customEnsemblePrompt,
        promptLane,
        isAutomationRun,
        options,
        processNewAnalysis,
    } = input;

    // === Markdown → JSON parse (with prose rescue) ===
    let finalAnalysis: TradeAnalysis;
    try {
        // The moderator's final output is MARKDOWN: verdict
        // prose + a labeled **FINAL TRADE PLAN** block (no
        // JSON anywhere). Parse the plan deterministically;
        // the parser itself falls back to free-form prose.
        const moderatorErrorMatch = fullResponseText.match(/<MODERATOR_ERROR>([\s\S]*?)<\/MODERATOR_ERROR>/);
        const debateEnd = fullResponseText.match(/<\/?DEBATE_END>/i);
        // Prefer the last moderator turn (the verdict). Concatenating
        // every moderator round glues clarification questions onto
        // the Trading signal card.
        const lastModeratorTurn = [...debateTurnsRef.current]
            .reverse()
            .find(t => t.speaker === 'Moderator')?.text ?? '';
        const candidate = debateEnd && debateEnd.index !== undefined
            ? fullResponseText.slice(debateEnd.index + debateEnd[0].length)
            : (lastModeratorTurn || fullResponseText);
        try {
            const plan = parseMarkdownTradePlan(candidate);
            if (!plan || !isBindingMarkdownPlan(plan)) {
                throw new Error('No markdown trade plan found in the moderator response');
            }
            finalAnalysis = sanitizeTradeAnalysis({
                ...tradePlanToAnalysis(plan),
                // The card renders the moderator's own markdown
                // verdict + plan — the same markdown format as
                // the workspace, never a JSON schema.
                strategy: stripPlanTags(candidate).slice(0, 3000),
            });
            // Vocabulary flag (Batch 4 f): urgency-framed
            // wording in the rendered verdict is a measured
            // tell (urgency-framed calls averaged −0.42R in
            // the signal study) — surface it, don't rewrite it.
            const bannedHits = flagBannedVocabulary(candidate);
            if (bannedHits.length > 0) {
                finalAnalysis.validationWarnings = [
                    ...(finalAnalysis.validationWarnings ?? []),
                    `URGENCY WORDING: ${bannedHits.join(', ')} — urgency-framed confidence is historically inflated; discount accordingly.`,
                ];
            }
        } catch (e) {
            // Only surface the moderator error marker when no
            // plan could be recovered at all.
            if (moderatorErrorMatch) {
                throw new Error(`Moderator Error: ${moderatorErrorMatch[1]}`, { cause: e });
            }
            throw e;
        }
    } catch (e) {
        console.error("Failed to parse final debate JSON:", e);
        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
        const isModeratorError = errorMessage.includes('Moderator Error');
        // Prose rescue: the moderator's markdown verdict often
        // carries the whole plan in WORDS even when the JSON
        // failed — parse the labeled fields so the card shows a
        // REAL signal (coin name, direction, entry/SL/TP,
        // probability) in the same markdown format, never a
        // dead "Unknown Asset · Neutral" card. The verdict
        // prose itself becomes the card's strategy text (tags
        // stripped — the JSON schema never renders).
        const lastModeratorTurn = [...debateTurnsRef.current]
            .reverse()
            .find(t => t.speaker === 'Moderator')?.text ?? '';
        const rescueSource = lastModeratorTurn || fullResponseText;
        const prosePlan = parseProseTradePlan(rescueSource);
        const rescuePlan = prosePlan ? { ...prosePlan } : null;
        // A ceiling hit inside the verdict window means the plan text itself
        // arrived incomplete — a different failure from a moderator that simply
        // never wrote a parseable plan, and one the operator can fix by raising
        // maxTokens. Read-only peek: the window stays open for the retry.
        const verdictTruncation = peekTruncations();
        const canRescue = Boolean(
            rescuePlan?.direction
            && rescuePlan.entry
            && rescuePlan.stopLoss
            && rescuePlan.takeProfit
            && !((rescuePlan.direction === 'Long' || rescuePlan.direction === 'Short') && /avoid/i.test(rescuePlan.confidence || '')),
        );
        const fallbackStrategy = isModeratorError
            ? `Connection Error: ${errorMessage}. Please try again.`
            : verdictTruncation.truncated
                ? `Plan truncated — the moderator hit its output-token ceiling on ${verdictTruncation.truncatedCalls} verdict call(s) before finishing the trade plan. Raise the verdict token budget or shorten the transcript.`
                : 'Plan incomplete — the moderator markdown could not be parsed. Open the Floor for the debate.';
        finalAnalysis = sanitizeTradeAnalysis({
            coinName: canRescue ? (prosePlan?.coinName ?? finalSymbol ?? undefined) : (finalSymbol ?? undefined),
            direction: canRescue ? (prosePlan?.direction ?? 'Neutral') : 'Neutral',
            confidence: canRescue ? (prosePlan?.confidence ?? 'Low') : 'Avoid',
            // A verdict nobody could parse is a measurement failure,
            // not a neutral opinion — quarantine it (never graded,
            // flagged in the UI and journal).
            verdictReview: canRescue ? undefined : {
                reason: verdictTruncation.truncated ? 'truncated-plan' as const : 'incomplete-plan' as const,
            },
            probability: canRescue ? prosePlan?.probability : undefined,
            entryPoints: canRescue && prosePlan?.entry ? [{ price: prosePlan.entry }] : undefined,
            stopLoss: canRescue ? prosePlan?.stopLoss : undefined,
            takeProfit: canRescue && prosePlan?.takeProfit ? [{ price: prosePlan.takeProfit }] : undefined,
            strategy: canRescue
                ? (stripPlanTags(rescueSource).slice(0, 3000) || fallbackStrategy)
                : fallbackStrategy,
        });
    }

    finalAnalysis = sanitizeTradeAnalysis(finalAnalysis);

    // === ACCURACY MODE VERIFICATION PASS ===
    // Standard mode has the clarification loop; accuracy mode is a
    // single autoplayed stream. This second focused moderator call
    // reviews the debate + plan and may adjust levels/confidence.
    // Fail-safe: any error keeps the moderator's plan untouched.
    let accuracyVerificationNote = '';
    if (runAccuracyMode && finalAnalysis.direction && finalAnalysis.direction !== 'Neutral') {
        try {
            const verification = await ensembleService.verifyAccuracyPlan(
                runModeratorConfig,
                runModeratorModel,
                fullResponseText,
                JSON.stringify(finalAnalysis),
                currentAbortControllerSignal,
                // Chart context + user strategies so the
                // verification pass is not blind.
                moderatorContextBundle,
                // Journal access so the verifier's recall
                // desk tool can check claims against history.
                loggedTrades,
            );
            if (verification.verdict === 'adjusted' && verification.planJson) {
                const adjustedPlan = parseMarkdownTradePlan(verification.planJson);
                if (adjustedPlan && adjustedPlan.direction) {
                    const adjusted = sanitizeTradeAnalysis(tradePlanToAnalysis(adjustedPlan));
                    if (adjusted.direction !== 'Neutral') {
                        finalAnalysis = adjusted;
                        accuracyVerificationNote = verification.note;
                    }
                }
            } else {
                accuracyVerificationNote = verification.note || 'Plan verified by the accuracy pass.';
            }
        } catch (verifyError) {
            const err = verifyError as { name?: string; code?: string; message?: string };
            // A user cancel must stay a cancel — it was being
            // swallowed here, so the run continued and emitted
            // the card after the user pressed stop.
            // A TIMEOUT is NOT a cancel: the debate + plan already
            // completed, so a slow verification pass must never
            // abort the finished run — keep the original plan
            // (mirrors verifyAccuracyPlan's own fail-safe).
            if ((err?.name === 'AbortError' || err?.code === 'ABORT_ERR') || !isCurrentRequest()) {
                throw verifyError;
            }
            console.warn('[AccuracyVerification] Skipped (kept original plan):', err?.message || verifyError);
        }
    }

    // === PROGRAMMATIC GATE CAP ENFORCEMENT ===
    // Runs AFTER processNewAnalysis so the R:R-based clamp
    // tiers use the RECOMPUTED rrRatio — clamping before the
    // metrics pass meant a moderator-emitted (or wrong)
    // rrRatio disabled the 54%/69% grade clamps entirely.

    // Compute OUTSIDE the state updater: updaters may re-run in
    // StrictMode (duplicate notifications) and must stay pure
    // (processNewAnalysis performs synchronous setState calls).
    if (currentAbortControllerSignal.aborted || !isCurrentRequest()) {
        throw new DOMException('Analysis run cancelled', 'AbortError');
    }
    // The journal's ◆ scalp / ◇ swing filter reads a field nothing ever wrote,
    // so it could only ever land on "nothing is classified". Labelled here,
    // AFTER processNewAnalysis recomputes the SL percentage the detector reads.
    // Label-only on purpose: see `withDetectedTradeType` for why the
    // validity-filling sibling must not run over every verdict.
    const processedAnalysis = withDetectedTradeType(processNewAnalysis(finalAnalysis));
    const liveBtResult = input.liveBtResult;

    const predicateCeiling = typeof input.predicateCeiling === 'number' && Number.isFinite(input.predicateCeiling)
        ? input.predicateCeiling
        : undefined;
    if (processedAnalysis && (capturedGateResult || predicateCeiling !== undefined) && processedAnalysis.probability != null) {
        // Gate cap and predicate ceiling both bind; the tighter one wins. With
        // no predicate this is byte-identical to the previous `?? 1.0` form, so
        // the R:R grade clamps keep firing exactly as before.
        const gateCap = Math.min(capturedGateResult?.confidenceCap ?? 1.0, predicateCeiling ?? 1.0);
        const clampResult = clampProbabilityToGate(
            processedAnalysis.probability,
            gateCap,
            processedAnalysis.rrRatio,
        );
        if (clampResult.wasClamped) {
            console.warn(`[Gate Enforcement] Clamped probability ${processedAnalysis.probability}% → ${clampResult.probability}% (${clampResult.reason})`);
            processedAnalysis.probability = clampResult.probability;
            // Also downgrade the confidence string if probability was clamped below the threshold
            if (clampResult.probability < 70 && processedAnalysis.confidence === 'High') {
                processedAnalysis.confidence = 'Medium';
            } else if (clampResult.probability < 55 && processedAnalysis.confidence === 'Medium') {
                processedAnalysis.confidence = 'Low';
            }
            // Record the clamping in validation warnings
            if (!processedAnalysis.validationWarnings) {
                processedAnalysis.validationWarnings = [];
            }
            processedAnalysis.validationWarnings.push(`Gate enforcement: ${clampResult.reason}`);
        }
    }

    if (freshHybridData && processedAnalysis) {
        // Inject market snapshot (Algo Mode & Regeneration).
        processedAnalysis.marketSnapshot = freshHybridData;
    }

    // Consensus explainability: per-analyst structured calls +
    // pre-debate divergence, attached to the verdict so the
    // result card can audit the call against its own inputs.
    if (processedAnalysis) {
        const consensus = ensembleService.buildAnalystConsensus(allFulfilledAnalysts);
        if (consensus) {
            processedAnalysis.analystConsensus = ensembleService.attachVerdictCitations(consensus, processedAnalysis);
            Object.assign(processedAnalysis, ensembleService.enforceCitedVerdict(
                processedAnalysis,
                processedAnalysis.analystConsensus,
                parseKeptAnalyst(fullResponseText),
            ));
        }
        processedAnalysis.recommendationContract = buildRecommendationContract(processedAnalysis);
        // Citation stamp: annotate the newest verdict-stage
        // injection record with which skills the FINAL verdict
        // actually cited. Without this call the `cited` field is
        // never written, skillAdherenceForRun can only ever return
        // 'injected-unknown', and the OVERRIDDEN evidence state
        // (injected-but-ignored → amendment counter, not stat rot)
        // is dead. Fire-and-forget — telemetry must never break
        // the verdict commit.
        void annotateVerdictCitations(input.getActiveUsername(), fullResponseText, userMessage.id)
            .catch(() => { /* citation telemetry is best-effort */ });
    }

    // Veto falsification ledger — stamp the deferred
    // veto only if the final verdict actually stayed blocked. An
    // actionable Long/Short here means the floor defied the veto
    // end-to-end, so nothing was blocked and the trade earns
    // normal evidence attribution instead of a phantom entry.
    if (vetoRecordParams
        && processedAnalysis.direction !== 'Long'
        && processedAnalysis.direction !== 'Short') {
        void VetoLedgerService.recordVeto(vetoRecordParams)
            .catch(() => { /* ledger must never break the debate */ });
    }

    // === Final message builder ===
    // The hook applies this via updateMessages(prev => ...) — see the
    // hook's caller. Built here so the cluster owns the full row shape
    // (runStats included) and the hook only does the state update.
    const existingMessage = input.existingMessage;

    const updatedMessage: Message = {
        ...existingMessage,
        isDebating: false,
        text: accuracyVerificationNote
            ? `The ensemble has concluded its debate.\n\n${accuracyVerificationNote}`
            : `The ensemble has concluded its debate.`,
        analysis: processedAnalysis,
        outcome: TradeOutcome.PENDING,
        // The authoritative verdict replaces the provisional
        // card that streamed while the moderator wrote.
        provisionalAnalysis: undefined,
        provisionalPlanFields: undefined,
        // Tool chips are live-only — the settled card keeps
        // the permanent run log instead.
        liveToolEvents: undefined,
        debateTurns: existingMessage.debateTurns,
        thoughtProcesses: { ...thoughtMap },
        reasoningProcesses: { ...reasoningMapRef.current },
        activeDebateSpeakers: {},
        // Any pending replacement offer is void once the
        // debate concludes (the banner must never persist
        // on the finished card).
        replacementOffer: undefined,
        // Multi-Timeframe Confluence from Hybrid Intelligence
        confluenceData: freshHybridData?.confluence ? {
            score: freshHybridData.confluence.score,
            direction: freshHybridData.confluence.direction,
            strength: freshHybridData.confluence.strength,
            alignedSignals: freshHybridData.confluence.alignment,
            conflictingSignals: freshHybridData.confluence.conflicts,
            timeframeCount: 4, // 5m, 15m, 1h, 4h
        } : undefined,
        isLensMode: runLensConfig?.enabled ?? lensConfig?.enabled ?? false,
        // Always set tradingStyle regardless of Lens mode
        tradingStyle: effectiveTradingStyle,
        debateRunLog: [...debateRunLogRef.current],
        // persisted model side-effects for this run.
        toolActions: toolActionsRef.current.length > 0 ? [...toolActionsRef.current] : undefined,
        debateCheckpoint: undefined,
        memoryRetrieved,
        // Audit surfaces: the finished
        // contract (frozen from the final log) + what the
        // arbiter's evidence pack contained.
        runContract: buildRunContractStages(debateRunLogRef.current, false),
        evidencePack: (() => {
            try {
                return buildVerdictEvidencePack(
                    memoryQuery ?? deriveSetupQueryFromPrompt(effectiveInput),
                    loggedTrades,
                ).ui;
            } catch { return undefined; }
        })(),
    };

    // Per-run execution summary (compare mode + diagnostics).
    updatedMessage.runStats = {
        // The run's identity — the user message that
        // triggered it, same id the injection records carry.
        // Trades copy it at log time so evidence attribution
        // joins exactly instead than by time window.
        runId: userMessage.id,
        startedAt: new Date(runStartedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - runStartedAt,
        promptVersion: computePromptVersion({
            accuracy: runAccuracyMode,
            ensemble: runEnsembleEnabled,
            hybrid: isHybridIntelligenceEnabled,
            lens: Boolean(runLensConfig?.enabled ?? lensConfig?.enabled),
            playbook: isPlaybookEnabledInPureAI,
            families: isFamiliesEnabledInPureAI,
            memory: isMemoryEnabledInPureAI,
            customEnsemble: Boolean(customEnsemblePrompt),
            promptLane,
            // Protocol lane attribution.
            protocol: ensembleService.getLastDebateProtocol(),
        }),
        promptLane,
        // Protocol lane attribution — on
        // runStats itself so the signal card can chip it.
        protocol: ensembleService.getLastDebateProtocol(),
        // ε-holdout classification for THIS run —
        // the same seeded decision the retrieval layer made
        // when it withheld skill injection.
        skillHoldout: shouldSkillHoldout(userMessage.id),
        // Point-in-time cutoff the notebook replayed to
        // (recorded posture; absent on live runs).
        asOfMs: memoryAsOfMs,
        gateCap: capturedGateResult?.confidenceCap,
        mcWinRate: perAIMC[0]?.result?.winRate,
        mcEV: perAIMC[0]?.result?.expectedValue,
        analystCount: allFulfilledAnalysts.length,
        btMatches: liveBtResult?.totalMatches,
        btWinRate: liveBtResult?.winRate,
        btEV: liveBtResult?.expectedValue,
        // Cost & latency ledger — the analysts that ACTUALLY
        // delivered (initial roster + mid-debate replacements),
        // with their model, wall time, and output size.
        analysts: allFulfilledAnalysts.map(a => {
            const timing = analystTimings.get(a.provider.thoughtsKey);
            const tokens = tokenByProvider.get(a.provider.config.id);
            // Seat identity for the floor/transcript tags:
            // the team role (or the unroled seat's focus
            // dimension) the harness actually ran with.
            const seat = teamSeatFor(a.provider.config.id, a.provider.model);
            const seatRole = !runLensConfig.enabled && runGroupMemberPersonas.length > 0 && seat?.role && seat.role !== AnalystRole.UNASSIGNED
                ? ANALYST_ROLE_DEFINITIONS[seat.role]?.shortName
                : undefined;
            const seatIndex = allFulfilledAnalysts.indexOf(a);
            const seatFocus = !runLensConfig.enabled && runGroupMemberPersonas.length > 0 && !seatRole
                ? GENERAL_DIMENSION_TAGS[seatIndex % GENERAL_DIMENSION_TAGS.length]
                : undefined;
            return {
                providerId: a.provider.config.id,
                displayName: a.provider.name,
                modelId: a.provider.model,
                ...(seatRole ? { seatRole } : {}),
                ...(seatFocus ? { seatFocus } : {}),
                ...(timing ? { durationMs: timing.durationMs, charsOut: timing.charsOut } : {}),
                ...(tokens ? { promptTokens: tokens.promptTokens, completionTokens: tokens.completionTokens } : {}),
            };
        }),
        promptTokens: [...tokenByProvider.values()].reduce((sum, u) => sum + u.promptTokens, 0) || undefined,
        completionTokens: [...tokenByProvider.values()].reduce((sum, u) => sum + u.completionTokens, 0) || undefined,
        costUsd: (() => {
            let total = 0;
            let any = false;
            tokenByProvider.forEach((usage, providerId) => {
                const cfg = providerConfigs.find(p => p.id === providerId);
                const cost = estimateCostUsd(usage, cfg);
                if (cost !== undefined) {
                    any = true;
                    total += cost;
                }
            });
            return any ? total : undefined;
        })(),
    };

    void appendSessionUsage({
        at: updatedMessage.runStats.finishedAt,
        durationMs: updatedMessage.runStats.durationMs,
        promptTokens: updatedMessage.runStats.promptTokens ?? 0,
        completionTokens: updatedMessage.runStats.completionTokens ?? 0,
        tokensEst: updatedMessage.runStats.analysts?.reduce((sum, a) => sum + Math.round((a.charsOut ?? 0) / 4), 0) ?? 0,
        analystCount: updatedMessage.runStats.analystCount ?? 0,
        costUsd: updatedMessage.runStats.costUsd,
        coin: processedAnalysis?.coinName,
        direction: processedAnalysis?.direction,
        models: updatedMessage.runStats.analysts?.map(a => ({
            modelId: a.modelId,
            tokens: (a.promptTokens ?? 0) + (a.completionTokens ?? 0) || Math.round((a.charsOut ?? 0) / 4),
        })),
    });

    // Apply the message update. The hook's applyUpdate routes through
    // updateRequestMessages — automation runs write to the private ref so
    // the dispatch below can find the message; interactive runs write to
    // updateMessages (which propagates to renderers).
    input.applyUpdate(prev => prev.map(m => m.id === debateMessageId
        ? { ...m, ...updatedMessage, debateTurns: m.debateTurns }
        : m));

    // === Side-effects: notification, highlight, skill draft, automation ===
    // Background completion notification (native, backgrounded only) —
    // outside the updater so StrictMode double-invocation can't
    // schedule duplicate notifications.
    void notifyAnalysisComplete(
        'Analysis complete',
        `${processedAnalysis?.direction ?? finalAnalysis.direction} ${finalAnalysis.coinName || ''} — ${finalAnalysis.confidence} confidence`,
    );

    // Verdict → skill draft: when the moderator cites a pattern
    // the notebook does not know yet, queue a draft for the
    // approval inbox (deterministic — no LLM call). Interactive
    // runs only; automation runs must not spam drafts.
    if (!isAutomationRun && runEnsembleEnabled) {
        try {
            maybeQueueVerdictSkillDraft(
                debateMessageId,
                processedAnalysis ?? finalAnalysis,
                input.getActiveUsername(),
            );
        } catch (draftError) {
            console.warn('[SkillDraft] Verdict draft queue failed (non-fatal):', draftError);
        }
    }

    // Automation run: deliver the completed card to the caller
    // (the main conversation was never touched).
    if (isAutomationRun) {
        const finalAiMessage = automationMessagesRef.current.find(m => m.id === debateMessageId);
        if (finalAiMessage) {
            options?.automation?.onMessage?.({ userMessage, aiMessage: finalAiMessage });
        } else {
            options?.automation?.onError?.('Automation run produced no result message.');
        }
    }

    return { updatedMessage, processedAnalysis };
}
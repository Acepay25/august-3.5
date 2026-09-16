import type { AccuracySubMode, ConfidenceCalibration, LoggedTrade, TradeAnalysis } from '../../types';
import type { HybridDataPacket } from './HybridIntelligenceService';
import type { MarketRegime } from '../analysis/TechnicalAnalysisService';
import type { LiveBacktestResult } from '../backtesting/LiveBacktestService';
import { runValidationGate, type TradeValidationOutput } from '../validation/TradeValidationGate';
import type { GateOutput } from '../validation/GateKeeperService';
import { applyNotebookSkillsToAnalysis } from '../learning/SkillMemoryService';
import { buildRecommendationContract } from '../../utils/recommendationContract';
import { buildLevelCitations } from '../../utils/levelEvidence';
import { enforceUngroundedLevels } from '../../utils/ungroundedGate';
import { rescueSoftAvoid } from '../../utils/avoidReason';
import { applyHybridChartDrift } from '../../utils/hybridChartDrift';
import { computeContractSize, gradeRiskTierWithAdjustment, kellyAdvisory, EQUITY_NOT_SET } from '../../utils/ticketSize';
import { planAmendmentDiff } from '../../utils/trustSurface';
import { assessSession } from '../validation/SessionGuardService';
import { getHarnessSettings, getSessionGuardConfig, type HarnessSettings } from '../../utils/harnessSettings';
import type { SessionGuardConfig } from '../validation/SessionGuardService';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis, parsePrice } from '../../utils/analysisUtils';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';

// ─── Dev-only logging ─────────────────────────────────────────────────────
const devLog = (...args: unknown[]): void => { if ((import.meta as any).env?.DEV) console.log(...args); };

export interface AnalysisUpdateContext {
    isUpdate?: boolean;
    updateInterval?: string;
    priorAnalysis?: TradeAnalysis;
    priorMessageId?: string;
}

interface ValidationAdjustmentState {
    directionBefore: string;
    adjustedConfidence?: TradeValidationOutput['adjustedConfidence'];
}

export interface AnalysisResultProcessorContext {
    capturedGateResult: GateOutput | null;
    update?: AnalysisUpdateContext;
    freshHybridData: HybridDataPacket | null;
    currentHybridData: HybridDataPacket | null;
    bayesianConfidenceCap?: TradeAnalysis['confidence'];
    loggedTrades: LoggedTrade[];
    sessionLoggedTrades: LoggedTrade[];
    getCalibration: () => ConfidenceCalibration | undefined;
    getActiveUsername: () => string;
    getHarnessSettings: () => HarnessSettings;
    getSessionGuardConfig: () => SessionGuardConfig;
    activeLeverage?: number;
    isAccuracyModeEnabled: boolean;
    accuracySubMode: AccuracySubMode;
    isHybridIntelligenceEnabled: boolean;
    isAutomationRun: boolean;
    onMonteCarlo: (analysis: TradeAnalysis, hybridData: HybridDataPacket) => void;
    onBacktest: (analysis: TradeAnalysis, tradeHistory: LoggedTrade[], regime?: MarketRegime) => Pick<LiveBacktestResult, 'totalMatches' | 'winRate' | 'expectedValue'> | undefined;
    onSetCurrentEntryTimingScore: (value: NonNullable<TradeAnalysis['entryTimingScore']>) => void;
    onSetCurrentSuggestedEntryPrice: (price: number) => void;
    onSetCurrentSlOptimization: (value: unknown) => void;
    onWarning: (title: string, message?: string) => void;
}

const applyUpdateMetadata = (
    analysis: TradeAnalysis,
    update: AnalysisUpdateContext | undefined,
): void => {
    if (!update?.isUpdate) return;

    analysis.isUpdate = true;
    if (update.updateInterval) {
        analysis.updateInterval = update.updateInterval;
    }
    analysis.planVersion = (update.priorAnalysis?.planVersion ?? 1) + 1;
    if (update.priorMessageId) {
        analysis.amendsMessageId = update.priorMessageId;
    }
    if (update.priorAnalysis) {
        const diff = planAmendmentDiff(update.priorAnalysis, analysis);
        if (diff) analysis.planDiff = diff;
    }
};

const applyGateResult = (
    analysis: TradeAnalysis,
    capturedGateResult: GateOutput | null,
): void => {
    if (!capturedGateResult) return;

    analysis.gateResult = {
        passed: capturedGateResult.pass,
        confidenceCap: capturedGateResult.confidenceCap,
        penalties: capturedGateResult.confidencePenalties,
        familyBias: capturedGateResult.familyBias,
        suggestedDirection: capturedGateResult.suggestedDirection,
        warnings: capturedGateResult.warnings.slice(0, 3),
        insights: capturedGateResult.insights.slice(0, 2)
    };
    devLog(`[GateKeeper] Result stored in analysis: cap=${(capturedGateResult.confidenceCap * 100).toFixed(0)}%`);

    const vetoNotes: string[] = [];
    if (capturedGateResult.pass === false) {
        vetoNotes.push('GATE VETO: insufficient data — this signal must not be traded on its own.');
    }
    const verdictDir = analysis.direction?.toLowerCase();
    const gateDir = capturedGateResult.suggestedDirection?.toLowerCase();
    if (gateDir && verdictDir && gateDir !== verdictDir && (capturedGateResult.confidencePenalties?.patternMemory ?? 0) > 0.15) {
        vetoNotes.push(`PATTERN-MEMORY CONTRADICTION: gate favors ${capturedGateResult.suggestedDirection}, verdict is ${analysis.direction}.`);
        analysis.originalConfidence = analysis.originalConfidence ?? analysis.confidence;
        if (analysis.confidence === 'High') analysis.confidence = 'Medium';
    }
    const hasSL = parsePrice(analysis.stopLoss || '') > 0;
    const hasTP = analysis.takeProfit?.[0]?.price != null;
    if (!hasSL || !hasTP) {
        vetoNotes.push('INCOMPLETE PLAN: missing stop loss or take profit — not tradeable as-is.');
        if (analysis.confidence === 'High') {
            analysis.originalConfidence = analysis.originalConfidence ?? analysis.confidence;
            analysis.confidence = 'Medium';
        }
    }
    if (vetoNotes.length > 0) {
        if (!analysis.validationWarnings) analysis.validationWarnings = [];
        analysis.validationWarnings.push(...vetoNotes);
        analysis.riskVeto = vetoNotes.join(' ');
        devLog(`[RiskVeto] ${vetoNotes.join(' | ')}`);
    }
};

const applyValidation = (
    analysis: TradeAnalysis,
    context: AnalysisResultProcessorContext,
    validationState: ValidationAdjustmentState,
): void => {
    let validationAdjustedConfidence: TradeValidationOutput['adjustedConfidence'];
    try {
        const validationResult = runValidationGate({
            analysis,
            hybridData: context.freshHybridData,
            calibration: context.getCalibration(),
            tradeHistory: context.loggedTrades
        });

        if (validationResult.confidenceWasAdjusted) {
            validationState.adjustedConfidence = validationResult.adjustedConfidence;
            validationAdjustedConfidence = validationResult.adjustedConfidence;
            analysis.originalConfidence = validationResult.originalConfidence;
            analysis.confidence = validationResult.adjustedConfidence;
            if (analysis.confidence === 'Avoid') {
                analysis.direction = 'Neutral';
            }
            devLog(`[ValidationGate] Confidence adjusted: ${validationResult.originalConfidence} → ${validationResult.adjustedConfidence}`);
        }

        if (context.bayesianConfidenceCap) {
            const LEVEL_ORDER: Record<string, number> = { avoid: -1, low: 0, medium: 1, high: 2 };
            const cap = LEVEL_ORDER[context.bayesianConfidenceCap.toLowerCase()];
            const current = LEVEL_ORDER[analysis.confidence?.toLowerCase() || 'high'];
            if (cap !== undefined && current !== undefined && current > cap) {
                analysis.originalConfidence = analysis.originalConfidence ?? analysis.confidence;
                analysis.confidence = context.bayesianConfidenceCap;
                devLog(`[Bayesian] Confidence capped: ${current} → ${context.bayesianConfidenceCap}`);
            }
        }

        if (validationResult.warnings.length > 0 || validationResult.errors.length > 0) {
            analysis.validationWarnings = [
                ...validationResult.warnings,
                ...validationResult.errors.map(error => ` HARD VALIDATION: ${error.trim()}`),
            ];
            devLog(`[ValidationGate] ${validationResult.warnings.length} warnings added to analysis`);
        }

        if (validationResult.devilsAdvocate) {
            analysis.devilsAdvocate = {
                bearCaseReasons: validationResult.devilsAdvocate.bearCaseReasons,
                failureScenarios: validationResult.devilsAdvocate.tradeFailureScenarios,
                crowdedTradeWarning: validationResult.crowdedTradeWarning,
                riskScore: validationResult.devilsAdvocate.overallRiskScore
            };
        }

        if (validationResult.entryTiming) {
            analysis.entryTimingScore = {
                score: validationResult.entryTiming.score,
                timingQuality: validationResult.entryTiming.timing,
                suggestedEntry: validationResult.entryTiming.suggestedEntry
            };
            devLog(`[ValidationGate] Entry Timing Score: ${validationResult.entryTiming.score}/100 (${validationResult.entryTiming.timing})`);

            context.onSetCurrentEntryTimingScore({
                score: validationResult.entryTiming.score,
                timingQuality: validationResult.entryTiming.timing,
                suggestedEntry: validationResult.entryTiming.suggestedEntry
            });

            if (validationResult.entryTiming.suggestedEntry?.price) {
                context.onSetCurrentSuggestedEntryPrice(validationResult.entryTiming.suggestedEntry.price);
                devLog(`[ValidationGate] Suggested Entry Price: $${validationResult.entryTiming.suggestedEntry.price}`);
            }
        }

        if (validationResult.slOptimization) {
            context.onSetCurrentSlOptimization(validationResult.slOptimization);
            devLog(`[ValidationGate] SL Optimization: Recommended multiplier ${(validationResult.slOptimization.recommendedMultiplier * 100).toFixed(0)}%, Missed wins: ${validationResult.slOptimization.missedWinRate.toFixed(0)}%`);
        }

        const modeStr = context.isAccuracyModeEnabled
            ? (context.accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Accuracy Original')
            : 'Standard';
        devLog(`[ValidationGate] Mode: ${modeStr} | Hybrid: ${context.isHybridIntelligenceEnabled}`);
        devLog('[ValidationGate] Full Report:\n', validationResult.validationReport);

        devLog('[MonteCarlo] Conditions check:', {
            hasHybridData: !!context.freshHybridData,
            hybridDataSymbol: context.freshHybridData?.symbol || 'none',
            hybridData1hATR: context.freshHybridData?.indicators?.['1h']?.atr || 'none',
            hasEntryPoints: !!analysis.entryPoints?.length,
            entryPointsLength: analysis.entryPoints?.length || 0,
            hasStopLoss: !!analysis.stopLoss,
            stopLoss: analysis.stopLoss,
            hasTakeProfit: !!analysis.takeProfit?.length,
            direction: analysis.direction
        });

        if (analysis.entryPoints?.length && analysis.stopLoss) {
            context.onMonteCarlo(analysis, context.freshHybridData || {
                indicators: {},
                regime: { detected: 'unknown', trendDirection: 'neutral' }
            } as unknown as HybridDataPacket);
        } else {
            devLog('[MonteCarlo] Skipped - missing conditions:', {
                needsEntryPoints: !analysis.entryPoints?.length ? 'No entry points in analysis' : 'present',
                needsStopLoss: !analysis.stopLoss ? 'No stop loss in analysis' : 'present'
            });
        }

        devLog('[LiveBacktest] Conditions check:', {
            loggedTradesCount: context.loggedTrades.length,
            needsMinTrades: 3,
            hasCoinName: !!analysis.coinName,
            coinName: analysis.coinName
        });

        if (context.loggedTrades.length >= 3 && analysis.coinName) {
            try {
                const btResult = context.onBacktest(analysis, context.loggedTrades, context.freshHybridData?.regime?.regime);
                if (btResult && btResult.totalMatches > 0) {
                    devLog(`[LiveBacktest] ✅ Found ${btResult.totalMatches} matches: WinRate=${btResult.winRate.toFixed(1)}%, EV=${btResult.expectedValue.toFixed(2)}%`);
                } else {
                    devLog('[LiveBacktest] ⚠️ No similar trades found in history');
                }
            } catch (btError) {
                console.error('[LiveBacktest] ❌ Backtest failed:', btError);
            }
        } else {
            devLog('[LiveBacktest] ⏭️ Skipped - missing conditions:', {
                needsMoreTrades: context.loggedTrades.length < 3 ? `Need ${3 - context.loggedTrades.length} more logged trades` : '✓',
                needsCoinName: !analysis.coinName ? 'No coin detected in analysis' : '✓'
            });
        }
    } catch (validationError) {
        console.error('[ValidationGate] Validation failed:', validationError);
    }
};

const applyRiskAndSizing = (
    analysis: TradeAnalysis,
    context: AnalysisResultProcessorContext,
): void => {
    const harnessSettingsNow = context.getHarnessSettings();
    const tier = gradeRiskTierWithAdjustment(analysis.grade, harnessSettingsNow.riskPercent);
    const guardVerdict = assessSession(context.sessionLoggedTrades, harnessSettingsNow.equityUsd, context.getSessionGuardConfig());
    const closedTrades = context.sessionLoggedTrades.filter(t =>
        t.outcome === 'WIN' || t.outcome === 'LOSS');
    const wins = closedTrades.filter(t => t.outcome === 'WIN');
    const losses = closedTrades.filter(t => t.outcome === 'LOSS');
    const avg = (xs: LoggedTrade[]): number => xs.length > 0
        ? xs.reduce((s, t) => s + (t.pnlAmount ?? 0), 0) / xs.length
        : 0;
    const kelly = kellyAdvisory(wins.length, losses.length, avg(wins), Math.abs(avg(losses)));
    const sized = computeContractSize(
        analysis,
        harnessSettingsNow.equityUsd,
        context.activeLeverage || DEFAULT_LEVERAGE,
        tier.riskPercent,
        [tier.adjustment],
    );
    analysis.positionSize = {
        line: sized.line,
        riskUsd: sized.riskUsd,
        fraction: sized.fraction,
        label: sized.label,
        adjustments: sized.adjustments,
    };
    if (sized.reason === EQUITY_NOT_SET && !context.isAutomationRun) {
        context.onWarning('Equity not set', 'Add your account equity in Settings → Risk to size trades.');
    }
    analysis.sessionGuard = {
        level: guardVerdict.level,
        summary: guardVerdict.warnings.length > 0
            ? guardVerdict.warnings.join(' ')
            : `Trades today: ${guardVerdict.tradesToday} · Day P&L ${guardVerdict.dayPnlUsd >= 0 ? '+' : ''}$${Math.round(guardVerdict.dayPnlUsd)}`,
    };
    if (kelly.line) analysis.kellyAdvisory = kelly.line;
    if (typeof context.freshHybridData?.fundingRate === 'number') {
        analysis.fundingRate = context.freshHybridData.fundingRate;
    }
    analysis.recommendationContract = buildRecommendationContract(analysis);
};

/**
 * Normalize and enrich one provider-produced analysis. Provider transport,
 * request freshness, React state, and user-facing toasts stay at the caller.
 */
export const processAnalysisResult = (
    rawAnalysis: TradeAnalysis,
    context: AnalysisResultProcessorContext,
): TradeAnalysis => {
    const finalAnalysis = sanitizeTradeAnalysis(rawAnalysis);
    finalAnalysis.originalStopLossPercentage = finalAnalysis.stopLossPercentage;
    finalAnalysis.takeProfit = Array.isArray(finalAnalysis.takeProfit)
        ? finalAnalysis.takeProfit.map(tp => ({ ...tp, originalPercentage: tp.percentage }))
        : [];

    const validationState: ValidationAdjustmentState = {
        directionBefore: finalAnalysis.direction,
    };
    applyUpdateMetadata(finalAnalysis, context.update);
    applyGateResult(finalAnalysis, context.capturedGateResult);
    applyValidation(finalAnalysis, context, validationState);

    Object.assign(finalAnalysis, applyNotebookSkillsToAnalysis(finalAnalysis, {
        regime: context.freshHybridData?.regime?.regime,
        username: context.getActiveUsername(),
    }));
    finalAnalysis.levelCitations = buildLevelCitations(finalAnalysis);
    Object.assign(finalAnalysis, enforceUngroundedLevels(finalAnalysis));
    Object.assign(finalAnalysis, applyHybridChartDrift(finalAnalysis, context.freshHybridData || context.currentHybridData));

    if (finalAnalysis.confidence === 'Avoid' && String(context.bayesianConfidenceCap ?? '').toLowerCase() !== 'avoid') {
        rescueSoftAvoid(finalAnalysis, {
            directionBefore: validationState.directionBefore,
            modelDeclaredAvoid: validationState.adjustedConfidence !== 'Avoid',
        });
    }

    applyRiskAndSizing(finalAnalysis, context);
    return recalculateAnalysisMetrics(finalAnalysis, context.activeLeverage || DEFAULT_LEVERAGE);
};

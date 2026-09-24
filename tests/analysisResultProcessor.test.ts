import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeAnalysis } from '../types';
import { TradeOutcome } from '../types';

const mocks = vi.hoisted(() => ({
    runValidationGate: vi.fn(),
    applyNotebookSkillsToAnalysis: vi.fn((analysis: TradeAnalysis) => analysis),
    buildLevelCitations: vi.fn(() => []),
    enforceUngroundedLevels: vi.fn((analysis: TradeAnalysis) => analysis),
    applyHybridChartDrift: vi.fn((analysis: TradeAnalysis) => analysis),
    rescueSoftAvoid: vi.fn((_analysis: TradeAnalysis) => false),
    buildRecommendationContract: vi.fn(() => ({
        action: 'long' as const,
        riskBoundary: 'Hard stop 90',
        invalidation: [],
        thesis: 'Long BTCUSDT',
    })),
    computeContractSize: vi.fn(() => ({
        line: '0.100 BTC · $100 risk',
        riskUsd: 100,
        fraction: 1,
        label: 'full' as const,
        adjustments: [],
        reason: 'ok',
    })),
    gradeRiskTierWithAdjustment: vi.fn(() => ({
        riskPercent: 1,
        line: 'Grade A — full 1% risk',
        adjustment: { type: 'grade-tier' as const, label: 'Grade A', fractionEffect: 1 },
    })),
    kellyAdvisory: vi.fn(() => ({
        fullKelly: 0.1,
        quarterKelly: 0.025,
        halfKelly: 0.05,
        sampleSize: 20,
        line: 'Kelly f*=10.0%',
    })),
    assessSession: vi.fn(() => ({
        level: 'clear' as const,
        dayPnlUsd: 25,
        dayPnlPct: 0.0025,
        tradesToday: 2,
        lossStreak: 0,
        dailyLossHit: false,
        tradeCapHit: false,
        streakPauseActive: false,
        cooldownActiveUntil: undefined,
        warnings: [],
        lossBudgetUsed: 0,
    })),
    getHarnessSettings: vi.fn(() => ({
        equityUsd: 10_000,
        riskPercent: 1,
        promptAbRate: 0.1 as const,
        debateCostCapUsd: 0.5,
        deskToolsEnabled: true,
        responseEffort: 'quality' as const,
    })),
    getSessionGuardConfig: vi.fn(() => ({
        dailyLossLimitPct: 0.02,
        maxTradesPerDay: 2,
        lossStreakPause: 2,
        postLossCooldownMin: 240,
        tradeRiskPercent: 1,
    })),
    recalculateAnalysisMetrics: vi.fn((analysis: TradeAnalysis) => analysis),
}));

vi.mock('../services/validation/TradeValidationGate', () => ({
    runValidationGate: mocks.runValidationGate,
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    applyNotebookSkillsToAnalysis: mocks.applyNotebookSkillsToAnalysis,
}));
vi.mock('../utils/levelEvidence', () => ({ buildLevelCitations: mocks.buildLevelCitations }));
vi.mock('../utils/ungroundedGate', () => ({ enforceUngroundedLevels: mocks.enforceUngroundedLevels }));
vi.mock('../utils/hybridChartDrift', () => ({ applyHybridChartDrift: mocks.applyHybridChartDrift }));
vi.mock('../utils/avoidReason', () => ({ rescueSoftAvoid: mocks.rescueSoftAvoid }));
vi.mock('../utils/recommendationContract', () => ({ buildRecommendationContract: mocks.buildRecommendationContract }));
vi.mock('../utils/ticketSize', () => ({
    computeContractSize: mocks.computeContractSize,
    gradeRiskTierWithAdjustment: mocks.gradeRiskTierWithAdjustment,
    kellyAdvisory: mocks.kellyAdvisory,
    EQUITY_NOT_SET: 'Equity not set',
}));
vi.mock('../services/validation/SessionGuardService', () => ({ assessSession: mocks.assessSession }));
vi.mock('../utils/harnessSettings', () => ({ getHarnessSettings: mocks.getHarnessSettings }));
vi.mock('../utils/analysisUtils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/analysisUtils')>();
    return {
        ...actual,
        recalculateAnalysisMetrics: mocks.recalculateAnalysisMetrics,
    };
});

import { processAnalysisResult, type AnalysisResultProcessorContext } from '../services/analysis/analysisResultProcessor';

const baseAnalysis = (): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'High',
    probability: 82,
    grade: 'A',
    strategy: 'Breakout above resistance with a defined stop.',
    activeStrategies: [],
    entryPoints: [{ description: 'Retest', price: '100' }],
    stopLoss: '90',
    stopLossPercentage: '10',
    takeProfit: [{ price: '120', percentage: '20' }],
    marketConditions: {
        pattern: 'breakout',
        candleBehavior: 'strong close',
        timeframeAlignment: 'aligned',
        rsi: '62',
        macd: 'bullish',
        sentiment: 'positive',
    },
    historicalCorrelation: '',
    createdAt: '2026-09-16T00:00:00.000Z',
});

const gate = (overrides: Record<string, unknown> = {}): any => ({
    symbol: 'BTCUSDT',
    pass: true,
    reason: 'passed',
    allowedFamilies: ['A', 'B', 'C', 'Omega'],
    confidenceCap: 0.8,
    confidencePenalties: {
        dataIntegrity: 0,
        patternMemory: 0,
        htfConflict: 0,
        volumeContext: 0,
        rawTotal: 0,
        effectiveTotal: 0,
    },
    familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: [] },
    warnings: ['warning-1', 'warning-2', 'warning-3', 'warning-4'],
    insights: ['insight-1', 'insight-2', 'insight-3'],
    stage1Timestamp: '2026-09-16T00:00:00.000Z',
    processingTimeMs: 1,
    ...overrides,
});

const validationOutput = (overrides: Record<string, unknown> = {}): any => ({
    isValid: true,
    originalConfidence: 'High',
    adjustedConfidence: 'Medium',
    confidenceWasAdjusted: true,
    warnings: ['validation warning'],
    errors: [' hard error'],
    validationScores: { confluence: 80, riskReward: 70, volume: 60, regime: 50, devilsAdvocate: 40 },
    devilsAdvocate: {
        bearCaseReasons: ['resistance'],
        tradeFailureScenarios: ['fakeout'],
        crowdedTradeWarning: 'crowded',
        overallRiskScore: 35,
    },
    calibrationNote: null,
    patternMatchWarning: null,
    sessionWarnings: [],
    crowdedTradeWarning: 'crowded',
    entryTiming: {
        score: 72,
        timing: 'Good',
        suggestedEntry: { price: 101, reason: 'retest' },
    },
    slOptimization: { recommendedMultiplier: 1.1, missedWinRate: 0.2 },
    detectedTradeType: 'swing',
    tradeTypeDetection: null,
    validationReport: 'validation report',
    ...overrides,
});

const context = (overrides: Partial<AnalysisResultProcessorContext> = {}): AnalysisResultProcessorContext => ({
    capturedGateResult: null,
    freshHybridData: null,
    currentHybridData: null,
    loggedTrades: [],
    sessionLoggedTrades: [],
    getCalibration: vi.fn(() => undefined),
    getActiveUsername: vi.fn(() => 'alice'),
    getHarnessSettings: mocks.getHarnessSettings,
    getSessionGuardConfig: mocks.getSessionGuardConfig,
    activeLeverage: 10,
    isAccuracyModeEnabled: false,
    accuracySubMode: 'original',
    isHybridIntelligenceEnabled: false,
    isAutomationRun: false,
    onMonteCarlo: vi.fn(),
    onBacktest: vi.fn(),
    onSetCurrentEntryTimingScore: vi.fn(),
    onSetCurrentSuggestedEntryPrice: vi.fn(),
    onSetCurrentSlOptimization: vi.fn(),
    onWarning: vi.fn(),
    ...overrides,
});

describe('processAnalysisResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyNotebookSkillsToAnalysis.mockImplementation((analysis: TradeAnalysis) => analysis);
        mocks.enforceUngroundedLevels.mockImplementation((analysis: TradeAnalysis) => analysis);
        mocks.applyHybridChartDrift.mockImplementation((analysis: TradeAnalysis) => analysis);
        mocks.runValidationGate.mockReturnValue(validationOutput());
        mocks.recalculateAnalysisMetrics.mockImplementation((analysis: TradeAnalysis) => analysis);
    });

    it('preserves update metadata, gate veto, validation, callbacks, enrichment, sizing, and final metrics', () => {
        const priorAnalysis = { ...baseAnalysis(), planVersion: 3, stopLoss: '85' };
        const sessionTrade = (outcome: TradeOutcome, pnlAmount: number) => ({
            id: outcome,
            outcome,
            timestamp: '2026-09-16T00:00:00.000Z',
            pnlAmount,
            analysis: baseAnalysis(),
        });
        const ctx = context({
            capturedGateResult: gate({
                pass: false,
                suggestedDirection: 'Short',
                confidencePenalties: {
                    dataIntegrity: 0,
                    patternMemory: 0.2,
                    htfConflict: 0,
                    volumeContext: 0,
                    rawTotal: 0.2,
                    effectiveTotal: 0.2,
                },
            }),
            update: {
                isUpdate: true,
                updateInterval: '2h',
                priorAnalysis,
                priorMessageId: 'msg-1',
            },
            bayesianConfidenceCap: 'Low',
            freshHybridData: {
                symbol: 'BTCUSDT',
                fundingRate: 0.0001,
                regime: { detected: 'trending', trendDirection: 'up', regime: 'bull' },
                indicators: {},
            } as any,
            loggedTrades: [sessionTrade(TradeOutcome.WIN, 100), sessionTrade(TradeOutcome.LOSS, -50), sessionTrade(TradeOutcome.WIN, 80)],
            sessionLoggedTrades: [sessionTrade(TradeOutcome.WIN, 100), sessionTrade(TradeOutcome.LOSS, -50)],
        });
        const onMonteCarlo = vi.fn();
        const onBacktest = vi.fn(() => ({ totalMatches: 4, winRate: 75, expectedValue: 12 }));
        ctx.onMonteCarlo = onMonteCarlo;
        ctx.onBacktest = onBacktest;

        mocks.runValidationGate.mockReturnValueOnce(validationOutput({
            adjustedConfidence: 'Avoid',
            confidenceWasAdjusted: true,
        }));
        const result = processAnalysisResult(baseAnalysis(), ctx);

        expect(result.isUpdate).toBe(true);
        expect(result.updateInterval).toBe('2h');
        expect(result.planVersion).toBe(4);
        expect(result.amendsMessageId).toBe('msg-1');
        expect(result.planDiff).toBeDefined();
        expect(result.originalStopLossPercentage).toBe('10');
        expect(result.takeProfit[0].originalPercentage).toBe('20');
        expect(result.gateResult?.warnings).toEqual(['warning-1', 'warning-2', 'warning-3']);
        expect(result.gateResult?.insights).toHaveLength(2);
        expect(result.validationWarnings).toEqual(['validation warning', ' HARD VALIDATION: hard error']);
        expect(result.riskVeto).toContain('GATE VETO');
        expect(result.riskVeto).toContain('PATTERN-MEMORY CONTRADICTION');
        expect(result.confidence).toBe('Avoid');
        expect(result.originalConfidence).toBe('High');
        expect(result.direction).toBe('Neutral');
        expect(result.devilsAdvocate?.riskScore).toBe(35);
        expect(result.entryTimingScore?.score).toBe(72);
        expect(ctx.onSetCurrentEntryTimingScore).toHaveBeenCalledOnce();
        expect(ctx.onSetCurrentSuggestedEntryPrice).toHaveBeenCalledWith(101);
        expect(ctx.onSetCurrentSlOptimization).toHaveBeenCalledOnce();
        expect(onMonteCarlo).toHaveBeenCalledOnce();
        expect(onBacktest).toHaveBeenCalledWith(expect.any(Object), ctx.loggedTrades, 'bull');
        // toHaveBeenCalledWith treats an explicit `runId: undefined` as equal
        // to an ABSENT key, so this assertion on its own cannot prove the
        // runId reaches skill enforcement — see the runId-forwarding test.
        expect(mocks.applyNotebookSkillsToAnalysis).toHaveBeenCalledWith(expect.any(Object), {
            regime: 'bull',
            username: 'alice',
        });
        expect(mocks.buildLevelCitations).toHaveBeenCalledOnce();
        expect(mocks.enforceUngroundedLevels).toHaveBeenCalledOnce();
        expect(mocks.applyHybridChartDrift).toHaveBeenCalledOnce();
        expect(result.positionSize).toEqual({
            line: '0.100 BTC · $100 risk',
            riskUsd: 100,
            fraction: 1,
            label: 'full',
            adjustments: [],
        });
        expect(result.sessionGuard?.level).toBe('clear');
        expect(result.kellyAdvisory).toBe('Kelly f*=10.0%');
        expect(result.fundingRate).toBe(0.0001);
        expect(mocks.buildRecommendationContract).toHaveBeenCalledOnce();
        expect(mocks.recalculateAnalysisMetrics).toHaveBeenCalledWith(result, 10);
    });

    it('fails open when validation throws and still applies post-validation enrichment and sizing', () => {
        mocks.runValidationGate.mockImplementationOnce(() => {
            throw new Error('degraded validation packet');
        });
        const ctx = context({
            loggedTrades: [{} as any, {} as any],
            onMonteCarlo: vi.fn(),
            onBacktest: vi.fn(),
        });

        expect(() => processAnalysisResult(baseAnalysis(), ctx)).not.toThrow();
        expect(ctx.onMonteCarlo).not.toHaveBeenCalled();
        expect(ctx.onBacktest).not.toHaveBeenCalled();
        expect(mocks.applyNotebookSkillsToAnalysis).toHaveBeenCalledOnce();
        expect(mocks.computeContractSize).toHaveBeenCalledOnce();
        expect(mocks.buildRecommendationContract).toHaveBeenCalledOnce();
        expect(mocks.recalculateAnalysisMetrics).toHaveBeenCalledOnce();
    });

    it('passes the validation origin into soft-Avoid rescue without overriding a Bayesian Avoid cap', () => {
        mocks.runValidationGate.mockReturnValueOnce(validationOutput({
            adjustedConfidence: 'Avoid',
            confidenceWasAdjusted: true,
        }));
        const ctx = context();
        processAnalysisResult(baseAnalysis(), ctx);
        expect(mocks.rescueSoftAvoid).toHaveBeenCalledWith(expect.any(Object), {
            directionBefore: 'Long',
            modelDeclaredAvoid: false,
        });

        vi.clearAllMocks();
        mocks.runValidationGate.mockReturnValueOnce(validationOutput({
            adjustedConfidence: 'High',
            confidenceWasAdjusted: false,
        }));
        const modelDeclared = baseAnalysis();
        modelDeclared.confidence = 'Avoid';
        processAnalysisResult(modelDeclared, context());
        expect(mocks.rescueSoftAvoid).toHaveBeenCalledWith(expect.any(Object), {
            directionBefore: 'Neutral',
            modelDeclaredAvoid: true,
        });
    });

    it('rescues a pipeline-generated soft Avoid without treating it as a model-declared Avoid', () => {
        mocks.runValidationGate.mockReturnValueOnce(validationOutput({
            adjustedConfidence: 'Avoid',
            confidenceWasAdjusted: true,
        }));
        mocks.rescueSoftAvoid.mockImplementationOnce((analysis: TradeAnalysis) => {
            analysis.confidence = 'Low';
            analysis.direction = 'Long';
            return true;
        });
        const result = processAnalysisResult(baseAnalysis(), context());
        expect(result.confidence).toBe('Low');
        expect(result.direction).toBe('Long');
        expect(mocks.rescueSoftAvoid).toHaveBeenCalledWith(expect.any(Object), {
            directionBefore: 'Long',
            modelDeclaredAvoid: false,
        });
    });

    it('only dispatches Monte Carlo and backtest adapters when their existing conditions are met', () => {
        const incomplete = baseAnalysis();
        incomplete.entryPoints = [];
        incomplete.stopLoss = '';
        const ctx = context({ loggedTrades: [] });
        processAnalysisResult(incomplete, ctx);
        expect(ctx.onMonteCarlo).not.toHaveBeenCalled();
        expect(ctx.onBacktest).not.toHaveBeenCalled();

        vi.clearAllMocks();
        mocks.runValidationGate.mockReturnValueOnce(validationOutput());
        const complete = baseAnalysis();
        const onMonteCarlo = vi.fn();
        const onBacktest = vi.fn();
        const completeCtx = context({
            freshHybridData: null,
            loggedTrades: [{} as any, {} as any, {} as any],
            onMonteCarlo,
            onBacktest,
        });
        processAnalysisResult(complete, completeCtx);
        expect(onMonteCarlo).toHaveBeenCalledOnce();
        expect(onMonteCarlo.mock.calls[0]?.[1]).toMatchObject({
            indicators: {},
            regime: { detected: 'unknown', trendDirection: 'neutral' },
        });
        expect(onBacktest).toHaveBeenCalledOnce();
    });

    /**
     * The ε-holdout is only honest if the code veto stands down on the same
     * runs prompt injection is blanked on. It used to fire anyway, so the
     * control group received the intervention it was the counterfactual for.
     * The runId is the only channel that can tell enforcement which run it is
     * on — so this pins the thread, not just the call.
     */
    it('forwards the run identity to notebook skill enforcement', () => {
        mocks.runValidationGate.mockReturnValueOnce(validationOutput());
        processAnalysisResult(baseAnalysis(), context({
            runId: 'run-holdout-7',
            onMonteCarlo: vi.fn(),
            onBacktest: vi.fn(),
        }));
        expect(mocks.applyNotebookSkillsToAnalysis).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ runId: 'run-holdout-7' }),
        );
    });
});

/**
 * Tests for the verdict finalizer cluster.
 *
 * The cluster owns:
 *   - Markdown plan parse (with prose rescue path)
 *   - Accuracy-mode verification (kept-original fail-safe)
 *   - `processNewAnalysis` (closure, mocked as a passthrough here)
 *   - Gate cap clamping
 *   - Cross-analyst consensus + citations + recommendation contract
 *   - Veto ledger write (only when the verdict stayed blocked)
 *   - Final-message updater (with runStats)
 *   - Completion notification
 *   - Skill draft (interactive runs only)
 *   - Automation dispatch (automation runs only)
 *
 * The cluster is unit-tested without React, Electron, or IPC — every
 * collaborator is `vi.mock`'d so the test exercises the cluster's branching
 * and side-effect sequencing only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import pipelineSource from '../hooks/useAnalysisPipeline.ts?raw';
import { MessageRole, TradeOutcome } from '../types';
import type {
    AnalystLensConfig,
    Message,
    TradeAnalysis,
} from '../types';
import type { ProviderConfig } from '../types/provider';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    notifyAnalysisComplete: vi.fn(async () => undefined),
    recordVeto: vi.fn(async () => null),
    buildAnalystConsensus: vi.fn(),
    attachVerdictCitations: vi.fn((consensus: unknown) => consensus),
    enforceCitedVerdict: vi.fn(() => ({})),
    getLastDebateProtocol: vi.fn(() => 'standard'),
    verifyAccuracyPlan: vi.fn(async () => ({ verdict: 'confirmed' as const, note: '' })),
    annotateVerdictCitations: vi.fn(async () => undefined),
    maybeQueueVerdictSkillDraft: vi.fn(() => null),
    buildRunContractStages: vi.fn(() => [
        { id: 'gate', label: 'Gate scan', state: 'done' as const },
        { id: 'openings', label: 'Analyst openings', state: 'done' as const },
    ]),
    buildVerdictEvidencePack: vi.fn(() => ({
        promptBlock: '',
        ui: {
            statsLine: '',
            causePattern: '',
            similar: [],
            skills: [],
            doctrineHeader: '',
        },
    })),
    deriveSetupQueryFromPrompt: vi.fn(() => undefined),
    buildRecommendationContract: vi.fn(() => ({
        action: 'long' as const,
        riskBoundary: 'Hard stop 90',
        invalidation: [],
        thesis: 'Long BTCUSDT',
    })),
    appendSessionUsage: vi.fn(async () => undefined),
    estimateCostUsd: vi.fn(() => 0.001),
    shouldSkillHoldout: vi.fn(() => false),
}));

vi.mock('../services/infrastructure/CompletionNotifications', () => ({
    notifyAnalysisComplete: mocks.notifyAnalysisComplete,
}));
vi.mock('../services/ui/VetoLedgerService', () => ({
    VetoLedgerService: { recordVeto: mocks.recordVeto },
}));
vi.mock('../services/providers/ensembleService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/providers/ensembleService')>();
    return {
        ...actual,
        buildAnalystConsensus: mocks.buildAnalystConsensus,
        attachVerdictCitations: mocks.attachVerdictCitations,
        enforceCitedVerdict: mocks.enforceCitedVerdict,
        getLastDebateProtocol: mocks.getLastDebateProtocol,
        verifyAccuracyPlan: mocks.verifyAccuracyPlan,
    };
});
vi.mock('../services/learning/MemoryInjectionService', () => ({
    annotateVerdictCitations: mocks.annotateVerdictCitations,
}));
vi.mock('../utils/verdictSkillDraft', () => ({
    maybeQueueVerdictSkillDraft: mocks.maybeQueueVerdictSkillDraft,
}));
vi.mock('../utils/runContract', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/runContract')>();
    return {
        ...actual,
        buildRunContractStages: mocks.buildRunContractStages,
    };
});
vi.mock('../services/learning/EvidencePackService', () => ({
    buildVerdictEvidencePack: mocks.buildVerdictEvidencePack,
    deriveSetupQueryFromPrompt: mocks.deriveSetupQueryFromPrompt,
}));
vi.mock('../utils/recommendationContract', () => ({
    buildRecommendationContract: mocks.buildRecommendationContract,
}));
vi.mock('../utils/sessionUsage', () => ({
    appendSessionUsage: mocks.appendSessionUsage,
}));
vi.mock('../utils/tokenUsage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/tokenUsage')>();
    return {
        ...actual,
        estimateCostUsd: mocks.estimateCostUsd,
    };
});
vi.mock('../utils/skillHoldout', () => ({
    shouldSkillHoldout: mocks.shouldSkillHoldout,
}));

import {
    finalizeVerdict,
    type VerdictFinalizerInput,
} from '../hooks/analysisPipeline/verdictFinalizer';

// ─── Helpers ────────────────────────────────────────────────────────────────

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'ai-msg-1',
    role: MessageRole.AI,
    text: '',
    createdAt: '2026-09-16T00:00:00.000Z',
    isDebating: true,
    debateTurns: [],
    ...overrides,
});

const moderatorConfig = (): ProviderConfig => ({
    id: 'moderator-1',
    name: 'Moderator',
    baseUrl: 'https://example.com',
    apiKey: 'redacted',
    isEnabled: true,
    models: ['moderator-model'],
    selectedModel: 'moderator-model',
    modalities: { chat: true },
    enabledModalities: { chat: true },
} as unknown as ProviderConfig);

const lensConfig = (overrides: Partial<AnalystLensConfig> = {}): AnalystLensConfig => ({
    enabled: false,
    tradingStyle: 'auto',
    teamMode: 'rotating',
    customRoster: [],
    assignments: [] as never,
    ...overrides,
} as AnalystLensConfig);

const makeInput = (overrides: Partial<VerdictFinalizerInput> = {}): VerdictFinalizerInput => {
    const input: VerdictFinalizerInput = {
        userMessage: {
            id: 'user-msg-1',
            role: MessageRole.USER,
            text: 'BTC long now',
            createdAt: '2026-09-16T00:00:00.000Z',
        },
        existingMessage: baseMessage(),
        fullResponseText: '',
        debateTurnsRef: { current: [] },
        debateRunLogRef: { current: [] },
        reasoningMapRef: { current: {} },
        toolActionsRef: { current: [] },
        automationMessagesRef: { current: [] },
        isCurrentRequest: () => true,
        abortSignal: new AbortController().signal,
        getActiveUsername: () => 'alice',
        effectiveInput: 'BTC long now',
        freshHybridData: null,
        moderatorContextBundle: '',
        effectiveTradingStyle: 'swing',
        finalSymbol: 'BTCUSDT',
        capturedGateResult: null,
        teamSeatFor: () => undefined,
        runGroupMemberPersonas: [],
        memoryQuery: undefined,
        memoryRetrieved: undefined,
        memoryAsOfMs: undefined,
        loggedTrades: [],
        analystTimings: new Map(),
        tokenByProvider: new Map(),
        providerConfigs: [],
        liveBtResult: undefined,
        perAIMC: [],
        debateMessageId: 'ai-msg-1',
        thoughtMap: {},
        vetoRecordParams: null,
        allFulfilledAnalysts: [],
        runAccuracyMode: false,
        runLensConfig: lensConfig(),
        runModeratorConfig: moderatorConfig(),
        runModeratorModel: 'moderator-model',
        runEnsembleEnabled: true,
        runStartedAt: Date.now() - 1000,
        isHybridIntelligenceEnabled: false,
        lensConfig: lensConfig(),
        isPlaybookEnabledInPureAI: false,
        isFamiliesEnabledInPureAI: false,
        isMemoryEnabledInPureAI: false,
        customEnsemblePrompt: null,
        promptLane: 'live',
        isAutomationRun: false,
        options: undefined,
        processNewAnalysis: (a: TradeAnalysis) => a,
        applyUpdate: () => undefined,
        setHighlightedAnalysisId: () => undefined,
        ...overrides,
    };
    return input;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('finalizeVerdict — markdown plan path', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
        mocks.attachVerdictCitations.mockImplementation((c: unknown) => c);
        mocks.enforceCitedVerdict.mockImplementation(() => ({}));
    });

    it('parses a markdown plan and produces a settled card with runStats', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000 (3.2%)
- **Probability:** 85
- **Confidence:** High
- **Strategy Family:** Family A
</FINAL TRADE PLAN>`;

        const result = await finalizeVerdict(makeInput({ fullResponseText }));

        // The cluster applies the updater internally before dispatching. The
        // returned updatedMessage is the new row shape — the hook passes it
        // through its own updateMessages(updater) with the same pattern.
        expect(result.updatedMessage.analysis?.direction).toBe('Long');
        expect(result.updatedMessage.analysis?.coinName).toBe('BTCUSDT');
        expect(result.updatedMessage.analysis?.probability).toBe(85);
        expect(result.updatedMessage.analysis?.confidence).toBe('High');
        expect(result.updatedMessage.isDebating).toBe(false);
        expect(result.updatedMessage.outcome).toBe(TradeOutcome.PENDING);
        expect(result.updatedMessage.runStats?.runId).toBe('user-msg-1');
        expect(result.updatedMessage.runStats?.promptLane).toBe('live');
        expect(result.updatedMessage.runStats?.analystCount).toBe(0);
        expect(result.processedAnalysis.coinName).toBe('BTCUSDT');
        // recommendationContract is added by the cluster
        expect(result.processedAnalysis.recommendationContract).toBeDefined();
        // runContract is on the message
        expect(result.updatedMessage.runContract).toBeDefined();
    });
});

describe('finalizeVerdict — prose rescue path', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('rescues a partial verdict via prose parsing when labeled parsing fails', async () => {
        // No labeled **FINAL TRADE PLAN** block, but the prose is parseable
        // by parseProseTradePlan (which extracts from "Direction:", "Entry:",
        // "Stop Loss:", "Take Profit:", "Probability:", "Confidence:" labels).
        const fullResponseText = `<DEBATE_END>
The moderator's read of the chart:
- Coin: BTCUSDT
- Direction: Long
- Entry: 95000
- Stop Loss: 93000
- Take Profit: 98000
- Probability: 85
- Confidence: High
`;

        const result = await finalizeVerdict(makeInput({ fullResponseText }));

        expect(result.processedAnalysis.direction).toBe('Long');
        expect(result.processedAnalysis.coinName).toBe('BTCUSDT');
        expect(result.processedAnalysis.confidence).toBe('High');
        // No `verdictReview` for rescued plans — only for fully-unparseable ones.
        expect(result.processedAnalysis.verdictReview).toBeUndefined();
    });

    it('quarantines an unparseable plan with verdictReview.reason=incomplete-plan', async () => {
        // No parseable plan, no parseable prose — verdict should land on
        // Neutral/Avoid with verdictReview stamped.
        const fullResponseText = 'random gibberish with no trade information at all';

        const result = await finalizeVerdict(makeInput({ fullResponseText }));

        expect(result.processedAnalysis.direction).toBe('Neutral');
        expect(result.processedAnalysis.confidence).toBe('Avoid');
        expect(result.processedAnalysis.verdictReview).toEqual({ reason: 'incomplete-plan' });
    });
});

describe('finalizeVerdict — moderator error', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
    });

    it('falls through to a "Connection Error:" strategy when the moderator emitted <MODERATOR_ERROR>', async () => {
        // The cluster does NOT rethrow moderator errors — it catches the
        // inner parse failure, surfaces the marker via the prose-rescue
        // fallback strategy ("Connection Error: Moderator Error: …"), and
        // stamps direction=Neutral with verdictReview=incomplete-plan.
        const fullResponseText = `<MODERATOR_ERROR>rate-limit hit on the upstream provider</MODERATOR_ERROR>`;

        const result = await finalizeVerdict(makeInput({ fullResponseText }));

        expect(result.processedAnalysis.direction).toBe('Neutral');
        expect(result.processedAnalysis.confidence).toBe('Avoid');
        expect(result.processedAnalysis.verdictReview).toEqual({ reason: 'incomplete-plan' });
        expect(result.processedAnalysis.strategy).toMatch(/Connection Error/);
        expect(result.processedAnalysis.strategy).toMatch(/Moderator Error/);
    });
});

describe('finalizeVerdict — banned vocabulary flagging', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('adds a URGENCY WORDING validation warning when the verdict uses urgency-framed wording', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High

This is a **urgent** move — you can't miss it. Easy profit incoming.
</FINAL TRADE PLAN>`;

        const result = await finalizeVerdict(makeInput({ fullResponseText }));
        expect(result.processedAnalysis.validationWarnings?.some(w => w.includes('URGENCY WORDING'))).toBe(true);
    });
});

describe('finalizeVerdict — gate cap clamping', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('clamps probability down to the capturedGateResult confidenceCap when the moderator overshot', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 90
- **Confidence:** High
</FINAL TRADE PLAN>`;

        const result = await finalizeVerdict(makeInput({
            fullResponseText,
            // Gate cap of 0.6 → 60%. processNewAnalysis is a passthrough, so
            // the cluster should clamp 90 → 60.
            capturedGateResult: { confidenceCap: 0.6 },
        }));

        expect(result.processedAnalysis.probability).toBe(60);
        expect(result.processedAnalysis.confidence).toBe('Medium');
        expect(result.processedAnalysis.validationWarnings?.some(w => w.includes('Gate enforcement'))).toBe(true);
    });
});

describe('finalizeVerdict — consensus + recommendation contract', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
    });

    it('attaches consensus + citations + recommendation contract to the processed analysis', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        const consensus = {
            entries: [{
                providerId: 'p1',
                thoughtsKey: 'p1::m',
                displayName: 'Analyst A',
                direction: 'Long',
                confidence: 'High',
            }],
            divergence: { score: 0, isEchoChamber: false, divergenceType: 'none' as const, details: [] },
        };
        mocks.buildAnalystConsensus.mockReturnValue(consensus);

        const result = await finalizeVerdict(makeInput({ fullResponseText }));

        expect(mocks.buildAnalystConsensus).toHaveBeenCalledTimes(1);
        expect(mocks.attachVerdictCitations).toHaveBeenCalledTimes(1);
        expect(mocks.enforceCitedVerdict).toHaveBeenCalledTimes(1);
        expect(result.processedAnalysis.analystConsensus).toBeDefined();
        expect(result.processedAnalysis.recommendationContract).toBeDefined();
    });
});

describe('finalizeVerdict — veto ledger', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('records the veto when vetoRecordParams is set and the verdict stayed Neutral', async () => {
        // Unparseable plan → direction=Neutral → veto fires.
        const result = await finalizeVerdict(makeInput({
            fullResponseText: 'no useful trade info here at all',
            vetoRecordParams: {
                username: 'alice',
                skill: { status: 'confirmed' as const, coin: 'BTC', direction: 'Long', family: 'Family A', kind: 'repeat' as const, wins: 0, losses: 0, consecutiveLosses: 0, tradeIds: [], body: '' },
                skillName: 'BTC-Long-Family-A.md',
                coinName: 'BTCUSDT',
                direction: 'Long',
                entryPrice: 95000,
                takeProfits: [{ price: 98000 }],
                stopLoss: 93000,
                reason: 'Test veto',
            },
        }));

        expect(mocks.recordVeto).toHaveBeenCalledTimes(1);
        expect(result.processedAnalysis.direction).toBe('Neutral');
    });

    it('skips the veto write when the verdict became actionable (Long)', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        await finalizeVerdict(makeInput({
            fullResponseText,
            vetoRecordParams: {
                username: 'alice',
                skill: { status: 'confirmed' as const, coin: 'BTC', direction: 'Long', family: 'Family A', kind: 'repeat' as const, wins: 0, losses: 0, consecutiveLosses: 0, tradeIds: [], body: '' },
                skillName: 'BTC-Long-Family-A.md',
                coinName: 'BTCUSDT',
                direction: 'Long',
                entryPrice: 95000,
                takeProfits: [{ price: 98000 }],
                stopLoss: 93000,
                reason: 'Test veto',
            },
        }));

        expect(mocks.recordVeto).not.toHaveBeenCalled();
    });
});

describe('finalizeVerdict — automation dispatch', () => {
    it('selects the automation-private messages at the hook call site', () => {
        expect(pipelineSource).toMatch(/const verdictMessages = isAutomationRun \? automationMessagesRef\.current : messagesRef\.current;/);
        expect(pipelineSource).toMatch(/existingVerdictMessage = verdictMessages\.find/);
    });
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('calls options.automation.onMessage with the verdict row when automation is enabled', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        const onMessage = vi.fn();
        const onError = vi.fn();
        const automationMessagesRef = {
            current: [baseMessage({ id: 'ai-msg-1', isDebating: true })],
        };

        const input = makeInput({
            fullResponseText,
            isAutomationRun: true,
            automationMessagesRef,
            options: {
                automation: {
                    automationId: 'auto-1',
                    conversation: {} as never,
                    onMessage,
                    onError,
                },
            },
        });

        // The cluster's applyUpdate writes to automationMessagesRef.current —
        // mirror the hook's updateRequestMessages helper so the dispatch
        // lookup (which scans the ref by id) finds the settled row.
        input.applyUpdate = (updater) => {
            automationMessagesRef.current = updater(automationMessagesRef.current);
        };

        await finalizeVerdict(input);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
            aiMessage: expect.objectContaining({ id: 'ai-msg-1', isDebating: false }),
        }));
    });

    it('does not throw when automation is set but no message was produced', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        const onError = vi.fn();
        const automationMessagesRef = { current: [] }; // empty — no message to find

        await expect(finalizeVerdict(makeInput({
            fullResponseText,
            isAutomationRun: true,
            automationMessagesRef,
            options: {
                automation: {
                    automationId: 'auto-1',
                    conversation: {} as never,
                    onMessage: vi.fn(),
                    onError,
                },
            },
        }))).resolves.toBeDefined();

        // onError is the cluster's fail-safe (with "produced no result message").
        // Re-run with a captured updater to ensure the ref actually got the
        // message before the dispatch lookup — the cluster's internal flow writes
        // to automationMessagesRef via applyUpdate, so on the second run the
        // message exists.
    });

    it('does not throw when automation is not configured', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        await expect(finalizeVerdict(makeInput({
            fullResponseText,
            isAutomationRun: false,
            options: undefined,
        }))).resolves.toBeDefined();
    });
});

describe('finalizeVerdict — state freshness', () => {
    const fullResponseText = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High`;

    it('reads backtest metrics after processing populates them', async () => {
        let backtest: VerdictFinalizerInput['liveBtResult'];
        const input = makeInput({ fullResponseText });
        Object.defineProperty(input, 'liveBtResult', { get: () => backtest });
        input.processNewAnalysis = (analysis) => {
            backtest = { totalMatches: 7, winRate: 65, expectedValue: 1.2 } as NonNullable<typeof backtest>;
            return analysis;
        };
        const result = await finalizeVerdict(input);
        expect(result.updatedMessage.runStats).toMatchObject({ btMatches: 7, btWinRate: 65, btEV: 1.2 });
    });

    it('preserves debate turns committed after the placeholder was captured', async () => {
        const latestTurns = [{ speaker: 'Moderator', round: 3, text: 'Final decision', createdAt: new Date().toISOString() }];
        let messages = [baseMessage({ debateTurns: latestTurns })];
        await finalizeVerdict(makeInput({
            fullResponseText,
            applyUpdate: (updater) => { messages = updater(messages); },
        }));
        expect(messages[0].debateTurns).toEqual(latestTurns);
    });

    it('does not process or commit a run superseded during verification', async () => {
        const processNewAnalysis = vi.fn((analysis: TradeAnalysis) => analysis);
        const applyUpdate = vi.fn();
        let current = true;
        mocks.verifyAccuracyPlan.mockImplementationOnce(async () => {
            current = false;
            return { verdict: 'confirmed', note: '' };
        });
        await expect(finalizeVerdict(makeInput({
            fullResponseText,
            runAccuracyMode: true,
            isCurrentRequest: () => current,
            processNewAnalysis,
            applyUpdate,
        }))).rejects.toMatchObject({ name: 'AbortError' });
        expect(processNewAnalysis).not.toHaveBeenCalled();
        expect(applyUpdate).not.toHaveBeenCalled();
    });
});

describe('finalizeVerdict — completion notification + skill draft', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(m => (m as { mockClear?: () => void }).mockClear?.());
        mocks.buildAnalystConsensus.mockReturnValue(undefined);
    });

    it('fires notifyAnalysisComplete and queues a skill draft for interactive runs', async () => {
        const fullResponseText = `<DEBATE_END>
**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000
- **Stop Loss:** 93000
- **Take Profit 1:** 98000
- **Probability:** 80
- **Confidence:** High
</FINAL TRADE PLAN>`;

        await finalizeVerdict(makeInput({ fullResponseText }));

        expect(mocks.notifyAnalysisComplete).toHaveBeenCalledTimes(1);
        expect(mocks.maybeQueueVerdictSkillDraft).toHaveBeenCalledTimes(1);
        // appendSessionUsage captures the per-run cost/latency ledger.
        expect(mocks.appendSessionUsage).toHaveBeenCalledTimes(1);
    });
});
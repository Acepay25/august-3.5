import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ProviderConfig } from '../types/provider';

/**
 * End-to-end lens-mode validation through the REAL production path:
 *
 *   REAL lens prompts (LENS_MODE_BASE_PROMPT + the role's promptPrefix) are
 *   assembled by analyzeTradingView → the transport is mocked with realistic
 *   lens transcripts (desk-trader prose with named levels, not a forced
 *   TRADE PLAN BLOCK) → the REAL structured-plan parser and
 *   schema pipeline run → the REAL consensus/divergence layer consumes the
 *   per-analyst plans.
 *
 * This is the layer that was dead before the audit fix (analysts produced a
 * hardcoded Neutral/Low placeholder, so per-AI Monte Carlo, the consensus
 * panel, divergence detection and calibration saw nothing). It also verifies
 * the analyst system prompt actually carries the assigned persona.
 */
const { streamMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
    sendChatRequest: ((...args: any[]) => Promise.resolve('')) as any,
    sendChatTurn: (async () => ({
        text: '',
        reasoning: '',
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: '' },
    })) as any,
}));

import { analyzeTradingView } from '../services/providers/GenericAnalysisService';
import { buildAnalystConsensus } from '../services/providers/ensembleService';
import { getLensPromptForStyle, ANALYST_ROLE_DEFINITIONS } from '../services/ui/AnalystLensService';
import { AnalystRole } from '../types';

const config: ProviderConfig = {
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: true,
    models: ['model-a'],
    selectedModel: 'model-a',
};

// Distinct identities per role — getRoleForProvider returns the FIRST
// assignment whose provider+model match, so three roles sharing one
// provider::model would all resolve to the Macro persona.
const ROLE_MODELS: Record<AnalystRole, string> = {
    [AnalystRole.MACRO_VOLATILITY]: 'model-a',
    [AnalystRole.TECHNICAL_ANALYST]: 'model-b',
    [AnalystRole.RISK_EXECUTION]: 'model-c',
    [AnalystRole.UNASSIGNED]: 'model-a',
};

const ASSIGNMENTS = [
    { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: 'prov-a', assignedModel: ROLE_MODELS[AnalystRole.MACRO_VOLATILITY] },
    { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: 'prov-a', assignedModel: ROLE_MODELS[AnalystRole.TECHNICAL_ANALYST] },
    { role: AnalystRole.RISK_EXECUTION, assignedProvider: 'prov-a', assignedModel: ROLE_MODELS[AnalystRole.RISK_EXECUTION] },
];

// Realistic transcripts in the shapes the lens prompts demand.
const MACRO_TRANSCRIPT = `
Weekly and daily are both HH/HL. 4H is still holding $93,800. Liquidity sits above $97,500; ATR on the 4H is expanding, so continuation has room if we wait for the session.

MACRO VERDICT: Bullish
Probability: 65%
`;

const TECHNICAL_TRANSCRIPT = `
1H HH/HL is intact after the BOS at $93,200. FVG at $93,600–$93,900 is partially filled; RSI 58 rising, MACD histogram expanding. This is a continuation long, not a trap.

TECHNICAL BIAS: LONG
Optimal Entry Zone: $93,800 to $94,200
Stop Loss: 93,400
Take Profit 1: 96,500
Take Profit 2: 97,800
Probability: 68%
`;

const RISK_TRANSCRIPT = `
The technical long is mathematically fine: 600 risk to 2,500 reward is 4.2 R. Session is not a news window. I'd size full.

VERDICT: APPROVE LONG
Entry: 94,000
Stop Loss: 93,400
Take Profit 1: 96,500
Probability: 70%
`;

const runAnalyst = async (role: AnalystRole, transcript: string) => {
    const identity = `${config.id}::${ROLE_MODELS[role]}`;
    const rolePrompt = getLensPromptForStyle(identity, ASSIGNMENTS, 'swing');
    expect(rolePrompt).toContain(ANALYST_ROLE_DEFINITIONS[role].name);
    const result = await analyzeTradingView(config, {
        prompt: 'Analyze BTCUSDT for a long setup.',
        images: [],
        imageSummaries: [],
        chatHistory: [],
        finalTradeSummary: null,
        recentInsights: null,
        activeFrameworks: ['Trend Following'],
        deepenAnalysis: false,
        globalMemory: undefined,
        threadSummary: undefined,
        subMode: undefined,
        customInstructions: '',
        isPlaybookEnabledInPureAI: false,
        isFamiliesEnabledInPureAI: false,
        isMemoryEnabledInPureAI: false,
        rolePrompt,
        systemPromptOverride: undefined,
        userStrategies: undefined,
        onReasoning: () => {},
    });
    return result;
};

describe('lens-mode pipeline end-to-end (real prompts + parser + consensus)', () => {
    beforeEach(() => {
        streamMock.mockReset();
    });

    it('builds a REAL per-analyst plan from lens transcripts (no more Neutral placeholder)', async () => {
        // Script one transcript per role in call order.
        const transcripts = [MACRO_TRANSCRIPT, TECHNICAL_TRANSCRIPT, RISK_TRANSCRIPT];
        let call = 0;
        streamMock.mockImplementation(async function* () {
            yield transcripts[Math.min(call, transcripts.length - 1)];
            call++;
        });

        const macro = await runAnalyst(AnalystRole.MACRO_VOLATILITY, MACRO_TRANSCRIPT);
        const tech = await runAnalyst(AnalystRole.TECHNICAL_ANALYST, TECHNICAL_TRANSCRIPT);
        const risk = await runAnalyst(AnalystRole.RISK_EXECUTION, RISK_TRANSCRIPT);

        // The analyst system prompt carries the persona + the plan-block contract.
        const [, messages] = streamMock.mock.calls[0];
        const systemPrompt = messages[0].content as string;
        expect(systemPrompt).toContain('Macro & Volatility Analyst');
        expect(systemPrompt).toContain('SPECIALIZED ANALYST ROLE ACTIVE');
        expect(systemPrompt).toContain('WRITE-UP');
        expect(systemPrompt).not.toContain('TRADE PLAN BLOCK (MANDATORY');
        expect(systemPrompt).not.toContain('Output **exactly**');

        // Macro: domain-respecting — direction + probability, NO fabricated levels.
        expect(macro.analysis.direction).toBe('Long');
        expect(macro.analysis.probability).toBe(65);
        expect(macro.analysis.entryPoints.length).toBe(0);
        expect(macro.analysis.stopLoss).toBe('');

        // Technical: full setup extracted.
        expect(tech.analysis.direction).toBe('Long');
        expect(tech.analysis.entryPoints[0].price).toBe('93,800 - 94,200');
        expect(tech.analysis.stopLoss).toBe('93,400');
        expect(tech.analysis.takeProfit.map((t: { price: string }) => t.price)).toEqual(['96,500', '97,800']);
        expect(tech.analysis.probability).toBe(68);

        // Risk: validates the plan with its own levels.
        expect(risk.analysis.direction).toBe('Long');
        expect(risk.analysis.stopLoss).toBe('93,400');
        expect(risk.analysis.probability).toBe(70);
    });

    it('feeds REAL levels into the consensus + divergence layer (was dead)', async () => {
        const transcripts = [MACRO_TRANSCRIPT, TECHNICAL_TRANSCRIPT, RISK_TRANSCRIPT];
        let call = 0;
        streamMock.mockImplementation(async function* () {
            yield transcripts[Math.min(call, transcripts.length - 1)];
            call++;
        });

        const results = [
            await runAnalyst(AnalystRole.MACRO_VOLATILITY, MACRO_TRANSCRIPT),
            await runAnalyst(AnalystRole.TECHNICAL_ANALYST, TECHNICAL_TRANSCRIPT),
            await runAnalyst(AnalystRole.RISK_EXECUTION, RISK_TRANSCRIPT),
        ];
        const consensus = buildAnalystConsensus(results.map((r, i) => ({
            provider: { config: { id: config.id }, name: `Analyst ${i + 1}` },
            result: r,
        })));

        expect(consensus).toBeDefined();
        expect(consensus!.entries.length).toBe(3);
        // Entry levels and stop losses survive into the explainability panel.
        expect(consensus!.entries[1].entry).toBe('93,800 - 94,200');
        expect(consensus!.entries[1].stopLoss).toBe('93,400');
        expect(consensus!.entries[1].takeProfit).toBe('96,500');
        expect(consensus!.entries[1].probability).toBe(68);
        // Probabilities differ per analyst → divergence math has real input.
        expect(consensus!.entries.map(e => e.probability)).toEqual([65, 68, 70]);
        // All three agree on direction → echo-chamber flag fires (real input).
        expect(consensus!.divergence.score).toBeGreaterThanOrEqual(0);
        expect(consensus!.divergence.details.some(d => d.includes('All analysts agree on direction'))).toBe(true);
    });

    it('keeps lens personas in accuracy mode (roleBlock is injected)', async () => {
        streamMock.mockImplementation(async function* () {
            yield TECHNICAL_TRANSCRIPT;
        });
        const identity = `${config.id}::${ROLE_MODELS[AnalystRole.TECHNICAL_ANALYST]}`;
        const rolePrompt = getLensPromptForStyle(identity, ASSIGNMENTS, 'swing');
        await analyzeTradingView(config, {
            prompt: 'Analyze BTCUSDT for a long setup.',
            images: [],
            imageSummaries: [],
            chatHistory: [],
            finalTradeSummary: null,
            recentInsights: null,
            activeFrameworks: ['Trend Following'],
            deepenAnalysis: false,
            globalMemory: undefined,
            threadSummary: undefined,
            subMode: 'original', // accuracy mode
            customInstructions: '',
            isPlaybookEnabledInPureAI: false,
            isFamiliesEnabledInPureAI: false,
            isMemoryEnabledInPureAI: false,
            rolePrompt,
            systemPromptOverride: undefined,
            userStrategies: undefined,
            onReasoning: () => {},
        });
        const [, messages] = streamMock.mock.calls[0];
        const systemPrompt = messages[0].content as string;
        // The accuracy branch must include the persona (the old code dropped
        // rolePrompt in accuracy/pure-AI modes entirely).
        expect(systemPrompt).toContain('Technical Analyst');
        expect(systemPrompt).toContain('SPECIALIZED ANALYST ROLE ACTIVE');
    });
});

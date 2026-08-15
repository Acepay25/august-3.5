import { describe, expect, it } from 'vitest';
import { extractTokenUsage, mergeTokenUsage, estimateCostUsd } from '../utils/tokenUsage';
import { summarizeUsagePeriod } from '../utils/sessionUsage';

describe('extractTokenUsage', () => {
    it('reads OpenAI chat completions usage', () => {
        expect(extractTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })).toEqual({
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
        });
    });

    it('reads Anthropic / Responses usage fields', () => {
        expect(extractTokenUsage({ usage: { input_tokens: 8, output_tokens: 12 } })).toEqual({
            promptTokens: 8,
            completionTokens: 12,
            totalTokens: 20,
        });
    });
});

describe('estimateCostUsd', () => {
    it('applies per-1k rates', () => {
        expect(estimateCostUsd(
            { promptTokens: 1000, completionTokens: 2000, totalTokens: 3000 },
            { inputUsdPer1k: 0.5, outputUsdPer1k: 1.5 },
        )).toBeCloseTo(3.5);
    });
});

describe('summarizeUsagePeriod', () => {
    it('sums entries after the cutoff', () => {
        const summary = summarizeUsagePeriod([
            { at: '2026-08-15T01:00:00.000Z', durationMs: 1000, promptTokens: 10, completionTokens: 20, tokensEst: 8, analystCount: 3 },
            { at: '2026-08-01T01:00:00.000Z', durationMs: 5000, promptTokens: 99, completionTokens: 99, tokensEst: 40, analystCount: 1 },
        ], Date.parse('2026-08-14T00:00:00.000Z'));
        expect(summary.runs).toBe(1);
        expect(summary.promptTokens).toBe(10);
        expect(summary.completionTokens).toBe(20);
        expect(summary.tokensExact).toBe(true);
    });
});

describe('mergeTokenUsage', () => {
    it('adds both sides', () => {
        expect(mergeTokenUsage(
            { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
            { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
        )).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
    });
});

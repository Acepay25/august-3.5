/**
 * The context window the app believes in — and what that belief is allowed to
 * do.
 *
 * Two claims get pinned here, and the second is the one that makes the first
 * safe to make:
 *
 *  1. Resolution order and the 1,000,000 default the owner set on 2026-10-20.
 *  2. Raising that default must not have inflated a single INJECTED byte. Every
 *     injection budget is `min(cap, window × fraction)` and both caps already
 *     bind at the old 65,536, so the change is provably inert for memory and
 *     the market packet. Without this control arm, "we now assume 1M" is a
 *     licence to send a 15x bigger notebook to a 128K model.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    DEFAULT_OUTPUT_RESERVE_TOKENS,
    WIRE_FRAMING_SAFETY_TOKENS,
    contextLengthLimitFromError,
    isContextLengthError,
    measuredContextWindow,
    outputTokenBudget,
    promptTokenCeiling,
    recordMeasuredContextWindow,
    resetMeasuredContextWindows,
    resolveContextWindow,
} from '../utils/contextWindow';
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS, windowBudgetTokens } from '../utils/tokenEstimate';
import type { ProviderConfig } from '../types/provider';

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1',
    name: 'Provider One',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['model-a'],
    selectedModel: 'model-a',
    ...over,
});

beforeEach(() => { resetMeasuredContextWindows(); });

describe('the assumed window', () => {
    it('is the owner\'s 1M default, and tokenEstimate reads the SAME number', () => {
        expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(1_000_000);
        // One number, two names: an alias that drifted would size injections
        // off a different window than the one compaction holds the wire to.
        expect(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    });

    it('changes no injected byte, because every cap already bound at 65,536', () => {
        // Retrieved memory: 2% fraction, 900-token cap.
        expect(windowBudgetTokens(0.02, 900, 65_536)).toBe(900);
        expect(windowBudgetTokens(0.02, 900, DEFAULT_CONTEXT_WINDOW_TOKENS)).toBe(900);
        // The market packet: 10% fraction, 6,000-token cap.
        expect(windowBudgetTokens(0.10, 6_000, 65_536)).toBe(6_000);
        expect(windowBudgetTokens(0.10, 6_000, DEFAULT_CONTEXT_WINDOW_TOKENS)).toBe(6_000);
    });

    it('still SHRINKS for a small window, which is what the override is for', () => {
        // The floor, not the default, decides below ~45K — and a 8K seat must
        // still get a smaller budget than a 1M one.
        expect(windowBudgetTokens(0.02, 100_000, 8_192)).toBe(300);
        expect(windowBudgetTokens(0.02, 100_000, DEFAULT_CONTEXT_WINDOW_TOKENS)).toBe(20_000);
    });
});

describe('resolveContextWindow', () => {
    it('falls back to the default and says it was assumed', () => {
        const r = resolveContextWindow(config());
        expect(r.tokens).toBe(1_000_000);
        expect(r.source).toBe('default');
        expect(r.label).toMatch(/assumed/i);
        expect(r.label).toMatch(/has not stated one/i);
    });

    it('prefers the trader\'s override over everything, including a limit it just measured', () => {
        recordMeasuredContextWindow('p1', 'model-a', 128_000);
        const r = resolveContextWindow(config({
            contextWindowTokens: 32_768,
            modelContextWindows: { 'model-a': 1_048_576 },
        }));
        expect(r.tokens).toBe(32_768);
        expect(r.source).toBe('user');
        expect(r.label).toMatch(/your override/i);
    });

    it('prefers a measured rejection over the model\'s own report', () => {
        recordMeasuredContextWindow('p1', 'model-a', 128_000);
        const r = resolveContextWindow(config({ modelContextWindows: { 'model-a': 1_000_000 } }));
        expect(r.tokens).toBe(128_000);
        expect(r.source).toBe('measured');
        expect(r.label).toMatch(/rejected request/i);
    });

    it('uses the reported per-model window when nothing better exists', () => {
        const r = resolveContextWindow(config({ modelContextWindows: { 'model-a': 262_144 } }));
        expect(r.tokens).toBe(262_144);
        expect(r.source).toBe('model');
    });

    it('ignores a report for a DIFFERENT model', () => {
        // Switching the seat to another model on the same provider must not
        // inherit the previous model's window.
        const r = resolveContextWindow(config({ modelContextWindows: { 'other-model': 8_192 } }));
        expect(r.tokens).toBe(1_000_000);
        expect(r.source).toBe('default');
    });

    it('rejects a nonsense stored value instead of believing it', () => {
        expect(resolveContextWindow(config({ contextWindowTokens: 0 })).source).toBe('default');
        expect(resolveContextWindow(config({ contextWindowTokens: -5 })).source).toBe('default');
        expect(resolveContextWindow(config({ contextWindowTokens: NaN })).source).toBe('default');
    });

    it('records only a plausible measured limit', () => {
        recordMeasuredContextWindow('p1', 'model-a', 128_000);
        expect(measuredContextWindow('p1', 'model-a')).toBe(128_000);
        recordMeasuredContextWindow('p1', 'model-a', 4);
        expect(measuredContextWindow('p1', 'model-a')).toBe(128_000);
        recordMeasuredContextWindow('p2', 'model-b', 128_000);
        expect(measuredContextWindow('p1', 'model-a')).toBe(128_000);
    });
});

describe('promptTokenCeiling', () => {
    it('subtracts the output reserve and the framing the estimator cannot see', () => {
        expect(promptTokenCeiling(128_000, 8_192)).toBe(128_000 - 8_192 - WIRE_FRAMING_SAFETY_TOKENS);
    });

    it('never answers zero, which would ask the compactor to delete the question', () => {
        // A 4K window with an 8K output budget does not fit at all; the floor
        // is what makes `stillOver` a MEASUREMENT rather than a negative number.
        expect(promptTokenCeiling(4_096, 8_192)).toBe(1_024);
    });

    it('falls back to the wire\'s own output default when the reserve is unusable', () => {
        // `max_tokens ?? 4096` is what the transport will actually send, so a
        // ceiling that reserved nothing would promise the prompt room the answer
        // then claims. Zero, NaN and undefined all land on the same default.
        expect(promptTokenCeiling(100_000, 0)).toBe(100_000 - 4_096 - WIRE_FRAMING_SAFETY_TOKENS);
        expect(promptTokenCeiling(100_000, NaN)).toBe(100_000 - DEFAULT_OUTPUT_RESERVE_TOKENS - WIRE_FRAMING_SAFETY_TOKENS);
        expect(promptTokenCeiling(NaN, 8_192)).toBe(1_000_000 - 8_192 - WIRE_FRAMING_SAFETY_TOKENS);
    });
});

describe('outputTokenBudget', () => {
    it('is what the window has left after the prompt and the framing reserve', () => {
        expect(outputTokenBudget(12_000, 7_000)).toBe(12_000 - 7_000 - WIRE_FRAMING_SAFETY_TOKENS);
    });

    it('is zero, not negative, when the prompt already fills the window', () => {
        expect(outputTokenBudget(2_000, 6_000)).toBe(0);
    });

    it('falls back to the assumed window for an unusable input', () => {
        expect(outputTokenBudget(NaN, 1_000)).toBe(1_000_000 - 1_000 - WIRE_FRAMING_SAFETY_TOKENS);
        expect(outputTokenBudget(12_000, NaN)).toBe(12_000 - WIRE_FRAMING_SAFETY_TOKENS);
    });
});

describe('isContextLengthError', () => {
    it('names the window rejections this app\'s four wire families send', () => {
        const samples = [
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens (OpenAI).",
            'prompt is too long: 210000 tokens > 200000 maximum (Anthropic)',
            'context_length_exceeded (gateway code)',
            'The inputs.length 130000 specified in the request body exceeds the model context window length (128000). (xAI)',
            'CreateCompletion: request too many tokens to process (Azure)',
            'ollama.err: 400 Bad Request — context size is 4096, too large for this model',
            'Gemini: request exceeds the context token limit of 32000',
        ];
        for (const sample of samples) expect(isContextLengthError(sample)).toBe(true);
    });

    it('does NOT call a rate limit or an auth failure a window problem', () => {
        // Compacting history does nothing for either, and a false positive here
        // spends a retry and rewrites the trader\'s transcript for nothing.
        const notWindow = [
            'Rate limit reached for requests (HTTP 429).',
            'Invalid API key (HTTP 401).',
            'Insufficient credits. Add more billing credits to your account.',
            'Your request body is too long: 41 MB exceeds the 20 MB upload limit.',
            'Model not found: gpt-4o-mini-2024-07-18.',
            '',
        ];
        for (const sample of notWindow) expect(isContextLengthError(sample)).toBe(false);
    });
});

describe('contextLengthLimitFromError', () => {
    it('reads the LIMIT, not the prompt size, when a message states both', () => {
        expect(contextLengthLimitFromError(
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
        )).toBe(128_000);
        expect(contextLengthLimitFromError('prompt is too long: 210000 tokens > 200000 maximum')).toBe(200_000);
        expect(contextLengthLimitFromError('The inputs.length 130000 exceeds the model context window length (128000).')).toBe(128_000);
        expect(contextLengthLimitFromError('context size is 4096, too large for this model')).toBe(4_096);
    });

    it('reads thousands separators', () => {
        expect(contextLengthLimitFromError('maximum context length is 1,000,000 tokens')).toBe(1_000_000);
    });

    it('refuses to believe a number that cannot be a window', () => {
        // `1` and `0` appear in these strings as counts, not limits, and a
        // window of 1 token would compact every later turn to nothing. A wrong
        // reading that PERSISTS is worse than no reading.
        expect(contextLengthLimitFromError('maximum context length is 1 tokens')).toBeNull();
        expect(contextLengthLimitFromError('too many tokens: 3 expected, 0 allowed')).toBeNull();
    });

    it('returns null for a context error that states no number', () => {
        expect(contextLengthLimitFromError('context_length_exceeded')).toBeNull();
    });

    it('returns null when the message is not a window error at all', () => {
        expect(contextLengthLimitFromError('Rate limit reached for requests.')).toBeNull();
        expect(contextLengthLimitFromError(undefined)).toBeNull();
    });
});

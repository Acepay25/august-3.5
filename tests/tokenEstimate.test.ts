/**
 * Token estimation and the window-derived memory budget.
 *
 * Two claims these pin:
 *   · the estimator must never budget MORE optimistically than the old
 *     chars/4 rule it replaces — an under-estimate delays compaction until the
 *     provider 4xx's, which is the failure mode being fixed;
 *   · the retrieved-memory allowance scales with the model's window but stays
 *     inside a floor and a ceiling, so neither a tiny model nor a 1M-context
 *     model gets an unsafe amount.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    charsForTokens,
    estimateTokens,
    observePromptRatio,
    observedCharsPerToken,
    resetObservedRatio,
    tokensForChars,
    windowBudgetTokens,
} from '../utils/tokenEstimate';
import { stageBudgetChars } from '../services/learning/MemoryRetrievalService';

describe('estimateTokens', () => {
    it('agrees with chars/4 on plain English prose, plus the framing constant', () => {
        const prose = 'the market is ranging and volume is fading on the retest';
        expect(estimateTokens(prose) - 4).toBeCloseTo(prose.length / 4, 0);
    });

    it('counts CJK far heavier than chars/4, which is the bug being fixed', () => {
        // "高位放量滞涨，等回踩" — 12 wide chars. chars/4 says 3 tokens;
        // each of these is realistically one token.
        const cjk = '高位放量滞涨，等回踩一下再做多';
        const naive = cjk.length / 4;
        expect(estimateTokens(cjk)).toBeGreaterThan(naive * 2);
    });

    it('counts digits and punctuation heavier than letters', () => {
        const letters = 'aaaaaaaaaaaa';
        const dense = '1,234.56;0x9f=(';
        expect(estimateTokens(dense)).toBeGreaterThan(estimateTokens(letters) * 1.5);
    });

    it('includes a per-message framing overhead', () => {
        // 'hi' = 2 letters -> ceil(0.5) = 1 token, + 4 framing.
        expect(estimateTokens('hi')).toBe(5);
    });

    it('is empty-safe rather than throwing', () => {
        // No content means no message, so no framing overhead either.
        expect(estimateTokens(null)).toBe(0);
        expect(estimateTokens(undefined)).toBe(0);
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('a')).toBe(5); // ceil(0.25)=1, +4 framing
    });

    it('treats an emoji surrogate pair as one character, not two', () => {
        // 0x1F600 is two JS units but one codepoint; iterating units inflates.
        expect(estimateTokens('😀')).toBe(estimateTokens('é'));
    });
});

describe('chars/tokens round trip', () => {
    it('charsForTokens is the conservative inverse of the ASCII assumption', () => {
        expect(charsForTokens(100)).toBe(400);
        expect(charsForTokens(0)).toBe(0);
        expect(charsForTokens(-5)).toBe(0);
    });

    it('tokensForChars never exceeds what charsForTokens allows back', () => {
        for (const chars of [0, 1, 400, 901, 5000]) {
            expect(charsForTokens(tokensForChars(chars))).toBeLessThanOrEqual(chars);
        }
    });
});

describe('windowBudgetTokens', () => {
    it('applies a floor, a fraction and a cap in that order of precedence', () => {
        // 65536 * 2% = 1310 -> the 900 cap wins.
        expect(windowBudgetTokens(0.02, 900, 65_536)).toBe(900);
        // 8192 * 2% = 163 -> the 300 floor wins, so memory never switches off.
        expect(windowBudgetTokens(0.02, 100_000, 8_192)).toBe(300);
        // A cap below the floor still wins — the caller's ceiling is honoured.
        expect(windowBudgetTokens(0.02, 100, 8_192)).toBe(100);
        // Mid-band: neither floor nor cap binds, so the fraction is the answer.
        expect(windowBudgetTokens(0.02, 100_000, 65_536)).toBe(1310);
    });

    it('caps a huge window instead of sending an unbounded notebook', () => {
        expect(windowBudgetTokens(0.02, 900, 1_000_000)).toBe(900);
    });

    it('keeps a floor so a tiny window does not switch memory off entirely', () => {
        expect(windowBudgetTokens(0.02, 900, 128)).toBe(300);
    });

    it('falls back to the conservative default window when none is given', () => {
        expect(windowBudgetTokens(0.02, 900)).toBe(
            windowBudgetTokens(0.02, 900, DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS),
        );
    });
});

describe('stageBudgetChars', () => {
    const HISTORICAL_FLOOR: Record<string, number> = {
        opening: 900, rebuttal: 400, verdict: 600,
    };

    it('never drops below the historical allowance the app ran on before', () => {
        // The whole point of keeping the constants as floors: scaling down a
        // model's window must not silently REMOVE memory that used to be sent.
        for (const stage of ['opening', 'rebuttal', 'verdict'] as const) {
            expect(stageBudgetChars(stage, 4_096)).toBeGreaterThanOrEqual(HISTORICAL_FLOOR[stage]);
            expect(stageBudgetChars(stage, 32_768)).toBeGreaterThanOrEqual(HISTORICAL_FLOOR[stage]);
        }
    });

    it('gives a larger window more memory, in the same stage proportions', () => {
        const small = stageBudgetChars('opening', 16_384);
        const large = stageBudgetChars('opening', 131_072);
        expect(large).toBeGreaterThan(small);
        // Proportions preserved from the old 900 : 400 : 600 split.
        const ratio = stageBudgetChars('rebuttal', 131_072) / stageBudgetChars('opening', 131_072);
        expect(ratio).toBeCloseTo(400 / 900, 2);
    });

    it('is bounded, so a 1M window cannot balloon the prompt', () => {
        expect(stageBudgetChars('opening', 1_000_000)).toBeLessThanOrEqual(900 * 4 + 400);
    });
});

describe('provider-usage anchoring', () => {
    beforeEach(() => resetObservedRatio());

    it('adopts a measured ratio inside the sane band', () => {
        observePromptRatio(1000, 3500);
        expect(observedCharsPerToken()).toBeCloseTo(3.5, 5);
    });

    it('refuses a garbage frame rather than becoming reckless', () => {
        observePromptRatio(1000, 100_000); // ratio 100 — absurd
        expect(observedCharsPerToken()).toBeNull();
        observePromptRatio(0, 10);
        expect(observedCharsPerToken()).toBeNull();
        observePromptRatio(NaN, 10);
        expect(observedCharsPerToken()).toBeNull();
    });
});

describe('the measured ratio must NOT size an allowance', () => {
    // Consuming `observedCharsPerToken` was tried on 2026-09-22 and reverted.
    // The ratio is message-text chars over a promptTokens that also counts
    // system framing and every tool schema, so it describes their difference,
    // not the text — and it is a sticky module global. One CJK-dense prompt
    // measures ~1.0 and would have pinned charsForTokens at a quarter of its
    // size for the rest of the session, starving the memory injected into
    // every later debate. These fail the moment the measurement is wired in
    // again without a like-for-like numerator and denominator.
    beforeEach(() => resetObservedRatio());

    it('leaves the allowance on the constant whatever the measurement says', () => {
        expect(charsForTokens(100)).toBe(400);
        observePromptRatio(1000, 1500);
        expect(observedCharsPerToken()).toBe(1.5);
        expect(charsForTokens(100)).toBe(400);
    });

    it('leaves the inverse on the constant too', () => {
        observePromptRatio(1000, 1500);
        expect(tokensForChars(4000)).toBe(1000);
    });
});

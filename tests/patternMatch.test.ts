import { describe, it, expect } from 'vitest';
import { familiesRelate } from '../utils/patternMatch';
import { calculateSimilarity, type SetupContext } from '../services/learning/PatternMemorySynthesisService';
import type { LoggedTrade } from '../types';

// Family matching must be negation-aware — "fake-breakout" is the
// OPPOSITE of "breakout", which plain substring includes() got backwards.

describe('familiesRelate (negation-aware segment matching)', () => {
    it('refuses negated variants of the same word', () => {
        expect(familiesRelate('breakout', 'fake-breakout')).toBe(false);
        expect(familiesRelate('fake-breakout', 'breakout')).toBe(false);
        expect(familiesRelate('breakout', 'failed breakout')).toBe(false);
        expect(familiesRelate('false breakout', 'breakout continuation')).toBe(false);
        expect(familiesRelate('exhausted move', 'move')).toBe(false);
        expect(familiesRelate('rejection wick', 'wick')).toBe(false);
    });

    it('accepts genuine overlaps and case/spacing differences', () => {
        expect(familiesRelate('breakout retest', 'breakout')).toBe(true);
        expect(familiesRelate('Fake Breakout', 'fake-breakout')).toBe(true);
        expect(familiesRelate('Family A', 'family a')).toBe(true);
        expect(familiesRelate('momentum burst', 'burst continuation')).toBe(true);
    });

    it('rejects disjoint families outright', () => {
        expect(familiesRelate('breakout', 'choppy range')).toBe(false);
        expect(familiesRelate('', 'breakout')).toBe(false);
    });
});

const makeTrade = (family: string): LoggedTrade =>
    ({
        id: 't1',
        outcome: 'LOSS',
        timestamp: new Date().toISOString(),
        analysis: {
            coinName: 'BTCUSDT',
            direction: 'Short',
            confidence: 'High',
            detectedPatternFamily: family,
        },
    }) as never as LoggedTrade;

describe('calculateSimilarity family scoring (negation-aware)', () => {
    const setup: SetupContext = { coin: 'BTCUSDT', direction: 'Short', family: 'breakout' };

    it('scores a true family match above its negated variant', () => {
        const real = calculateSimilarity(setup, makeTrade('breakout'));
        const fake = calculateSimilarity(setup, makeTrade('fake-breakout'));
        // Coin/direction/recency points are identical — only family differs.
        expect(real).toBeGreaterThan(fake);
        expect(fake).toBeLessThan(100);
    });
});

/**
 * Label prefixes are not descriptors. Every family in the app is labelled
 * "Family A" … "Family Z", so each contains the literal token "family" — and
 * sharing that word alone made every family relate to every other one. This
 * predicate backs the strict enforcement matcher, so a "Family A" skill
 * claimed to cover "Family Z" and a distinct setup looked already handled.
 */
describe('familiesRelate ignores label prefixes', () => {
    it('does not relate two different families on the shared word "family"', () => {
        expect(familiesRelate('Family Z', 'Family A')).toBe(false);
    });

    it('still relates the same family', () => {
        expect(familiesRelate('Family A', 'Family A')).toBe(true);
        expect(familiesRelate('family a', 'FAMILY-A')).toBe(true);
    });

    it('still relates families that share a real descriptor', () => {
        expect(familiesRelate('Family A', 'A')).toBe(true);
        expect(familiesRelate('breakout retest', 'breakout')).toBe(true);
    });

    it('does not strip a family genuinely NAMED "family"', () => {
        // Nothing follows the label word, so the token stays and can match.
        expect(familiesRelate('family', 'family')).toBe(true);
    });
});

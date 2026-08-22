import { describe, it, expect } from 'vitest';
import { familiesRelate } from '../utils/patternMatch';
import { calculateSimilarity, type SetupContext } from '../services/learning/PatternMemorySynthesisService';
import type { LoggedTrade } from '../types';

// ROUND-26: family matching must be negation-aware — "fake-breakout" is the
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

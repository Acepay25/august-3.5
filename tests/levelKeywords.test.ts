import { describe, it, expect } from 'vitest';

import { isSpecificData, LEVEL_OR_VALUE, PATTERN } from '../utils/levelKeywords';

describe('isSpecificData', () => {
    it('rejects empty / very short data', () => {
        expect(isSpecificData('')).toBe(false);
        expect(isSpecificData('ok')).toBe(false);
        expect(isSpecificData('low')).toBe(false);
    });

    it('accepts data with a number', () => {
        expect(isSpecificData('BTC 4H close below 94200')).toBe(true);
        expect(isSpecificData('price 1.234')).toBe(true);
    });

    it('accepts data with a level keyword', () => {
        expect(isSpecificData('reclaim of support')).toBe(true);
        expect(isSpecificData('order block at 94k')).toBe(true);
        expect(isSpecificData('sweep + reclaim')).toBe(true);
    });

    it('accepts data with a pattern keyword', () => {
        expect(isSpecificData('breakout above resistance')).toBe(true);
        expect(isSpecificData('head and shoulders forming')).toBe(true);
        expect(isSpecificData('range day 5')).toBe(true);
    });

    it('rejects vague prose without numbers, levels, or patterns', () => {
        expect(isSpecificData('looks pretty bearish to me')).toBe(false);
        expect(isSpecificData('a quiet tape, probably nothing')).toBe(false);
    });

    it('exposes LEVEL_OR_VALUE and PATTERN as exported regexes', () => {
        expect(LEVEL_OR_VALUE.test('reclaim support')).toBe(true);
        expect(PATTERN.test('breakout')).toBe(true);
    });
});

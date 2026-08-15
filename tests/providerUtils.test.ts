import { describe, expect, it } from 'vitest';
import { formatModelDisplayName, formatSeatLabel, isFreeModelId, sortModelsFreeFirst, mergeDiscoveredModels, resolveModelLabel } from '../utils/providerUtils';

describe('formatModelDisplayName', () => {
    it('turns slugs into readable labels', () => {
        expect(formatModelDisplayName('deepseek-v4-flash')).toBe('Deepseek V4 Flash');
        expect(formatModelDisplayName('openrouter/deepseek/deepseek-v4-flash')).toBe('Deepseek V4 Flash');
        expect(formatModelDisplayName('deepseek-v4-flash:free')).toBe('Deepseek V4 Flash Free');
        expect(formatModelDisplayName('gpt-4o')).toBe('GPT 4o');
    });
});

describe('formatSeatLabel', () => {
    it('pretty-prints a provider · slug seat name', () => {
        expect(formatSeatLabel('Kilocode · stepfun/step-3.7-flash:free')).toBe('Kilocode · Step 3.7 Flash Free');
        expect(formatSeatLabel('tencent/hy3:free')).toBe('Hy3 Free');
        expect(formatSeatLabel('Macro & Volatility Analyst')).toBe('Macro & Volatility Analyst');
    });
});

describe('resolveModelLabel', () => {
    it('falls back to a formatted slug when the map misses', () => {
        expect(resolveModelLabel('deepseek-v4-flash', {})).toBe('Deepseek V4 Flash');
        expect(resolveModelLabel('x', { x: 'Custom Label' })).toBe('Custom Label');
    });
});

describe('isFreeModelId', () => {
    it('matches OpenRouter and *-free slugs', () => {
        expect(isFreeModelId('hy3-free')).toBe(true);
        expect(isFreeModelId('deepseek-v4-flash-free')).toBe(true);
        expect(isFreeModelId('openrouter/foo:free')).toBe(true);
        expect(isFreeModelId('provider/model/free')).toBe(true);
        expect(isFreeModelId('FREE')).toBe(true);
    });

    it('does not match paid or similarly named ids', () => {
        expect(isFreeModelId('big-pickle')).toBe(false);
        expect(isFreeModelId('gpt-4o')).toBe(false);
        expect(isFreeModelId('freedom-preview')).toBe(false);
        expect(isFreeModelId('')).toBe(false);
    });
});

describe('sortModelsFreeFirst / mergeDiscoveredModels', () => {
    it('lists free ids before paid and drops duplicates', () => {
        expect(sortModelsFreeFirst(['gpt-4o', 'deepseek-v4-flash-free', 'gpt-4o', 'mimo-v2.5-free'])).toEqual([
            'deepseek-v4-flash-free',
            'mimo-v2.5-free',
            'gpt-4o',
        ]);
    });

    it('keeps user extras that the catalog omitted', () => {
        expect(mergeDiscoveredModels(['custom-local', 'paid-model'], ['paid-model', 'hy3-free'])).toEqual([
            'hy3-free',
            'paid-model',
            'custom-local',
        ]);
    });
});

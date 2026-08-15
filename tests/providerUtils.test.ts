import { describe, expect, it } from 'vitest';
import { isFreeModelId, sortModelsFreeFirst, mergeDiscoveredModels } from '../utils/providerUtils';

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

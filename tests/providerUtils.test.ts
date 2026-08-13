import { describe, expect, it } from 'vitest';
import { isFreeModelId } from '../utils/providerUtils';

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

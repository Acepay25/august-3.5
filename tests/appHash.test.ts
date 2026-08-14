import { describe, expect, it } from 'vitest';
import { parseAppHash, serializeAppHash } from '../utils/appHash';

describe('appHash', () => {
    it('parses journal tabs and round-trips', () => {
        expect(parseAppHash('#/journal/learning')).toEqual({ view: 'journal', tab: 'learning' });
        expect(serializeAppHash({ view: 'journal', tab: 'learning' })).toBe('#/journal/learning');
        expect(serializeAppHash({ view: 'settings' })).toBe('#/settings');
        expect(parseAppHash('#/watch').view).toBe('watch');
        expect(parseAppHash('').view).toBe('chat');
    });
});

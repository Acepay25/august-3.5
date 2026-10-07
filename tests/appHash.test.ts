import { describe, expect, it } from 'vitest';
import { parseAppHash, serializeAppHash } from '../utils/appHash';

describe('appHash', () => {
    it('parses journal tabs and round-trips', () => {
        expect(parseAppHash('#/journal')).toEqual({ view: 'journal', tab: 'log' });
        expect(parseAppHash('#/journal/analytics')).toEqual({ view: 'journal', tab: 'analytics' });
        expect(parseAppHash('#/journal/saved')).toEqual({ view: 'journal', tab: 'saved' });
        // Dead tabs — the old performance/learning/memory/models/reasoning
        // set — fold to the ledger instead of rendering a blank panel. The
        // #/journal/learning SURFACE redirect keys off the raw hash upstream
        // (useSurfaceRouter), so the fold never strands that bookmark.
        expect(parseAppHash('#/journal/learning')).toEqual({ view: 'journal', tab: 'log' });
        expect(parseAppHash('#/journal/reasoning')).toEqual({ view: 'journal', tab: 'log' });
        expect(parseAppHash('#/journal/models')).toEqual({ view: 'journal', tab: 'log' });
        expect(serializeAppHash({ view: 'journal', tab: 'analytics' })).toBe('#/journal/analytics');
        expect(serializeAppHash({ view: 'settings' })).toBe('#/settings');
        expect(parseAppHash('#/watch').view).toBe('watch');
        expect(parseAppHash('').view).toBe('chat');
    });
});

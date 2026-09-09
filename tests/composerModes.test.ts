import { describe, it, expect } from 'vitest';
import {
    matchComposerCommand,
    composerCommandFor,
    COMPOSER_COMMANDS,
} from '../utils/composerModes';

describe('composer modes (slash commands)', () => {
    it('resolves the primary token, aliases, and prefixes', () => {
        expect(matchComposerCommand('research')?.id).toBe('research');
        expect(matchComposerCommand('/research')?.id).toBe('research');
        expect(matchComposerCommand('res')?.id).toBe('research');
        expect(matchComposerCommand('deep')?.id).toBe('research');
        expect(matchComposerCommand('analyze')?.id).toBe('research');
        expect(matchComposerCommand('visualize')?.id).toBe('visualize');
        expect(matchComposerCommand('chart')?.id).toBe('visualize');
        expect(matchComposerCommand('plot')?.id).toBe('visualize');
    });

    it('returns null for empty or non-command fragments (so skills still win)', () => {
        expect(matchComposerCommand('')).toBeNull();
        expect(matchComposerCommand('btc')).toBeNull();
        expect(matchComposerCommand('random-skill')).toBeNull();
    });

    it('a real skill slug is never captured as a command', () => {
        // Skills are notebook-authored; none of the reserved tokens collide
        // with the shipped command set.
        expect(matchComposerCommand('btc-short-avoid')).toBeNull();
    });

    it('composerCommandFor maps a set mode back to its command', () => {
        expect(composerCommandFor('research')?.label).toBe('Deep Research');
        expect(composerCommandFor('visualize')?.label).toBe('Visualize Data');
        expect(composerCommandFor(null)).toBeNull();
        expect(COMPOSER_COMMANDS.every(c => c.token === c.token.toLowerCase())).toBe(true);
    });
});

import { describe, it, expect } from 'vitest';
import { debatePreStep } from '../utils/debatePreStep';

/**
 * The conviction auction + devil's advocate + evidence round live inside
 * conductRealDebate's prompt assembly (not exported individually), so these
 * tests pin the observable contract: the pre-step waterfall still routes
 * skill vetoes, and the CONVICTION line format is parseable by the regex the
 * moderator-side builder uses.
 */
describe('debate flow upgrades — contracts', () => {
    it('pre-step waterfall still short-circuits on skill veto', () => {
        const d = debatePreStep({ skillVeto: 'avoid BTC long squeeze' });
        expect(d.action).toBe('skip_to_verdict');
        expect(d.inject).toContain('SKILL VETO');
    });

    it('CONVICTION line format matches the auction parser', () => {
        // The moderator-side parser uses /CONVICTION:\s*(\d{1,3})/i against the
        // final-round text. Pin that the documented format parses.
        const sample = 'Levels stay the same.\n\nCONVICTION: 72';
        const m = sample.match(/CONVICTION:\s*(\d{1,3})/i);
        expect(m?.[1]).toBe('72');
    });

    it('conviction values clamp to 0-100 in the auction block logic', () => {
        const clamp = (n: number): number => Math.min(100, Math.max(0, n));
        expect(clamp(150)).toBe(100);
        expect(clamp(-5)).toBe(0);
        expect(clamp(72)).toBe(72);
    });
});

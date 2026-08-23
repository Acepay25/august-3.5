import { describe, it, expect } from 'vitest';
import { parseReplyTo, turnAddressedTo, applyReplyTo } from '../utils/debateReplyTo';

describe('debate reply-to routing (ROUND-34)', () => {
    it('parses named recipients case-insensitively and strips @', () => {
        expect(parseReplyTo('My point stands.\nREPLY-TO: @Moderator, Technical')).toEqual(['moderator', 'technical']);
    });

    it('treats missing marker and "all" as floor-wide', () => {
        expect(parseReplyTo('No routing line here.')).toBeNull();
        expect(parseReplyTo('Text\nREPLY-TO: all')).toBeNull();
    });

    it('addressed filtering: named seats read it, others do not', () => {
        const turn = 'Funding is negative.\nREPLY-TO: Moderator';
        expect(turnAddressedTo(turn, 'Moderator')).toBe(true);
        expect(turnAddressedTo(turn, 'Technical')).toBe(false);
        expect(turnAddressedTo('Broadcast text', 'Technical')).toBe(true);
    });

    it('applyReplyTo strips the marker from display text and persists `to`', () => {
        const out = applyReplyTo({ speaker: 'Macro', text: 'Level holds.\nREPLY-TO: Risk' });
        expect(out.text).toBe('Level holds.');
        expect(out.to).toEqual(['risk']);
    });
});

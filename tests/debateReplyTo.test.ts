import { describe, it, expect } from 'vitest';
import { parseReplyTo, turnAddressedTo, applyReplyTo } from '../utils/debateReplyTo';

describe('debate reply-to routing', () => {
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

    it('lens aliases: a marker naming the anonymized label routes to the raw seat', () => {
        // With the lens on, the seat sees itself as "Macro Analyst" and writes
        // the marker with that label — routing must still recognize the seat.
        const turn = 'Funding is negative.\nREPLY-TO: Macro Analyst';
        expect(turnAddressedTo(turn, 'macro', ['Macro Analyst'])).toBe(true);
        expect(turnAddressedTo(turn, 'risk', ['Risk Analyst'])).toBe(false);
        // raw-name markers keep working when aliases are passed
        expect(turnAddressedTo('Text\nREPLY-TO: macro', 'macro', ['Macro Analyst'])).toBe(true);
        // no aliases (lens off) behaves exactly as before
        expect(turnAddressedTo(turn, 'macro')).toBe(false);
    });
});

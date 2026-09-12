/**
 * chatPanel — the pure planning half of Chart AI panel sessions: seats
 * derive from the stored model refs, the round-robin + synthesis schedule
 * terminates, and the room transcript names every speaker for cross-talk.
 */

import { describe, it, expect } from 'vitest';
import {
    panelSeats, planPanelTurn, formatRoomTranscript, parsePanelMentions,
    panelCouldStillBePass,
} from '../services/trade/chatPanel';
import type { ChatSession } from '../services/trade/chatSessions';

const labelFor = (modelId: string): string => modelId.toUpperCase();

describe('panelSeats', () => {
    it('dedupes models and caps at 5 seats', () => {
        const session = { panelModels: [
            { providerId: 'gemini', modelId: 'a' },
            { providerId: 'gemini', modelId: 'a' },
            { providerId: 'x', modelId: 'b' },
            { providerId: 'x', modelId: 'c' },
            { providerId: 'x', modelId: 'd' },
            { providerId: 'x', modelId: 'e' },
            { providerId: 'x', modelId: 'f' },
        ] } as ChatSession;
        const seats = panelSeats(session, labelFor);
        expect(seats.length).toBeLessThanOrEqual(5);
        expect(new Set(seats.map(s => s.id)).size).toBe(seats.length);
    });

    it('empty panel models → no seats', () => {
        expect(panelSeats({} as ChatSession, labelFor)).toEqual([]);
    });
});

describe('planPanelTurn', () => {
    const seats = [
        { id: 'p:m1', name: 'M1' },
        { id: 'p:m2', name: 'M2' },
        { id: 'p:m3', name: 'M3' },
    ];

    it('walks the round-robin in order', () => {
        expect(planPanelTurn(seats, []).seat?.id).toBe('p:m1');
        expect(planPanelTurn(seats, ['p:m1']).seat?.id).toBe('p:m2');
        expect(planPanelTurn(seats, ['p:m1', 'p:m2']).seat?.id).toBe('p:m3');
    });

    it('the last seat synthesizes exactly once, then the round settles', () => {
        const after = planPanelTurn(seats, ['p:m1', 'p:m2', 'p:m3']);
        expect(after.seat?.id).toBe('p:m3');
        expect(after.isSynthesis).toBe(true);
        const done = planPanelTurn(seats, ['p:m1', 'p:m2', 'p:m3', 'p:m3']);
        expect(done.seat).toBeNull();
        expect(done.isSynthesis).toBe(false);
    });

    it('an @mentioned seat jumps the round-robin queue', () => {
        // m1 spoke and mentioned m3 → m3 goes next, not m2.
        expect(planPanelTurn(seats, ['p:m1'], ['p:m3']).seat?.id).toBe('p:m3');
        // A pull for a seat that already spoke is ignored (no ghost turns).
        expect(planPanelTurn(seats, ['p:m1', 'p:m3'], ['p:m1']).seat?.id).toBe('p:m2');
        // Empty pull keeps plain order.
        expect(planPanelTurn(seats, ['p:m1'], []).seat?.id).toBe('p:m2');
    });

    it('a single-seat panel still completes', () => {
        const one = [{ id: 'p:m1', name: 'M1' }];
        expect(planPanelTurn(one, []).seat?.id).toBe('p:m1');
        // First turn is the opening (single seat — not a synthesis round).
        expect(planPanelTurn(one, []).isSynthesis).toBe(false);
        expect(planPanelTurn(one, ['p:m1']).seat).toBeNull();
    });
});

describe('formatRoomTranscript', () => {
    it('names every speaker so seats can quote each other', () => {
        const text = formatRoomTranscript(
            [{ seatId: 'p:m1', text: 'Bias long above 61k.' }, { seatId: 'p:m2', text: 'Funding says fade.' }],
            id => id.split(':')[1].toUpperCase(),
        );
        expect(text).toContain('M1: Bias long above 61k.');
        expect(text).toContain('M2: Funding says fade.');
        expect(text).toContain('panel has spoken');
    });
    it('empty room → empty string', () => {
        expect(formatRoomTranscript([], x => x)).toBe('');
    });
});

describe('parsePanelMentions', () => {
    const seats = [
        { id: 'a:m1', name: 'GPT' },
        { id: 'a:m2', name: 'Claude Opus' },
    ];
    it('routes known peers, skips self and strangers', () => {
        // Mentioning a peer FROM the other seat routes to the mentioned one;
        // self-mentions never route, strangers are ignored.
        expect(parsePanelMentions('I agree with @Claude Opus — @GPT backs this?', seats, 'a:m2')).toEqual(['a:m1']);
        expect(parsePanelMentions('ask @GPT about funding', seats, 'a:m1')).toEqual([]);
        expect(parsePanelMentions('ask @GPT about funding', seats, 'a:m2')).toEqual(['a:m1']);
        expect(parsePanelMentions('@nobody help', seats, 'a:m2')).toEqual([]);
    });
});

describe('silence', () => {
    it('couldStillBePass keeps partial pass streams hidden', () => {
        expect(panelCouldStillBePass('(pa')).toBe(true);
        expect(panelCouldStillBePass('(pass)')).toBe(true);
        expect(panelCouldStillBePass('')).toBe(true);
        expect(panelCouldStillBePass('long above')).toBe(false);
    });
});

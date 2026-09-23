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
import type { PanelSeat } from '../services/trade/chatPanel';

const labelFor = (modelId: string): string => modelId.toUpperCase();

/** A seat exactly as `panelSeats` builds one. The planner only reads id and
 *  name, but carrying the full shape keeps a fixture from drifting away from
 *  what the dock actually hands it — an agent seat adds `botId` on top. */
const seat = (id: string, name: string): PanelSeat => ({
    id, name, providerId: id.split(':')[0], modelId: id.split(':')[1],
});

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

    it('names an agent seat after the agent, keyed on the bot', () => {
        const session = { panelModels: [
            { providerId: 'gemini', modelId: 'llama-4', botId: 'b1' },
        ] } as ChatSession;
        expect(panelSeats(session, labelFor, (id) => (id === 'b1' ? 'Aria' : undefined))).toEqual([
            { id: 'bot:b1', name: 'Aria', providerId: 'gemini', modelId: 'llama-4', botId: 'b1' },
        ]);
    });

    it('keeps two agents that think with ONE model as two seats', () => {
        // The reason an agent seat exists: an agent is not its model. Keying
        // these on provider:model would silently delete a seated agent while
        // the picker still showed it.
        const session = { panelModels: [
            { providerId: 'gemini', modelId: 'llama-4', botId: 'b1' },
            { providerId: 'gemini', modelId: 'llama-4', botId: 'b2' },
        ] } as ChatSession;
        const seats = panelSeats(session, labelFor, id => ({ b1: 'Aria', b2: 'Bruno' })[id]);
        expect(seats.map(s => s.name)).toEqual(['Aria', 'Bruno']);
        expect(seats.map(s => s.id)).toEqual(['bot:b1', 'bot:b2']);
    });

    it('a deleted agent degrades to its model seat instead of naming a phantom', () => {
        const session = { panelModels: [
            { providerId: 'gemini', modelId: 'llama-4', botId: 'gone' },
        ] } as ChatSession;
        expect(panelSeats(session, labelFor, () => undefined)).toEqual([
            { id: 'gemini:llama-4', name: 'LLAMA-4', providerId: 'gemini', modelId: 'llama-4' },
        ]);
    });

    it('lets the SAME model sit on two relays (dedupe is provider:model, not bare model)', () => {
        // Regression: deduping on modelId alone collapsed two providers offering
        // one model into a single seat, even though the ids differ.
        const session = { panelModels: [
            { providerId: 'gemini', modelId: 'llama-4' },
            { providerId: 'groq', modelId: 'llama-4' },
        ] } as ChatSession;
        const seats = panelSeats(session, labelFor);
        expect(seats.map(s => s.id)).toEqual(['gemini:llama-4', 'groq:llama-4']);
    });
});

describe('planPanelTurn', () => {
    const seats = [
        seat('p:m1', 'M1'),
        seat('p:m2', 'M2'),
        seat('p:m3', 'M3'),
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
        const one = [seat('p:m1', 'M1')];
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
        seat('a:m1', 'GPT'),
        seat('a:m2', 'Claude Opus'),
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

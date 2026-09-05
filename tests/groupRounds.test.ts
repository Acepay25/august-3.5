import { describe, it, expect } from 'vitest';
import type { AgentBot } from '../services/agents/agentRoster';
import { AnalystRole } from '../types/enums';
import {
    PASS_TOKEN,
    ROOM_HUMAN_LABEL,
    buildRoomProtocolSection,
    buildRoomSystemPrompt,
    couldStillBePass,
    isPassReply,
    parseRoomMentions,
    renderRoomTurn,
} from '../services/agents/groupRounds';

// Bot Mode G2 (plan botmode-scan): the room engine's pure half —
// deterministic mention routing, "(pass)" silence, incremental per-member
// context, and the byte-stable room protocol.

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id' | 'name'>): AgentBot => ({
    providerId: 'gemini', modelId: 'gemini-2.5-pro', avatar: '',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
} as AgentBot);

const macro = bot({ id: 'b1', name: 'Macro', title: 'Thesis hunter' });
const risk = bot({ id: 'b2', name: 'Risk Bot' });
const scout = bot({ id: 'b3', name: 'Scout' });

describe('parseRoomMentions', () => {
    it('routes by exact handle, no-space form, and title', () => {
        expect(parseRoomMentions('@macro look', [macro, risk]).map(b => b.id)).toEqual(['b1']);
        expect(parseRoomMentions('@Risk-BOT size?', [macro, risk]).map(b => b.id)).toEqual(['b2']);
        expect(parseRoomMentions('hey @thesis-hunter', [macro, risk]).map(b => b.id)).toEqual(['b1']);
    });

    it('@everyone addresses all members', () => {
        expect(parseRoomMentions('@everyone react', [macro, risk, scout])).toHaveLength(3);
    });

    it('returns unique bots in first-mention order; ignores non-members', () => {
        // Handles are collapsed names: "Risk Bot" -> @riskbot. @risk is a
        // non-member token and must be ignored, not fuzzy-matched.
        const m = parseRoomMentions('@riskbot @macro @riskbot @ghost', [macro, risk]);
        expect(m.map(b => b.id)).toEqual(['b2', 'b1']);
    });

    it('plain prompts mention nobody (fan-out parity)', () => {
        expect(parseRoomMentions('analyze btc', [macro, risk])).toEqual([]);
    });
});

describe('(pass) semantics', () => {
    it('exact token and empty are passes; anything else speaks', () => {
        expect(isPassReply('(pass)')).toBe(true);
        expect(isPassReply('  (PASS)  ')).toBe(true);
        expect(isPassReply('')).toBe(true);
        expect(isPassReply('(pass) but one thing…')).toBe(false);
        expect(isPassReply('size 0.5R')).toBe(false);
    });

    it('streaming holds the bubble only while a pass is still possible', () => {
        expect(couldStillBePass('')).toBe(true);
        expect(couldStillBePass('(')).toBe(true);
        expect(couldStillBePass('(pas')).toBe(true);
        expect(couldStillBePass('(pass)')).toBe(true);
        expect(couldStillBePass('(pass) extra')).toBe(false);
        expect(couldStillBePass('BTC')).toBe(false);
    });
});

describe('renderRoomTurn (incremental context)', () => {
    it('renders unseen entries with self-perspective; the human stays Trader', () => {
        const turn = renderRoomTurn('Macro', [
            { speaker: ROOM_HUMAN_LABEL, text: 'analyze btc' },
            { speaker: 'Macro', text: 'heavy into supply' },
            { speaker: 'Risk Bot', text: 'size it small' },
        ]);
        // The human's prompt must NOT render as "You" — that would tell
        // the model the human's words were its own speech.
        expect(turn).toContain('Trader: analyze btc');
        expect(turn).toContain('You: heavy into supply');
        expect(turn).toContain('Risk Bot: size it small');
        expect(turn).toContain('Your turn, Macro:');
    });
});

describe('room protocol', () => {
    it('lists teammates, forbids DM markers, teaches (pass)', () => {
        const section = buildRoomProtocolSection(macro, [macro, risk]);
        expect(section).toContain('@riskbot');
        expect(section).toContain(PASS_TOKEN);
        expect(section).toContain('Never use [[dm:@…]]');
        expect(section).not.toContain('- @macro');
    });

    it('is byte-stable for a given member set (prompt caching)', () => {
        const a = buildRoomSystemPrompt(macro, { persona: 'P', notes: 'N', members: [macro, risk] });
        const b = buildRoomSystemPrompt(macro, { persona: 'P', notes: 'N', members: [macro, risk] });
        expect(a).toBe(b);
        expect(a).toContain('P');
        expect(a).toContain('## Your private notes');
        expect(a).toContain('## Group room');
    });

    it('a member with a debate role carries that persona into the room turn', () => {
        const roled = bot({ id: 'b9', name: 'Macro Bot', role: AnalystRole.TECHNICAL_ANALYST });
        const prompt = buildRoomSystemPrompt(roled, { persona: null, notes: null, members: [roled] });
        expect(prompt).toContain('## Your role');
        // The built-in Technical Analyst prompt prefix lands in the section.
        expect(prompt).toContain('## Group room');
    });

    it('an unroled member gets no role section (plain identity + room protocol)', () => {
        const plain = bot({ id: 'b8', name: 'Plain' });
        const prompt = buildRoomSystemPrompt(plain, { persona: null, notes: null, members: [plain] });
        expect(prompt).not.toContain('## Your role');
        expect(prompt).toContain('You are Plain');
    });
});

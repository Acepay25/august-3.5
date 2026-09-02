import { describe, it, expect } from 'vitest';
import type { AgentBot } from '../services/agents/agentRoster';
import {
    DM_MAX_HOPS,
    botHandle,
    buildBotSystemPrompt,
    buildTeammateProtocolSection,
    dmEnvelopeText,
    dmReplyNoticeText,
    parseDmMarkers,
    resolveRosterHandle,
    validateDM,
} from '../services/agents/botMailbox';

// Bot Mode G1 (plan botmode-scan): the DM transport's pure half — marker
// grammar, roster-handle resolution, validation refusals, and the
// byte-stable teammate protocol. The async queue lives in
// hooks/useBotMailbox.ts and is exercised through these functions.

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id' | 'name'>): AgentBot => ({
    providerId: 'gemini',
    modelId: 'gemini-2.5-pro',
    avatar: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
} as AgentBot);

const macro = bot({ id: 'b1', name: 'Macro', title: 'Thesis hunter' });
const risk = bot({ id: 'b2', name: 'Risk Bot', providerId: 'openai', modelId: 'gpt-4.1' });
const lonely = bot({ id: 'b3', name: 'Lonely' });

const ready = (pid: string) => pid === 'gemini' || pid === 'openai';

describe('botHandle / resolveRosterHandle', () => {
    it('collapses display names to mention handles', () => {
        expect(botHandle('Risk Bot')).toBe('riskbot');
        expect(botHandle('Macro')).toBe('macro');
    });

    it('resolves exact handle, no-space form, and title', () => {
        const bots = [macro, risk];
        expect(resolveRosterHandle(bots, 'macro')?.id).toBe('b1');
        expect(resolveRosterHandle(bots, '@RISK-BOT')?.id).toBe('b2');
        expect(resolveRosterHandle(bots, 'thesis-hunter')?.id).toBe('b1');
        expect(resolveRosterHandle(bots, 'nobody')).toBeNull();
        expect(resolveRosterHandle(bots, '')).toBeNull();
    });
});

describe('parseDmMarkers', () => {
    it('extracts markers and strips them from the display text', () => {
        const raw = [
            'BTC looks heavy into the supply zone.',
            '[[dm:@riskbot]] Check my short thesis: entry 111k, stop 113k — size it?',
            'I will wait for the retest.',
        ].join('\n');
        const { clean, marks } = parseDmMarkers(raw);
        expect(marks).toHaveLength(1);
        expect(marks[0].handle).toBe('riskbot');
        expect(marks[0].text).toContain('111k');
        expect(clean).toContain('supply zone');
        expect(clean).toContain('wait for the retest');
        expect(clean).not.toContain('[[dm:');
    });

    it('handles multiple markers in order', () => {
        const { marks } = parseDmMarkers('a [[dm:@macro]] first [[dm:@riskbot]] second');
        expect(marks.map(m => m.handle)).toEqual(['macro', 'riskbot']);
        expect(marks.map(m => m.text)).toEqual(['first', 'second']);
    });

    it('drops empty marker bodies (malformed sends never deliver)', () => {
        const { clean, marks } = parseDmMarkers('hi [[dm:@riskbot]]   ');
        expect(marks).toHaveLength(0);
        expect(clean).toBe('hi');
    });

    it('leaves plain replies untouched', () => {
        const { clean, marks } = parseDmMarkers('just a normal answer');
        expect(marks).toHaveLength(0);
        expect(clean).toBe('just a normal answer');
    });
});

describe('validateDM', () => {
    it('accepts a resolvable teammate and builds the envelope', () => {
        const v = validateDM([macro, risk], macro, 'riskbot', 'size my short?', 0, ready);
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.envelope.toBotId).toBe('b2');
            expect(v.envelope.fromBotId).toBe('b1');
            expect(v.envelope.hop).toBe(0);
        }
    });

    it('refuses unknown targets, self-DMs, unreachable providers', () => {
        expect(validateDM([macro, risk], macro, 'ghost', 'hi', 0, ready)).toMatchObject({ ok: false, reason: 'unknown_target' });
        expect(validateDM([macro, risk], macro, 'macro', 'hi', 0, ready)).toMatchObject({ ok: false, reason: 'self_dm' });
        expect(validateDM([macro, lonely], macro, 'lonely', 'hi', 0, () => false)).toMatchObject({ ok: false, reason: 'no_provider' });
    });

    it('caps the chain at DM_MAX_HOPS (storm guard)', () => {
        expect(validateDM([macro, risk], macro, 'riskbot', 'hi', DM_MAX_HOPS - 1, ready).ok).toBe(true);
        expect(validateDM([macro, risk], macro, 'riskbot', 'hi', DM_MAX_HOPS, ready)).toMatchObject({ ok: false, reason: 'hop_cap' });
    });
});

describe('attribution + protocol', () => {
    it('prefixes sender attribution harness-side', () => {
        expect(dmEnvelopeText('Macro', 'size my short?')).toContain('Macro (teammate DM)');
        expect(dmReplyNoticeText('Risk Bot', 'size 0.5R')).toContain('Risk Bot replied to your DM');
    });

    it('lists reachable teammates and never the bot itself', () => {
        const section = buildTeammateProtocolSection([macro, risk], macro);
        expect(section).toContain('@riskbot');
        // The roster lines must not include self; "You are @macro" is fine.
        expect(section).not.toContain('- @macro');
        expect(section).toContain('[[dm:@handle]]');
    });

    it('tells a lone bot not to emit markers', () => {
        expect(buildTeammateProtocolSection([lonely], lonely)).toContain('do not emit DM markers');
    });

    it('is byte-stable for a given roster (prompt-cache discipline)', () => {
        const a = buildBotSystemPrompt(macro, { persona: 'You hunt theses.', notes: 'note-1', teammates: [macro, risk] });
        const b = buildBotSystemPrompt(macro, { persona: 'You hunt theses.', notes: 'note-1', teammates: [macro, risk] });
        expect(a).toBe(b);
        expect(a).toContain('You hunt theses.');
        expect(a).toContain('note-1');
        expect(a).toContain('@riskbot');
    });
});

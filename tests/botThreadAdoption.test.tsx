/**
 * A bot opened in the Chart AI dock inherits its conversation.
 *
 * THE DEFECT. A bot's history lives in App's `messages` — that is what the
 * Chat rail renders, and what the Journal, the analyses gallery and the
 * learning loop all read. The dock renders a `chatStore` session. So the
 * "Open in Chart AI" bridge called `chatStore.addSession({ botId })`, which
 * creates an EMPTY session, and the entire conversation the trader had built
 * with that bot vanished at the moment they moved surfaces. The button implied
 * continuity and delivered a blank page.
 *
 * WHAT THIS IS NOT. The two surfaces still run different transports for a bot
 * (the rail uses the mailbox's `runUserBotTurn`, the dock its own streaming
 * send) and this adoption is ONE-WAY. That is deliberate: the dock carries
 * reasoning rows, desk tools and key levels, and fully unifying means one store
 * owning both surfaces, which is a much larger change than a converter. This
 * closes the data loss without pretending to be that.
 *
 * The load-bearing assertion is the second one: BOTH entry points go through
 * one helper, so a bot cannot be openable with history from the roster and
 * without it from the dock's own menu — which is exactly how a fix like this
 * silently half-applies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

import { liveEntryFromMessage } from '../services/trade/chatSessions';
import * as chatStore from '../services/trade/chatStore';
import { MessageRole, type Message } from '../types';

const msg = (over: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: MessageRole.AI,
    text: 'answer',
    createdAt: new Date().toISOString(),
    ...over,
} as Message);

beforeEach(() => {
    chatStore.__resetForTests();
    localStorage.clear();
});

describe('liveEntryFromMessage', () => {
    it('carries the identity, the text and the timestamp', () => {
        const at = Date.parse('2026-09-01T10:00:00.000Z');
        const e = liveEntryFromMessage(msg({ id: 'x', text: 'hi', createdAt: '2026-09-01T10:00:00.000Z' }));
        expect(e.id).toBe('x');
        expect(e.text).toBe('hi');
        expect(e.at).toBe(at);
    });

    it('maps the role, and does not claim a user row is a model answer', () => {
        expect(liveEntryFromMessage(msg({ role: MessageRole.USER })).role).toBe('user');
        expect(liveEntryFromMessage(msg({ role: MessageRole.AI })).role).toBe('ai');
    });

    it('leaves `at` undefined for an unparseable timestamp rather than stamping 0', () => {
        // The memory-attribution window join reads a real stamp as meaningful;
        // 0 would be noise that looks like data.
        expect(liveEntryFromMessage(msg({ createdAt: 'not-a-date' })).at).toBeUndefined();
        expect(liveEntryFromMessage(msg({ createdAt: '' })).at).toBeUndefined();
    });

    it('flattens reasoning and thought traces into the Thought row', () => {
        const e = liveEntryFromMessage(msg({
            reasoningProcesses: { a: 'because A' },
            thoughtProcesses: { b: 'because B' },
        }));
        expect(e.reasoning).toContain('because A');
        expect(e.reasoning).toContain('because B');
    });

    it('keeps tool lines, side effects and the first image', () => {
        const e = liveEntryFromMessage(msg({
            liveToolEvents: { t1: '▸ get_market_packet' },
            images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        }));
        expect(e.tools).toEqual(['▸ get_market_packet']);
        expect(e.image).toBe('data:image/png;base64,AAA');
    });

    it('leaves the speaker unset so the dock stamps its own seat', () => {
        // A stale name carried across would fight the dock's own labelling.
        expect(liveEntryFromMessage(msg()).speaker).toBeUndefined();
    });
});

describe('the dock adopts a bot conversation', () => {
    it('seeds a new bot session with the rows App hands it', () => {
        const history = [msg({ id: 'a', role: MessageRole.USER, text: 'first' }),
            msg({ id: 'b', role: MessageRole.AI, text: 'second' })];
        const entries = history.map(liveEntryFromMessage);

        const id = chatStore.addSession({ botId: 'bot-1', entries });
        const s = chatStore.getSnapshot().sessions.find(x => x.id === id);

        expect(s?.botId).toBe('bot-1');
        expect(s?.entries.map(e => e.text)).toEqual(['first', 'second']);
    });

    it('an adopted session is a normal session — it renders and persists', () => {
        const id = chatStore.addSession({
            botId: 'bot-1',
            entries: [liveEntryFromMessage(msg({ text: 'inherited' }))],
        });
        // LiveEntry extras default off; a seeded row must not arrive streaming.
        const s = chatStore.getSnapshot().sessions.find(x => x.id === id);
        expect(s?.entries[0].streaming).toBeFalsy();
    });
});

describe('both ways of opening a bot behave alike', () => {
    // Structural: the roster bridge and the dock menu must not each grow their
    // own seeding. A bot openable WITH history from the rail and WITHOUT it
    // from the dock's own menu is the failure this whole change is about.
    it('the dock has exactly one bot-session creation path, used by both', () => {
        const src = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');

        // EXACTLY ONE place in the file builds a bot-bound session, and it is
        // the helper. Four existed: the roster bridge, the dock menu, the
        // NewBotDialog, and a `botId` parameter on the generic `addSession`
        // that nobody passed any more — each a chance to skip the adoption.
        const creates = [...src.matchAll(/chatStore\.addSession\(\{[^}]*botId/g)];
        expect(creates, 'a bot-bound session is created outside openBotSession')
            .toHaveLength(1);

        const helperAt = src.indexOf('const openBotSession = useCallback');
        expect(helperAt).toBeGreaterThan(-1);
        const helperEnd = src.indexOf('}, [botThreadFor]);', helperAt);
        expect(helperEnd).toBeGreaterThan(helperAt);
        const sole = creates[0].index ?? -1;
        expect(sole, 'the one bot-bound session must be the one inside the helper')
            .toBeGreaterThan(helperAt);
        expect(sole).toBeLessThan(helperEnd);

        // The helper seeds, and every entry point goes through it.
        // Seeded from the prop, and only when there IS history — an empty
        // array must not become an entry-less-but-present branch.
        expect(src).toMatch(/const history = botThreadFor\?\.\(botId\) \?\? \[\];/);
        expect(src).toMatch(/entries: history\.map\(liveEntryFromMessage\)/);
        expect(src).toMatch(/history\.length > 0 \? \{ entries:/);
        expect(src).toMatch(/openBotSession\(botSessionRequest\.botId\)/);
        expect(src).toMatch(/onClick=\{\(\) => openBotSession\(b\.id\)\}/);
        expect(src).toMatch(/openBotSession\(bot\.id\)/);
        // And the generic helper can no longer make a bot session at all.
        expect(src).not.toMatch(/addSession = useCallback\(\(kind: 'solo' \| 'panel' = 'solo', botId/);
    });

    it('the dock takes its history from App, which owns `messages`', () => {
        const panel = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
        const app = readFileSync('App.tsx', 'utf8');
        expect(panel).toMatch(/botThreadFor\?: \(botId: string\) => Message\[\]/);
        // One selection function, used by both surfaces — not two filters that
        // will disagree the first time a row is stamped for a bot.
        expect(app).toMatch(/threadForProvider\(messages, b\.providerId, b\.modelId, b\.id\)/);
        expect(app).toMatch(/botThreadFor=\{botThreadFor\}/);
    });

    it('a bot id that is not in the roster yields no history, not a throw', () => {
        // The dock must survive a stale botId: a bot can be deleted while a
        // session still references it, and an unguarded find would take the
        // whole surface down.
        const app = readFileSync('App.tsx', 'utf8');
        const body = app.slice(
            app.indexOf('const botThreadFor = useCallback'),
            app.indexOf('}, [bots, messages]);'),
        );
        expect(body).toMatch(/if \(!b\) return \[\]/);
    });
});

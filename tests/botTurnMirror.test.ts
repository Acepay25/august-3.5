/**
 * A bot turn asked in the Chat reaches the Chart AI dock.
 *
 * THE SPLIT. The two surfaces ran different transports into different stores:
 * the Chat goes through the mailbox (App's `messages`), the dock through its own
 * streaming send (`chatStore`). Asking a bot something in Chat therefore never
 * reached the dock. History crossing OVER on open was fixed separately — a bot
 * opened in the dock adopts the conversation — but a turn asked afterwards went
 * nowhere.
 *
 * THE CONTAINED HALF. The real fix is one store owning both surfaces, which
 * means extracting the dock's send machinery out of a 2,000-line component.
 * Until that exists, App mirrors the Chat's gain into the bot's dock session
 * after the turn. App is the only scope holding the mailbox, `messagesRef` and
 * `chatStore` together, and doing it in one place is deliberate: a second
 * implementation is how these two surfaces drifted apart in the first place.
 *
 * The load-bearing property is the CLAIMING. `threadForProvider` decides which
 * rows belong to a bot — the same function the Chat rail renders from. If the
 * mirror used a different filter, the two surfaces would disagree about which
 * messages a bot owns, and the disagreement would only show up when two bots
 * share a provider and model.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

import * as chatStore from '../services/trade/chatStore';
import { liveEntryFromMessage } from '../services/trade/chatSessions';
import { MessageRole, type Message } from '../types';

const appSrc = readFileSync('App.tsx', 'utf8');

const msg = (over: Partial<Message> = {}): Message => ({
    id: 'm1', role: MessageRole.AI, text: 'answer',
    createdAt: new Date().toISOString(), ...over,
} as Message);

beforeEach(() => {
    chatStore.__resetForTests();
    localStorage.clear();
});

describe('the Chat-to-dock bot mirror', () => {
    /** The body of runBotTurnAndMirror, straight from the source. */
    const handler = (): string => {
        const at = appSrc.indexOf('const runBotTurnAndMirror = useCallback');
        expect(at).toBeGreaterThan(-1);
        return appSrc.slice(at, at + 1800);
    };

    it('still runs the turn through the mailbox, unchanged', () => {
        // The mirror must never become a second transport. It copies the
        // result; it does not re-run the model.
        expect(handler()).toMatch(/mailbox\.runUserBotTurn\(bot, prompt\)/);
        expect(handler()).toMatch(/if \(!ok\) return false/);
    });

    it('claims rows with the SAME function the Chat rail renders from', () => {
        const body = handler();
        const claims = body.match(/threadForProvider\(/g) ?? [];
        expect(claims.length, 'it must claim before AND after the turn').toBe(2);
        expect(body).toMatch(/threadForProvider\(messagesRef\.current, bot\.providerId, bot\.modelId, bot\.id\)/);
    });

    it('mirrors only the rows the turn actually added', () => {
        const body = handler();
        expect(body).toMatch(/const before = threadForProvider\([\s\S]*?\.map\(m => m\.id\)/);
        expect(body).toMatch(/const known = new Set\(before\)/);
        expect(body).toMatch(/\.filter\(m => !known\.has\(m\.id\)\)/);
        // Re-mirroring the whole thread on every turn would duplicate history
        // in the dock, which is the failure this shape prevents.
        expect(body).not.toMatch(/entries: \[\.\.\.prev\.entries, \.\.\.session\.entries\]/);
    });

    it('does not duplicate a row the dock already has', () => {
        const body = handler();
        expect(body).toMatch(/const have = new Set\(session\.entries\.map\(e => e\.id\)\)/);
        expect(body).toMatch(/\.filter\(m => !have\.has\(m\.id\)\)/);
    });

    it('does NOT invent a dock session that does not exist', () => {
        // Opening one here would bypass the adoption path in `botThreadFor`,
        // and a session created behind its back would miss the chart binding
        // the dock sets when the trader opens it.
        const body = handler();
        expect(body).toMatch(/const session = snap\.sessions\.find/);
        expect(body).not.toMatch(/chatStore\.addSession/);
    });

    it('the mirror produces dock-shaped rows, not raw messages', () => {
        // One adapter, shared with the adoption path — the two must not
        // disagree about what a Message looks like as an entry.
        const body = handler();
        expect(body).toMatch(/\.map\(liveEntryFromMessage\)/);
        const id = chatStore.addSession({ botId: 'bot-1', entries: [liveEntryFromMessage(msg({ text: 'hi' }))] });
        const s = chatStore.getSnapshot().sessions.find(x => x.id === id);
        expect(s?.entries[0].text).toBe('hi');
    });
});

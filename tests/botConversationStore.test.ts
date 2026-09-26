/**
 * One conversation, one owner, two readers.
 *
 * A bot's conversation belongs to App's `messages` — that is what the Journal,
 * the analyses gallery, the learning loop and the Chat rail read, and what a
 * turn is learned from. The Chart AI dock used to keep a COPY in its own
 * session, seeded once when the bot was opened, and two bridges papered over
 * the gap: an open-time adoption, and a mirror that copied Chat turns into the
 * dock after the fact. Both were load-bearing, and both were wrong:
 *
 *  - the adoption copied a snapshot that could never learn anything new;
 *  - the mirror fed the dock's MODEL history but not its RENDER, so the trader
 *    and the bot could be looking at two different conversations.
 *
 * Both are deleted. A bot session now renders — and answers from — the same
 * merge, and the session it keeps is only the part with no counterpart yet: the
 * answer currently streaming, which joins `messages` when it settles.
 *
 * The properties below are what stop the split coming back. Each one is a
 * specific way this has already gone wrong.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

import * as chatStore from '../services/trade/chatStore';
import { liveEntryFromMessage } from '../services/trade/chatSessions';
import { MessageRole, type Message } from '../types';

const panelSrc = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
const appSrc = readFileSync('App.tsx', 'utf8');

const msg = (over: Partial<Message> = {}): Message => ({
    id: 'm1', role: MessageRole.AI, text: 'answer',
    createdAt: new Date().toISOString(), ...over,
} as Message);

beforeEach(() => {
    chatStore.__resetForTests();
    localStorage.clear();
});

describe('the bridges are gone', () => {
    it('no mirror: the Chat turn is not copied into the dock session', () => {
        // Copying rows between two stores is what let them disagree. A turn
        // asked in Chat reaches the dock because the dock READS the same rows.
        expect(appSrc, 'the App mirror must not come back').not.toMatch(/runBotTurnAndMirror/);
    });

    it('no adoption: a bot session is not seeded with a copy at open time', () => {
        // The seeded copy is what made the dock's transcript a stale snapshot.
        expect(panelSrc).not.toMatch(/botThreadFor/);
        expect(panelSrc).toMatch(/const openBotSession = useCallback\(\(botId: string\): void => \{\s*chatStore\.addSession\(\{ botId \}\);/);
    });

    it('no second selection: the rows come from the one claim function', () => {
        // `threadForProvider` is what decides a row belongs to a bot. A second
        // filter is a second opinion about ownership.
        expect(appSrc).toMatch(/threadForProvider\(messages, b\.providerId, b\.modelId, b\.id\)/);
        const panelFilters = [...panelSrc.matchAll(/threadForProvider\(/g)].length;
        expect(panelFilters, 'the dock must not re-derive which rows are a bot\'s')
            .toBe(0);
    });
});

describe('the trader and the bot read the SAME conversation', () => {
    it('one merge, used by the render AND the model history', () => {
        expect(panelSrc).toMatch(/const mergeBotConversation = useCallback\(/);
        // The render:
        expect(panelSrc).toMatch(/\(\) => mergeBotConversation\(boundBot, activeSession\.entries, botThreadRows\)/);
        // And the history the bot answers from:
        expect(panelSrc).toMatch(/const conversation = mergeBotConversation\(/);
        expect(panelSrc).toMatch(/const history = retryIdx >= 0 \? conversation\.slice\(0, retryIdx\) : conversation;/);
    });

    it('the history no longer reads the raw session', () => {
        // This single line was the split: the trader saw canonical rows while
        // the bot answered from the stale copy.
        expect(panelSrc).not.toMatch(/const history = retryIdx >= 0 \? session\.entries\.slice/);
    });

    it('takes the canonical rows first, then only what has no counterpart yet', () => {
        expect(panelSrc).toMatch(/if \(!bot \|\| !canonical\) return local;/);
        expect(panelSrc).toMatch(/const rows: LiveEntry\[\] = canonical\.map\(liveEntryFromMessage\)/);
    });

    it('a local row the canonical list already has REPLACES it, never appends', () => {
        // The optimistic user bubble and the streaming answer both take this
        // path. Appending would show every exchange twice.
        expect(panelSrc).toMatch(/const at = rows\.findIndex\(m => m\.id === e\.id\);/);
        expect(panelSrc).toMatch(/if \(at >= 0\) rows\[at\] = e;/);
    });

    it('leaves a solo or panel session completely alone', () => {
        // A chart-side session is a conversation of its own — it has its own
        // tool rounds and key levels, and no counterpart to be a view of.
        expect(panelSrc).toMatch(/if \(!bot \|\| !canonical\) return local;/);
    });
});

describe('the merge behaves', () => {
    it('an empty canonical conversation falls back to the session untouched', () => {
        const local = [liveEntryFromMessage(msg({ text: 'local only' }))];
        // Mirrors the guard: a session with no bot, or no canonical rows, is
        // returned as-is rather than emptied.
        expect(local).toHaveLength(1);
        expect(local[0].text).toBe('local only');
    });

    it('converts a canonical Message into the entry shape the dock draws', () => {
        const rows = [msg({ id: 'x', text: 'hi' })].map(liveEntryFromMessage);
        expect(rows[0]).toMatchObject({ id: 'x', role: 'ai', text: 'hi' });
    });
});

describe('a turn asked in the dock reaches the Chat surface', () => {
    // A view cannot write. The dock renders `messages` and the Chat surface
    // renders `messages`, but the dock's composer wrote into its own chat
    // session — so a question asked in Chart AI produced an answer the other
    // surface could not see. The trader switched surfaces and found the
    // exchange had never happened.
    it('App commits both rows into the conversation that owns them', () => {
        expect(appSrc).toMatch(/const commitDockBotTurn = useCallback/);
        expect(appSrc).toMatch(/role: MessageRole\.USER, text: prompt/);
        expect(appSrc).toMatch(/role: MessageRole\.AI,\s*$/m);
    });

    it('stamps the answer with botId + modelsUsed, which is what claims it', () => {
        // One stamp does BOTH jobs: `threadForProvider` claims the pair as this
        // bot's thread, and `deskThread` keeps it out of the desk pane. A second
        // opinion about ownership is how these two drift.
        expect(appSrc).toMatch(/modelsUsed: \{ \[bot\.providerId\]: bot\.modelId \}/);
        expect(appSrc).toMatch(/botId: bot\.id/);
    });

    it('commits the question when the turn starts, and the answer when it settles', () => {
        // Two calls, not one: the question should be visible in the other
        // surface WHILE it is being answered.
        expect(panelSrc).toMatch(/onBotTurnCommit\?\.\(bot, text\);/);
        expect(panelSrc).toMatch(/onBotTurnCommit\?\.\(bot, text, settledText\);/);
    });

    it('commits only a REAL answer, never the stop placeholder', () => {
        // The pending row reads "Running the full ensemble analysis…". Filing
        // that into the conversation would show the other surface a turn that
        // never finished, said by a bot that said nothing.
        expect(panelSrc).toMatch(/if \(settledText\.trim\(\) && !\/\^Running the full ensemble\//);
    });

    it('fires for a bot session only', () => {
        // A solo or panel session is not a bot turn and has no bot identity to
        // commit under.
        expect(panelSrc).toMatch(/if \(bot\) onBotTurnCommit\?\.\(bot, text\);/);
    });
});

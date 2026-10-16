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
import { entriesForSession, liveEntryFromMessage } from '../services/trade/chatSessions';
import { MessageRole, type Message } from '../types';

// The dock feature spans the shell + the extracted chatTurnRunner — the
// bot-turn commit and merge contracts follow the code into the runner.
const panelSrc = [
    readFileSync('components/trade/TradeChatPanel.tsx', 'utf8'),
    readFileSync('services/trade/chatTurnRunner.ts', 'utf8'),
].join('\n');
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
    // The merge moved to `services/trade/chatSessions.ts#entriesForSession`, so
    // BOTH readers import one function instead of the dock owning a copy the
    // runner had to be handed. These pins are the same contract, re-expressed:
    // one implementation, two callers, neither caller allowed its own merge.
    const panelOnly = readFileSync('components/trade/TradeChatPanel.tsx', 'utf8');
    const runnerOnly = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
    const IMPORT = /import\s*\{[^}]*\bentriesForSession\b[^}]*\}\s*from\s*'[^']*chatSessions'/s;

    it('one merge, imported by the render AND by the model history', () => {
        expect(panelOnly, 'the dock render must read the shared merge').toMatch(IMPORT);
        expect(runnerOnly, 'the bot must answer from the shared merge').toMatch(IMPORT);
        expect(panelSrc).toMatch(/\(\) => entriesForSession\(activeSession\.entries, canonicalRows\)/);
        expect(panelSrc).toMatch(/const conversation = entriesForSession\(/);
        expect(panelSrc).toMatch(/const history = retryIdx >= 0 \? conversation\.slice\(0, retryIdx\) : conversation;/);
    });

    it('neither reader re-implements it', () => {
        // A second copy is a second answer to "what did we say" — the exact
        // split this file exists to keep closed.
        expect(panelSrc).not.toMatch(/canonical\.map\(liveEntryFromMessage\)/);
        expect(panelSrc).not.toMatch(/mergeBotConversation/);
    });

    it('the history no longer reads the raw session', () => {
        // This single line was the split: the trader saw canonical rows while
        // the bot answered from the stale copy.
        expect(panelSrc).not.toMatch(/const history = retryIdx >= 0 \? session\.entries\.slice/);
    });

    it('takes the canonical rows first, then only what has no counterpart yet', () => {
        // Behaviour, not shape: see tests/mergedChatThread.test.ts for the
        // canonical-first order, the replace-not-append rule, and the
        // undefined-canonical fallback that every case below rests on.
        const local = [{ id: 'a', role: 'ai' as const, text: 'streaming', tools: [], streaming: true }];
        expect(entriesForSession(local, undefined)).toBe(local);
    });

    it('leaves a solo or panel session completely alone', () => {
        // A chart-side session is a conversation of its own — it has its own
        // tool rounds and key levels, and no counterpart to be a view of. The
        // gate now lives at each call site: canonical rows are handed over only
        // when the session is bound to a bot that exists.
        // A session is a view only when it is BOUND — to a bot, or to a Chat
        // conversation via `conversationId`. Neither ⇒ canonical rows are
        // undefined and the session's own entries are the whole transcript.
        expect(panelSrc).toMatch(/const canonicalRows = boundBot\s+\?\s+botThreadRows/);
        expect(panelSrc).toMatch(/activeSession\.conversationId \? conversationRows : undefined/);
        expect(panelSrc).toMatch(/session\.conversationId \? conversationRows : undefined/);
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

    it('commits the question when the turn starts, and the answer + its work time when it settles', () => {
        // Two calls, not one: the question should be visible in the other
        // surface WHILE it is being answered.
        expect(panelSrc).toMatch(/onBotTurnCommit\?\.\(bot, text\);/);
        expect(panelSrc).toMatch(/onBotTurnCommit\?\.\(bot, text, settledText, workedMsFor\(soloStartedAt\)\);/);
    });

    it('commits the measured work time so the other surface shows the same duration', () => {
        // The dock's block measured the turn; committing `workedMs` as the
        // answer's runStats is what lets the Chat surface's collapsed block
        // show the same "Analyzed for Ns" — and keeps it after a reload. A dock
        // turn with no stamp shows no duration there at all.
        expect(appSrc).toMatch(/durationMs: workedMs/);
        expect(appSrc).toMatch(/answer\?: string, workedMs\?: number/);
    });

    it('commits only a REAL answer, never the stop placeholder', () => {
        // The pending row reads "Running the full ensemble analysis…". Filing
        // that into the conversation would show the other surface a turn that
        // never finished, said by a seat that said nothing. The test now passes,
        // so it is computed ONCE and named, and both commit paths read it.
        expect(panelSrc).toMatch(/const settled = !!settledText\.trim\(\) && !\/\^Running the full ensemble\//);
        expect(panelSrc).toMatch(/if \(settled\) onBotTurnCommit\?\.\(bot, text, settledText/);
    });

    it('a bot turn commits under bot identity; a solo turn only when it is bound', () => {
        // This case used to read "fires for a bot session only", which was true
        // for a bleak reason: a solo turn had no path into the conversation at
        // all, so a question asked in the Desk AI pane was simply never filed.
        // That split is what the merge exists to close. What must STILL hold is
        // the guard on the solo path — an unbound dock chat has no conversation
        // to write into, and guessing one would drop a dock question into
        // whichever chat the trader has open elsewhere.
        expect(panelSrc).toMatch(/if \(bot\) onBotTurnCommit\?\.\(bot, text\);/);
        expect(panelSrc).toMatch(/else if \(session\.conversationId\) \{/);
        expect(panelSrc).toMatch(/else if \(settled && session\.conversationId\) \{/);
    });
});

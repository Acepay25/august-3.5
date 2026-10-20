/**
 * E-45 — the Chat surface's run survives a conversation switch.
 *
 * The defect: `hooks/useAnalysisPipeline.ts` owned ONE module-level
 * `analysisAbortController` for the whole app, and an effect on
 * `activeConversationId` aborted it on ANY conversation change. The same file
 * already bound every async write to the conversation the request started in
 * (`updateRequestMessages` → `requestConversationId`) — the run was DESIGNED
 * to land its answer in the thread it was typed in, and the effect killed it
 * before that machinery could be used. The dock's half of this design already
 * shipped: `services/trade/chatStore.ts` hoists session state out of React and
 * keeps a per-session AbortController, so an answer survives a surface switch.
 *
 * These are the load-bearing claims, and each one is asserted against the
 * SOURCE or the STORE rather than against a mounted hook. Mounting
 * `useAnalysisPipeline` means standing up a 1,600-line hook and its whole prop
 * surface to observe one thing — the very fragility
 * `tests/analysisPipelineSendIdentity.test.ts` documents when it moved its
 * assertions to extracted modules ("pure units that are now testable without
 * mounting the 3k-line send hook"). The properties below are facts about the
 * source and about the store, so they are asserted against those.
 *
 * Every assertion has a matching CONTROL: a regex that silently stopped
 * matching would make this file pass for the wrong reason, which is the
 * vacuous-test failure this repo keeps encoding guards against.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as store from '../services/trade/chatStore';

const SOURCE = join(process.cwd(), 'hooks', 'useAnalysisPipeline.ts');
const src = readFileSync(SOURCE, 'utf8');

const HOUSEKEEPING = join(process.cwd(), 'hooks', 'useConversationHousekeeping.ts');
const housekeepingSrc = readFileSync(HOUSEKEEPING, 'utf8');

// The store persists per ACTIVE user — swap the marker from one place so the
// profile-switch cases can flip identities mid-suite.
const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

beforeEach(() => {
    store.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
});

describe('E-45 — the store owns a run per CONVERSATION', () => {
    it('the snapshot carries the conversation-keyed running map', () => {
        // A badge that says "this is still running" needs a place to read the
        // truth from, and the App does not thread props into the components
        // that render it — so the store's snapshot is the channel.
        const snap = store.getSnapshot();
        expect(snap.conversationRunning).toEqual({});
    });

    it('a registered run is reported as running, and only for its own conversation', () => {
        const ctrl = new AbortController();
        store.beginConversationRun('conv-a', ctrl);
        expect(store.isConversationRunning('conv-a')).toBe(true);
        expect(store.isConversationRunning('conv-b')).toBe(false);
        expect(store.getSnapshot().conversationRunning['conv-a']).toBe(true);
        expect(store.anyConversationRunning()).toBe(true);
    });

    it('two conversations can run at once — the whole point of the ownership', () => {
        const a = new AbortController();
        const b = new AbortController();
        store.beginConversationRun('conv-a', a);
        store.beginConversationRun('conv-b', b);
        expect(store.getSnapshot().conversationRunning).toEqual({ 'conv-a': true, 'conv-b': true });
        // Stopping one leaves the other alone.
        store.abortConversationRun('conv-a');
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(false);
        expect(store.isConversationRunning('conv-b')).toBe(true);
    });

    it('a Stop aborts the controller it names, and nothing else', () => {
        const a = new AbortController();
        const b = new AbortController();
        store.beginConversationRun('conv-a', a);
        store.beginConversationRun('conv-b', b);
        store.abortConversationRun('conv-a');
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(false);
    });

    it('the owner-checked release frees only ITS OWN slot', () => {
        // A blind delete would clear a NEWER run's slot and leave it
        // un-stoppable — the exact bug `endRunOwned` exists to prevent.
        const first = new AbortController();
        const second = new AbortController();
        store.beginConversationRun('conv-a', first);
        store.beginConversationRun('conv-a', second);
        store.endConversationRunOwned('conv-a', first);
        // The newer run still owns the slot.
        expect(store.isConversationRunning('conv-a')).toBe(true);
        store.endConversationRunOwned('conv-a', second);
        expect(store.isConversationRunning('conv-a')).toBe(false);
    });

    it('the profile switch aborts EVERY conversation run', () => {
        const a = new AbortController();
        const b = new AbortController();
        store.beginConversationRun('conv-a', a);
        store.beginConversationRun('conv-b', b);
        store.abortAllConversationRuns();
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(true);
        expect(store.anyConversationRunning()).toBe(false);
    });

    it('the conversation registry is separate from the dock\'s session registry', () => {
        // A shared map would let a session id and a conversation id collide,
        // and one run's Stop would abort the other.
        const ctrl = new AbortController();
        store.beginRun('sess-1', ctrl);
        store.beginConversationRun('sess-1', new AbortController());
        store.abortConversationRun('sess-1');
        // The dock's session run is untouched by the conversation stop.
        expect(ctrl.signal.aborted).toBe(false);
        expect(store.getSnapshot().running['sess-1']).toBe(true);
    });
});

describe('E-45 — the conversation-switch effect moves the VIEW, it does not kill the run', () => {
    /** The switch effect's own body, so a match cannot come from a comment
     *  elsewhere in the file. */
    const switchEffect = (): string => {
        const at = src.indexOf('useEffect(() => {\n        const key = runKeyFor(activeConversationId);');
        expect(at, 'the conversation-switch effect is gone or renamed').toBeGreaterThan(-1);
        const close = src.indexOf('}, [activeConversationId]);', at);
        expect(close, 'the switch effect no longer ends where this scan expects').toBeGreaterThan(at);
        return src.slice(at, close);
    };

    it('the effect no longer aborts anything', () => {
        // THE DEFECT. An abort here killed a run that was about to land its
        // answer in the thread it was typed in.
        expect(switchEffect()).not.toMatch(/\.abort\(/);
    });

    it('the effect shows THAT conversation\'s state instead of clearing it', () => {
        const body = switchEffect();
        // It reads the new conversation's record...
        expect(body).toMatch(/runsRef\.current\.get\(key\)/);
        // ...and paints it, rather than resetting to null.
        expect(body).toMatch(/setLoadingMessage\(run\?\.loadingMessage \?\? null\)/);
        expect(body).toMatch(/setSteeringNotes\(/);
    });

    it('the run registry is per conversation, not one global controller', () => {
        expect(src).toMatch(/const runsRef = useRef<Map<string, ConversationRun>>\(new Map\(\)\)/);
        // The single global controller is gone.
        expect(src).not.toMatch(/const analysisAbortController = useRef/);
    });

    it('a run records the trader who started it, and the conversation it belongs to', () => {
        // The owner is what makes the profile switch safe: a run that belongs
        // to the previous trader is aborted before it can write a word into the
        // new trader's data.
        expect(src).toMatch(/owner: runOwner,/);
        expect(src).toMatch(/const runOwner = getActiveUsername\(\);/);
    });

    it('the write path refuses to write across a profile change', () => {
        // The profile switch cancels BEFORE the username flips, so its cancel
        // cannot see the change on that call. THIS is the guard that holds.
        expect(src).toMatch(/if \(runOwner !== getActiveUsername\(\)\) \{/);
    });

    it('the double-submit guard is per conversation', () => {
        // A run in another thread must not block a send here.
        expect(src).toMatch(/const activeRunInFlight = runsRef\.current\.get\(activeRunKey\)\?\.inFlight === true;/);
    });

    it('a new send supersedes the PREVIOUS run of the SAME conversation only', () => {
        expect(src).toMatch(/const previousRun = runsRef\.current\.get\(requestRunKey\);/);
        expect(src).toMatch(/previousRun\?\.controller\.abort\(\);/);
    });

    it('the loading message is written into the run\'s OWN conversation', () => {
        // A background run must not paint its loading line over the thread
        // the trader is looking at.
        expect(src).toMatch(/setLoadingFor\(requestConversationId, "Thinking\.\.\."\)/);
        expect(src).not.toMatch(/setLoadingMessage\("Thinking\.\.\."\)/);
    });

    it('the steering queue is per conversation, not one global list', () => {
        expect(src).toMatch(/const steeringRef = useRef<Map<string, string\[\]>>\(new Map\(\)\)/);
        expect(src).not.toMatch(/const steeringQueueRef = useRef/);
    });

    it('a scheduled run owns no thread, so it is filed under its own key', () => {
        // Filing it under the active conversation would light that thread's
        // "running" badge for a run that never writes to it.
        expect(src).toMatch(/const requestRunKey = isAutomationRun \? AUTOMATION_RUN_KEY : runKeyFor\(activeConversationId\);/);
    });
});

describe('E-45 — Stop, delete and the profile switch', () => {
    it('Stop with no id reaches the ACTIVE conversation\'s run only', () => {
        expect(src).toMatch(/const handleCancelAnalysis = \(conversationId\?: string\): void => \{/);
        expect(src).toMatch(/cancelRunAt\(runKeyFor\(activeConversationIdRef\.current\)\);/);
    });

    it('Stop with an id reaches THAT conversation\'s run', () => {
        expect(src).toMatch(/if \(conversationId !== undefined\) \{\s*cancelRunAt\(runKeyFor\(conversationId\)\);/);
    });

    it('a run that belongs to another trader is stopped', () => {
        // The profile switch calls the cancel BEFORE the username flips, so
        // the owner check is the backstop; the write guard is the one that
        // actually holds.
        expect(src).toMatch(/if \(run\.owner !== currentUser\) cancelRunAt\(key\);/);
    });

    it('loading a conversation does not cancel anything', () => {
        // THE CONTRACT THIS CHANGED. The old assertion pinned the defect.
        expect(housekeepingSrc).toMatch(/const handleLoadConversation = useCallback\(\(id: string\) => \{\s*if \(id !== activeConversationId\) \{\s*setActiveConversationId\(id\);/);
        const at = housekeepingSrc.indexOf('const handleLoadConversation');
        const close = housekeepingSrc.indexOf('}, [activeConversationId, setActiveConversationId]);', at);
        expect(close).toBeGreaterThan(at);
        expect(housekeepingSrc.slice(at, close)).not.toMatch(/handleCancelAnalysis/);
    });

    it('a new conversation does not cancel anything either', () => {
        const at = housekeepingSrc.indexOf('const handleNewConversation');
        const close = housekeepingSrc.indexOf('}, [conversationHistory', at);
        expect(close).toBeGreaterThan(at);
        expect(housekeepingSrc.slice(at, close)).not.toMatch(/handleCancelAnalysis/);
    });

    it('deleting a conversation stops THAT conversation\'s run, by name', () => {
        expect(housekeepingSrc).toMatch(/for \(const id of ids\) handleCancelAnalysis\(id\);/);
    });

    it('clearing the whole history stops every conversation\'s run, by name', () => {
        expect(housekeepingSrc).toMatch(/for \(const c of conversationHistory\) handleCancelAnalysis\(c\.id\);/);
    });
});

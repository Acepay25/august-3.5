/**
 * The one writer for an analysis turn in the chat transcript.
 *
 * Both the Chart AI dock and the Agents surface route through this, so every
 * exit path is load-bearing: whatever this does on success, on failure, and on
 * an aborted run is what the trader sees, and what gets persisted.
 *
 * The abort case is the one worth the most attention. A run that is stopped
 * used to return early without settling its answer row, leaving a
 * `streaming: true` bubble in the session — which then blocked ALL session
 * persistence until reload. So "the user pressed Stop" could cost them the
 * conversation, not just the answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as chatStore from '../services/trade/chatStore';
import {
    runAnalysisAsChatTurn,
    ANALYSIS_EMPTY_TEXT,
    ANALYSIS_FAILED_TEXT,
    ANALYSIS_STOP_TEXT,
} from '../services/trade/analysisTurn';

const entries = (sid: string) => {
    const s = chatStore.getSnapshot().sessions.find(x => x.id === sid);
    return s?.entries ?? [];
};

beforeEach(() => {
    chatStore.__resetForTests();
    localStorage.clear();
});

describe('runAnalysisAsChatTurn', () => {
    it('appends the question and a streaming answer, then settles the answer', async () => {
        const sid = chatStore.addSession({});
        const seen: number[] = [];
        const stop = chatStore.subscribe(() => seen.push(entries(sid).length));

        await runAnalysisAsChatTurn({
            sid,
            text: 'what is the plan?',
            run: async () => 'Long above 64k.',
        });
        stop();

        const rows = entries(sid);
        expect(rows).toHaveLength(2);
        expect(rows[0].role).toBe('user');
        expect(rows[0].text).toBe('what is the plan?');
        expect(rows[1].role).toBe('ai');
        expect(rows[1].text).toBe('Long above 64k.');
        // Settled means settled: a row left streaming is what froze persistence.
        expect(rows[1].streaming).toBe(false);
        // The answer was visibly pending while the pipeline ran, not absent.
        expect(seen).toContain(2);
    });

    it('reports a pipeline rejection in the transcript instead of throwing', async () => {
        const sid = chatStore.addSession({});

        await expect(runAnalysisAsChatTurn({
            sid, text: 'go',
            run: async () => { throw new Error('no AI providers are configured'); },
        })).resolves.toBeUndefined();

        const rows = entries(sid);
        expect(rows[1].text).toBe(ANALYSIS_FAILED_TEXT('no AI providers are configured'));
        expect(rows[1].streaming).toBe(false);
    });

    it('settles the row when the pipeline returns nothing', async () => {
        const sid = chatStore.addSession({});
        await runAnalysisAsChatTurn({ sid, text: 'go', run: async () => '' });
        expect(entries(sid)[1].text).toBe(ANALYSIS_EMPTY_TEXT);
        expect(entries(sid)[1].streaming).toBe(false);
    });

    it('settles AND releases the run slot when the run was aborted mid-flight', async () => {
        const sid = chatStore.addSession({});

        await runAnalysisAsChatTurn({
            sid, text: 'go',
            run: async () => {
                // The Stop button aborts the session's active controller.
                chatStore.abortActive();
                return 'an answer that must not be shown';
            },
        });

        const rows = entries(sid);
        expect(rows[1].streaming).toBe(false);
        // A stopped run shows the stop notice, not a verdict the trader never saw.
        expect(rows[1].text).not.toContain('must not be shown');
        expect(rows[1].text).toBe(ANALYSIS_STOP_TEXT);
        // The session is idle again — a stuck slot blocks every later send.
        expect(chatStore.getController(sid)).toBeUndefined();
        expect(chatStore.getSnapshot().running[sid]).toBeFalsy();
    });

    it('hands the App-side message id back for the row it created', async () => {
        const sid = chatStore.addSession({});
        const mapped: Array<[string, string]> = [];

        await runAnalysisAsChatTurn({
            sid, text: 'go',
            run: async () => ({ text: 'verdict', messageId: 'app-msg-7' }),
            onMessageId: (entryId, messageId) => mapped.push([entryId, messageId]),
        });

        expect(mapped).toHaveLength(1);
        // The id is keyed to the ANSWER row, so Locate scrolls to the verdict.
        expect(mapped[0][1]).toBe('app-msg-7');
        expect(mapped[0][0]).toBe(entries(sid)[1].id);
    });

    it('does not call back with an id when the pipeline returns a bare string', async () => {
        const sid = chatStore.addSession({});
        const onMessageId = vi.fn();
        await runAnalysisAsChatTurn({ sid, text: 'go', run: async () => 'verdict', onMessageId });
        expect(onMessageId).not.toHaveBeenCalled();
    });

    it('titles the session from the question', async () => {
        const sid = chatStore.addSession({});
        await runAnalysisAsChatTurn({ sid, text: 'BTC or ETH here?', run: async () => 'x' });
        const s = chatStore.getSnapshot().sessions.find(x => x.id === sid);
        expect(s?.title).toContain('BTC or ETH');
    });

    it('releases the run slot even when the pipeline throws synchronously', async () => {
        const sid = chatStore.addSession({});
        await runAnalysisAsChatTurn({
            sid, text: 'go',
            run: () => { throw new Error('boom'); },
        });
        expect(chatStore.getController(sid)).toBeUndefined();
    });
});

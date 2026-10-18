import { describe, it, expect } from 'vitest';
import * as throttlers from '../hooks/analysisPipeline/streamThrottlers';
import { applyCasualStreamUpdate } from '../hooks/analysisPipeline/streamThrottlers';

const row = (over: Record<string, unknown> = {}) => ({ id: 'm1', role: 'ai', text: '', ...over } as never);
/** A transcript with something beside the addressed row: the writer must not
 *  touch the neighbours. The row under test is always index 1. */
const list = (over: Record<string, unknown> = {}) => [row({ id: 'user', text: 'asked' }), row({ id: 'm1', ...over } as never)];
const ai = (out: readonly unknown[]): Record<string, any> => (out as unknown as Array<Record<string, any>>)[1];

describe('applyCasualStreamUpdate', () => {
    it('patches the addressed row and leaves the others alone', () => {
        const prev = [row({ id: 'a', text: 'old' }), row({ id: 'm1', text: 'old' })];
        const out = applyCasualStreamUpdate(prev, 'm1', 'new', '', 'gemini', true);
        expect(ai(out).text).toBe('new');
        expect((out as unknown as Array<Record<string, any>>)[0].text).toBe('old');
    });

    it('returns the same array when the row is not there', () => {
        const prev = list();
        expect(applyCasualStreamUpdate(prev, 'gone', 'x', '', 'gemini', true)).toBe(prev);
    });

    it('moves a scratchpad leaked into the answer channel over to thinking', () => {
        const leaked = "Here's a thinking process:\n\n1. Read the tape\n\nThe setup is a breakout.";
        const out = applyCasualStreamUpdate(list(), 'm1', leaked, '', 'gemini', false);
        expect(ai(out).text).toBe('');
        expect(ai(out).text).not.toMatch(/thinking process/);
        expect(Object.values(ai(out).thoughtProcesses ?? {})[0]).toContain('Read the tape');
    });

    it('keys thinking by provider and keeps the previous map when this frame has none', () => {
        const withThinking = applyCasualStreamUpdate(list(), 'm1', 'answer', 'native thought', 'gemini', false);
        expect(ai(withThinking).thoughtProcesses).toEqual({ gemini: 'native thought' });
        const quiet = applyCasualStreamUpdate(list({ thoughtProcesses: { gemini: 'kept' } }), 'm1', 'answer', '', 'gemini', false);
        expect(ai(quiet).thoughtProcesses).toEqual({ gemini: 'kept' });
    });

    it('carries isStreaming so the last frame settles the row', () => {
        const streaming = applyCasualStreamUpdate(list(), 'm1', 'partial', '', 'gemini', true);
        expect(ai(streaming).isStreaming).toBe(true);
        expect(ai(applyCasualStreamUpdate(streaming, 'm1', 'final', '', 'gemini', false)).isStreaming).toBe(false);
    });
});

/** The four debate writers this file used to export died with the engine, and
 *  the casual writer is the only one the pipeline still destructures. */
describe('the throttlers surface after the debate deletion', () => {
    it('exports the casual writer and none of the debate updaters', () => {
        const names = Object.keys(throttlers);
        expect(names).toContain('applyCasualStreamUpdate');
        expect(names).toContain('useStreamThrottlers');
        for (const dead of [
            'applyDebateStreamUpdate',
            'applyProvisionalVerdictUpdate',
            'applyEnsembleProgressUpdate',
            'applyOpeningThinkingUpdate',
        ]) {
            expect(names).not.toContain(dead);
        }
    });
});

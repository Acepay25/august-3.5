import { describe, it, expect, vi, beforeEach } from 'vitest';

// Harness lesson store (Batch 1 P7) + known-answer probe (P6).

// The probe sends a real request through sendChatRequest — mock the
// transport so tests stay offline and deterministic.
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
}));

import {
    listHarnessLessons,
    lessonsForClass,
    recordHarnessLesson,
    clearHarnessLesson,
    probeWireSupport,
    resetHarnessLessonCache,
} from '../services/learning/harnessLessons';
import { sendChatRequest } from '../services/providers/GenericProviderService';
import type { ProviderConfig } from '../types/provider';

const makeConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'k',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['m'],
    selectedModel: 'm',
    ...overrides,
});

const mockSend = sendChatRequest as ReturnType<typeof vi.fn>;

describe('harnessLessons store (P7)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetHarnessLessonCache();
        mockSend.mockReset();
    });

    it('starts empty and records lessons with id + timestamp', () => {
        expect(listHarnessLessons()).toEqual([]);
        recordHarnessLesson({
            kind: 'wire',
            scope: 'thinkingDefault',
            pattern: 'pattern A',
            lesson: 'lesson A',
            evidenceId: 'ev-1',
        });
        const all = listHarnessLessons();
        expect(all).toHaveLength(1);
        expect(all[0].id).toMatch(/^hl_/);
        expect(all[0].at).toBeTruthy();
        expect(all[0].kind).toBe('wire');
        expect(all[0].scope).toBe('thinkingDefault');
    });

    it('re-recording the same scope+kind+pattern refreshes instead of duplicating', () => {
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'p', lesson: 'old', evidenceId: 'e1' });
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'p', lesson: 'new', evidenceId: 'e2' });
        const all = listHarnessLessons();
        expect(all).toHaveLength(1);
        expect(all[0].lesson).toBe('new');
        expect(all[0].evidenceId).toBe('e2');
    });

    it('same pattern but different kind stays distinct', () => {
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'p', lesson: 'l1', evidenceId: 'e1' });
        recordHarnessLesson({ kind: 'budget', scope: 'jsonMode', pattern: 'p', lesson: 'l2', evidenceId: 'e2' });
        expect(listHarnessLessons()).toHaveLength(2);
    });

    it('lessonsForClass filters by capability class (scope, never provider identity)', () => {
        recordHarnessLesson({ kind: 'wire', scope: 'vision', pattern: 'p1', lesson: 'l1', evidenceId: 'e1' });
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'p2', lesson: 'l2', evidenceId: 'e2' });
        expect(lessonsForClass('vision')).toHaveLength(1);
        expect(lessonsForClass('jsonMode')).toHaveLength(1);
        expect(lessonsForClass('thinkingDefault')).toHaveLength(0);
    });

    it('provider is recorded as provenance but is not the scope', () => {
        recordHarnessLesson({ kind: 'wire', scope: 'thinkingDefault', provider: 'custom-123', pattern: 'p', lesson: 'l', evidenceId: 'e' });
        const lesson = listHarnessLessons()[0];
        expect(lesson.provider).toBe('custom-123');
        expect(lesson.scope).toBe('thinkingDefault');
        // The same lesson matches its CLASS, not just its evidence provider.
        expect(lessonsForClass('thinkingDefault')).toHaveLength(1);
    });

    it('clearHarnessLesson removes exactly one lesson by id', () => {
        const a = recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'pa', lesson: 'la', evidenceId: 'e' });
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'pb', lesson: 'lb', evidenceId: 'e' });
        clearHarnessLesson(a.id);
        const all = listHarnessLessons();
        expect(all).toHaveLength(1);
        expect(all[0].pattern).toBe('pb');
    });

    it('persists across store reloads (localStorage chassis)', async () => {
        recordHarnessLesson({ kind: 'wire', scope: 'jsonMode', pattern: 'persist-me', lesson: 'l', evidenceId: 'e' });
        // Re-import with a fresh module registry by resetting the registry.
        vi.resetModules();
        const reloaded = await import('../services/learning/harnessLessons');
        const all = reloaded.listHarnessLessons();
        expect(all.some(l => l.pattern === 'persist-me')).toBe(true);
    });
});

describe('probeWireSupport (P6 known-answer probe)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetHarnessLessonCache();
        mockSend.mockReset();
    });

    it('knob sent + model replies OK → honored with evidence', async () => {
        mockSend.mockResolvedValue('OK');
        const result = await probeWireSupport(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'high');
        expect(result.honored).toBe(true);
        expect(result.audit.applied).toBe(true);
        expect(result.evidence).toContain('knob sent');
    });

    it('knob sent but model does not reply OK → not honored', async () => {
        mockSend.mockResolvedValue('something else entirely');
        const result = await probeWireSupport(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'high');
        expect(result.honored).toBe(false);
        expect(result.evidence).toContain('did not reply OK');
    });

    it('provider rejects the knob field by name → the knob provably reached the wire (honored)', async () => {
        mockSend.mockRejectedValue(new Error("400 Unrecognized request argument supplied: reasoning_effort"));
        const result = await probeWireSupport(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'high');
        expect(result.honored).toBe(true);
        expect(result.evidence).toContain('rejected the reasoning_effort field');
    });

    it('fail-closed shape (no verified route) → no knob sent, not honored', async () => {
        mockSend.mockResolvedValue('OK');
        const result = await probeWireSupport(makeConfig(), 'high');
        expect(result.audit.route).toBe('none');
        expect(result.honored).toBe(false);
        expect(result.evidence).toContain('no knob sent');
    });

    it('call fails for unrelated reasons → not honored, evidence names the failure', async () => {
        mockSend.mockRejectedValue(new Error('503 service unavailable'));
        const result = await probeWireSupport(makeConfig({ baseUrl: 'https://api.x.ai/v1' }), 'high');
        expect(result.honored).toBe(false);
        expect(result.evidence).toContain('503');
    });

    it('the probe request itself carries the effort tier', async () => {
        mockSend.mockResolvedValue('OK');
        await probeWireSupport(makeConfig({ baseUrl: 'https://api.z-ai.com/v1' }), 'max');
        const [, , options] = mockSend.mock.calls[0];
        expect(options.reasoningEffort).toBe('max');
    });
});

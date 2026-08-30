import { describe, it, expect, vi, beforeEach } from 'vitest';

// §14-3 probe self-harm guard — separate file because it mocks the whole
// transport module (probeWireSupport calls sendChatRequest directly).

const probeSend = vi.fn();
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: (...args: any[]) => probeSend(...args),
}));

import {
    probeWireSupport,
    probeAndLearn,
    listHarnessLessons,
    resetHarnessLessonCache,
} from '../services/learning/harnessLessons';
import type { ProviderConfig } from '../types/provider';

const baseConfig = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1', name: 'P1', apiKey: 'k', baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm', ...over,
});

const glm = () => baseConfig({
    baseUrl: 'https://api.z-ai.dev/v1', selectedModel: 'glm-4.6', id: 'glm',
});

describe('§14-3 probe self-harm guard', () => {
    beforeEach(() => {
        localStorage.clear();
        resetHarnessLessonCache();
        probeSend.mockReset();
    });

    it('probe sends a thinking-safe budget (>=512 tokens)', async () => {
        probeSend.mockResolvedValue('OK');
        await probeWireSupport(glm(), 'high');
        const [, , options] = probeSend.mock.calls[0];
        expect(options.maxTokens).toBeGreaterThanOrEqual(512);
    });

    it('knob sent + 200 + no OK → inconclusive, and probeAndLearn records NO lesson', async () => {
        probeSend.mockResolvedValue('something else');
        const result = await probeAndLearn(glm(), 'high');
        expect(result.honored).toBe(false);
        expect(result.evidence).toContain('inconclusive');
        expect(listHarnessLessons()).toHaveLength(0);
    });

    it('rejection naming the knob still counts as reached-the-wire (hard evidence path intact)', async () => {
        probeSend.mockRejectedValue(new Error('400 Unrecognized request argument supplied: reasoning_effort'));
        const result = await probeWireSupport(baseConfig({
            baseUrl: 'https://api.x.ai/v1', selectedModel: 'grok-4', id: 'xai',
        }), 'high');
        expect(result.honored).toBe(true);
        expect(result.evidence).toContain('rejected the reasoning_effort field');
    });

    it('unrelated error mentioning "thinking" does NOT count as knob rejection', async () => {
        probeSend.mockRejectedValue(new Error('500 internal error while thinking about routing'));
        const result = await probeWireSupport(glm(), 'high');
        expect(result.honored).toBe(false);
        expect(result.evidence).toContain('call failed before the knob could be judged');
    });
});

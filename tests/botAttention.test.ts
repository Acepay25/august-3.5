import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';
import { classifyBotAttention } from '../services/agents/botAttention';
import { recordProviderError, resetProviderHealth } from '../services/infrastructure/ProviderHealthService';

// Bot Mode G3 (plan botmode-scan): needs-attention classification — every
// way a bot can silently stop working must produce a one-line hint.

const bot = (over: Partial<AgentBot> = {}): AgentBot => ({
    id: 'b1', name: 'Macro', providerId: 'p1', modelId: 'm1',
    avatar: { kind: 'auto' }, createdAt: '', ...over,
});

const cfg = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1', name: 'Alpha', apiKey: 'sk', baseUrl: 'https://x', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: false, models: ['m1'], selectedModel: 'm1', ...over,
} as ProviderConfig);

beforeEach(() => resetProviderHealth());

describe('classifyBotAttention', () => {
    it('null when the bot is ready', () => {
        expect(classifyBotAttention(bot(), [cfg()])).toBeNull();
    });

    it('config problems outrank telemetry', () => {
        expect(classifyBotAttention(bot(), [])?.cls).toBe('no_provider');
        expect(classifyBotAttention(bot(), [cfg({ models: ['other'] })])?.cls).toBe('model_missing');
        expect(classifyBotAttention(bot(), [cfg({ apiKey: '' })])?.cls).toBe('no_key');
        expect(classifyBotAttention(bot(), [cfg({ isEnabled: false })])?.cls).toBe('disabled');
    });

    it('auth errors from the last persisted provider error', () => {
        recordProviderError('p1', new Error('HTTP 401 Unauthorized'));
        expect(classifyBotAttention(bot(), [cfg()])?.cls).toBe('auth');
    });

    it('quota/rate-limit errors', () => {
        recordProviderError('p1', new Error('429 rate limit exceeded'));
        expect(classifyBotAttention(bot(), [cfg()])?.cls).toBe('quota');
    });

    it('benched after the cooldown threshold', () => {
        for (let i = 0; i < 3; i++) recordProviderError('p1', new Error('HTTP 500 boom'));
        expect(classifyBotAttention(bot(), [cfg()])?.cls).toBe('benched');
    });

    it('hints name the bot and the fix surface', () => {
        const a = classifyBotAttention(bot(), [cfg({ apiKey: '' })]);
        expect(a?.hint).toContain('Macro');
        expect(a?.hint).toContain('Settings');
    });
});

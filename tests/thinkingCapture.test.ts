import { describe, it, expect } from 'vitest';
import {
    extractReasoning,
    extractMessagesThinking,
    extractResponsesReasoning,
    shouldRequestExtendedThinking,
} from '../services/providers/GenericProviderService';
import type { ProviderConfig } from '../types/provider';

// Thinking capture is format-agnostic: users configure arbitrary providers
// (chat_completions / messages / responses), so the chain-of-thought must be
// sniffed from every wire format, not just Claude's. These tests pin the
// extraction shapes — DeepSeek-style `reasoning_content`, Qwen/Kimi-style
// `reasoning` arrays, Anthropic `thinking` blocks, and Responses API
// `reasoning` items.

const baseConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'test',
    name: 'Test',
    apiKey: 'key',
    baseUrl: 'https://example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['test-model'],
    selectedModel: 'test-model',
    ...overrides,
});

describe('extractReasoning — OpenAI-compatible reasoning payloads', () => {
    it('passes a plain reasoning_content string through', () => {
        expect(extractReasoning('step by step')).toBe('step by step');
    });

    it('joins Qwen/Kimi-style reasoning arrays', () => {
        expect(extractReasoning(['first thought', 'second thought'])).toBe('first thought\nsecond thought');
    });

    it('returns empty for missing / non-string payloads', () => {
        expect(extractReasoning(undefined)).toBe('');
        expect(extractReasoning('')).toBe('');
        expect(extractReasoning(42)).toBe('');
        expect(extractReasoning([1, 'text', null])).toBe('text');
    });

    it('prefers reasoning_content over reasoning when both exist', () => {
        const payload: any = { reasoning_content: 'deepseek', reasoning: 'other' };
        expect(extractReasoning(payload.reasoning_content) || extractReasoning(payload.reasoning)).toBe('deepseek');
    });
});

describe('extractMessagesThinking — Anthropic thinking blocks', () => {
    it('joins thinking content blocks in order', () => {
        const content = [
            { type: 'thinking', thinking: 'check the entry zone', signature: 'sig1' },
            { type: 'text', text: 'Final answer' },
            { type: 'thinking', thinking: 'then the stop loss', signature: 'sig2' },
        ];
        expect(extractMessagesThinking(content)).toBe('check the entry zone\nthen the stop loss');
    });

    it('surfaces redacted_thinking blocks as a marker', () => {
        const content = [
            { type: 'thinking', thinking: 'visible part', signature: 's' },
            { type: 'redacted_thinking', data: 'encrypted' },
        ];
        expect(extractMessagesThinking(content)).toBe('visible part\n[Thinking redacted by provider]');
    });

    it('returns empty when there is no thinking', () => {
        expect(extractMessagesThinking([{ type: 'text', text: 'only text' }])).toBe('');
        expect(extractMessagesThinking(undefined)).toBe('');
        expect(extractMessagesThinking('not an array')).toBe('');
    });

    it('ignores empty thinking blocks', () => {
        expect(extractMessagesThinking([{ type: 'thinking', thinking: '  ' }])).toBe('');
    });
});

describe('extractResponsesReasoning — OpenAI Responses API reasoning items', () => {
    it('extracts full text from reasoning item content blocks', () => {
        const output = [
            { type: 'message', content: [{ type: 'output_text', text: 'the answer' }] },
            { type: 'reasoning', content: [{ type: 'output_text', text: 'chain of thought' }] },
        ];
        expect(extractResponsesReasoning(output)).toBe('chain of thought');
    });

    it('falls back to the public summary when full text is absent', () => {
        const output = [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: 'public summary' }] },
        ];
        expect(extractResponsesReasoning(output)).toBe('public summary');
    });

    it('captures both content and summary when present', () => {
        const output = [
            { type: 'reasoning', content: [{ type: 'output_text', text: 'full' }], summary: [{ type: 'summary_text', text: 'summary' }] },
        ];
        expect(extractResponsesReasoning(output)).toBe('full\nsummary');
    });

    it('returns empty for non-reasoning output', () => {
        expect(extractResponsesReasoning([{ type: 'message', content: [] }])).toBe('');
        expect(extractResponsesReasoning(undefined)).toBe('');
    });
});

describe('shouldRequestExtendedThinking — Anthropic thinking request gating', () => {
    const thinkingCapable = (model: string) => baseConfig({ apiFormat: 'messages', selectedModel: model });

    it('enables thinking for extended-thinking Claude models', () => {
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-3-7-sonnet-20250219'))).toBe(true);
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-sonnet-4-latest'))).toBe(true);
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-opus-4-20250514'))).toBe(true);
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-haiku-4-5-latest'))).toBe(true);
    });

    it('never requests thinking for models that would 400 on the block', () => {
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-3-5-sonnet-20241022'))).toBe(false);
        expect(shouldRequestExtendedThinking(thinkingCapable('claude-3-opus-20240229'))).toBe(false);
        expect(shouldRequestExtendedThinking(baseConfig({ apiFormat: 'messages', selectedModel: 'gpt-4o' }))).toBe(false);
        expect(shouldRequestExtendedThinking(baseConfig({ apiFormat: 'chat_completions', selectedModel: 'claude-sonnet-4' }))).toBe(false);
    });

    it('skips tiny calls (connection tests) and JSON mode', () => {
        const config = thinkingCapable('claude-sonnet-4-latest');
        expect(shouldRequestExtendedThinking(config, { maxTokens: 10 })).toBe(false);
        expect(shouldRequestExtendedThinking(config, { maxTokens: 4096 })).toBe(true);
        expect(shouldRequestExtendedThinking(config, { maxTokens: 8192, jsonMode: true })).toBe(false);
    });
});

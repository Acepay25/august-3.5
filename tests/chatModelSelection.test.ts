/**
 * resolveChatModelSelection — the composer's model pick must answer from the
 * EXACT provider the user picked it from. A bare model id is ambiguous when
 * two providers offer the same model; the qualified `providerId::modelId`
 * form pins it. Legacy bare ids resolve heuristically.
 */

import { describe, it, expect } from 'vitest';
import { chatModelIdOf, findChatModelOwner, resolveChatModelSelection } from '../utils/providerUtils';
import type { ProviderConfig } from '../types/provider';

const prov = (id: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id, name: id.toUpperCase(), apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['glm-5'], selectedModel: 'glm-5',
    ...over,
});

describe('resolveChatModelSelection', () => {
    it('a qualified pick answers from the picked provider even when another provider lists the same model first', () => {
        const providers = [
            prov('prov-a', { models: ['glm-5', 'm-a2'] }),
            prov('prov-b', { models: ['glm-5', 'm-b2'] }),
        ];
        const got = resolveChatModelSelection(providers, 'prov-b::glm-5');
        expect(got?.id).toBe('prov-b');
        expect(got?.selectedModel).toBe('glm-5');
    });

    it('a qualified pick to a disabled/unkeyed provider does NOT silently fall back', () => {
        const providers = [
            prov('prov-a'),
            prov('prov-b', { isEnabled: false }),
        ];
        expect(resolveChatModelSelection(providers, 'prov-b::glm-5')).toBeNull();
    });

    it('legacy bare ids prefer the provider whose selectedModel matches, then any provider listing it', () => {
        const providers = [
            prov('prov-a', { models: ['glm-5', 'm-a2'], selectedModel: 'other' }),
            prov('prov-b', { models: ['glm-5'], selectedModel: 'glm-5' }),
        ];
        expect(resolveChatModelSelection(providers, 'glm-5')?.id).toBe('prov-b');
        expect(resolveChatModelSelection(providers, 'm-a2')?.id).toBe('prov-a');
    });

    it('empty or unknown selections resolve to null (caller decides the fallback)', () => {
        expect(resolveChatModelSelection([prov('prov-a')], '')).toBeNull();
        expect(resolveChatModelSelection([prov('prov-a')], 'nope')).toBeNull();
    });

    it('chatModelIdOf strips the provider prefix and passes legacy ids through', () => {
        expect(chatModelIdOf('prov-b::glm-5')).toBe('glm-5');
        expect(chatModelIdOf('glm-5')).toBe('glm-5');
        expect(chatModelIdOf('')).toBe('');
    });

    it('findChatModelOwner reports the precise reason a selection cannot answer', () => {
        const providers = [
            prov('prov-a'),
            prov('prov-b', { isEnabled: false }),
            prov('prov-c', { apiKey: '' }),
        ];
        // Disabled provider: found, flagged not-ready (vs. missing entirely).
        const disabled = findChatModelOwner(providers, 'prov-b::glm-5');
        expect(disabled?.ready).toBe(false);
        expect(disabled?.config.id).toBe('prov-b');
        // Keyless provider: same story.
        const keyless = findChatModelOwner(providers, 'prov-c::glm-5');
        expect(keyless?.ready).toBe(false);
        // Genuinely gone (provider deleted / model removed): no owner at all.
        expect(findChatModelOwner(providers, 'ghost::glm-5')).toBeNull();
        expect(findChatModelOwner(providers, 'no-such-model')).toBeNull();
        // A healthy pick is ready.
        expect(findChatModelOwner(providers, 'prov-a::glm-5')?.ready).toBe(true);
    });
});

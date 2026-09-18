/**
 * providerRequestPolicy — the shared wire-policy module that the renderer
 * (GenericProviderService), the vite dev proxy, and electron/main.cjs all
 * consume. The transport-triplication drift (stale Claude thinking-gate
 * regexes, fixed 0.35 budgets, missing messages temperature, diverging
 * LAN-HTTP host rules — .review/deep-dive-2026-09-15.md §"Providers /
 * transport" + audit-crosscheck §4/§5) is only "killed at the class" if this
 * module is provably THE source: every rule below pins the single copy, and
 * the final describe greps the three transports for resurrected inline
 * copies.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import {
    isExtendedThinkingModel,
    claudeThinkingBudgetTokens,
    anthropicShouldSendThinking,
    anthropicThinkingFields,
    geminiThinkingParams,
    isPrivateOrLoopbackHost,
    httpAllowedForHost,
    isSafeProviderTargetUrl,
    isLocalBaseUrl,
    MIN_EFFECTIVE_THINKING_TOKENS,
    ANTHROPIC_DEFAULT_TEMPERATURE,
} from '../shared/providerRequestPolicy.cjs';
import { isProviderReady } from '../utils/providerUtils';
import type { ProviderConfig } from '../types/provider';

// getReadyProviders lives in ProviderConfigService, which loads its module
// graph through PreferencesService — stub it like the service's own suite.
let prefStore: unknown = null;
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async () => prefStore),
    setPreferenceObject: vi.fn(async (_key: string, value: unknown) => { prefStore = value; }),
}));
import { getReadyProviders } from '../services/infrastructure/ProviderConfigService';

const baseConfig = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'messages',
    isEnabled: true,
    isBuiltIn: false,
    models: ['model-1'],
    selectedModel: 'model-1',
    ...over,
});

describe('isExtendedThinkingModel — the single Claude thinking-gate list', () => {
    it('accepts the full 3.7/4/4.5/5-series family (renderer list is the source)', () => {
        expect(isExtendedThinkingModel('claude-3-7-sonnet-20250219')).toBe(true);
        expect(isExtendedThinkingModel('claude-3.7-sonnet')).toBe(true);
        expect(isExtendedThinkingModel('anthropic/claude-sonnet-4-5')).toBe(true);
        expect(isExtendedThinkingModel('claude-opus-4-20250514')).toBe(true);
        expect(isExtendedThinkingModel('claude-haiku-4-5-latest')).toBe(true);
        expect(isExtendedThinkingModel('claude-4-5')).toBe(true);
        // The 5-series ids the OLD proxy copies missed — thinking on them is
        // now impossible to lose on desktop/dev.
        expect(isExtendedThinkingModel('claude-sonnet-5-20260901')).toBe(true);
        expect(isExtendedThinkingModel('claude-opus-5')).toBe(true);
    });

    it('rejects non-thinking Claude ids and foreign models', () => {
        expect(isExtendedThinkingModel('claude-3-5-sonnet-20241022')).toBe(false);
        expect(isExtendedThinkingModel('claude-3-opus-20240229')).toBe(false);
        expect(isExtendedThinkingModel('claude-instant-1')).toBe(false);
        expect(isExtendedThinkingModel('gpt-5')).toBe(false);
        expect(isExtendedThinkingModel('')).toBe(false);
        expect(isExtendedThinkingModel(undefined)).toBe(false);
    });

    it('matches through the display name when the model id is opaque (proxy routes)', () => {
        expect(isExtendedThinkingModel('proxy-main', 'claude-opus-4-1-passthrough')).toBe(true);
        expect(isExtendedThinkingModel('proxy-main', 'GPT-4o')).toBe(false);
    });

    it('honors the manual thinkingCapable override in both directions', () => {
        expect(isExtendedThinkingModel('gpt-4o', undefined, true)).toBe(true);
        expect(isExtendedThinkingModel('claude-opus-5', undefined, false)).toBe(false);
        expect(isExtendedThinkingModel('claude-opus-5', undefined, undefined)).toBe(true);
    });
});

describe('claudeThinkingBudgetTokens — effort fractions + clamps', () => {
    it('scales the budget by the effort tier (fractions .15/.35/.55/.85)', () => {
        expect(claudeThinkingBudgetTokens(8192, 'low')).toBe(1228);    // 0.15
        expect(claudeThinkingBudgetTokens(8192, 'medium')).toBe(2867); // 0.35
        expect(claudeThinkingBudgetTokens(8192, 'high')).toBe(4505);   // 0.55
        expect(claudeThinkingBudgetTokens(8192, 'max')).toBe(6963);    // 0.85
        // 'auto'/unknown/absent keep the historical default fraction.
        expect(claudeThinkingBudgetTokens(8192, undefined)).toBe(2867);
        expect(claudeThinkingBudgetTokens(8192, 'auto')).toBe(2867);
    });

    it('clamps to the Anthropic 1024 floor and under max_tokens', () => {
        // 0.35 × 2560 = 896 → clamped up to 1024 (debate rebuttals think).
        expect(claudeThinkingBudgetTokens(2560)).toBe(1024);
        expect(claudeThinkingBudgetTokens(2560, 'low')).toBe(1024);
        // Just above the floor: budget 1024 stays below max_tokens.
        expect(claudeThinkingBudgetTokens(1025, 'max')).toBe(1024);
        expect(claudeThinkingBudgetTokens(1025, 'max')).toBeLessThan(1025);
        // The upper clamp (maxTokens-1) can never strand a valid budget.
        expect(claudeThinkingBudgetTokens(4096, 'max')).toBe(3481);
    });
});

describe('anthropicShouldSendThinking — the full gate', () => {
    it('excludes JSON mode and the composer "off" tier', () => {
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5', maxTokens: 8192, jsonMode: true })).toBe(false);
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5', maxTokens: 8192, reasoningEffort: 'off' })).toBe(false);
    });

    it('requires maxTokens headroom above the 1024 floor (connection tests skipped)', () => {
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5', maxTokens: 10 })).toBe(false);
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5', maxTokens: MIN_EFFECTIVE_THINKING_TOKENS })).toBe(false);
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5', maxTokens: MIN_EFFECTIVE_THINKING_TOKENS + 1 })).toBe(true);
        expect(anthropicShouldSendThinking({ modelId: 'claude-opus-5' })).toBe(true); // default 4096
    });

    it('respects the override flag and the model list', () => {
        expect(anthropicShouldSendThinking({ modelId: 'gpt-4o', maxTokens: 4096 })).toBe(false);
        expect(anthropicShouldSendThinking({ modelId: 'gpt-4o', maxTokens: 4096, capabilityOverride: true })).toBe(true);
        expect(anthropicShouldSendThinking({ modelId: 'claude-sonnet-4-5', maxTokens: 4096, capabilityOverride: false })).toBe(false);
    });
});

describe('anthropicThinkingFields — temperature-omitted-with-thinking rule', () => {
    it('omits temperature entirely while thinking is active', () => {
        const fields = anthropicThinkingFields({ modelId: 'claude-sonnet-5', maxTokens: 8192, reasoningEffort: 'high' });
        expect(fields.thinking).toEqual({ type: 'enabled', budget_tokens: 4505 });
        expect(fields.temperature).toBeUndefined();
    });

    it('defaults messages temperature to 0.7 and passes an explicit value through', () => {
        expect(ANTHROPIC_DEFAULT_TEMPERATURE).toBe(0.7);
        const dflt = anthropicThinkingFields({ modelId: 'gpt-4o', maxTokens: 4096 });
        expect(dflt.thinking).toBeUndefined();
        expect(dflt.temperature).toBe(0.7);
        expect(anthropicThinkingFields({ modelId: 'gpt-4o', temperature: 0.2 }).temperature).toBe(0.2);
    });

    it('keeps the temperature when the gate drops thinking (json mode, floor)', () => {
        const json = anthropicThinkingFields({ modelId: 'claude-opus-5', maxTokens: 8192, jsonMode: true, temperature: 0.4 });
        expect(json.thinking).toBeUndefined();
        expect(json.temperature).toBe(0.4);
        const tiny = anthropicThinkingFields({ modelId: 'claude-opus-5', maxTokens: 10 });
        expect(tiny.thinking).toBeUndefined();
        expect(tiny.temperature).toBe(0.7);
    });
});

describe('geminiThinkingParams', () => {
    it('requests thoughts with the long-standing 8192 budget, never under JSON mode', () => {
        expect(geminiThinkingParams(false, 'gemini-2.5-pro')).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
        expect(geminiThinkingParams(true, 'gemini-2.5-pro')).toBeUndefined();
    });

    it('keeps the renderer semantics for thinking-ish and unknown ids', () => {
        expect(geminiThinkingParams(false, 'thinking-machines/tm-1')).toBeDefined();
        expect(geminiThinkingParams(false, 'gpt-4o')).toBeUndefined();
        expect(geminiThinkingParams(false, '')).toBeDefined(); // empty id still counts gemini-ish (renderer rule)
    });

    it('scales thinkingBudget based on effort and disables on off', () => {
        expect(geminiThinkingParams(false, 'gemini-2.5-pro', 'off')).toBeUndefined();
        expect(geminiThinkingParams(false, 'gemini-2.5-pro', 'low')).toEqual({ includeThoughts: true, thinkingBudget: 2048 });
        expect(geminiThinkingParams(false, 'gemini-2.5-pro', 'medium')).toEqual({ includeThoughts: true, thinkingBudget: 4096 });
        expect(geminiThinkingParams(false, 'gemini-2.5-pro', 'high')).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
        expect(geminiThinkingParams(false, 'gemini-2.5-pro', 'max')).toEqual({ includeThoughts: true, thinkingBudget: 16384 });
    });
});

describe('host policy — loopback/private LAN vs public', () => {
    const allowed: Array<[string, string]> = [
        ['localhost', 'loopback name'],
        ['127.0.0.1', 'loopback'],
        ['127.5.5.5', 'whole 127/8'],
        ['[::1]', 'IPv6 loopback (URL form)'],
        ['::1', 'IPv6 loopback (bare)'],
        ['0.0.0.0', 'unspecified'],
        ['10.1.2.3', 'RFC1918 10/8'],
        ['192.168.1.5', 'RFC1918 192.168/16'],
        ['172.16.0.9', 'RFC1918 172.16/12 low edge'],
        ['172.31.255.255', 'RFC1918 172.16/12 high edge'],
        ['169.254.10.1', 'link-local'],
        ['LocalHost', 'case-insensitive'],
    ];
    const denied: Array<[string, string]> = [
        ['172.32.0.1', 'just outside 172.16/12'],
        ['8.8.8.8', 'public IP'],
        ['example.com', 'public name'],
        ['localhost.evil.example', 'name-suffix spoof'],
        ['100.64.0.1', 'CGNAT (not in the renderer rule)'],
        ['', 'empty'],
    ];

    it.each(allowed)('treats %s (%s) as private/loopback', (host) => {
        expect(isPrivateOrLoopbackHost(host)).toBe(true);
        expect(httpAllowedForHost(host)).toBe(true);
    });

    it.each(denied)('treats %s (%s) as remote — HTTP forbidden', (host) => {
        expect(isPrivateOrLoopbackHost(host)).toBe(false);
        expect(httpAllowedForHost(host)).toBe(false);
    });

    it('isSafeProviderTargetUrl: https remote OK, http only for private, no embedded credentials', () => {
        expect(isSafeProviderTargetUrl('https://api.example.com/v1')).toBe(true);
        expect(isSafeProviderTargetUrl('http://192.168.1.5:11434/v1')).toBe(true);
        expect(isSafeProviderTargetUrl('http://localhost:11434')).toBe(true);
        expect(isSafeProviderTargetUrl('http://api.example.com/v1')).toBe(false);
        expect(isSafeProviderTargetUrl('ftp://localhost/models')).toBe(false);
        expect(isSafeProviderTargetUrl('http://user:pass@127.0.0.1')).toBe(false);
        expect(isSafeProviderTargetUrl('https://proxy.example/r?token=1')).toBe(true); // redirect hops may carry query
        expect(isSafeProviderTargetUrl('not a url')).toBe(false);
        expect(isSafeProviderTargetUrl('')).toBe(false);
    });
});

describe('isLocalBaseUrl — keyless local providers', () => {
    it('recognizes loopback and LAN server URLs', () => {
        expect(isLocalBaseUrl('http://localhost:11434')).toBe(true);
        expect(isLocalBaseUrl('http://127.0.0.1:1234/v1')).toBe(true);
        expect(isLocalBaseUrl('https://127.0.0.1:1337/v1')).toBe(true);
        expect(isLocalBaseUrl('http://192.168.1.20:11434/v1')).toBe(true);
        expect(isLocalBaseUrl('http://[::1]:8080')).toBe(true);
    });

    it('rejects remote and garbage', () => {
        expect(isLocalBaseUrl('https://api.openai.com/v1')).toBe(false);
        expect(isLocalBaseUrl('')).toBe(false);
        expect(isLocalBaseUrl('gibberish')).toBe(false);
    });

    it('both readiness predicates accept keyless local configs and share the models clause', () => {
        const local = { apiKey: '', baseUrl: 'http://192.168.1.20:11434/v1', isEnabled: true };
        expect(isProviderReady(baseConfig(local))).toBe(true);
        expect(getReadyProviders([baseConfig(local)])).toHaveLength(1);

        // Empty models list ⇒ NOT ready via either predicate (no `model:''`
        // 400s). This clause used to exist only in getReadyProviders.
        const noModels = baseConfig({ ...local, models: [], selectedModel: '' });
        expect(isProviderReady(noModels)).toBe(false);
        expect(getReadyProviders([noModels])).toEqual([]);

        // Remote providers still demand a key; disable still wins everywhere.
        expect(isProviderReady(baseConfig({ apiKey: '' }))).toBe(false);
        expect(getReadyProviders([baseConfig({ apiKey: '' })])).toEqual([]);
        expect(isProviderReady(baseConfig({ ...local, isEnabled: false }))).toBe(false);
        expect(getReadyProviders([baseConfig({ ...local, isEnabled: false })])).toEqual([]);

        // Regression: remote WITH a key stays ready.
        expect(isProviderReady(baseConfig())).toBe(true);
        expect(getReadyProviders([baseConfig()])).toHaveLength(1);
    });
});

describe('single-source enforcement — no transport may re-inline the policy', () => {
    const mainSrc = readFileSync('electron/main.cjs', 'utf8');
    const viteSrc = readFileSync('vite.config.ts', 'utf8');
    const rendererSrc = readFileSync('services/providers/GenericProviderService.ts', 'utf8');

    it('all three transports load the shared module', () => {
        expect(mainSrc).toContain("require('../shared/providerRequestPolicy.cjs')");
        expect(viteSrc).toContain("from './shared/providerRequestPolicy.cjs'");
        expect(rendererSrc).toContain("from '../../shared/providerRequestPolicy.cjs'");
    });

    it('no transport carries a private copy of the Claude thinking regex anymore', () => {
        // The drift that started this: main.cjs + the proxy kept
        // /claude-(?:3-7|sonnet-4|opus-4|haiku-4-5)/ while the renderer moved on.
        expect(mainSrc).not.toMatch(/claude-\(\?:/);
        expect(viteSrc).not.toMatch(/claude-\(\?:/);
        expect(rendererSrc).not.toMatch(/claude-\(\?:/);
        // …nor the fixed-0.35 inline budget math.
        expect(mainSrc).not.toMatch(/budget_tokens: Math\.max\(1024/);
        expect(viteSrc).not.toMatch(/budget_tokens: Math\.max\(1024/);
    });

    it('no transport keeps a private copy of the URL host rules', () => {
        expect(mainSrc).not.toContain('LOCAL_PROVIDER_HOSTS');
        expect(viteSrc).not.toMatch(/192\\\.168\\\.\\d/);
    });
});

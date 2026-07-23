/**
 * ProviderConfigService — CRUD for runtime-configurable AI provider settings.
 * Stores provider configs via PreferencesService (localStorage / Capacitor Preferences).
 */

import { ProviderConfig, ApiFormat } from '../../types/provider';
import { getPreferenceObject, setPreferenceObject } from './PreferencesService';

const STORAGE_KEY = 'provider_configs_v1';

// ─── Default Built-In Providers ─────────────────────────────────────────────

export function getDefaultConfigs(): ProviderConfig[] {
    return [
        {
            id: 'gemini',
            name: 'Gemini',
            apiKey: '',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiFormat: 'chat_completions',
            isEnabled: true,
            isBuiltIn: true,
            models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3-pro-preview', 'gemini-3-flash'],
            selectedModel: 'gemini-2.5-pro',
        },
        {
            id: 'deepseek',
            name: 'DeepSeek',
            apiKey: '',
            baseUrl: 'https://api.deepseek.com',
            apiFormat: 'chat_completions',
            isEnabled: true,
            isBuiltIn: true,
            models: ['deepseek-chat', 'deepseek-reasoner'],
            selectedModel: 'deepseek-chat',
        },
        {
            id: 'openai',
            name: 'OpenAI',
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            apiFormat: 'chat_completions',
            isEnabled: false,
            isBuiltIn: true,
            models: ['gpt-5-nano', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4o'],
            selectedModel: 'gpt-4.1-nano',
        },
        {
            id: 'groq',
            name: 'Groq',
            apiKey: '',
            baseUrl: 'https://api.groq.com/openai/v1',
            apiFormat: 'chat_completions',
            isEnabled: false,
            isBuiltIn: true,
            models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'moonshotai/kimi-k2-instruct'],
            selectedModel: 'llama-3.3-70b-versatile',
        },
        {
            id: 'openrouter',
            name: 'OpenRouter',
            apiKey: '',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiFormat: 'chat_completions',
            isEnabled: false,
            isBuiltIn: true,
            models: ['qwen/qwen3-235b-a22b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'mistralai/mistral-7b-instruct:free', 'moonshotai/kimi-k2:free'],
            selectedModel: 'qwen/qwen3-235b-a22b:free',
        },
        {
            id: 'zhipu',
            name: 'Zhipu (GLM)',
            apiKey: '',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            apiFormat: 'chat_completions',
            isEnabled: false,
            isBuiltIn: true,
            models: ['glm-4.5-flash', 'glm-4.6', 'glm-4.5', 'glm-4.6v-flash'],
            selectedModel: 'glm-4.5-flash',
        },
        {
            id: 'grok',
            name: 'Grok (xAI)',
            apiKey: '',
            baseUrl: 'https://api.x.ai/v1',
            apiFormat: 'chat_completions',
            isEnabled: false,
            isBuiltIn: true,
            models: ['grok-3', 'grok-3-mini', 'grok-3-fast', 'grok-4-1-fast-reasoning'],
            selectedModel: 'grok-3-mini',
        },
    ];
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Load all provider configs. Falls back to defaults if none saved.
 * Merges saved configs with any new built-in providers added in updates.
 */
export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
    const saved = await getPreferenceObject<ProviderConfig[]>(STORAGE_KEY);
    if (!saved || saved.length === 0) {
        return getDefaultConfigs();
    }

    // Merge: ensure all built-in providers exist (in case new ones were added in updates)
    const defaults = getDefaultConfigs();
    const savedIds = new Set(saved.map(c => c.id));
    const newBuiltIns = defaults.filter(d => !savedIds.has(d.id));

    return [...saved, ...newBuiltIns];
}

/**
 * Persist all provider configs.
 */
export async function saveProviderConfigs(configs: ProviderConfig[]): Promise<void> {
    await setPreferenceObject(STORAGE_KEY, configs);
}

/**
 * Update a single provider config by ID.
 */
export async function updateProviderConfig(
    id: string,
    updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>
): Promise<ProviderConfig[]> {
    const configs = await loadProviderConfigs();
    const updated = configs.map(c =>
        c.id === id ? { ...c, ...updates } : c
    );
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Add a custom provider.
 */
export async function addCustomProvider(provider: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiFormat;
    models?: string[];
    selectedModel?: string;
}): Promise<ProviderConfig[]> {
    const configs = await loadProviderConfigs();
    const newConfig: ProviderConfig = {
        id: `custom-${Date.now()}`,
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat,
        isEnabled: true,
        isBuiltIn: false,
        models: provider.models || ['default'],
        selectedModel: provider.selectedModel || provider.models?.[0] || 'default',
    };
    const updated = [...configs, newConfig];
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Remove a custom provider (built-in providers cannot be removed).
 */
export async function removeCustomProvider(id: string): Promise<ProviderConfig[]> {
    const configs = await loadProviderConfigs();
    const target = configs.find(c => c.id === id);
    if (target?.isBuiltIn) {
        throw new Error('Cannot remove built-in providers');
    }
    const updated = configs.filter(c => c.id !== id);
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Get only enabled providers that have an API key configured.
 */
export function getReadyProviders(configs: ProviderConfig[]): ProviderConfig[] {
    return configs.filter(c => c.isEnabled && c.apiKey.trim().length > 0);
}

/**
 * ProviderConfigService — CRUD for runtime-configurable AI provider settings.
 * Stores provider configs via PreferencesService (localStorage / Capacitor Preferences).
 */

import { ProviderConfig, ApiFormat } from '../../types/provider';
import { getPreferenceObject, setPreferenceObject } from './PreferencesService';

const STORAGE_KEY = 'provider_configs_v1';

// ─── Provider Configuration Service ───────────────────────────────────────

export function getDefaultConfigs(): ProviderConfig[] {
    return [];
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Load all provider configs. Returns empty array if none configured.
 */
export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
    const saved = await getPreferenceObject<ProviderConfig[]>(STORAGE_KEY);
    if (!saved) {
        return getDefaultConfigs();
    }
    return saved;
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
 * Remove a provider (custom or built-in).
 */
export async function removeCustomProvider(id: string): Promise<ProviderConfig[]> {
    const configs = await loadProviderConfigs();
    const updated = configs.filter(c => c.id !== id);
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Add a model ID to a provider's model list.
 */
export async function addModelToProvider(providerId: string, modelId: string): Promise<ProviderConfig[]> {
    const trimmed = modelId.trim();
    if (!trimmed) return await loadProviderConfigs();
    const configs = await loadProviderConfigs();
    const updated = configs.map(c => {
        if (c.id === providerId) {
            const models = c.models.includes(trimmed) ? c.models : [...c.models, trimmed];
            const selectedModel = c.selectedModel ? c.selectedModel : trimmed;
            return { ...c, models, selectedModel };
        }
        return c;
    });
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Remove a model ID from a provider's model list.
 */
export async function removeModelFromProvider(providerId: string, modelId: string): Promise<ProviderConfig[]> {
    const configs = await loadProviderConfigs();
    const updated = configs.map(c => {
        if (c.id === providerId) {
            const models = c.models.filter(m => m !== modelId);
            const selectedModel = c.selectedModel === modelId ? (models[0] || '') : c.selectedModel;
            return { ...c, models, selectedModel };
        }
        return c;
    });
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Update/rename a model ID in a provider's model list.
 */
export async function updateModelInProvider(providerId: string, oldModelId: string, newModelId: string): Promise<ProviderConfig[]> {
    const trimmed = newModelId.trim();
    if (!trimmed) return await loadProviderConfigs();
    const configs = await loadProviderConfigs();
    const updated = configs.map(c => {
        if (c.id === providerId) {
            const models = c.models.map(m => m === oldModelId ? trimmed : m);
            const selectedModel = c.selectedModel === oldModelId ? trimmed : c.selectedModel;
            return { ...c, models, selectedModel };
        }
        return c;
    });
    await saveProviderConfigs(updated);
    return updated;
}

/**
 * Get only enabled providers that have an API key configured.
 */
export function getReadyProviders(configs: ProviderConfig[]): ProviderConfig[] {
    return configs.filter(c => c.isEnabled && c.apiKey.trim().length > 0);
}


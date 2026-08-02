/**
 * ProviderConfigService — CRUD for runtime-configurable AI provider settings.
 * Stores provider configs via PreferencesService (localStorage / Capacitor Preferences).
 */

import { ProviderConfig, ApiFormat } from '../../types/provider';
import { getPreferenceObject, setPreferenceObject } from './PreferencesService';

const STORAGE_KEY = 'provider_configs_v1';

// ─── Secret Encryption (Electron safeStorage bridge) ─────────────────────────
// API keys are encrypted at rest on desktop via the OS keychain. Web/Capacitor
// builds have no bridge and keep plaintext (unchanged behavior). Encrypted
// values are prefixed "enc:v1:" so we can distinguish them from legacy
// plaintext and fail open (return as-is) if the bridge is unavailable.

interface CryptoBridge {
    encryptSecret: (plaintext: string) => Promise<string | null>;
    decryptSecret: (payload: string) => Promise<string | null>;
}

function getCryptoBridge(): CryptoBridge | null {
    if (typeof window !== 'undefined') {
        const api = (window as any).electronAPI as CryptoBridge | undefined;
        if (api && typeof api.encryptSecret === 'function' && typeof api.decryptSecret === 'function') {
            return api;
        }
    }
    return null;
}

const isEncrypted = (value: string): boolean => value.startsWith('enc:v1:');

async function encryptKey(apiKey: string): Promise<string> {
    if (!apiKey || isEncrypted(apiKey)) return apiKey;
    const bridge = getCryptoBridge();
    if (!bridge) return apiKey;
    try {
        return (await bridge.encryptSecret(apiKey)) || apiKey;
    } catch (err) {
        console.warn('[ProviderConfigService] Key encryption failed, storing plaintext:', err);
        return apiKey;
    }
}

async function decryptKey(stored: string): Promise<string> {
    if (!stored || !isEncrypted(stored)) return stored;
    const bridge = getCryptoBridge();
    if (!bridge) return stored;
    try {
        return (await bridge.decryptSecret(stored)) ?? stored;
    } catch (err) {
        console.warn('[ProviderConfigService] Key decryption failed:', err);
        return stored;
    }
}

// ─── Provider Configuration Service ───────────────────────────────────────

export function getDefaultConfigs(): ProviderConfig[] {
    return [];
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Load all provider configs. Returns empty array if none configured.
 * API keys are decrypted transparently when the desktop bridge is available.
 */
export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
    const saved = await getPreferenceObject<ProviderConfig[]>(STORAGE_KEY);
    if (!saved) {
        return getDefaultConfigs();
    }
    return Promise.all(saved.map(async c => ({ ...c, apiKey: await decryptKey(c.apiKey || '') })));
}

/**
 * Persist all provider configs. API keys are encrypted at rest on desktop.
 */
export async function saveProviderConfigs(configs: ProviderConfig[]): Promise<void> {
    const encrypted = await Promise.all(configs.map(async c => ({ ...c, apiKey: await encryptKey(c.apiKey || '') })));
    await setPreferenceObject(STORAGE_KEY, encrypted);
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


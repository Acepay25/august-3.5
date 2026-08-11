/**
 * ProviderConfigService — CRUD for runtime-configurable AI provider settings.
 * Stores provider configs via PreferencesService (localStorage / Capacitor Preferences).
 */

import { ProviderConfig, ApiFormat } from '../../types/provider';
import { getPreferenceObject, setPreferenceObject } from './PreferencesService';
import { assertValidProviderUrl } from '../../utils/providerUrlValidation';

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
    const encrypted = await bridge.encryptSecret(apiKey);
    if (!encrypted) {
        // Fail open (matching decryptKey): on systems without a working OS
        // keyring (e.g. Linux without gnome-keyring/kwallet) encryptSecret
        // returns null — throwing here made EVERY provider save fail with no
        // recovery path. Store plaintext so the app stays usable.
        console.warn('[ProviderConfigService] safeStorage unavailable — storing API key as plaintext.');
        return apiKey;
    }
    return encrypted;
}

async function decryptKey(stored: string): Promise<string> {
    if (!stored || !isEncrypted(stored)) return stored;
    const bridge = getCryptoBridge();
    // Fail open: when the bridge is unavailable (web/Capacitor) or the OS
    // keychain can't decrypt (fresh OS session, changed DPAPI/keyring
    // credentials), return the stored payload as-is. Returning '' here made
    // the next save re-encrypt an empty key and permanently destroy the
    // stored secret — unrecoverable key loss.
    if (!bridge) return stored;
    const decrypted = await bridge.decryptSecret(stored);
    return decrypted || stored;
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
    if (!Array.isArray(saved)) return getDefaultConfigs();

    return Promise.all(saved.map(async (raw) => {
        const config = raw as Partial<ProviderConfig>;
        const apiFormat: ApiFormat = config.apiFormat === 'messages' || config.apiFormat === 'responses'
            ? config.apiFormat
            : 'chat_completions';
        const models = Array.isArray(config.models)
            ? config.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
            // Legacy configs predate the models array — keep the old
            // 'default' placeholder so they still work. An EMPTY array (all
            // models deleted via removeModelFromProvider) must STAY empty:
            // resurrecting 'default' sent a phantom model to the API that
            // failed on every call.
            : ['default'];
        const selectedModel = typeof config.selectedModel === 'string' && models.includes(config.selectedModel)
            ? config.selectedModel
            : models[0];
        const ensembleModels = Array.isArray(config.ensembleModels)
            ? config.ensembleModels.filter((model): model is string => typeof model === 'string' && models.includes(model)).slice(0, 3)
            : undefined;

        return {
            id: typeof config.id === 'string' ? config.id : `legacy-${Date.now()}`,
            name: typeof config.name === 'string' ? config.name : 'Unnamed provider',
            apiKey: await decryptKey(typeof config.apiKey === 'string' ? config.apiKey : ''),
            baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
            apiFormat,
            isEnabled: config.isEnabled === true,
            isBuiltIn: config.isBuiltIn === true,
            models,
            selectedModel,
            ...(ensembleModels ? { ensembleModels: ensembleModels.length > 0 ? ensembleModels : [selectedModel] } : {}),
        } satisfies ProviderConfig;
    }));
}

/**
 * Persist all provider configs. API keys are encrypted at rest on desktop.
 */
export async function saveProviderConfigs(configs: ProviderConfig[]): Promise<void> {
    const encrypted = await Promise.all(configs.map(async c => ({ ...c, apiKey: await encryptKey(c.apiKey || '') })));
    await setPreferenceObject(STORAGE_KEY, encrypted);
}

// Serialize read-modify-write cycles. Every CRUD op below reloads the full
// list, mutates, and saves; two overlapping ops (e.g. toggling Enable while a
// model add is in flight) would both read the same snapshot and the second
// save would clobber the first op's change (mirrors SqliteService's
// runExclusiveWrite pattern).
let providerWriteChain: Promise<unknown> = Promise.resolve();
function runExclusiveProviderWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = providerWriteChain.then(fn, fn);
    providerWriteChain = run.catch(() => {});
    return run;
}

/**
 * Update a single provider config by ID.
 */
export async function updateProviderConfig(
    id: string,
    updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>
): Promise<ProviderConfig[]> {
    return runExclusiveProviderWrite(async () => {
        const configs = await loadProviderConfigs();
        const updated = configs.map(c => {
            if (c.id !== id) return c;
            const next = { ...c, ...updates };
            if (updates.baseUrl !== undefined) {
                next.baseUrl = assertValidProviderUrl(updates.baseUrl);
            }
            return next;
        });
        await saveProviderConfigs(updated);
        return updated;
    });
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
    return runExclusiveProviderWrite(async () => {
        const configs = await loadProviderConfigs();
        const newConfig: ProviderConfig = {
            id: `custom-${Date.now()}`,
            name: provider.name,
            apiKey: provider.apiKey,
            baseUrl: assertValidProviderUrl(provider.baseUrl),
            apiFormat: provider.apiFormat,
            isEnabled: true,
            isBuiltIn: false,
            models: provider.models || ['default'],
            selectedModel: provider.selectedModel || provider.models?.[0] || 'default',
            ensembleModels: [provider.selectedModel || provider.models?.[0] || 'default'],
        };
        const updated = [...configs, newConfig];
        await saveProviderConfigs(updated);
        return updated;
    });
}

/**
 * Remove a provider (custom or built-in).
 */
export async function removeCustomProvider(id: string): Promise<ProviderConfig[]> {
    return runExclusiveProviderWrite(async () => {
        const configs = await loadProviderConfigs();
        const updated = configs.filter(c => c.id !== id);
        await saveProviderConfigs(updated);
        return updated;
    });
}

/**
 * Add a model ID to a provider's model list.
 */
export async function addModelToProvider(providerId: string, modelId: string): Promise<ProviderConfig[]> {
    const trimmed = modelId.trim();
    if (!trimmed) return await loadProviderConfigs();
    return runExclusiveProviderWrite(async () => {
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
    });
}

/**
 * Remove a model ID from a provider's model list.
 */
export async function removeModelFromProvider(providerId: string, modelId: string): Promise<ProviderConfig[]> {
    return runExclusiveProviderWrite(async () => {
        const configs = await loadProviderConfigs();
        const updated = configs.map(c => {
            if (c.id === providerId) {
                const models = c.models.filter(m => m !== modelId);
                const selectedModel = c.selectedModel === modelId ? (models[0] || '') : c.selectedModel;
                const ensembleModels = (c.ensembleModels || [c.selectedModel]).filter(m => m !== modelId);
                return { ...c, models, selectedModel, ensembleModels: ensembleModels.length > 0 ? ensembleModels : [selectedModel].filter(Boolean) };
            }
            return c;
        });
        await saveProviderConfigs(updated);
        return updated;
    });
}

/**
 * Update/rename a model ID in a provider's model list.
 */
export async function updateModelInProvider(providerId: string, oldModelId: string, newModelId: string): Promise<ProviderConfig[]> {
    const trimmed = newModelId.trim();
    if (!trimmed) return await loadProviderConfigs();
    return runExclusiveProviderWrite(async () => {
        const configs = await loadProviderConfigs();
        const updated = configs.map(c => {
            if (c.id === providerId) {
                const models = c.models.map(m => m === oldModelId ? trimmed : m);
                const selectedModel = c.selectedModel === oldModelId ? trimmed : c.selectedModel;
                const ensembleModels = (c.ensembleModels || [c.selectedModel]).map(m => m === oldModelId ? trimmed : m);
                return { ...c, models, selectedModel, ensembleModels: [...new Set(ensembleModels)].slice(0, 3) };
            }
            return c;
        });
        await saveProviderConfigs(updated);
        return updated;
    });
}

/**
 * Get only enabled providers that have an API key configured AND a usable
 * model — a provider whose last model was deleted (models: []) must not be
 * "ready" (its phantom 'default' model used to fail on every API call).
 */
export function getReadyProviders(configs: ProviderConfig[]): ProviderConfig[] {
    return configs.filter(c => c.isEnabled && c.apiKey.trim().length > 0 && (c.models.length > 0 || !!c.selectedModel));
}

/**
 * Discover a provider's available models through its /models endpoint.
 *
 * Endpoint + auth per API format:
 *  - OpenAI-compatible (chat_completions / responses): GET {baseUrl}/models
 *    with `Authorization: Bearer <key>` → { data: [{ id }] }
 *  - Anthropic (messages): GET {baseUrl}/models with `x-api-key` +
 *    `anthropic-version` headers → { data: [{ id }] }
 *  - Gemini (generativelanguage baseUrl): GET {baseUrl}/models?key=<key>
 *    → { models: [{ name: "models/..." }] } (the "models/" prefix is stripped)
 *
 * Returns the model ids, deduped and in the provider's order. Throws
 * user-safe errors (network / HTTP status / unparseable / empty).
 */
export async function discoverProviderModels(config: {
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiFormat;
}): Promise<string[]> {
    const base = (config.baseUrl || '').trim().replace(/\/+$/, '');
    const key = (config.apiKey || '').trim();
    if (!base) throw new Error('Base URL is required to discover models.');
    if (!key) throw new Error('API key is required to discover models.');

    const isGemini = /generativelanguage/i.test(base);
    const isAnthropic = config.apiFormat === 'messages' && !isGemini;
    const url = isGemini ? `${base}/models?key=${encodeURIComponent(key)}` : `${base}/models`;

    const headers: Record<string, string> = {};
    if (isAnthropic) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    } else if (!isGemini) {
        headers['Authorization'] = `Bearer ${key}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
        res = await fetch(url, { headers, signal: controller.signal });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
            throw new Error('Model discovery timed out — check the base URL.');
        }
        throw new Error('Could not reach the provider — check the base URL and your network.');
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        let detail = '';
        try {
            const body = await res.json();
            detail = body?.error?.message ?? body?.message ?? '';
        } catch { /* unreadable body — fall through to the status message */ }
        throw new Error(
            detail
                ? `Discovery failed (HTTP ${res.status}): ${detail}`
                : `Discovery failed (HTTP ${res.status}) — check the API key and base URL.`
        );
    }

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new Error('The provider returned an unreadable response.');
    }

    const ids: string[] = [];
    const data = (body as { data?: unknown[] })?.data;
    if (Array.isArray(data)) {
        for (const m of data) {
            if (m && typeof (m as { id?: unknown }).id === 'string' && (m as { id: string }).id.trim()) {
                ids.push((m as { id: string }).id.trim());
            }
        }
    } else {
        const models = (body as { models?: unknown[] })?.models;
        if (Array.isArray(models)) {
            for (const m of models) {
                const name = (m as { name?: unknown })?.name;
                if (typeof name === 'string' && name.trim()) {
                    ids.push(name.trim().replace(/^models\//, ''));
                }
            }
        }
    }

    if (ids.length === 0) {
        throw new Error('The provider returned no models — its /models endpoint may be unsupported.');
    }
    return [...new Set(ids)];
}

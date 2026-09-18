/**
 * ProviderConfigService — CRUD for runtime-configurable AI provider settings.
 * Stores provider configs via PreferencesService (localStorage / Capacitor Preferences).
 */

import { ProviderConfig, ApiFormat, parseApiFormat } from '../../types/provider';
import { getPreferenceObject, setPreferenceObject } from './PreferencesService';
import { assertValidProviderUrl } from '../../utils/providerUrlValidation';
import { usesGoogleGeminiDiscovery, googleModelsUrl } from '../../utils/googleGeminiFormat';
import { isLocalBaseUrl } from '../../shared/providerRequestPolicy.cjs';

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
    if (typeof window === 'undefined') return null;
    const api = window.electronAPI;
    // The global electronAPI type carries the optional crypto members; narrow
    // across the presence check and hand back a required-members view so the
    // rest of this file never re-casts.
    if (api && typeof api.encryptSecret === 'function' && typeof api.decryptSecret === 'function') {
        return { encryptSecret: api.encryptSecret, decryptSecret: api.decryptSecret };
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
    // Bridge unavailable (web/Capacitor — documented plaintext storage): return
    // the stored payload as-is, unchanged behavior for those platforms.
    if (!bridge) return stored;
    // The bridge EXISTS but the DECRYPT failed (OS keychain rotated, fresh
    // session, DPAPI/keyring credentials changed). Returning the raw
    // `enc:v1:…` blob as the apiKey was fail-OPEN in the wrong direction: the
    // ciphertext satisfies the non-empty readiness check (`apiKey.trim().length
    // > 0`) and got sent verbatim as the Bearer token to the provider. Mark
    // the provider NOT-READY instead — an empty key keeps it present in the
    // list, fails readiness, and the UI prompts the user to re-enter the key.
    try {
        const decrypted = await bridge.decryptSecret(stored);
        if (decrypted) return decrypted;
        console.warn('[ProviderConfigService] Failed to decrypt stored API key (OS keychain unavailable or rotated). Provider marked not ready — re-enter the key in Settings → Providers.');
        return '';
    } catch (error) {
        console.warn('[ProviderConfigService] API key decryption threw; provider marked not ready — re-enter the key in Settings → Providers.', error);
        return '';
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
    if (!Array.isArray(saved)) return getDefaultConfigs();

    return Promise.all(saved.map(async (raw) => {
        const config = raw as Partial<ProviderConfig>;
        const apiFormat: ApiFormat = parseApiFormat(config.apiFormat);
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
        // No phantom 'default' model seed (audit 2026-09-15): readiness is
        // `models.length > 0 || selectedModel`, so seeding ['default'] minted
        // a provider that looked READY with a fake model that 400s on every
        // call — and the picker rendered the phantom. A provider added
        // without models stays NOT ready until the user refreshes/picks real
        // models from the endpoint.
        const firstModel = provider.selectedModel || provider.models?.[0] || '';
        const newConfig: ProviderConfig = {
            id: `custom-${Date.now()}`,
            name: provider.name,
            apiKey: provider.apiKey,
            baseUrl: assertValidProviderUrl(provider.baseUrl),
            apiFormat: provider.apiFormat,
            isEnabled: true,
            isBuiltIn: false,
            models: provider.models ?? [],
            selectedModel: firstModel,
            ensembleModels: firstModel ? [firstModel] : [],
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
 * Get only enabled providers that have a usable model AND either an API key
 * or a local base URL — Ollama / LM Studio style servers are keyless, so an
 * empty key must not make them "not ready" (users were inventing dummy keys
 * to get past the old hard requirement). A provider whose last model was
 * deleted (models: [] and no selectedModel) must not be "ready" either (its
 * phantom 'default' model used to fail on every API call). Mirrors
 * providerUtils.isProviderReady exactly.
 */
export function getReadyProviders(configs: ProviderConfig[]): ProviderConfig[] {
    return configs.filter(c => c.isEnabled
        && (c.apiKey.trim().length > 0 || isLocalBaseUrl(c.baseUrl))
        && (c.models.length > 0 || !!c.selectedModel));
}

/**
 * Discover a provider's available models through its /models endpoint.
 *
 * Endpoint + auth per API format:
 *  - OpenAI-compatible (chat_completions / responses): GET {baseUrl}/models
 *    with `Authorization: Bearer <key>` → { data: [{ id }] }
 *  - Anthropic (messages): GET {baseUrl}/models with `x-api-key` +
 *    `anthropic-version` headers → { data: [{ id }] }
 *  - Gemini / Google format: GET {baseUrl}/models?key=<key>
 *    → { models: [{ name: "models/..." }] } (the "models/" prefix is stripped)
 *
 * Returns the model ids, deduped and in the provider's order. Throws
 * user-safe errors (network / HTTP status / unparseable / empty).
 */
function parseDiscoverErrorBody(raw: string): string {
    try {
        const parsed = raw ? JSON.parse(raw) as { error?: { message?: string }; message?: string } : {};
        return (parsed?.error?.message || parsed?.message || '').trim();
    } catch {
        return '';
    }
}

function extractModelId(item: unknown): string | null {
    if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? trimmed.replace(/^models\//, '') : null;
    }
    if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const candidate = obj.id ?? obj.name ?? obj.model ?? obj.model_name ?? obj.value;
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            return trimmed ? trimmed.replace(/^models\//, '') : null;
        }
    }
    return null;
}

export function parseDiscoveredModelIds(body: unknown): string[] {
    const ids: string[] = [];

    // 1. Direct top-level array: ["model1", "model2"] or [{ id: "model1" }, ...]
    if (Array.isArray(body)) {
        for (const item of body) {
            const id = extractModelId(item);
            if (id) ids.push(id);
        }
        return [...new Set(ids)];
    }

    if (body && typeof body === 'object') {
        const dict = body as Record<string, unknown>;

        // 2. Standard wrapper properties: data (OpenAI/Anthropic), models (Gemini/Ollama), result, model_list, items, list
        const candidateArrays = [
            dict.data,
            dict.models,
            dict.result,
            dict.model_list,
            dict.items,
            dict.list,
        ];

        for (const arr of candidateArrays) {
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    const id = extractModelId(item);
                    if (id) ids.push(id);
                }
                if (ids.length > 0) {
                    return [...new Set(ids)];
                }
            }
        }
    }

    return [...new Set(ids)];
}

export function normalizeBaseUrlForModels(rawUrl: string): string {
    const base = assertValidProviderUrl(rawUrl);
    let parsed: URL;
    try {
        parsed = new URL(base);
    } catch {
        return base.replace(/\/+$/, '');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    for (const suffix of ['/chat/completions', '/messages', '/responses', '/models', '/chat', '/completions']) {
        if (parsed.pathname.endsWith(suffix)) {
            parsed.pathname = parsed.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
            break;
        }
    }
    return parsed.toString().replace(/\/$/, '');
}

function throwDiscoverHttpError(status: number, rawBody: string): never {
    const detail = parseDiscoverErrorBody(rawBody);
    throw new Error(
        detail
            ? `Discovery failed (HTTP ${status}): ${detail}`
            : `Discovery failed (HTTP ${status}) — check the API key and base URL.`
    );
}

export function getDiscoveryCandidateUrls(baseUrl: string, isGemini: boolean, apiKey: string): string[] {
    if (isGemini) {
        return [googleModelsUrl(baseUrl, apiKey)];
    }
    const urls: string[] = [];
    urls.push(`${baseUrl}/models`);
    if (baseUrl.endsWith('/v1')) {
        const withoutV1 = baseUrl.slice(0, -3);
        if (withoutV1) urls.push(`${withoutV1}/models`);
    } else {
        urls.push(`${baseUrl}/v1/models`);
    }
    if (isLocalBaseUrl(baseUrl)) {
        const root = baseUrl.replace(/\/v1$/, '');
        urls.push(`${root}/api/tags`);
    }
    return [...new Set(urls)];
}

/**
 * Fetch GET {baseUrl}/models without CORS. Chat already goes through Electron
 * IPC / the Vite dev proxy; discovery used to call the provider from the
 * renderer and failed with a generic "could not reach" on every provider
 * that doesn't send Access-Control-Allow-Origin.
 */
async function fetchDiscoverPayload(config: {
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiFormat;
}): Promise<{ status: number; body: string }> {
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (electronAPI?.isElectron && electronAPI.discoverModels) {
        const result = await electronAPI.discoverModels(config);
        if (typeof result?.body === 'string') {
            return { status: result.status ?? (result.ok ? 200 : 0), body: result.body };
        }
        throw new Error(result?.message || 'Could not reach the provider — check the base URL and your network.');
    }

    const useDevProxy = Boolean(import.meta.env.DEV)
        && !import.meta.env.VITEST
        && typeof window !== 'undefined'
        && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (useDevProxy) {
        const response = await fetch('/__provider_proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discover: true, config }),
        });
        const result = await response.json() as { ok?: boolean; status?: number; body?: string; message?: string };
        if (typeof result.body === 'string') {
            return { status: result.status ?? response.status, body: result.body };
        }
        throw new Error(result.message || 'Could not reach the provider — check the base URL and your network.');
    }

    const base = normalizeBaseUrlForModels(config.baseUrl);
    const key = (config.apiKey || '').trim();
    const isGemini = usesGoogleGeminiDiscovery(base, config.apiFormat);
    const isAnthropic = config.apiFormat === 'messages' && !isGemini;
    const headers: Record<string, string> = {
        Accept: 'application/json',
    };
    if (isAnthropic) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    } else if (!isGemini && key && key !== 'not-needed') {
        headers.Authorization = `Bearer ${key}`;
    }

    const candidateUrls = getDiscoveryCandidateUrls(base, isGemini, key);
    let lastResult = { status: 0, body: '' };
    let timedOut = false;

    for (const candidateUrl of candidateUrls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(candidateUrl, { headers, signal: controller.signal });
            const body = await res.text();
            lastResult = { status: res.status, body };
            // Success or explicit auth/validation error: stop and return.
            // Only retry candidate URLs if the endpoint was Not Found (404).
            if ((res.status >= 200 && res.status < 300) || res.status !== 404) {
                return lastResult;
            }
        } catch (e) {
            // A timeout on ONE endpoint must not cancel the fallback chain —
            // reaching the next candidate is the entire reason it exists. One
            // hanging /v1/models used to abort the whole sweep, so a provider
            // that answered fine on /v1/… was never given the chance.
            if ((e as Error)?.name === 'AbortError') timedOut = true;
            lastResult = { status: 0, body: (e as Error)?.message || '' };
        } finally {
            clearTimeout(timer);
        }
    }

    if (timedOut) {
        throw new Error('Model discovery timed out — check the base URL.');
    }
    if (lastResult.status === 0 && !lastResult.body) {
        throw new Error('Could not reach the provider — check the base URL and your network.');
    }
    return lastResult;
}

export async function discoverProviderModels(config: {
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiFormat;
}): Promise<string[]> {
    const key = (config.apiKey || '').trim();
    if (!(config.baseUrl || '').trim()) throw new Error('Base URL is required to discover models.');
    // Keyless LOCAL providers (Ollama / LM Studio) answer /models with no
    // auth — demanding a key here made the one endpoint that could tell the
    // user "no key needed" reject them before the request. Remote providers
    // still require a key.
    if (!key && !isLocalBaseUrl(config.baseUrl)) throw new Error('API key is required to discover models.');
    assertValidProviderUrl(config.baseUrl);

    const { status, body } = await fetchDiscoverPayload(config);
    if (status < 200 || status >= 300) throwDiscoverHttpError(status, body);

    let parsed: unknown;
    try {
        parsed = body ? JSON.parse(body) : {};
    } catch {
        throw new Error('The provider returned an unreadable response.');
    }

    const ids = parseDiscoveredModelIds(parsed);
    if (ids.length === 0) {
        throw new Error('The provider returned no models — its /models endpoint may be unsupported.');
    }
    return ids;
}

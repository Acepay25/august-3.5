/**
 * Restoring a backup must not leave an API key in PLAINTEXT at rest.
 *
 * `importPreferencesData` merged the backup's provider list and wrote it with
 * a raw `setPreferenceObject`. Every other write of that key goes through
 * `ProviderConfigService.saveProviderConfigs`, which encrypts each key with
 * the Electron safeStorage bridge (OS keychain) under the `enc:v1:` prefix —
 * so a restored key stayed plaintext in Preferences on desktop until some
 * unrelated CRUD save (add a model, toggle Enable) happened to re-encrypt it.
 * The restore is the one moment a key definitely arrives, so it is the worst
 * moment to skip encryption.
 *
 * The key-graft hardening (tests/exportService.test.ts) must keep holding:
 * the live key is read RAW, so a grafted value is already ciphertext, and an
 * already-prefixed value must pass through byte-identical — encrypting a
 * ciphertext again would make it undecryptable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(), canShare: vi.fn(async () => ({ value: false })) } }));
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: { writeFile: vi.fn() },
    Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/preferences', () => ({
    Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn() },
}));

let prefStore: Record<string, unknown> = {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

vi.mock('../services/infrastructure/PreferencesService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    return {
        ...actual,
        getPreferenceObject: vi.fn(async (key: string) => (key in prefStore ? clone(prefStore[key]) : null)),
        getPreferenceArray: vi.fn(async () => []),
        setPreferenceObject: vi.fn(async (key: string, value: unknown) => { prefStore[key] = clone(value); }),
        getAllKeys: vi.fn(async () => Object.keys(prefStore)),
    };
});

import { importPreferencesData } from '../services/infrastructure/ExportService';
import { PREF_KEYS } from '../services/infrastructure/PreferencesService';
import type { ProviderConfig } from '../types/provider';

const encryptSecret = vi.fn(async (plain: string) => `enc:v1:${plain}`);

const setBridge = () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
        encryptSecret,
        decryptSecret: vi.fn(async (payload: string) => (payload.startsWith('enc:v1:') ? payload.slice(6) : null)),
    };
};

const stored = (): ProviderConfig[] => prefStore[PREF_KEYS.PROVIDER_CONFIGS] as ProviderConfig[];

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'prov-a',
    name: 'Provider A',
    apiKey: '',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['model-1'],
    selectedModel: 'model-1',
    ...overrides,
});

beforeEach(() => {
    prefStore = {};
    encryptSecret.mockClear();
    setBridge();
});

afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('importPreferencesData — provider keys stay encrypted at rest', () => {
    it('encrypts a backup-carried key on a fresh machine', async () => {
        await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [config({ apiKey: 'sk-plaintext-from-backup' })],
        });
        expect(encryptSecret).toHaveBeenCalledWith('sk-plaintext-from-backup');
        expect(stored()[0].apiKey).toBe('enc:v1:sk-plaintext-from-backup');
    });

    it('re-uses the live key\'s EXISTING ciphertext when grafting (never double-encrypts)', async () => {
        // The live key is read raw, so the grafted value is already `enc:v1:`.
        // Encrypting it again would nest the prefix and make it undecryptable.
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [config({ apiKey: 'enc:v1:sk-live' })];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [config({ apiKey: '', baseUrl: 'https://api.example.com/v1/' })],
        });
        expect(report.providersKeyGrafted).toBe(1);
        expect(encryptSecret).not.toHaveBeenCalled();
        expect(stored()[0].apiKey).toBe('enc:v1:sk-live');
    });

    it('keeps a cleared (present-but-not-ready) entry empty rather than restoring a key', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [config({ apiKey: 'enc:v1:sk-live' })];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [config({ apiKey: 'attacker-key', baseUrl: 'https://evil.tld' })],
        });
        expect(report.providersRequiringKeyReentry).toBe(1);
        expect(stored()[0].apiKey).toBe('');
        expect(stored()[0].baseUrl).toBe('https://evil.tld');
    });
});

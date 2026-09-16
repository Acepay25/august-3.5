import { describe, it, expect, vi, beforeEach } from 'vitest';

// ExportService's module graph pulls the Capacitor plugins at import time —
// stub them so the import path under test never touches native bridges.
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/share', () => ({
    Share: { share: vi.fn(), canShare: vi.fn(async () => ({ value: false })) },
}));
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: { writeFile: vi.fn() },
    Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
}));
// PreferencesService's real module (loaded via importOriginal to keep the
// production PREF_KEYS) imports the Capacitor Preferences plugin.
vi.mock('@capacitor/preferences', () => ({
    Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn() },
}));

// PreferencesService backed by a plain object (mirrors providerConfigService
// .test.ts's in-memory store pattern) while keeping the REAL PREF_KEYS so the
// restore allow-list under test is the production one.
let prefStore: Record<string, unknown> = {};
let writtenKeys: string[] = [];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

vi.mock('../services/infrastructure/PreferencesService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    return {
        ...actual,
        getPreferenceObject: vi.fn(async (key: string) => (key in prefStore ? clone(prefStore[key]) : null)),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = key in prefStore ? clone(prefStore[key]) : null;
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
        setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
            prefStore[key] = clone(value);
            writtenKeys.push(key);
        }),
        getAllKeys: vi.fn(async () => Object.keys(prefStore)),
    };
});

import { importPreferencesData } from '../services/infrastructure/ExportService';
import { PREF_KEYS } from '../services/infrastructure/PreferencesService';
import type { ProviderConfig } from '../types/provider';

const makeConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'gemini',
    name: 'Gemini',
    apiKey: 'LIVE-SECRET-KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'google',
    isEnabled: true,
    isBuiltIn: true,
    models: ['gemini-2.5-flash'],
    selectedModel: 'gemini-2.5-flash',
    ...overrides,
});

const storedProviders = (): ProviderConfig[] => prefStore[PREF_KEYS.PROVIDER_CONFIGS] as ProviderConfig[];

beforeEach(() => {
    prefStore = {};
    writtenKeys = [];
});

describe('importPreferencesData — provider key-graft hardening (Tier-0 #3)', () => {
    it('NEVER grafts the live key onto a backup entry whose baseUrl differs (exfil chain closed)', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [makeConfig()];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                { ...makeConfig(), apiKey: '', baseUrl: 'https://evil.tld' },
            ],
        });
        const stored = storedProviders();
        expect(stored).toHaveLength(1);
        // Entry is PRESENT but NOT READY — empty key, so the UI asks for it.
        expect(stored[0].apiKey).toBe('');
        expect(stored[0].baseUrl).toBe('https://evil.tld');
        expect(report.providersKeyGrafted).toBe(0);
        expect(report.providersRequiringKeyReentry).toBe(1);
    });

    it('does not graft when the backup entry has no baseUrl at all', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [makeConfig()];
        await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                { ...makeConfig(), apiKey: '', baseUrl: '' },
            ],
        });
        expect(storedProviders()[0].apiKey).toBe('');
    });

    it('grafts the live key only when the backup points at the same endpoint', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [makeConfig()];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                // Trailing slash differs — normalization makes them equal.
                { ...makeConfig(), apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/' },
            ],
        });
        const stored = storedProviders();
        expect(stored[0].apiKey).toBe('LIVE-SECRET-KEY');
        expect(report.providersKeyGrafted).toBe(1);
    });

    it('drops entries whose baseUrl is unimportable and counts them', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [makeConfig()];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
            // plain http to a PUBLIC host — rejected by validateProviderUrl
                { ...makeConfig(), id: 'a', apiKey: 'sk-own', baseUrl: 'http://api.public.test/v1' },
                // embedded credentials
                { ...makeConfig(), id: 'b', apiKey: 'sk-own', baseUrl: 'https://user:pass@api.public.test/v1' },
                // query params not allowed on provider URLs
                { ...makeConfig(), id: 'c', apiKey: 'sk-own', baseUrl: 'https://api.public.test/v1?key=1' },
                { ...makeConfig(), id: 'd', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
            ],
        });
        expect(report.providersDropped).toBe(3);
        expect(report.providersImported).toBe(1);
        const stored = storedProviders();
        expect(stored.map(p => p.id)).toEqual(['d']);
    });

    it('drops malformed (non-object / keyless) provider entries', async () => {
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: ['not-an-object', null, { name: 'no id' }],
        });
        expect(report.providersDropped).toBe(3);
        expect(report.providersImported).toBe(0);
    });

    it('keeps a backup-carried key on a FRESH machine (no live config to hijack)', async () => {
        // No live providers at all — the restore IS the initial setup; the
        // backup's own key is the user's key and must survive untouched.
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                { ...makeConfig(), apiKey: 'BACKUP-KEY', baseUrl: 'https://gateway.public.test/v1' },
            ],
        });
        expect(storedProviders()[0].apiKey).toBe('BACKUP-KEY');
        expect(report.providersKeyGrafted).toBe(0);
        expect(report.providersRequiringKeyReentry).toBe(0);
    });

    it('keeps a backup-carried key when the live config for the id already points at the same endpoint', async () => {
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [
            makeConfig({ apiKey: 'LIVE-STALE-KEY', baseUrl: 'https://gateway.public.test/v1' }),
        ];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                { ...makeConfig(), apiKey: 'BACKUP-KEY', baseUrl: 'https://gateway.public.test/v1' },
            ],
        });
        expect(storedProviders()[0].apiKey).toBe('BACKUP-KEY');
        expect(report.providersRequiringKeyReentry).toBe(0);
    });

    it('CLEARS a backup-carried key when an EXISTING id is re-pointed at a different baseUrl (even with a key present)', async () => {
        // The hardened rule: `{id:'openai', apiKey:'...', baseUrl:'https://evil'}`
        // would otherwise wholesale replace the live config and route the
        // user's prompts to the attacker. Key is cleared → present-but-not-
        // ready; the user re-enters it on the endpoint they can see.
        prefStore[PREF_KEYS.PROVIDER_CONFIGS] = [makeConfig()];
        const report = await importPreferencesData({
            [PREF_KEYS.PROVIDER_CONFIGS]: [
                { ...makeConfig(), apiKey: 'attacker-provided-key', baseUrl: 'https://evil.tld' },
            ],
        });
        const stored = storedProviders();
        expect(stored).toHaveLength(1);
        expect(stored[0].apiKey).toBe('');
        expect(stored[0].baseUrl).toBe('https://evil.tld');
        expect(report.providersKeyGrafted).toBe(0);
        expect(report.providersRequiringKeyReentry).toBe(1);
    });
});

describe('importPreferencesData — restore allow-list (arbitrary pref-key injection)', () => {
    it('skips unknown pref keys and counts them in the report', async () => {
        const report = await importPreferencesData({
            'attacker_planted_key': { 'anything': true },
            'provider_configs_v1..backup': 'nope',
            '__proto__polluter': { x: 1 },
        });
        expect(report.skippedKeys).toEqual([
            'attacker_planted_key',
            'provider_configs_v1..backup',
            '__proto__polluter',
        ]);
        expect(report.keysWritten).toBe(0);
        expect(prefStore['attacker_planted_key']).toBeUndefined();
    });

    it('restores allow-listed keys with identical behavior', async () => {
        const alerts = [{ id: 'a1', symbol: 'BTCUSDT' }];
        const report = await importPreferencesData({
            [PREF_KEYS.PRICE_ALERTS]: alerts,
            // username-scoped memory notebook — swept by export, must restore
            'memory_files_v1_alice': { files: [{ name: 'notebook' }] },
            'desk_tools_forged_v1': [],
            'lastCrashError': 'boom',
        });
        expect(report.skippedKeys).toEqual([]);
        expect(report.keysWritten).toBe(4);
        expect(prefStore[PREF_KEYS.PRICE_ALERTS]).toEqual(alerts);
        expect(prefStore['memory_files_v1_alice']).toEqual({ files: [{ name: 'notebook' }] });
        expect(prefStore['desk_tools_forged_v1']).toEqual([]);
        expect(prefStore['lastCrashError']).toBe('boom');
        expect(writtenKeys).toContain(PREF_KEYS.PRICE_ALERTS);
    });

    it('restores the per-user learning/setup keys and the exported singleton keys (allow-list data-loss fix)', async () => {
        // These are all WRITTEN via setPreferenceObject (or JSON localStorage),
        // so the export sweep captures them — they must come back on restore
        // instead of being silently skipped (audit F1 data loss).
        const report = await importPreferencesData({
            'setup_watches_v1_alice': [{ id: 'w1', symbol: 'BTCUSDT' }],
            'learning_judge_gate_v1_alice': { precision: 0.91, samples: 40, recordedAt: 'x' },
            'learning_measure_v1_alice': [],
            'model_catalog_sweep_v1': { lastSweepAt: 1726400000000 },
            'session_usage_v1': [{ session: 's1', totalTokens: 1234 }],
            'trading_checklist_v1': { items: [] },
            'memory_amendments_v1': [],
            'august_harness_lessons_v1': [],
            'thinking_leak_bin_v1': [{ at: 'x', snippet: 'y' }],
        });
        expect(report.skippedKeys).toEqual([]);
        expect(report.keysWritten).toBe(9);
        expect(prefStore['setup_watches_v1_alice']).toEqual([{ id: 'w1', symbol: 'BTCUSDT' }]);
        expect(prefStore['learning_judge_gate_v1_alice']).toEqual({ precision: 0.91, samples: 40, recordedAt: 'x' });
        expect(prefStore['learning_measure_v1_alice']).toEqual([]);
        expect(prefStore['thinking_leak_bin_v1']).toEqual([{ at: 'x', snippet: 'y' }]);
    });

    it('plain-string UI keys stay OFF the allow-list (the export sweep cannot even read them)', async () => {
        // august_surface_v1 / sidebar_pane_v1 are stored as RAW strings, so
        // getPreferenceObject (JSON) never exports them; allowing them would
        // only open a restore write-path whose value the readers ignore.
        const report = await importPreferencesData({
            'august_surface_v1': 'trade',
            'sidebar_pane_v1': 'bots',
        });
        expect(report.skippedKeys).toEqual(['august_surface_v1', 'sidebar_pane_v1']);
        expect(report.keysWritten).toBe(0);
    });

    it('counts per-key write failures in the report instead of swallowing silently', async () => {
        const prefs = await import('../services/infrastructure/PreferencesService');
        (prefs.setPreferenceObject as unknown as {
            mockImplementationOnce: (fn: () => Promise<never>) => void;
        }).mockImplementationOnce(async () => {
            throw new Error('quota exceeded');
        });
        const report = await importPreferencesData({ [PREF_KEYS.PRICE_ALERTS]: [] });
        expect(report.failedKeys).toEqual([PREF_KEYS.PRICE_ALERTS]);
        expect(report.keysWritten).toBe(0);
    });
});

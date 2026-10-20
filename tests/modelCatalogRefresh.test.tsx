import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { renderHook, act, waitFor as waitForHook } from '@testing-library/react';
import { useModelCatalogRefresh } from '../hooks/useModelCatalogRefresh';
import { ProviderConfig } from '../types/provider';

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    // The sweep reads the CATALOG face (ids + the context window each model
    // reported); `discoverProviderModels` stays the ids-only face other callers
    // use, and it is kept in the mock so an accidental call is a visible
    // undefined-function failure rather than a silent miss.
    discoverProviderModelCatalog: vi.fn(),
    discoverProviderModels: vi.fn(),
}));
// Preferences: in-memory so the sweep bookkeeping works in jsdom.
vi.mock('../services/infrastructure/PreferencesService', async importOriginal => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    const store = new Map<string, string>();
    return {
        ...actual,
        getPreferenceObject: vi.fn(async <T,>(key: string): Promise<T | null> => {
            const raw = store.get(key);
            return raw ? (JSON.parse(raw) as T) : null;
        }),
        setPreferenceObject: vi.fn(async <T,>(key: string, value: T): Promise<void> => {
            store.set(key, JSON.stringify(value));
        }),
    };
});

import { discoverProviderModelCatalog } from '../services/infrastructure/ProviderConfigService';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const provider = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'Test Provider',
    apiFormat: over.apiFormat ?? 'chat_completions',
    baseUrl: over.baseUrl ?? 'https://example.test/v1',
    apiKey: over.apiKey ?? 'sk-test',
    isEnabled: over.isEnabled ?? true,
    models: over.models ?? ['model-a'],
    selectedModel: over.selectedModel ?? 'model-a',
    ...over,
} as ProviderConfig);

const discover = discoverProviderModelCatalog as unknown as ReturnType<typeof vi.fn>;

/** The shape the sweep now consumes: ids plus whatever windows were reported. */
const catalog = (ids: string[], windows: Record<string, number> = {}) => ({ ids, windows });

describe('useModelCatalogRefresh (background model refresh)', () => {
    it('merges freshly discovered models into the provider config', async () => {
        discover.mockResolvedValue(catalog(['model-a', 'model-b', 'model-c']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({})];

        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        // Drive the sweep directly (the boot sweep waits 4s).
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        await waitForHook(() => {
            expect(onUpdateProvider).toHaveBeenCalled();
        });
        expect(onUpdateProvider).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ models: expect.arrayContaining(['model-b', 'model-c']) }),
        );
    });

    it('prunes obsolete models omitted by the provider and updates selectedModel if removed', async () => {
        discover.mockResolvedValue(catalog(['new-model', 'still-supported']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [
            provider({
                id: 'p1',
                models: ['deprecated-model', 'still-supported'],
                selectedModel: 'deprecated-model',
            }),
        ];

        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        await waitForHook(() => {
            expect(onUpdateProvider).toHaveBeenCalled();
        });
        expect(onUpdateProvider).toHaveBeenCalledWith(
            'p1',
            {
                models: ['new-model', 'still-supported'],
                selectedModel: 'new-model',
            },
        );
    });

    it('does not call update when the catalog is unchanged', async () => {
        discover.mockResolvedValue(catalog(['model-a']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({})];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        expect(onUpdateProvider).not.toHaveBeenCalled();
    });

    it('skips disabled providers and swallows discovery failures silently', async () => {
        discover.mockRejectedValue(new Error('offline'));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [
            provider({ id: 'off', isEnabled: false }),
            provider({ id: 'p1' }),
        ];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        // Disabled provider never queried…
        expect(discover.mock.calls.filter(c => (c[0] as { apiKey: string }).apiKey === 'sk-test')).toHaveLength(1);
        // …and the failure stays silent (no update, no throw).
        expect(onUpdateProvider).not.toHaveBeenCalled();
    });

    it('a total-failure sweep marks lastSweepFailed so the next window retries in 15min', async () => {
        discover.mockRejectedValue(new Error('offline'));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({})];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        // The persisted sweep state carries the total-failure flag.
        const { getPreferenceObject, setPreferenceObject } = await import('../services/infrastructure/PreferencesService');
        const state = await getPreferenceObject<{ lastSweepAt: number; lastSweepFailed?: boolean }>('model_catalog_sweep_v1');
        expect(state?.lastSweepFailed).toBe(true);

        // The flag shortens the eligibility gap: a failed sweep ~15min ago
        // is eligible again, while a SUCCESSFUL sweep at that age is not.
        await setPreferenceObject('model_catalog_sweep_v1', {
            lastSweepAt: Date.now() - 15 * 60_000 - 1_000,
            lastSweepFailed: true,
        });
        discover.mockResolvedValue(catalog(['model-a', 'model-b']));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        expect(onUpdateProvider).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ models: expect.arrayContaining(['model-b']) }),
        );
    });

    it('a partial failure does NOT set the flag (6h gap stands)', async () => {
        discover
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(catalog(['model-a', 'model-b']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({ id: 'p1' }), provider({ id: 'p2' })];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => {
            await utils.result.current.refreshNow();
        });
        const { getPreferenceObject } = await import('../services/infrastructure/PreferencesService');
        const state = await getPreferenceObject<{ lastSweepFailed?: boolean }>('model_catalog_sweep_v1');
        expect(state?.lastSweepFailed).toBe(false);
        expect(onUpdateProvider).toHaveBeenCalledWith('p2', expect.objectContaining({ models: expect.arrayContaining(['model-b']) }));
    });
    it('persists a context window the provider reported for a model', async () => {
        // This is the whole reason the sweep fetches the catalog rather than
        // only the ids: `/models` is the one place the app can learn a model's
        // real window without the trader typing it, and that number is what
        // automatic compaction holds the outbound history to.
        discover.mockResolvedValue({
            ids: ['model-a'],
            windows: { 'model-a': 131_072 },
        });
        const onUpdateProvider = vi.fn(async () => {});
        const utils = renderHook(() => useModelCatalogRefresh([provider({ models: ['model-a'] })], onUpdateProvider));
        await act(async () => { await utils.result.current.refreshNow(); });
        expect(onUpdateProvider).toHaveBeenCalledWith('p1', expect.objectContaining({
            modelContextWindows: { 'model-a': 131_072 },
        }));
    });

    it('keeps a previously learned window when a sweep stops reporting one', async () => {
        // A gateway that drops the field must not return a 128K model to the
        // assumed 1M default — that is the one shape that makes the app
        // overflow instead of compact.
        discover.mockResolvedValue({ ids: ['model-a'], windows: {} });
        const onUpdateProvider = vi.fn(async () => {});
        const utils = renderHook(() => useModelCatalogRefresh(
            [provider({ models: ['model-a'], modelContextWindows: { 'model-a': 131_072 } })],
            onUpdateProvider,
        ));
        await act(async () => { await utils.result.current.refreshNow(); });
        // Ids unchanged, windows unchanged → nothing to write.
        expect(onUpdateProvider).not.toHaveBeenCalled();
    });

    it('prunes a deprecated id on a remote catalog provider', async () => {
        discover.mockResolvedValue(catalog(['model-b']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({ models: ['model-a', 'model-b'], selectedModel: 'model-a' })];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => { await utils.result.current.refreshNow(); });
        // OpenAI deprecates a model id, the endpoint stops listing it, and the
        // sweep drops it — the deliberate authoritative behavior.
        // The vanished selection moves rather than pointing at nothing.
        expect(onUpdateProvider).toHaveBeenCalledWith('p1', { models: ['model-b'], selectedModel: 'model-b' });
    });

    it('does NOT prune a hand-added model a local server merely has unloaded', async () => {
        // Ollama's /api/tags lists only what is currently pulled. Treating that
        // as the whole catalog deleted a configured model for anyone who had
        // simply stopped their server.
        // One model pulled, one newly pulled, and the unloaded qwen row the
        // endpoint does not list — the write has to add without pruning.
        discover.mockResolvedValue(catalog(['llama3.2:3b', 'mistral:7b']));
        const onUpdateProvider = vi.fn(async () => {});
        const configs = [provider({
            baseUrl: 'http://127.0.0.1:11434', apiKey: '',
            models: ['llama3.2:3b', 'qwen2.5:7b'], selectedModel: 'qwen2.5:7b',
        })];
        const utils = renderHook(() => useModelCatalogRefresh(configs, onUpdateProvider));
        await act(async () => { await utils.result.current.refreshNow(); });
        // The selection still resolves, so only the model list is rewritten.
        expect(onUpdateProvider).toHaveBeenCalledWith('p1', expect.objectContaining({
            models: expect.arrayContaining(['llama3.2:3b', 'qwen2.5:7b', 'mistral:7b']),
        }));
        expect(onUpdateProvider).toHaveBeenCalledWith('p1', expect.not.objectContaining({ selectedModel: expect.anything() }));
    });
});

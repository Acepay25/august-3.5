import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { renderHook, act, waitFor as waitForHook } from '@testing-library/react';
import { useModelCatalogRefresh } from '../hooks/useModelCatalogRefresh';
import { ProviderConfig } from '../types/provider';

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
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

import { discoverProviderModels } from '../services/infrastructure/ProviderConfigService';

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

const discover = discoverProviderModels as unknown as ReturnType<typeof vi.fn>;

describe('useModelCatalogRefresh (background model refresh)', () => {
    it('merges freshly discovered models into the provider config', async () => {
        discover.mockResolvedValue(['model-a', 'model-b', 'model-c']);
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

    it('does not call update when the catalog is unchanged', async () => {
        discover.mockResolvedValue(['model-a']);
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
        discover.mockResolvedValue(['model-a', 'model-b']);
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
            .mockResolvedValueOnce(['model-a', 'model-b']);
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
});

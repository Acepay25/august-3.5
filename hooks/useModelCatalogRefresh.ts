/**
 * useModelCatalogRefresh — keeps every provider's model list fresh so all
 * model dropdowns (composer selector, bot dialog, team seats, automations)
 * show the provider's CURRENT catalog without anyone visiting Settings.
 *
 * Design: a quiet background sweep keyed on a persisted last-checked
 * timestamp. On app boot (and every 6h while the app stays open) each
 * ready provider's /models endpoint is queried; discovered ids are merged
 * (never removed — manual additions and orderings survive) straight into
 * the provider config through the same onUpdateProvider path Settings
 * uses, so React state, Preferences, and every dropdown re-derive from
 * one source of truth. Failures are silent (offline / no /models
 * endpoint) — the existing list stays authoritative until a sweep
 * succeeds.
 */

import { useCallback, useEffect, useRef } from 'react';
import { ProviderConfig } from '../types/provider';
import { discoverProviderModels } from '../services/infrastructure/ProviderConfigService';
import { getPreferenceObject, setPreferenceObject } from '../services/infrastructure/PreferencesService';
import { mergeDiscoveredModels } from '../utils/providerUtils';

const LAST_SWEEP_KEY = 'model_catalog_sweep_v1';
/** Minimum gap between background sweeps (6h). */
const SWEEP_INTERVAL_MS = 6 * 3_600_000;
/** Stagger between providers — stay under per-key rate limits. */
const PROVIDER_STAGGER_MS = 1_500;

interface SweepState {
    lastSweepAt: number;
}

const readSweepState = async (): Promise<SweepState> =>
    (await getPreferenceObject<SweepState>(LAST_SWEEP_KEY)) ?? { lastSweepAt: 0 };

export interface UseModelCatalogRefreshResult {
    /** Force a sweep now (also resets the interval timer). */
    refreshNow: () => Promise<void>;
}

export const useModelCatalogRefresh = (
    providerConfigs: ProviderConfig[],
    onUpdateProvider: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>,
): UseModelCatalogRefreshResult => {
    // Refs keep the effect stable (no re-sweep on every configs change);
    // the callback always reads the LIVE configs.
    const configsRef = useRef(providerConfigs);
    configsRef.current = providerConfigs;
    const updateRef = useRef(onUpdateProvider);
    updateRef.current = onUpdateProvider;
    const sweepingRef = useRef(false);

    const sweep = useCallback(async (): Promise<void> => {
        if (sweepingRef.current) return;
        sweepingRef.current = true;
        try {
            const targets = configsRef.current.filter(
                p => p.isEnabled && (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0,
            );
            for (const provider of targets) {
                try {
                    const discovered = await discoverProviderModels({
                        baseUrl: provider.baseUrl,
                        apiKey: provider.apiKey,
                        apiFormat: provider.apiFormat,
                    });
                    const existing = new Set(provider.models);
                    const fresh = discovered.filter(m => !existing.has(m));
                    if (fresh.length > 0) {
                        // Merge-only: manual models and ordering survive;
                        // every dropdown re-derives from configs on update.
                        await updateRef.current(provider.id, { models: mergeDiscoveredModels(provider.models, discovered) });
                    }
                } catch {
                    // Silent: offline, unsupported /models, rate limit — the
                    // stored list stays authoritative until a sweep succeeds.
                }
                await new Promise<void>(resolve => setTimeout(resolve, PROVIDER_STAGGER_MS));
            }
            await setPreferenceObject<SweepState>(LAST_SWEEP_KEY, { lastSweepAt: Date.now() });
        } finally {
            sweepingRef.current = false;
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        const maybeSweep = async (): Promise<void> => {
            const state = await readSweepState();
            if (cancelled || Date.now() - state.lastSweepAt < SWEEP_INTERVAL_MS) return;
            await sweep();
        };
        // Small boot delay so the first paint never competes with the sweep.
        const boot = setTimeout(() => { void maybeSweep(); }, 4_000);
        const interval = setInterval(() => { void maybeSweep(); }, SWEEP_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearTimeout(boot);
            clearInterval(interval);
        };
    }, [sweep]);

    return { refreshNow: sweep };
};

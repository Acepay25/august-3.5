/**
 * useProviderConfigs — React hook for managing AI provider configurations.
 * Loads configs on mount, exposes CRUD operations, and tracks ready providers.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ProviderConfig, ApiFormat } from '../types/provider';
import {
    loadProviderConfigs,
    saveProviderConfigs,
    updateProviderConfig,
    addCustomProvider,
    removeCustomProvider,
    getReadyProviders,
} from '../services/infrastructure/ProviderConfigService';

export function useProviderConfigs() {
    const [configs, setConfigs] = useState<ProviderConfig[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load configs on mount
    useEffect(() => {
        let mounted = true;
        loadProviderConfigs().then(loaded => {
            if (mounted) {
                setConfigs(loaded);
                setIsLoaded(true);
            }
        });
        return () => { mounted = false; };
    }, []);

    // Update a provider's config
    const handleUpdateProvider = useCallback(async (
        id: string,
        updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>
    ) => {
        const updated = await updateProviderConfig(id, updates);
        setConfigs(updated);
    }, []);

    // Add a custom provider
    const handleAddCustomProvider = useCallback(async (provider: {
        name: string;
        baseUrl: string;
        apiKey: string;
        apiFormat: ApiFormat;
        models?: string[];
        selectedModel?: string;
    }) => {
        const updated = await addCustomProvider(provider);
        setConfigs(updated);
    }, []);

    // Remove a custom provider
    const handleRemoveProvider = useCallback(async (id: string) => {
        const updated = await removeCustomProvider(id);
        setConfigs(updated);
    }, []);

    // Toggle a provider's enabled state
    const handleToggleProvider = useCallback(async (id: string) => {
        const config = configs.find(c => c.id === id);
        if (config) {
            const updated = await updateProviderConfig(id, { isEnabled: !config.isEnabled });
            setConfigs(updated);
        }
    }, [configs]);

    // Get providers that are enabled AND have an API key
    const readyProviders = useMemo(() => getReadyProviders(configs), [configs]);

    // Get a specific provider config by ID
    const getProviderById = useCallback((id: string) => {
        return configs.find(c => c.id === id);
    }, [configs]);

    return {
        configs,
        isLoaded,
        readyProviders,
        handleUpdateProvider,
        handleAddCustomProvider,
        handleRemoveProvider,
        handleToggleProvider,
        getProviderById,
    };
}

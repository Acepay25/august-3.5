import { useEffect } from 'react';
import { AnalystLensConfig } from '../types';
import { EnsembleModelSelection, retainEnsembleSelection } from '../services/ui/AnalystLensService';
import { ProviderConfig } from '../types/provider';

interface CatalogReconcileArgs {
    providerConfigsLoaded: boolean;
    providerConfigs: ProviderConfig[];
    lensConfig: AnalystLensConfig;
    handleSetLensConfig: (config: AnalystLensConfig) => void;
    ensembleModelSelection: EnsembleModelSelection;
    handleSetEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
}

/** Drop picks only after providers have loaded. An empty catalog must not wipe. */
export function useCatalogReconcile({
    providerConfigsLoaded,
    providerConfigs,
    lensConfig,
    handleSetLensConfig,
    ensembleModelSelection,
    handleSetEnsembleModelSelection,
}: CatalogReconcileArgs): void {
    useEffect(() => {
        if (!providerConfigsLoaded || providerConfigs.length === 0) return;
        if (!lensConfig?.assignments) return;
        const providersById = new Map(providerConfigs.map(c => [c.id, c]));
        let changed = false;
        const assignments = lensConfig.assignments.map(a => {
            if (!a.assignedProvider) return a;
            if (providersById.has(a.assignedProvider)) return a;
            changed = true;
            return { ...a, assignedProvider: null, assignedModel: undefined };
        });
        if (changed) handleSetLensConfig({ ...lensConfig, assignments });
    }, [providerConfigsLoaded, providerConfigs, lensConfig, handleSetLensConfig]);

    useEffect(() => {
        if (!providerConfigsLoaded || providerConfigs.length === 0) return;
        if (!ensembleModelSelection?.length) return;
        const cleaned = retainEnsembleSelection(ensembleModelSelection, providerConfigs.map(c => c.id));
        if (cleaned.length !== ensembleModelSelection.length) {
            handleSetEnsembleModelSelection(cleaned);
        }
    }, [providerConfigsLoaded, providerConfigs, ensembleModelSelection, handleSetEnsembleModelSelection]);
}

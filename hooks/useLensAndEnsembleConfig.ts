import { useCallback, useEffect, useRef } from 'react';
import {
    saveLensConfig,
    saveEnsembleModelSelection,
    saveCustomEnsemblePrompt,
    saveCustomLensPrompts,
    saveLastModeratorPick,
    EnsembleModelSelection,
} from '../services/ui/AnalystLensService';
import { useCatalogReconcile } from './useCatalogReconcile';
import { getFirstReadyProvider } from '../utils/providerUtils';
import type { AnalystLensConfig } from '../types/lens';
import type { ProviderConfig } from '../types/provider';
import type { AccuracySubMode } from '../types/enums';

export interface UseLensAndEnsembleConfigArgs {
    // Conversation-level moderator wiring
    setConversationModeratorProvider: (providerId: string) => void;
    setConversationModeratorModel: (model: string) => void;
    moderatorProviderId: string;
    moderatorModel: string;
    updateActiveConversation: (updater: (conv: any) => any) => void;

    // Lens + ensemble settings state (owned by useAppSettings)
    setLensConfig: React.Dispatch<React.SetStateAction<AnalystLensConfig>>;
    lensConfig: AnalystLensConfig;
    setEnsembleModelSelection: React.Dispatch<React.SetStateAction<EnsembleModelSelection>>;
    ensembleModelSelection: EnsembleModelSelection;
    setCustomEnsemblePrompt: React.Dispatch<React.SetStateAction<string | null>>;
    setCustomLensPrompts: React.Dispatch<React.SetStateAction<Record<string, string>>>;

    // Accuracy-mode confirm dialog state
    isAccuracyModeEnabled: boolean;
    setIsAccuracyModeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    accuracySubMode: AccuracySubMode;
    setAccuracySubMode: React.Dispatch<React.SetStateAction<AccuracySubMode>>;
    setShowAccuracyModal: (open: boolean) => void;

    // Provider catalog (drives the seed + reconcile effects)
    providerConfigs: ProviderConfig[];
    providerConfigsLoaded: boolean;
}

export interface UseLensAndEnsembleConfigResult {
    handleSetModeratorProvider: (providerId: string) => void;
    handleSetModeratorModel: (model: string) => void;
    handleSetLensConfig: (newConfig: AnalystLensConfig) => void;
    handleConfirmAccuracyMode: () => void;
    handleSetEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    handleSetCustomEnsemblePrompt: (prompt: string | null) => void;
    handleSetCustomLensPrompts: (prompts: Record<string, string>) => void;
}

/**
 * Lens / ensemble / moderator configuration: the handlers that mutate the
 * AI-lineup settings and persist each choice so it survives reloads, plus
 * the two boot-time conveniences around them — seeding the ordinary-mode
 * ensemble selection from ready providers (once per session, never over a
 * user-cleared pick) and the catalog reconcile that keeps lens/ensemble
 * picks pointing at models the providers actually expose.
 */
export const useLensAndEnsembleConfig = (args: UseLensAndEnsembleConfigArgs): UseLensAndEnsembleConfigResult => {
    const {
        setConversationModeratorProvider, setConversationModeratorModel,
        moderatorProviderId, moderatorModel, updateActiveConversation,
        setLensConfig, lensConfig,
        setEnsembleModelSelection, ensembleModelSelection,
        setCustomEnsemblePrompt, setCustomLensPrompts,
        isAccuracyModeEnabled, setIsAccuracyModeEnabled,
        accuracySubMode, setAccuracySubMode, setShowAccuracyModal,
        providerConfigs, providerConfigsLoaded,
    } = args;

    const handleSetModeratorProvider = useCallback((providerId: string) => {
        setConversationModeratorProvider(providerId);
        saveLastModeratorPick({ providerId, model: moderatorModel || '' });
    }, [setConversationModeratorProvider, moderatorModel]);

    const handleSetModeratorModel = useCallback((model: string) => {
        setConversationModeratorModel(model);
        if (moderatorProviderId) saveLastModeratorPick({ providerId: moderatorProviderId, model });
    }, [setConversationModeratorModel, moderatorProviderId]);

    // Analyst Lens config handler - updates state and persists to storage.
    const handleSetLensConfig = useCallback((newConfig: AnalystLensConfig) => {
        setLensConfig(newConfig);
        saveLensConfig(newConfig);
    }, [setLensConfig]);

    const handleConfirmAccuracyMode = () => {
        setIsAccuracyModeEnabled(!isAccuracyModeEnabled);
        setShowAccuracyModal(false);

        if (!isAccuracyModeEnabled) { // Enabling Accuracy Mode
            // Default moderator/vision to the first ready provider instead of a hardcoded brand.
            const firstReady = getFirstReadyProvider(providerConfigs);
            updateActiveConversation(conv => ({
                ...conv,
                moderatorProviderId: firstReady?.id || conv.moderatorProviderId || '',
                moderatorModel: firstReady?.selectedModel || conv.moderatorModel || '',
                ocrModel: firstReady?.selectedModel || conv.ocrModel || ''
            }));
            if (!accuracySubMode) setAccuracySubMode('original');
        }
    };

    // Ordinary ensemble model selection (Lenses off) handler — persists the
    // picked models that drive the cards and the debate (2–5 flat floor,
    // 6–10 lens pods; Settings pickers offer 3).
    const handleSetEnsembleModelSelection = useCallback((selection: EnsembleModelSelection) => {
        setEnsembleModelSelection(selection.slice(0, 10));
        saveEnsembleModelSelection(selection.slice(0, 10));
    }, [setEnsembleModelSelection]);

    // Seed the ordinary (normal-mode) debate-model selection from the ready
    // providers' ensembleModels when nothing has been picked yet. The run
    // falls back to those models anyway — without the seed the chat pickers
    // look empty while three "hardcoded" models silently run. Once seeded
    // (or cleared by the user), never re-seed this session.
    const ensembleSelectionSeededRef = useRef(false);
    useEffect(() => {
        if (!providerConfigsLoaded || ensembleSelectionSeededRef.current) return;
        if (ensembleModelSelection && ensembleModelSelection.length > 0) {
            ensembleSelectionSeededRef.current = true;
            return;
        }
        const ready = providerConfigs.filter(c => c.isEnabled && c.apiKey.trim().length > 0);
        if (ready.length === 0) return;
        const seeded: EnsembleModelSelection = [];
        for (const c of ready) {
            const models = (c.ensembleModels?.filter(m => c.models.includes(m)) ?? []).slice(0, 3);
            if (models.length === 0 && c.selectedModel && c.models.includes(c.selectedModel)) models.push(c.selectedModel);
            for (const m of models) {
                if (seeded.length >= 3) break;
                const key = `${c.id}::${m}`;
                if (!seeded.some(e => `${e.providerId}::${e.model}` === key)) seeded.push({ providerId: c.id, model: m });
            }
            if (seeded.length >= 3) break;
        }
        if (seeded.length > 0) {
            ensembleSelectionSeededRef.current = true;
            handleSetEnsembleModelSelection(seeded);
        }
    }, [providerConfigsLoaded, providerConfigs, ensembleModelSelection, handleSetEnsembleModelSelection]);

    // Custom prompt overrides (prompt editor) — persist so they survive reloads.
    const handleSetCustomEnsemblePrompt = useCallback((prompt: string | null) => {
        setCustomEnsemblePrompt(prompt);
        saveCustomEnsemblePrompt(prompt);
    }, [setCustomEnsemblePrompt]);

    const handleSetCustomLensPrompts = useCallback((prompts: Record<string, string>) => {
        setCustomLensPrompts(prompts);
        saveCustomLensPrompts(prompts);
    }, [setCustomLensPrompts]);

    useCatalogReconcile({
        providerConfigsLoaded,
        providerConfigs,
        lensConfig,
        handleSetLensConfig,
        ensembleModelSelection,
        handleSetEnsembleModelSelection,
    });

    return {
        handleSetModeratorProvider,
        handleSetModeratorModel,
        handleSetLensConfig,
        handleConfirmAccuracyMode,
        handleSetEnsembleModelSelection,
        handleSetCustomEnsemblePrompt,
        handleSetCustomLensPrompts,
    };
};

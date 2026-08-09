/**
 * useAppSettings — manages AI analysis settings state.
 * Extracted from App.tsx to reduce component complexity.
 */

import { useState } from 'react';
import { AccuracySubMode, CustomInstructionsMap, AnalystLensConfig, GlobalMemory, ConfidenceCalibration, InsightKnowledgeBase, AIProvider } from '../types';
import { ProviderConfig } from '../types/provider';
import { DEFAULT_FRAMEWORKS } from '../constants/models';
import { loadLensConfig, loadEnsembleModelSelection, EnsembleModelSelection, loadCustomEnsemblePrompt, loadCustomLensPrompts } from '../services/ui/AnalystLensService';

export function useAppSettings() {
    // Layer 3: Global Long-Term Memory
    const [globalMemory, setGlobalMemory] = useState<GlobalMemory | undefined>(undefined);

    // Memory Provider Selection
    const [memoryConfig, setMemoryConfig] = useState<ProviderConfig | null>(null);
    const [memoryModel, setMemoryModel] = useState<string>('');
    const [isGlobalMemoryEnabled, setIsGlobalMemoryEnabled] = useState<boolean>(false);

    // Accuracy Mode State
    const [isAccuracyModeEnabled, setIsAccuracyModeEnabled] = useState<boolean>(false);
    const [accuracySubMode, setAccuracySubMode] = useState<AccuracySubMode>('original');

    // Custom AI Behavior
    const [customInstructions, setCustomInstructions] = useState<CustomInstructionsMap>({
        general: [],
        accuracyOriginal: [],
        accuracyPure: []
    });
    const [isPlaybookEnabledInPureAI, setIsPlaybookEnabledInPureAI] = useState<boolean>(false);
    const [isFamiliesEnabledInPureAI, setIsFamiliesEnabledInPureAI] = useState<boolean>(false);
    const [isMemoryEnabledInPureAI, setIsMemoryEnabledInPureAI] = useState<boolean>(false);
    const [isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled] = useState<boolean>(false);

    // Analyst Lens Configuration
    const [lensConfig, setLensConfig] = useState<AnalystLensConfig>(() => loadLensConfig());

    // Ordinary ensemble model selection (used when Lenses are OFF): the three
    // models the user picks in the chat input become the debate participants.
    const [ensembleModelSelection, setEnsembleModelSelection] = useState<EnsembleModelSelection>(() => loadEnsembleModelSelection());

    // Custom prompt overrides (prompt editor): Normal-mode base prompt and
    // per-role lens prompts. null/empty = use the built-in prompt.
    const [customEnsemblePrompt, setCustomEnsemblePrompt] = useState<string | null>(() => loadCustomEnsemblePrompt());
    const [customLensPrompts, setCustomLensPrompts] = useState<Record<string, string>>(() => loadCustomLensPrompts());

    // Confidence Calibration
    const [confidenceCalibration, setConfidenceCalibration] = useState<ConfidenceCalibration | undefined>(undefined);

    // AI Learning - Knowledge base
    const [insightKnowledgeBase, setInsightKnowledgeBase] = useState<InsightKnowledgeBase | undefined>(undefined);

    // Summarization settings
    const [activeFrameworks, setActiveFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
    const [summaryCharLimit, setSummaryCharLimit] = useState<number>(4000);
    // Defaults are empty — App resolves them to the first ready provider once configs load.
    const [summarizationProvider, setSummarizationProvider] = useState<AIProvider>('');
    const [summarizationModel, setSummarizationModel] = useState<string>('');
    const [useAlgorithmicSummary, setUseAlgorithmicSummary] = useState<boolean>(true);
    const [useAlgorithmicInsights, setUseAlgorithmicInsights] = useState<boolean>(true);

    return {
        globalMemory, setGlobalMemory,
        memoryConfig, setMemoryConfig,
        memoryModel, setMemoryModel,
        isGlobalMemoryEnabled, setIsGlobalMemoryEnabled,
        isAccuracyModeEnabled, setIsAccuracyModeEnabled,
        accuracySubMode, setAccuracySubMode,
        customInstructions, setCustomInstructions,
        isPlaybookEnabledInPureAI, setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI, setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI, setIsMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled,
        lensConfig, setLensConfig,
        ensembleModelSelection, setEnsembleModelSelection,
        customEnsemblePrompt, setCustomEnsemblePrompt,
        customLensPrompts, setCustomLensPrompts,
        confidenceCalibration, setConfidenceCalibration,
        insightKnowledgeBase, setInsightKnowledgeBase,
        activeFrameworks, setActiveFrameworks,
        summaryCharLimit, setSummaryCharLimit,
        summarizationProvider, setSummarizationProvider,
        summarizationModel, setSummarizationModel,
        useAlgorithmicSummary, setUseAlgorithmicSummary,
        useAlgorithmicInsights, setUseAlgorithmicInsights,
    };
}

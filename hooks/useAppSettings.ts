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

    // User-uploaded strategy summaries (Settings → Strategies): master switch
    // that gates whether enabled docs are injected into analysis prompts.
    const [isStrategiesEnabled, setIsStrategiesEnabled] = useState<boolean>(false);

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

    // AI Learning - Knowledge base.
    // WRITE-ONLY BY CONSTRUCTION, and it is the SECOND copy of that name:
    // the store this state mirrors (`UserSettings.insightKnowledgeBase`) is
    // loaded once per profile (`useUserProfileLoader.ts:432`) and persisted
    // right back (`useProfilePersistence.ts:98`), so the round trip can only
    // ever re-write what it read. Nothing at runtime feeds it — the real store
    // is `GlobalMemory.insightKnowledgeBase`, maintained per write by
    // `AlgorithmicMemoryService.ts:135-149` and read into prompts by
    // `utils/memoryUtils.buildGlobalMemoryIndex:52`. Its single consumer
    // (`useAnalysisPipeline.ts:162,316`) destructures it and lists it in a
    // dependency array without ever reading the value, so the only honest
    // description of this state is "carried, not used". Deleting it means
    // unwinding App.tsx:304,823,1568,2463 plus the four hook call sites, so it
    // stays documented rather than quietly half-removed. See
    // docs/learning-loop-map.md.
    const [insightKnowledgeBase, setInsightKnowledgeBase] = useState<InsightKnowledgeBase | undefined>(undefined);

    // Summarization settings
    const [activeFrameworks, setActiveFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
    const [summaryCharLimit, setSummaryCharLimit] = useState<number>(4000);
    // Defaults are empty — App resolves them to the first ready provider once configs load.
    const [summarizationProvider, setSummarizationProvider] = useState<AIProvider>('');
    const [summarizationModel, setSummarizationModel] = useState<string>('');
    // Global vision model (Settings → AI setup → Vision Model): one model for
    // EVERY vision feature — chart OCR, post-trade uploads, PDF book OCR.
    // Empty = fall back to the conversation's OCR model, then first ready provider.
    const [visionModel, setVisionModel] = useState<string>('');
    // Journal generation defaults to AI (false = use AI); algorithmic mode
    // (true, token-free) is an explicit opt-in. Persisted via UserSettings.
    const [useAlgorithmicSummary, setUseAlgorithmicSummary] = useState<boolean>(false);
    const [useAlgorithmicInsights, setUseAlgorithmicInsights] = useState<boolean>(false);

    return {
        globalMemory, setGlobalMemory,
        memoryConfig, setMemoryConfig,
        memoryModel, setMemoryModel,
        isGlobalMemoryEnabled, setIsGlobalMemoryEnabled,
        isStrategiesEnabled, setIsStrategiesEnabled,
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
        visionModel, setVisionModel,
        useAlgorithmicSummary, setUseAlgorithmicSummary,
        useAlgorithmicInsights, setUseAlgorithmicInsights,
    };
}

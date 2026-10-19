/**
 * useAppSettings — manages AI analysis settings state.
 * Extracted from App.tsx to reduce component complexity.
 */

import { useState } from 'react';
import { CustomInstructionsMap, GlobalMemory, InsightKnowledgeBase, AIProvider } from '../types';
import { ProviderConfig } from '../types/provider';
import { DEFAULT_FRAMEWORKS } from '../constants/models';

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

    // Custom AI Behavior
    const [customInstructions, setCustomInstructions] = useState<CustomInstructionsMap>({
        general: [],
    });
    const [isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled] = useState<boolean>(false);

    // Confidence Calibration

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
        customInstructions, setCustomInstructions,
        isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled,
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

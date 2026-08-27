
import { GlobalMemory, LoggedTrade, ProviderConfig } from '../../types';
import { generateAlgorithmicTradeSummary } from '../ui/AlgorithmicSummaryService';
import { updateGlobalMemoryAlgorithmically } from './AlgorithmicMemoryService';
import { summarizeTrade as genericSummarizeTrade } from '../providers/GenericAnalysisService';

/**
 * Update global memory from a fresh batch of closed trades. Always uses
 * the deterministic algorithmic path — the previous AI-fallback branch was
 * unreachable in practice (the algorithmic path never throws) and added
 * provider cost + latency on every post-mortem completion.
 */
export const updateGlobalMemory = async (
    recentTrades: LoggedTrade[],
    currentMemory: GlobalMemory | undefined,
): Promise<GlobalMemory> => updateGlobalMemoryAlgorithmically(recentTrades, currentMemory);

/**
 * Summarize a single trade. The user can opt out of the algorithmic path
 * (`useAlgorithmic = false`) so a configured provider produces a richer
 * natural-language summary when available; on any failure we fall back to
 * the deterministic local summary so the loop never stalls.
 */
export const summarizeTrade = async (
    trade: LoggedTrade,
    modelName: string,
    config: ProviderConfig,
    useAlgorithmic: boolean = true,
): Promise<string> => {
    if (useAlgorithmic) {
        return generateAlgorithmicTradeSummary(trade);
    }

    const selectedModel = (modelName || config?.selectedModel || '').trim();
    if (!config?.baseUrl?.trim() || !selectedModel) {
        console.warn('[MemoryService] Insight provider/model incomplete; using algorithmic summary');
        return generateAlgorithmicTradeSummary(trade);
    }

    const insightConfig: ProviderConfig = { ...config, selectedModel };
    try {
        return await genericSummarizeTrade(insightConfig, trade);
    } catch (error) {
        console.error(`[MemoryService] AI insight failed for ${insightConfig.name}, falling back to algorithmic:`, error);
        return generateAlgorithmicTradeSummary(trade);
    }
};

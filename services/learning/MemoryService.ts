import { Message, GlobalMemory, LoggedTrade, ProviderConfig } from '../../types';
import { generateAlgorithmicTradeSummary } from '../ui/AlgorithmicSummaryService';
import { updateGlobalMemoryAlgorithmically } from './AlgorithmicMemoryService';
import { compressChatHistoryAlgorithmically } from '../ui/AlgorithmicChatService';

import {
    compressChatHistory as genericCompressChatHistory,
    updateGlobalMemory as genericUpdateGlobalMemory,
    summarizeTrade as genericSummarizeTrade,
} from '../providers/GenericAnalysisService';

/**
 * Compress chat history using the selected provider
 */
export const compressChatHistory = async (
    messages: Message[],
    currentSummary: string = "",
    config: ProviderConfig
): Promise<string> => {
    // NEW: Always use Algorithmic Chat Compression to save tokens
    // "Smart Sliding Window" approach (Head + Tail)
    console.log('[MemoryService] Using Algorithmic Chat Compression (Token Saver Active)');

    try {
        return compressChatHistoryAlgorithmically(messages, currentSummary);
    } catch (e) {
        console.error('[MemoryService] Algorithmic compression failed, falling back to AI:', e);
        // Fallback below
    }

    console.log(`[MemoryService] compressChatHistory using provider: ${config.name}`);

    return genericCompressChatHistory(config, messages, currentSummary);
};

/**
 * Update global memory using the selected provider
 */
export const updateGlobalMemory = async (
    recentTrades: LoggedTrade[],
    currentMemory: GlobalMemory | undefined,
    config: ProviderConfig
): Promise<GlobalMemory> => {
    // NEW: Always use Algorithmic Global Memory Manager to save tokens
    // This replaces the massive AI prompt for compiling stats
    console.log('[MemoryService] Using Algorithmic Global Memory Manager (Token Saver Active)');

    try {
        return updateGlobalMemoryAlgorithmically(recentTrades, currentMemory);
    } catch (e) {
        console.error('[MemoryService] Algorithmic memory update failed, falling back to AI:', e);
        // Fallback to AI logic below
    }

    console.log(`[MemoryService] updateGlobalMemory using provider: ${config.name}`);

    try {
        return await genericUpdateGlobalMemory(config, recentTrades, currentMemory);
    } catch (error: any) {
        console.error(`[MemoryService] Primary provider ${config.name} failed:`, error);

        // Auto-fallback logic for Rate Limits or API errors
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
            console.warn(`[MemoryService] Provider quota exceeded: ${config.name}.`);
        }

        throw error;
    }
};

/**
 * Summarize trade using the selected provider
 */
export const summarizeTrade = async (
    trade: any, // LoggedTrade with postMortem
    modelName: string,
    config: ProviderConfig,
    useAlgorithmic: boolean = true // New param to toggle between Algo and AI
): Promise<string> => {
    // Check toggle before using Algo
    if (useAlgorithmic) {
        console.log('[MemoryService] Using Algorithmic Summary (Token Saver Active)');
        try {
            const summary = generateAlgorithmicTradeSummary(trade as LoggedTrade);
            return summary;
        } catch (e) {
            console.error('[MemoryService] Algorithmic summary failed, falling back to AI:', e);
            // Fallback to original AI logic if algo fails (unlikely)
        }
    } else {
        console.log('[MemoryService] Algorithmic Summary DISABLED by user. Using AI Model for insight generation.');
    }

    console.log(`[MemoryService] summarizeTrade using provider: ${config.name}`);

    return genericSummarizeTrade(config, trade as LoggedTrade);
};

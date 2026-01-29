import { Message, GlobalMemory, LoggedTrade } from '../types';
import { MEMORY_COMPRESSOR_PROMPT, GLOBAL_MEMORY_MANAGER_PROMPT } from '../constants/prompts';
import { generateAlgorithmicTradeSummary } from './AlgorithmicSummaryService';
import { updateGlobalMemoryAlgorithmically } from './AlgorithmicMemoryService';
import { compressChatHistoryAlgorithmically } from './AlgorithmicChatService';

// Import all AI services
import * as geminiService from './geminiService';
import * as deepseekService from './deepseekService';
import * as groqService from './groqService';
import * as zhipuService from './zhipuService';

import * as groqAlt2Service from './groqAlt2Service';
import * as openrouterService from './openrouterService';
import * as openaiService from './openaiService';
import * as grokNativeService from './grokNativeService';

export type MemoryProvider =
    | 'gemini'
    | 'deepseek'
    | 'groq'
    | 'groq-alt2'
    | 'zhipu'

    | 'openrouter'
    | 'openai'
    | 'grok-native';

export const MEMORY_PROVIDER_OPTIONS: { value: MemoryProvider; label: string }[] = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'groq', label: 'Groq' },
    { value: 'groq-alt2', label: 'Groq (Alt 2)' },
    { value: 'zhipu', label: 'Zhipu' },

    { value: 'openrouter', label: 'OpenRouter (Free)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'grok-native', label: 'Grok (xAI)' },
];

// Models available for each provider
export const MEMORY_MODELS: Record<MemoryProvider, { value: string; label: string }[]> = {
    'gemini': [
        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
        { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        { value: 'gemini-2.0-flash-lite-preview-02-05', label: 'Gemini 2.0 Flash Lite' },
        { value: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
        { value: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite' },
        { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
    ],
    'deepseek': [
        { value: 'deepseek-chat', label: 'DeepSeek Chat (V3.2)' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (Thinking)' },
    ],
    'groq': [
        { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
        { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { value: 'allam-2-7b', label: 'Allam-2 7B' },
        { value: 'groq/compound', label: 'Groq Compound' },
        { value: 'groq/compound-mini', label: 'Groq Compound Mini' },
        { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
        { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
        { value: 'openai/gpt-oss-safeguard-20b', label: 'GPT-OSS Safeguard 20B' },
        { value: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
        { value: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 Instruct' },
        { value: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct 0905' },
    ],
    'groq-alt2': [
        { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
        { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { value: 'allam-2-7b', label: 'Allam-2 7B' },
        { value: 'groq/compound', label: 'Groq Compound' },
        { value: 'groq/compound-mini', label: 'Groq Compound Mini' },
        { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
        { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
        { value: 'openai/gpt-oss-safeguard-20b', label: 'GPT-OSS Safeguard 20B' },
        { value: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
        { value: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 Instruct' },
        { value: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct 0905' },
    ],
    'zhipu': [
        { value: 'glm-4.5-flash', label: 'GLM-4.5-Flash (Optimized)' },
        { value: 'glm-4.6', label: 'GLM-4.6' },
        { value: 'glm-4.5', label: 'GLM-4.5' },
        { value: 'glm-4-32b-0414-128k', label: 'GLM-4-32B-0414-128K' },
        { value: 'glm-4.5v', label: 'GLM-4.5V (Vision)' },
    ],

    'openrouter': [
        { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct (Free)' },
        { value: 'qwen/qwen3-235b-a22b:free', label: 'Qwen3 235B (Free)' },
        { value: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash Exp (Free)' },
        { value: 'moonshotai/kimi-k2:free', label: 'Kimi K2 (Free)' },
        { value: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 Llama 405B (Free)' },
        { value: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B Instruct (Free)' },
        { value: 'tngtech/deepseek-r1t2-chimera:free', label: 'DeepSeek R1T2 Chimera (Free)' },
        { value: 'alibaba/tongyi-deepresearch-30b-a3b:free', label: 'Tongyi DeepResearch 30B (Free)' },
    ],
    'openai': [
        { value: 'gpt-5-nano', label: 'GPT-5 Nano' },
        { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    ],
    'grok-native': [
        { value: 'grok-3', label: 'Grok 3' },
        { value: 'grok-3-mini', label: 'Grok 3 Mini' },
        { value: 'grok-3-fast', label: 'Grok 3 Fast' },
        { value: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning' },
        { value: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast Non-Reasoning' },
    ],
};

// Get default model for a provider
export const getDefaultModelForProvider = (provider: MemoryProvider): string => {
    return MEMORY_MODELS[provider]?.[0]?.value || '';
};

/**
 * Compress chat history using the selected provider
 */
export const compressChatHistory = async (
    messages: Message[],
    currentSummary: string = "",
    provider: MemoryProvider = 'gemini'
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

    console.log(`[MemoryService] compressChatHistory using provider: ${provider}`);

    switch (provider) {
        case 'gemini':
            return geminiService.compressChatHistory(messages, currentSummary);
        case 'deepseek':
            return deepseekService.compressChatHistory(messages, currentSummary);
        case 'groq':
            return groqService.compressChatHistory(messages, currentSummary);
        case 'groq-alt2':
            return groqAlt2Service.compressChatHistory(messages, currentSummary);
        case 'zhipu':
            return zhipuService.compressChatHistory(messages, currentSummary);

        case 'openrouter':
            return openrouterService.compressChatHistory(messages, currentSummary);
        case 'openai':
            return openaiService.compressChatHistory(messages, currentSummary);
        case 'grok-native':
            return grokNativeService.compressChatHistory(messages, currentSummary);
        default:
            console.warn(`[MemoryService] Unknown provider: ${provider}, falling back to Gemini`);
            return geminiService.compressChatHistory(messages, currentSummary);
    }
};

/**
 * Update global memory using the selected provider
 */
export const updateGlobalMemory = async (
    recentTrades: LoggedTrade[],
    currentMemory: GlobalMemory | undefined,
    provider: MemoryProvider = 'gemini'
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

    console.log(`[MemoryService] updateGlobalMemory using provider: ${provider}`);

    try {
        switch (provider) {
            case 'gemini':
                return await geminiService.updateGlobalMemory(recentTrades, currentMemory);
            case 'deepseek':
                return await deepseekService.updateGlobalMemory(recentTrades, currentMemory);
            case 'groq':
                return await groqService.updateGlobalMemory(recentTrades, currentMemory);
            case 'groq-alt2':
                return await groqAlt2Service.updateGlobalMemory(recentTrades, currentMemory);
            case 'zhipu':
                return await zhipuService.updateGlobalMemory(recentTrades, currentMemory);

            case 'openrouter':
                return await openrouterService.updateGlobalMemory(recentTrades, currentMemory);
            case 'openai':
                return await openaiService.updateGlobalMemory(recentTrades, currentMemory);
            case 'grok-native':
                return await grokNativeService.updateGlobalMemory(recentTrades, currentMemory);
            default:
                console.warn(`[MemoryService] Unknown provider: ${provider}, falling back to Gemini`);
                return await geminiService.updateGlobalMemory(recentTrades, currentMemory);
        }
    } catch (error: any) {
        console.error(`[MemoryService] Primary provider ${provider} failed:`, error);

        // Auto-fallback logic for Rate Limits or API errors
        if (provider === 'gemini' && (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota'))) {
            console.warn(`[MemoryService] Gemini quota exceeded. Falling back to Groq for memory update.`);
            return await groqService.updateGlobalMemory(recentTrades, currentMemory);
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
    provider: MemoryProvider = 'gemini',
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

    console.log(`[MemoryService] summarizeTrade using provider: ${provider}`);

    switch (provider) {
        case 'gemini':
            return geminiService.summarizeTrade(trade, modelName);
        case 'deepseek':
            return deepseekService.summarizeTrade(trade, modelName);
        case 'groq':
            return groqService.summarizeTrade(trade, modelName);
        case 'groq-alt2':
            return groqAlt2Service.summarizeTrade(trade, modelName);
        case 'zhipu':
            return zhipuService.summarizeTrade(trade, modelName);

        case 'openrouter':
            return openrouterService.summarizeTrade(trade, modelName);
        case 'openai':
            return openaiService.summarizeTrade(trade, modelName);
        case 'grok-native':
            return grokNativeService.summarizeTrade(trade, modelName);
        default:
            console.warn(`[MemoryService] Unknown provider: ${provider}, falling back to Gemini`);
            return geminiService.summarizeTrade(trade, modelName);
    }
};

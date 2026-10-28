export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Input tokens served from the provider's prompt cache — a SUBSET of
     *  promptTokens. Absent when the provider reported no cache frame; never
     *  inferred from the prompt size. */
    cachedPromptTokens?: number;
}

export const emptyTokenUsage = (): TokenUsage => ({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
});

export const mergeTokenUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedPromptTokens: (a.cachedPromptTokens ?? 0) + (b.cachedPromptTokens ?? 0),
});

const objectField = (value: unknown, key: string): Record<string, unknown> | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const field = (value as Record<string, unknown>)[key];
    return field && typeof field === 'object' ? field as Record<string, unknown> : undefined;
};

export const extractTokenUsage = (data: unknown): TokenUsage | null => {
    if (!data || typeof data !== 'object') return null;
    const usage = (data as { usage?: Record<string, unknown> }).usage;
    const meta = (data as { usageMetadata?: Record<string, unknown> }).usageMetadata;
    if (usage && typeof usage === 'object') {
        // The two families disagree about whether the cache is inside the
        // prompt count: Anthropic's `input_tokens` EXCLUDES cache reads and
        // writes, while OpenAI's `prompt_tokens` / the Responses API's
        // `input_tokens` INCLUDE them. Normalize to one meaning — promptTokens
        // is the whole prompt, cachedPromptTokens the subset — or a cached
        // turn would report a prompt that collapsed to its uncached sliver.
        const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0;
        const cacheWritten = Number(usage.cache_creation_input_tokens ?? 0) || 0;
        const cached = cacheRead
            || Number(objectField(usage, 'prompt_tokens_details')?.cached_tokens ?? 0)
            || Number(objectField(usage, 'input_tokens_details')?.cached_tokens ?? 0)
            || Number(usage.prompt_cache_hit_tokens ?? 0) // DeepSeek spelling
            || 0;
        const prompt = (Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0) + cacheRead + cacheWritten;
        const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
        const total = Number(usage.total_tokens ?? 0) || prompt + completion;
        if (prompt === 0 && completion === 0 && total === 0) return null;
        return {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total || prompt + completion,
            ...(cached > 0 ? { cachedPromptTokens: cached } : {}),
        };
    }
    if (meta && typeof meta === 'object') {
        const prompt = Number(meta.promptTokenCount ?? 0) || 0;
        const completion = Number(meta.candidatesTokenCount ?? 0) || 0;
        const cached = Number(meta.cachedContentTokenCount ?? 0) || 0;
        const total = Number(meta.totalTokenCount ?? prompt + completion) || 0;
        if (prompt === 0 && completion === 0 && total === 0) return null;
        return {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total || prompt + completion,
            ...(cached > 0 ? { cachedPromptTokens: cached } : {}),
        };
    }
    return null;
};

export const estimateCostUsd = (
    usage: TokenUsage,
    rates?: { inputUsdPer1k?: number; outputUsdPer1k?: number },
): number | undefined => {
    const input = rates?.inputUsdPer1k;
    const output = rates?.outputUsdPer1k;
    if (input === undefined && output === undefined) return undefined;
    const cost =
        (usage.promptTokens / 1000) * (input ?? 0) +
        (usage.completionTokens / 1000) * (output ?? 0);
    return Number.isFinite(cost) ? cost : undefined;
};

export interface TokenUsageEvent {
    providerId: string;
    modelId: string;
    usage: TokenUsage;
}

type Listener = (event: TokenUsageEvent) => void;
const listeners = new Set<Listener>();

export const subscribeTokenUsage = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const emitTokenUsage = (event: TokenUsageEvent): void => {
    listeners.forEach(listener => listener(event));
};

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export const emptyTokenUsage = (): TokenUsage => ({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
});

export const mergeTokenUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
});

export const extractTokenUsage = (data: unknown): TokenUsage | null => {
    if (!data || typeof data !== 'object') return null;
    const usage = (data as { usage?: Record<string, unknown>; usageMetadata?: Record<string, unknown> }).usage;
    const meta = (data as { usageMetadata?: Record<string, unknown> }).usageMetadata;
    if (usage && typeof usage === 'object') {
        const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
        const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
        const total = Number(usage.total_tokens ?? prompt + completion) || 0;
        if (prompt === 0 && completion === 0 && total === 0) return null;
        return {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total || prompt + completion,
        };
    }
    if (meta && typeof meta === 'object') {
        const prompt = Number(meta.promptTokenCount ?? 0) || 0;
        const completion = Number(meta.candidatesTokenCount ?? 0) || 0;
        const total = Number(meta.totalTokenCount ?? prompt + completion) || 0;
        if (prompt === 0 && completion === 0 && total === 0) return null;
        return {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total || prompt + completion,
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

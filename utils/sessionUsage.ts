import { getPreferenceObject, setPreferenceObject } from '../services/infrastructure/PreferencesService';

export interface SessionUsageModelSlice {
    modelId: string;
    tokens: number;
    costUsd?: number;
}

export interface SessionUsageEntry {
    at: string;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    tokensEst: number;
    analystCount: number;
    costUsd?: number;
    coin?: string;
    direction?: string;
    models?: SessionUsageModelSlice[];
}

const STORAGE_KEY = 'session_usage_v1';
const MAX_ENTRIES = 200;

export const loadSessionUsage = async (): Promise<SessionUsageEntry[]> => {
    const stored = await getPreferenceObject<SessionUsageEntry[]>(STORAGE_KEY);
    return Array.isArray(stored) ? stored : [];
};

export const appendSessionUsage = async (entry: SessionUsageEntry): Promise<void> => {
    const next = [...(await loadSessionUsage()), entry].slice(-MAX_ENTRIES);
    await setPreferenceObject(STORAGE_KEY, next);
};

export const clearSessionUsage = async (): Promise<void> => {
    await setPreferenceObject(STORAGE_KEY, []);
};

export interface PeriodUsageSummary {
    runs: number;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    tokensEst: number;
    costUsd: number;
    tokensExact: boolean;
}

export const summarizeUsagePeriod = (entries: SessionUsageEntry[], sinceMs: number): PeriodUsageSummary => {
    const slice = entries.filter(e => Date.parse(e.at) >= sinceMs);
    return slice.reduce<PeriodUsageSummary>((acc, e) => ({
        runs: acc.runs + 1,
        durationMs: acc.durationMs + e.durationMs,
        promptTokens: acc.promptTokens + e.promptTokens,
        completionTokens: acc.completionTokens + e.completionTokens,
        tokensEst: acc.tokensEst + e.tokensEst,
        costUsd: acc.costUsd + (e.costUsd ?? 0),
        tokensExact: acc.tokensExact || (e.promptTokens + e.completionTokens) > 0,
    }), { runs: 0, durationMs: 0, promptTokens: 0, completionTokens: 0, tokensEst: 0, costUsd: 0, tokensExact: false });
};

export interface ModelUsageSlice {
    modelId: string;
    tokens: number;
    costUsd: number;
    share: number;
}

export const summarizeModelUsage = (entries: SessionUsageEntry[], sinceMs: number): ModelUsageSlice[] => {
    const totals = new Map<string, { tokens: number; costUsd: number }>();
    for (const entry of entries.filter(e => Date.parse(e.at) >= sinceMs)) {
        if (entry.models && entry.models.length > 0) {
            for (const slice of entry.models) {
                const current = totals.get(slice.modelId) ?? { tokens: 0, costUsd: 0 };
                current.tokens += slice.tokens;
                current.costUsd += slice.costUsd ?? 0;
                totals.set(slice.modelId, current);
            }
            continue;
        }
        const fallback = entry.promptTokens + entry.completionTokens || entry.tokensEst;
        if (fallback <= 0) continue;
        const current = totals.get('unattributed') ?? { tokens: 0, costUsd: 0 };
        current.tokens += fallback;
        current.costUsd += entry.costUsd ?? 0;
        totals.set('unattributed', current);
    }
    const sum = [...totals.values()].reduce((n, s) => n + s.tokens, 0);
    return [...totals.entries()]
        .map(([modelId, value]) => ({
            modelId,
            tokens: value.tokens,
            costUsd: value.costUsd,
            share: sum > 0 ? value.tokens / sum : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens);
};

import { getPreferenceObject, setPreferenceObject } from '../services/infrastructure/PreferencesService';

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
    }), { runs: 0, durationMs: 0, promptTokens: 0, completionTokens: 0, tokensEst: 0, costUsd: 0 });
};

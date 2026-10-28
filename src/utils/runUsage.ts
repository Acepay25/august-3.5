import { RunStats } from '../types';

export interface RunUsageSummary {
    durationSec: number;
    analystCount: number;
    charsOut: number;
    tokensEst: number;
    tokensExact: boolean;
    costUsd?: number;
    gateCapPct?: number;
    mcWinRate?: number;
    mcEV?: number;
    similarSetups?: number;
    similarWinRate?: number;
    similarEV?: number;
}

export const summarizeRunUsage = (stats: RunStats): RunUsageSummary => {
    const charsOut = (stats.analysts ?? []).reduce((sum, a) => sum + (a.charsOut ?? 0), 0);
    const promptTokens = stats.promptTokens
        ?? (stats.analysts ?? []).reduce((sum, a) => sum + (a.promptTokens ?? 0), 0);
    const completionTokens = stats.completionTokens
        ?? (stats.analysts ?? []).reduce((sum, a) => sum + (a.completionTokens ?? 0), 0);
    const apiTokens = promptTokens + completionTokens;
    return {
        durationSec: Math.max(0, Math.round(stats.durationMs / 1000)),
        analystCount: stats.analystCount ?? stats.analysts?.length ?? 0,
        charsOut,
        tokensEst: apiTokens > 0 ? apiTokens : Math.round(charsOut / 4),
        tokensExact: apiTokens > 0,
        costUsd: stats.costUsd,
        gateCapPct: stats.gateCap !== undefined ? Math.round(stats.gateCap * 100) : undefined,
        mcWinRate: stats.mcWinRate,
        mcEV: stats.mcEV,
        similarSetups: stats.btMatches,
        similarWinRate: stats.btWinRate,
        similarEV: stats.btEV,
    };
};

export const formatChars = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
};

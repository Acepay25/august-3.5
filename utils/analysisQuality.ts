import { LoggedTrade, TradeOutcome } from '../types';

export type EvidenceCoverage = 'high' | 'partial' | 'low';

export interface QualityBucket {
    coverage: EvidenceCoverage;
    n: number;
    wins: number;
    winRate: number | null;
    avgProbability: number | null;
}

export const evidenceCoverageOf = (trade: LoggedTrade): EvidenceCoverage => {
    const claims = trade.analysis?.evidence || [];
    if (claims.length === 0) return 'low';
    const observed = claims.filter(c => c.state === 'observed').length;
    const ratio = observed / claims.length;
    if (ratio >= 0.7) return 'high';
    if (ratio >= 0.3) return 'partial';
    return 'low';
};

export const computeEvidenceQualityStats = (trades: LoggedTrade[]): QualityBucket[] => {
    const closed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const buckets: Record<EvidenceCoverage, { n: number; wins: number; probSum: number; probN: number }> = {
        high: { n: 0, wins: 0, probSum: 0, probN: 0 },
        partial: { n: 0, wins: 0, probSum: 0, probN: 0 },
        low: { n: 0, wins: 0, probSum: 0, probN: 0 },
    };
    for (const trade of closed) {
        const bucket = buckets[evidenceCoverageOf(trade)];
        bucket.n += 1;
        if (trade.outcome === TradeOutcome.WIN) bucket.wins += 1;
        if (typeof trade.analysis?.probability === 'number') {
            bucket.probSum += trade.analysis.probability;
            bucket.probN += 1;
        }
    }
    return (['high', 'partial', 'low'] as const).map(coverage => {
        const b = buckets[coverage];
        return {
            coverage,
            n: b.n,
            wins: b.wins,
            winRate: b.n > 0 ? Math.round((b.wins / b.n) * 1000) / 10 : null,
            avgProbability: b.probN > 0 ? Math.round((b.probSum / b.probN) * 10) / 10 : null,
        };
    });
};

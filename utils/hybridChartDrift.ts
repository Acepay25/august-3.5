import { TradeAnalysis } from '../types';
import { HybridDataPacket } from '../services/analysis/HybridIntelligenceService';

const parseNum = (value?: string): number | undefined => {
    if (!value) return undefined;
    const n = Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
};

export interface HybridDrift {
    pct: number;
    spot: number;
    entry: number;
    line: string;
}

/** Spot vs ticket entry. Large gaps usually mean a stale chart vs live hybrid. */
export const detectHybridChartDrift = (
    analysis: TradeAnalysis,
    hybrid?: HybridDataPacket | null,
): HybridDrift | null => {
    const spot = hybrid?.marketData?.currentPrice;
    const entry = parseNum(analysis.entryPoints?.[0]?.price);
    if (!spot || !entry || spot <= 0) return null;
    const pct = Math.abs(entry - spot) / spot;
    if (pct < 0.015) return null;
    const line = `Hybrid/chart drift ${(pct * 100).toFixed(1)}% (spot ${spot} vs entry ${entry}).`;
    return { pct, spot, entry, line };
};

export const applyHybridChartDrift = <T extends TradeAnalysis>(
    analysis: T,
    hybrid?: HybridDataPacket | null,
): T => {
    const drift = detectHybridChartDrift(analysis, hybrid);
    if (!drift) return analysis;
    const next: T = {
        ...analysis,
        validationWarnings: [...(analysis.validationWarnings ?? []), drift.line],
    };
    if (drift.pct >= 0.04 && next.confidence !== 'Avoid' && next.direction !== 'Neutral') {
        next.originalConfidence = next.originalConfidence ?? next.confidence;
        if (next.confidence === 'High' || next.confidence === 'Medium') next.confidence = 'Low';
    }
    return next;
};

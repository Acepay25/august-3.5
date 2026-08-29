/**
 * CalibrationLedgerService — the trust ledger (Batch 7, plan §5f).
 *
 * "When the verdict says 70%+, it hits X% of the time over N trades." The
 * aggregation is client-side over the closed journal rows: predicted vs
 * realized hit rate by grade (A–F) and confidence band, per-moderator
 * attribution, and the Brier score (mean squared error of the declared
 * probability against the realized outcome — lower is better, 0.25 is the
 * coin-flip baseline).
 *
 * Deterministic, no LLM. Trades missing a declared probability are counted
 * in the win-rate rows but excluded from Brier — an absent number must not
 * become a fabricated 50%.
 */

import { LoggedTrade } from '../../types/trade';
import { TradeOutcome } from '../../types/enums';

export interface LedgerRow {
    label: string;
    /** Closed trades in the row. */
    n: number;
    wins: number;
    /** Realized hit rate 0-100. */
    winRate: number;
    /** Mean declared probability across the row (0-100), null when none declared. */
    avgDeclaredPct: number | null;
    /** Mean Brier contribution for the row (0-1), null when no declared probs. */
    brier: number | null;
}

export interface CalibrationLedger {
    totalClosed: number;
    /** Overall Brier over every closed trade with a declared probability. */
    overallBrier: number | null;
    /** Brier sample (trades with a declared probability). */
    brierN: number;
    byGrade: LedgerRow[];
    byBand: LedgerRow[];
    byModerator: LedgerRow[];
}

const GRADES = ['A', 'B', 'C', 'D', 'F'];
const BANDS = ['High', 'Medium', 'Low'];

const closedWithProbability = (trades: LoggedTrade[]): { p: number; win: boolean }[] => {
    const rows: { p: number; win: boolean }[] = [];
    for (const t of trades) {
        if (t.outcome !== TradeOutcome.WIN && t.outcome !== TradeOutcome.LOSS) continue;
        const p = t.analysis?.probability;
        if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) continue;
        rows.push({ p: Math.min(100, Math.max(0, p)) / 100, win: t.outcome === TradeOutcome.WIN });
    }
    return rows;
};

const brierOf = (rows: { p: number; win: boolean }[]): number | null =>
    rows.length === 0 ? null : rows.reduce((s, r) => s + (r.p - (r.win ? 1 : 0)) ** 2, 0) / rows.length;

const buildRow = (label: string, trades: LoggedTrade[]): LedgerRow => {
    const closed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const wins = closed.filter(t => t.outcome === TradeOutcome.WIN).length;
    const withP = closedWithProbability(closed);
    const declared = closed
        .map(t => t.analysis?.probability)
        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
    return {
        label,
        n: closed.length,
        wins,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
        avgDeclaredPct: declared.length > 0
            ? declared.reduce((s, p) => s + p, 0) / declared.length
            : null,
        brier: brierOf(withP),
    };
};

export const buildCalibrationLedger = (trades: LoggedTrade[]): CalibrationLedger => {
    const withP = closedWithProbability(trades);
    const byModerator = new Map<string, LoggedTrade[]>();
    for (const t of trades) {
        const key = t.moderatorProvider || 'unknown';
        const bucket = byModerator.get(key) ?? [];
        bucket.push(t);
        byModerator.set(key, bucket);
    }
    return {
        totalClosed: trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS).length,
        overallBrier: brierOf(withP),
        brierN: withP.length,
        byGrade: GRADES.map(g => buildRow(g, trades.filter(t => t.analysis?.grade === g))),
        byBand: BANDS.map(b => buildRow(b, trades.filter(t => t.analysis?.confidence === b))),
        byModerator: [...byModerator.entries()]
            .map(([label, rows]) => buildRow(label, rows))
            .sort((a, b) => b.n - a.n),
    };
};

/**
 * The plain-language framing the research calls for — frequency format beats
 * raw probability for calibrated reliance. Empty when the journal is too
 * thin to say anything honest.
 */
export const ledgerFramingLine = (ledger: CalibrationLedger): string => {
    const confident = ledger.byBand.find(b => b.label === 'High');
    if (!confident || confident.n < 5 || confident.avgDeclaredPct === null) return '';
    return `When the verdict says High (~${Math.round(confident.avgDeclaredPct)}%), it hit ${confident.winRate.toFixed(0)}% of the time over ${confident.n} closed trades`;
};

/** Brier quality bucket for display coloring — coin flip is 0.25. */
export const brierQuality = (brier: number | null): 'good' | 'fair' | 'poor' | 'none' => {
    if (brier === null) return 'none';
    if (brier < 0.15) return 'good';
    if (brier <= 0.25) return 'fair';
    return 'poor';
};

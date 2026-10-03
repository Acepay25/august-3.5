/**
 * lensMemoryRecord — turn a CLOSED trade into the lines each analyst seat
 * would want to read next time.
 *
 * Why this is a separate module: the lens files were always READ and injected
 * (AnalystLensService injects "MY LENS MEMORY" into every Lens seat; the
 * doctrine rewriter folds the three files in) but nothing ever WROTE them, so
 * every seat was told it had a personal record and always received nothing.
 * The writer itself (`appendLensMemoryLine`) already existed and was tested.
 *
 * What goes in a line, and what does NOT:
 *
 *  - Only FACTS already established for this trade. The lens file is a seat's
 *    own record; a line is worth its prompt tokens only if it is true and
 *    would change a future answer. No model prose is copied in — the seat can
 *    re-derive that from the journal, and pasting it would grow the injection
 *    with text the seat cannot act on.
 *  - NO line per run. A file that grows by one entry per analysis is noise the
 *    seat learns to skim, which is worse than an empty file. One line per
 *    CLOSED, SCORED trade is the event that carries a lesson.
 *  - The regime seat's raw regime history is NOT duplicated here — that is the
 *    regime ledger's job (regimeLedger.ts), and `regimeSummaryBlock` already
 *    injects it. This file records what the seat concluded ABOUT the trade.
 */
import { AnalystRole } from '../../types';
import { appendLensMemoryLine } from './lensMemory';
import { fmtRiskReward, plannedRiskReward } from '../../utils/riskReward';
import { parsePrice } from '../../utils/analysisUtils';
import type { TradeAnalysis } from '../../types/analysis';
import type { LoggedTrade } from '../../types/trade';

export interface LensRecordInput {
    analysis: TradeAnalysis | undefined;
    outcome: 'WIN' | 'LOSS';
    username: string;
    /** Regime at the time of the trade, when hybrid data supplied one. */
    regime?: string;
    /** Whether the price tape confirms the user's stated outcome. */
    tapeAgreed?: boolean;
    /** The harness's own veto, when one was applied. */
    riskVeto?: string;
    /** Planned R:R as the harness computed it, when the levels support one. */
    plannedRr?: number;
}

const pct = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const short = (v: string | undefined, max = 8): string => {
    const n = parsePrice(v ?? '');
    return Number.isFinite(n) ? String(Math.round(n)) : '—';
};

/**
 * Build (but do not write) the per-seat lines for one closed trade. Exported
 * separately from the writer so the content is unit-testable without touching
 * the notebook.
 */
export const lensLinesForTrade = (input: LensRecordInput): Array<{ role: AnalystRole; line: string }> => {
    const { analysis, outcome } = input;
    if (!analysis) return [];
    const coin = (analysis.coinName || 'unknown').replace(/USDT?$/i, '').toUpperCase();
    const direction = analysis.direction === 'Neutral' ? 'no-trade' : analysis.direction.toLowerCase();
    const entry = short(analysis.entryPoints?.[0]?.price);
    const stop = short(analysis.stopLoss);
    const target = short(analysis.takeProfit?.[0]?.price);
    const rr = input.plannedRr ?? (Number.isFinite(analysis.rrRatio) ? analysis.rrRatio : undefined);
    const tape = input.tapeAgreed === false ? ' · tape disagreed with the stated outcome' : '';

    const lines: Array<{ role: AnalystRole; line: string }> = [];

    // MACRO — the regime the trade was taken in, and whether the regime held.
    // This is the seat that answers "should I even be looking at this coin".
    if (input.regime) {
        lines.push({
            role: AnalystRole.MACRO_VOLATILITY,
            line: `${coin} ${input.regime}: ${direction} ${entry} → ${target}, stop ${stop}, closed ${outcome}${tape}`,
        });
    }

    // TECHNICAL — the shape of the plan and whether that shape worked. This is
    // the seat that answers "does this pattern actually pay on this coin".
    lines.push({
        role: AnalystRole.TECHNICAL_ANALYST,
        line: `${coin} ${direction} entry ${entry} / stop ${stop} / first target ${target}`
            + `${rr ? ` (planned ${fmtRiskReward(rr, 1)})` : ''} closed ${outcome}${tape}`,
    });

    // RISK — the sizing verdict and the plan's own risk boundary, which is what
    // the risk seat reasons about on the next trade of the same family.
    const declaredRr = analysis.rrRatio;
    if (input.riskVeto) {
        lines.push({
            role: AnalystRole.RISK_EXECUTION,
            line: `${coin} ${direction} was vetoed before entry (${input.riskVeto}) and closed ${outcome} — the veto did not cost a real loss here`,
        });
    } else if (typeof declaredRr === 'number' && declaredRr > 0) {
        lines.push({
            role: AnalystRole.RISK_EXECUTION,
            line: `${coin} ${direction} took ${fmtRiskReward(declaredRr, 1)} planned risk (stop ${stop}) and closed ${outcome}${tape}`,
        });
    }

    return lines;
};

/** Write the per-seat lines for one closed trade. Best-effort, never throws. */
export const recordLensMemoryForTrade = async (input: LensRecordInput): Promise<void> => {
    if (!input.username) return;
    const lines = lensLinesForTrade(input);
    for (const { role, line } of lines) {
        try {
            await appendLensMemoryLine(role, line, input.username);
        } catch (error) {
            // A seat's personal record is an enhancement. It must never turn a
            // completed post-mortem into a failure — the same rule the memory
            // side-effects below it follow.
            console.warn('[LensMemory] Could not record the seat line:', error);
        }
    }
};

/** Convenience adapter for the post-mortem call site. */
export const recordLensMemoryFromTrade = async (
    trade: Pick<LoggedTrade, 'outcome' | 'analysis'>,
    extra: { username: string; regime?: string; tapeAgreed?: boolean; riskVeto?: string },
): Promise<void> => {
    const outcome: 'WIN' | 'LOSS' = trade.outcome === 'WIN' ? 'WIN' : 'LOSS';
    await recordLensMemoryForTrade({
        analysis: trade.analysis,
        outcome,
        username: extra.username,
        regime: extra.regime,
        tapeAgreed: extra.tapeAgreed,
        riskVeto: extra.riskVeto ?? trade.analysis?.riskVeto,
        plannedRr: trade.analysis ? plannedRiskReward({
            entry: parsePrice(trade.analysis.entryPoints?.[0]?.price ?? ''),
            stopLoss: parsePrice(trade.analysis.stopLoss ?? ''),
            takeProfits: (trade.analysis.takeProfit ?? []).map(tp => parsePrice(tp.price)),
        }) : undefined,
    });
};

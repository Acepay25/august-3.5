/**
 * planReplay — would today's deterministic code grade yesterday's plan the
 * same way?
 *
 * This is the measurement instrument for the plan-object / ratio / cost
 * changes. It is READ-ONLY over a journal export, needs no provider, and
 * re-derives every number through the SAME `buildTradePlan` the live card and
 * journal use. A copy of the arithmetic here would answer a different
 * question: "would a second implementation agree with itself?"
 *
 * It reports drift, it does not fix it. A row with no stored gate is counted
 * as `unstamped` rather than as drift — absence of a measurement is not a
 * disagreement with one.
 */

import type { LoggedTrade } from '../types';
import { parsePrice } from './analysisUtils';
import { buildTradePlan, type TradeProposal } from '../services/trade/proposedTrade';

export interface ReplayDrift {
    tradeId: string;
    symbol: string;
    fields: Array<'rr' | 'confidence' | 'probability'>;
    recorded: { rr?: number; confidence?: string; probability?: number };
    replayed: { rr: number; confidence: string; probability: number };
    detail: string;
}

export interface ReplayReport {
    total: number;
    compared: number;
    /** Rows with no usable levels / direction — nothing to replay. */
    skipped: number;
    /** Rows with no stored gate: their recorded probability may predate the
     *  current builder, so only ratio/confidence are compared. */
    unstamped: number;
    drift: ReplayDrift[];
    counts: { rr: number; confidence: number; probability: number };
}

const num = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
};

/** Rebuild the model's proposal from the stored analysis. The app's levels are
 *  the only inputs; everything else is derived. */
export const proposalFromTrade = (trade: LoggedTrade): TradeProposal | null => {
    const a = trade.analysis;
    if (!a || (a.direction !== 'Long' && a.direction !== 'Short')) return null;
    const entry = parsePrice(a.entryPoints?.[0]?.price || '');
    const stopLoss = parsePrice(a.stopLoss || '');
    const takeProfits = (a.takeProfit ?? [])
        .map(tp => parsePrice(tp.price))
        .filter(n => Number.isFinite(n) && n > 0);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0 || takeProfits.length === 0) {
        return null;
    }
    const confidence = a.confidence === 'High' || a.confidence === 'Medium' || a.confidence === 'Low'
        ? a.confidence
        : 'Medium';
    return {
        symbol: a.coinName || trade.id,
        direction: a.direction,
        entry,
        stopLoss,
        takeProfits,
        confidence,
        ...(a.gate ? { gate: a.gate } : {}),
        planId: trade.planId,
    };
};

export const replayTrades = (trades: LoggedTrade[]): ReplayReport => {
    const report: ReplayReport = {
        total: trades.length,
        compared: 0,
        skipped: 0,
        unstamped: 0,
        drift: [],
        counts: { rr: 0, confidence: 0, probability: 0 },
    };
    for (const trade of trades) {
        const proposal = proposalFromTrade(trade);
        if (!proposal) {
            report.skipped += 1;
            continue;
        }
        const plan = buildTradePlan(proposal);
        const recordedRr = num(trade.analysis.rrRatio);
        const recordedProbability = num(trade.analysis.probability);
        const recordedConfidence = trade.analysis.confidence;
        const fields: ReplayDrift['fields'] = [];

        if (recordedRr !== undefined && Math.abs(recordedRr - plan.plannedRr) > 0.02) fields.push('rr');
        if (recordedConfidence && recordedConfidence !== plan.confidence) fields.push('confidence');
        if (proposal.gate && recordedProbability !== undefined
            && Math.abs(recordedProbability - plan.probability) > 0.5) {
            fields.push('probability');
        }
        if (!proposal.gate) report.unstamped += 1;
        report.compared += 1;
        if (fields.length === 0) continue;
        for (const field of fields) report.counts[field] += 1;
        report.drift.push({
            tradeId: trade.id,
            symbol: proposal.symbol,
            fields,
            recorded: {
                ...(recordedRr !== undefined ? { rr: recordedRr } : {}),
                ...(recordedConfidence ? { confidence: recordedConfidence } : {}),
                ...(recordedProbability !== undefined ? { probability: recordedProbability } : {}),
            },
            replayed: {
                rr: plan.plannedRr,
                confidence: plan.confidence,
                probability: plan.probability,
            },
            detail: `recorded ${fields.map(f => f === 'rr' ? `R:R ${recordedRr}` : f === 'confidence' ? recordedConfidence : `${recordedProbability}%`).join(', ')}`
                + ` / replayed R:R ${plan.plannedRr}, ${plan.confidence}, ${plan.probability}%`,
        });
    }
    return report;
};

/** The one-line summary a CI artifact carries. */
export const replaySummaryLine = (report: ReplayReport): string =>
    `replay: ${report.compared}/${report.total} compared · ${report.drift.length} drifted`
    + ` (rr ${report.counts.rr}, confidence ${report.counts.confidence}, probability ${report.counts.probability})`
    + ` · ${report.unstamped} unstamped · ${report.skipped} skipped`;

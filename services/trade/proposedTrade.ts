/**
 * proposedTrade — the shape a Chart AI model emits when it PRESENTS a trade
 * (entry / stop / targets), and the bridge that turns an accepted proposal
 * into a PENDING journal trade.
 *
 * The point of building a real `TradeAnalysis` here (rather than a bespoke
 * "open trade" type) is reuse: the existing outcome autopilot
 * (`useWatchAndAutopilot` → `OutcomeAutopilotService.register`) already
 * watches any message whose `outcome === PENDING` and whose analysis has a
 * Long/Short direction, an entry and a stop — then detects the SL/TP touch and
 * records the settled outcome. So "Log this trade" only has to append a PENDING
 * analysis message and the autopilot takes over unchanged.
 *
 * The post-mortem this file used to name as the loop's next step was deleted
 * (2026-10-18) — a logged trade now settles into the journal and stops there.
 * Pure + dependency-free (bar the shared clamp helpers) so it is unit-tested.
 */

import { TradeAnalysis, TradeOutcome, Message, MessageRole, type ProposalGate } from '../../types';
import { baseOf, quoteOf } from '../../utils/symbol';
import { plannedRiskReward } from '../../utils/riskReward';
import { clampProbabilityToGate, downgradeConfidenceForProbability } from '../../utils/analysisUtils';

/** Re-exported so existing importers keep one name for it; the definition lives
 *  in `types/analysis.ts`, because a stamped value has to survive onto a
 *  persisted journal row. */
export type { ProposalGate };

/** A structured trade the model puts on the table for the user to accept. */
export interface TradeProposal {
    symbol: string;
    direction: 'Long' | 'Short';
    entry: number;
    stopLoss: number;
    takeProfits: number[];
    confidence?: 'High' | 'Medium' | 'Low';
    rationale?: string;
    invalidation?: string;
    /** Which model / session presented it — carried onto the trade for
     *  attribution so the model-performance ledger can credit/debit it. */
    proposedBy?: string;
    /** The gate that bound this plan at present time. Absent only on proposals
     *  recorded before the stamp existed — never on a fresh present_trade call. */
    gate?: ProposalGate;
    /** Stable plan id the DOCK generates when the proposal is presented
     *  (not the model): the harness level-watch arms on it and its level
     *  ids (`${planId}:ENTRY|:SL|:TP1..N`), and it rides onto the logged
     *  message so plan, warning and journal row stay the same object. */
    planId?: string;
}

const CONFIDENCE_PROBABILITY: Record<'High' | 'Medium' | 'Low', number> = {
    High: 72, Medium: 58, Low: 44,
};

/** Reward:risk from the first target vs the stop, sign-correct for direction.
 *  Delegates to the single planned-R:R definition — the old version read
 *  `takeProfits[0]`, so a model emitting targets out of order quoted the
 *  FARTHEST target as the nearest one. */
export const computeRrRatio = (p: Pick<TradeProposal, 'direction' | 'entry' | 'stopLoss' | 'takeProfits'>): number =>
    plannedRiskReward({ entry: p.entry, stopLoss: p.stopLoss, takeProfits: p.takeProfits });

/** Validate + normalize the model's raw tool arguments into a proposal, or
 *  return the reason it is unusable (the tool surfaces this to the model). */
export const parseTradeProposal = (args: Record<string, unknown>): { proposal?: TradeProposal; error?: string } => {
    const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const direction = args.direction === 'Short' ? 'Short' : args.direction === 'Long' ? 'Long' : null;
    if (!direction) return { error: 'direction must be "Long" or "Short"' };
    const entry = num(args.entry);
    const stopLoss = num(args.stopLoss);
    if (entry === null) return { error: 'entry price is required' };
    if (stopLoss === null) return { error: 'stopLoss price is required' };
    const takeProfits = Array.isArray(args.takeProfits)
        ? args.takeProfits.map(num).filter((n): n is number => n !== null).slice(0, 5)
        : [];
    if (takeProfits.length === 0) return { error: 'at least one takeProfits price is required' };
    // A long must stop below entry and target above it (and vice versa) — a
    // backwards plan is a model slip, not a trade.
    if (direction === 'Long' && (stopLoss >= entry || takeProfits.some(tp => tp <= entry))) {
        return { error: 'for a Long, the stop must sit below entry and every target above it' };
    }
    if (direction === 'Short' && (stopLoss <= entry || takeProfits.some(tp => tp >= entry))) {
        return { error: 'for a Short, the stop must sit above entry and every target below it' };
    }
    const confidence = args.confidence === 'High' || args.confidence === 'Medium' || args.confidence === 'Low'
        ? args.confidence : 'Medium';
    // SYMBOL DOCTRINE (utils/symbol, PR#5): models routinely answer with a bare
    // base ("BTC"). Storing it verbatim armed the harness level-watch under
    // 'BTC' — tick('BTCUSDT') never matches, fetchMarkPrice('BTC') 400s on
    // every 5s poll forever (plans have no expiry), and disarmSymbol('BTCUSDT')
    // can't remove it. Normalize at the PARSE site to the canonical full
    // futures form (base + quote, bare base defaults to USDT): 'BTC' and
    // 'BTC/USDT' both arm as 'BTCUSDT'; a canonical input is unchanged.
    const rawSymbol = String(args.symbol ?? '').trim();
    return {
        proposal: {
            symbol: rawSymbol ? `${baseOf(rawSymbol)}${quoteOf(rawSymbol)}` : 'BTCUSDT',
            direction, entry, stopLoss, takeProfits, confidence,
            rationale: typeof args.rationale === 'string' ? args.rationale.slice(0, 600) : undefined,
            invalidation: typeof args.invalidation === 'string' ? args.invalidation.slice(0, 300) : undefined,
            proposedBy: typeof args.proposedBy === 'string' ? args.proposedBy.slice(0, 60) : undefined,
        },
    };
};

/** Build the minimal-but-valid TradeAnalysis the autopilot + journal expect.
 *
 *  The gate cap binds HERE, at the one place a confidence WORD becomes a number:
 *  a plan stamped `evaluated` with a 0.50 cap cannot reach the journal as 72%,
 *  and a plan whose gate could not run is recorded UNCAPPED with a warning
 *  rather than quietly measured zero. Same helper as the pipeline's finalizer, so
 *  a presented plan and an analysed one are clamped by one rule, not two.
 *
 *  No stamp at all is also recorded, not hidden: every log path awaits
 *  `ensureStamp` first, so an unstamped row here means a caller skipped it. */
export const buildProposedTradeAnalysis = (p: TradeProposal, createdAt = new Date().toISOString()): TradeAnalysis => {
    const rr = computeRrRatio(p);
    let confidence: 'High' | 'Medium' | 'Low' = p.confidence ?? 'Medium';
    let probability = CONFIDENCE_PROBABILITY[confidence];
    const validationWarnings: string[] = [];

    if (p.gate?.status === 'evaluated') {
        const clamp = clampProbabilityToGate(probability, p.gate.confidenceCap, rr);
        if (clamp.wasClamped) {
            probability = clamp.probability;
            // The shared rule returns the full label union because a PIPELINE
            // verdict can carry 'Avoid'. A proposal cannot (parseTradeProposal
            // admits three tiers) and the rule cannot produce it, so this arm
            // exists only to keep one helper for both callers.
            const next = downgradeConfidenceForProbability(clamp.probability, confidence);
            confidence = next === 'Avoid' ? confidence : next;
            validationWarnings.push(`Gate enforcement: ${clamp.reason}`);
        }
    } else if (p.gate?.status === 'unavailable') {
        validationWarnings.push(`Gate unavailable — this plan is UNCAPPED (${p.gate.reason})`);
    } else {
        validationWarnings.push('Gate never ran for this plan — logged UNCAPPED');
    }

    return {
        coinName: p.symbol,
        direction: p.direction,
        confidence,
        probability,
        strategy: 'Chart AI proposal',
        activeStrategies: [],
        entryPoints: [{ description: p.proposedBy ? `Proposed by ${p.proposedBy}` : 'Chart AI proposal', price: String(p.entry) }],
        stopLoss: String(p.stopLoss),
        takeProfit: p.takeProfits.map(tp => ({ price: String(tp) })),
        marketConditions: {
            pattern: '—', candleBehavior: '—', timeframeAlignment: '—', rsi: '—', macd: '—', sentiment: '—',
        },
        historicalCorrelation: p.rationale ? `Chart AI: ${p.rationale}` : 'Proposed from the live chart in Chart AI.',
        createdAt,
        rrRatio: rr,
        ...(p.gate ? { gate: p.gate } : {}),
        ...(validationWarnings.length > 0 ? { validationWarnings } : {}),
    };
};

/** The PENDING message "Log this trade" appends to the conversation — the
 *  autopilot picks it up by id and drives the SL/TP detection.
 *
 *  A RECEIPT, not a second report: the entry/stop/target/probability numbers
 *  this plan is made of are already carried by the decision card (the answer's
 *  own card on this surface, the proposal card in the dock) and by the journal
 *  row this receipt becomes. Restating them here printed the same four numbers
 *  twice in one turn — once in prose, once under a card that labels them — so
 *  the text names the plan (direction, symbol, plan id) and stops there. */
export const buildProposedTradeMessage = (p: TradeProposal, id: string): Message => ({
    id,
    role: MessageRole.AI,
    text: `Logged from Chart AI — ${p.direction} ${p.symbol}${p.planId ? ` · plan ${p.planId}` : ''}`,
    createdAt: new Date().toISOString(),
    analysis: buildProposedTradeAnalysis(p),
    outcome: TradeOutcome.PENDING,
    isDebating: false,
    // The headline carries the plan id for the reader; the FIELD carries it for
    // the journal row and the dedupe, so neither has to re-parse prose.
    ...(p.planId ? { planId: p.planId } : {}),
});

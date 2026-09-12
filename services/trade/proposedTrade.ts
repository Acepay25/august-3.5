/**
 * proposedTrade — the shape a Chart AI model emits when it PRESENTS a trade
 * (entry / stop / targets), and the bridge that turns an accepted proposal
 * into a PENDING journal trade.
 *
 * The point of building a real `TradeAnalysis` here (rather than a bespoke
 * "open trade" type) is reuse: the existing outcome autopilot
 * (`useWatchAndAutopilot` → `OutcomeAutopilotService.register`) already
 * watches any message whose `outcome === PENDING` and whose analysis has a
 * Long/Short direction, an entry and a stop — then auto-detects the SL/TP
 * touch and runs the full post-mortem → skill-learning loop. So "Log this
 * trade" only has to append a PENDING analysis message and the whole learning
 * pipeline takes over unchanged. Pure + dependency-free so it is unit-tested.
 */

import { TradeAnalysis, TradeOutcome, Message, MessageRole } from '../../types';

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
    /** Stable plan id the DOCK generates when the proposal is presented
     *  (not the model): the harness level-watch arms on it and its level
     *  ids (`${planId}:ENTRY|:SL|:TP1..N`), and it rides onto the logged
     *  message so plan, warning and journal row stay the same object. */
    planId?: string;
}

const CONFIDENCE_PROBABILITY: Record<'High' | 'Medium' | 'Low', number> = {
    High: 72, Medium: 58, Low: 44,
};

/** Reward:risk from the first target vs the stop, sign-correct for direction. */
export const computeRrRatio = (p: Pick<TradeProposal, 'direction' | 'entry' | 'stopLoss' | 'takeProfits'>): number => {
    const risk = Math.abs(p.entry - p.stopLoss);
    if (risk === 0 || p.takeProfits.length === 0) return 0;
    const reward = Math.abs(p.takeProfits[0] - p.entry);
    return Math.round((reward / risk) * 100) / 100;
};

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
    return {
        proposal: {
            symbol: String(args.symbol ?? '').toUpperCase() || 'BTCUSDT',
            direction, entry, stopLoss, takeProfits, confidence,
            rationale: typeof args.rationale === 'string' ? args.rationale.slice(0, 600) : undefined,
            invalidation: typeof args.invalidation === 'string' ? args.invalidation.slice(0, 300) : undefined,
            proposedBy: typeof args.proposedBy === 'string' ? args.proposedBy.slice(0, 60) : undefined,
        },
    };
};

/** Build the minimal-but-valid TradeAnalysis the autopilot + journal expect. */
export const buildProposedTradeAnalysis = (p: TradeProposal, createdAt = new Date().toISOString()): TradeAnalysis => ({
    coinName: p.symbol,
    direction: p.direction,
    confidence: p.confidence ?? 'Medium',
    probability: CONFIDENCE_PROBABILITY[p.confidence ?? 'Medium'],
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
    rrRatio: computeRrRatio(p),
});

/** The PENDING message "Log this trade" appends to the conversation — the
 *  autopilot picks it up by id and drives the SL/TP detection + post-mortem. */
export const buildProposedTradeMessage = (p: TradeProposal, id: string): Message => ({
    id,
    role: MessageRole.AI,
    text: `Logged from Chart AI — ${p.direction} ${p.symbol} @ ${p.entry}, SL ${p.stopLoss}, TP ${p.takeProfits.join(' / ')}${p.planId ? ` · plan ${p.planId}` : ''}${p.rationale ? `\n\n${p.rationale}` : ''}`,
    createdAt: new Date().toISOString(),
    analysis: buildProposedTradeAnalysis(p),
    outcome: TradeOutcome.PENDING,
    isDebating: false,
});

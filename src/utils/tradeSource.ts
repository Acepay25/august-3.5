/**
 * Trade provenance — where a journal row came from.
 *
 * Staged on purpose (owner ruling 2026-10-29): the field lands now, and the
 * signal fold will be the first reader that acts on it. `imported` history is
 * user behaviour and must never confirm a playbook; `signal` is reserved for
 * the tape-resolved ledger. Nothing filters on it yet — that is the point of
 * this step, so the field exists before the behavior that needs it.
 */

import type { TradeSource } from '../types/trade';

/** A legacy row (no field) is a manual row: that is what every pre-field row
 *  was, and inventing a different default would relabel history. */
export const normalizeTradeSource = (trade: { source?: TradeSource }): TradeSource =>
    trade.source ?? 'manual';

/** One normalizer for every load path, so a restored backup cannot leave half
 *  the journal with an undefined source. */
export const withTradeSource = <T extends { source?: TradeSource }>(trade: T): T & { source: TradeSource } => ({
    ...trade,
    source: normalizeTradeSource(trade),
});

/**
 * Setup watches — price-triggered re-debates ("watch this setup").
 *
 * A watch attaches a price trigger to a completed analysis message. When the
 * trigger condition is met, the watch fires (once) and the app launches a
 * fresh debate for the same setup, with the previous verdict as context.
 * Transient state is stored on the watch itself; the watch list is persisted
 * via Preferences so armed watches survive restarts.
 */

/** What condition on the symbol's price arms the re-debate. */
export type SetupWatchTriggerType = 'PRICE_ABOVE' | 'PRICE_BELOW' | 'PCT_MOVE' | 'INVALIDATION';

export type SetupWatchStatus = 'ARMED' | 'TRIGGERED' | 'CANCELED';

export interface SetupWatch {
  id: string;
  /** The analysis message this watch is attached to (re-debate target). */
  messageId: string;
  coinName: string;
  /** Normalized Binance symbol, e.g. BTCUSDT. */
  symbol: string;
  triggerType: SetupWatchTriggerType;
  /** Trigger level (USDT) for PRICE_ABOVE / PRICE_BELOW. */
  priceLevel?: number;
  /** Trigger distance (percent, 2 = 2%) for PCT_MOVE. */
  percent?: number;
  /** Price at watch creation — baseline for PCT_MOVE. */
  referencePrice: number;
  /** Used by INVALIDATION: Long fires on a break below the level. */
  direction?: 'Long' | 'Short' | 'Neutral';
  status: SetupWatchStatus;
  createdAt: string;
  triggeredAt?: string;
  /** How many times the watch has fired (fire-once by default → max 1). */
  triggerCount: number;
}

/** Payload delivered to subscribers when an armed watch fires. */
export interface SetupWatchTriggerEvent {
  watch: SetupWatch;
  currentPrice: number;
}

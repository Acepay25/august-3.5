/**
 * Shared market-data contract for the August harness.
 *
 * Keep this list in one place. Prompt text, GateKeeper, and hybrid payloads
 * must describe the same data or models will reason about timeframes they did
 * not actually receive.
 */
export const HARNESS_TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;

export type HarnessTimeframe = typeof HARNESS_TIMEFRAMES[number];

export const HARNESS_TIMEFRAME_LABEL = '15m / 1h / 4h / 1d';

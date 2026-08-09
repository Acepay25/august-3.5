/**
 * Lightweight-charts-compatible point types.
 *
 * The app only ever used `lightweight-charts` for its TypeScript types
 * (CandlestickData / Time / LineData) — the charting component was swapped out
 * long ago and `createChart` was never called. These are the two shapes the
 * app actually produces, inlined so the dead dependency can be dropped.
 */

/** Candle timestamp in seconds (lightweight-charts `Time`). */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Single trendline anchor point (lightweight-charts `LineData`). */
export interface ChartLinePoint {
  time: number;
  value: number;
}

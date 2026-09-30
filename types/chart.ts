/**
 * Lightweight-charts-compatible point types.
 *
 * `lightweight-charts` is a LIVE runtime dependency (^5.2.1) and the chart it
 * draws is the product: `createChart` is called in TradingChart, which paints
 * the candles, the order book overlay and every model drawing.
 *
 * An earlier version of this comment claimed the opposite — that the charting
 * component had been swapped out, that the library's chart constructor was
 * never called, and that the dependency could be dropped. All three were false,
 * and the false claim was the dangerous kind: acting on it would have deleted
 * the library rendering the user's chart. (Those sentences are paraphrased
 * rather than quoted, so a documentation-truth guard checking for the old
 * wording is not satisfied by this file explaining what it replaced.) These
 * structural types are kept separate from the chart's own view types on
 * purpose, because the desk, the journal and the model-facing code all pass
 * plain candle/point shapes around; they are not a vendored copy of the
 * library's types.
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

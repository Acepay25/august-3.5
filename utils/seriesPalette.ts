/**
 * Fixed series palette for multi-series charts (per-model equity lines,
 * per-seat comparisons, …).
 *
 * Two rules, both stolen from better chart code:
 *  • FIXED — series N always wears color N, on every chart, so a line
 *    keeps its identity across the dashboard instead of re-shuffling per
 *    render.
 *  • RED/GREEN ARE RESERVED — rose/red means LOSS and emerald/green means
 *    WIN on every status surface in this app. A chart series must never
 *    borrow them (an ordinary model rendered in the loss color reads as a
 *    verdict). Teal is excluded too — at 2px it reads as green.
 *
 * Colors are positional, never derived from provider ids: providers are
 * user-configured, so no color can hint at a brand.
 */
export const SERIES_PALETTE: readonly string[] = [
    '#818cf8', // indigo
    '#38bdf8', // sky
    '#fbbf24', // amber
    '#f472b6', // pink
    '#a78bfa', // violet
    '#22d3ee', // cyan
    '#fb923c', // orange
    '#a1a1aa', // zinc — the overflow slot stays neutral like the chrome
];

/** Stable color for series `index` (wraps, never goes out of range). */
export const seriesColor = (index: number): string =>
    SERIES_PALETTE[((index % SERIES_PALETTE.length) + SERIES_PALETTE.length) % SERIES_PALETTE.length];

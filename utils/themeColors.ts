/**
 * Reading a theme color from JavaScript.
 *
 * The chart libraries and raw canvases in this app cannot take a Tailwind
 * class — they want a plain color string. That used to mean either hardcoding
 * a hex or reaching into a component, and both were wrong for the same reason:
 * the hexes drifted out of the theme the moment anyone re-stepped a ramp.
 *
 * `chartColor` is the one reader. It resolves a `--color-*` custom property off
 * `:root` at CALL time, which matters: the style tag is injected by JS in dev,
 * so a module-scope read would capture the empty string and fall back forever.
 *
 * It lives here rather than in `components/trade/TradingChart.tsx` (where it
 * was born) because the dashboards need it too, and importing it from there
 * would pull the ~200 kB chart chunk into every dashboard bundle to get a
 * four-line function. `TradingChart` re-exports it, so existing callers and
 * `TradeView` are unaffected.
 *
 * The `fallback` is not a guess: it is the token's own palette value, used
 * when no CSS is loaded — unit tests and jsdom import no stylesheet, and the
 * first paint can beat the style chunk. A chart must never render "undefined".
 */

/** Resolve a `--color-*` token to a literal color string, with a safe fallback. */
export const chartColor = (token: string, fallback: string): string => {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        return v.length > 0 ? v : fallback;
    } catch { return fallback; }
};
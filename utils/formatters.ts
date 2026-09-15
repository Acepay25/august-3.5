/**
 * Shared primitive formatters — the canonical copies of what the 2026-09-15
 * dead-code sweep counted as "duplicated fmtPrice ×4, formatTime ×2".
 *
 * fmtPrice merges the two historical variants:
 *  · The desk variant (TradeView hero/strip, OrderBookPanel ladder — byte-
 *    identical copies): en-US fixed locale, 2 minimum decimals so mono/tabular
 *    columns keep their width, max 2 decimals ≥ $1000, else 4.
 *  · The screener variant (ScreenerPanel): locale-less toLocaleString (which
 *    silently localized separators per browser language — a drift risk against
 *    the en-US desk) with 6 decimals below $1.
 * The canonical rule takes the desk's fixed en-US + min-2 alignment and the
 * screener's sub-dollar precision: with the desk's old max-4, a sub-$0.01
 * perp (PEPE, SHIB) printed as "0.0000" on the ladder/hero — data destroyed.
 * Sites where output changes: sub-dollar desk prices gain real precision;
 * screener cells ≥$1 gain trailing ".00" and switch from user-locale to
 * en-US separators.
 *
 * NOT deduped here (peer-owned as of 2026-09-16): services/ui/
 * AutoCaptureService.ts's fmtPrice ('$'-prefixed display, a different
 * function) and the two formatTime copies — utils/analysisTrace.ts's
 * (ISO string → localized HH:MM:SS) and services/infrastructure/
 * SessionService.ts's (hour/minute → 'HH:MM' UTC clock pad). They share only
 * a name, not a body; folding them into this module needs an edit window on
 * those files.
 */

/**
 * Market price → en-US grouped string, precision scaled to magnitude:
 * ≥1000 → 2 decimals; 1–999.99 → up to 4; below 1 → up to 6. Always at
 * least 2 decimals so tabular columns line up. Non-finite input returns
 * '—' (call sites mostly guard already; this keeps stray NaN off the desk).
 */
export const fmtPrice = (n: number): string => {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6,
    });
};

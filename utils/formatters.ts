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

/**
 * Percent readout → `66.7%`. Takes the value ALREADY in percent units
 * (0–100), not a fraction — the ledger, the dashboards and the gate all
 * carry percents that way, and a helper that silently multiplied would
 * double-scale half of them.
 *
 * `digits` is a required argument on purpose. Percent precision used to be
 * whatever each call site happened to leave behind, so the same win rate
 * printed as `66.66666666666667%` in one panel and `67%` in another, and a
 * raw float reflows its own column every tick. Declaring the digit count at
 * the call site keeps the glyph width fixed (doctrine: digits may change
 * while streaming, width may not). House standard: win rates 0, P&L 1,
 * spread 3, funding 4.
 *
 * Not for Brier scores — those are 0–1 probabilities rendered without a
 * percent sign, and this appends one.
 */
export const fmtPercent = (n: number, digits: number): string =>
    Number.isFinite(n)
        ? `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
        : '—';

/**
 * Notional volume — 24h quote volume, open interest — as $B / $M / $K. One
 * home, because this arithmetic lived inside a view file, which is how two
 * panels end up disagreeing about what the same number rounds to.
 */
export const fmtUsd = (n: number): string =>
    n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B`
        : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
            : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K`
                : `$${n.toFixed(2)}`;

/**
 * symbol — the ONE place a trading symbol is understood.
 *
 * The audits flagged ~50 ad-hoc `replace(/USDT|USD|PERP/gi, '')` sites as the
 * single biggest silent-mismatch class: the UN-ANCHORED variants strip "USD"
 * ANYWHERE, so the stablecoin symbol "USDC" parses to "C" and "USDCUSDT" to
 * "CUSDT" — mis-joining skill/trade/coin memory against the wrong asset.
 *
 * These helpers are anchored (they only ever remove a trailing quote token,
 * longest-first) and side-effect-free, so every consumer derives the SAME base
 * from the SAME symbol.
 */

/** Quote/venue suffixes, LONGEST FIRST so a trailing 'USDT' is never
 *  half-stripped by the shorter 'USD'/'USDS' alternatives. */
export const QUOTE_SUFFIXES = [
    'FDUSD', 'USDS', 'USDC', 'USDT', 'TUSD', 'BUSD', 'BUSDT', 'USDD', 'PERP', 'USD',
] as const;

/** Canonical uppercase symbol with any non-alphanumeric separators removed. */
export const fullSymbol = (input: string): string =>
    (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Remove ONE trailing quote token. May return '' when the input is itself a
 * bare quote (e.g. "USD") — callers that want that "not a base" signal
 * (symbol detection from free text) rely on it; use `baseOf` for the
 * keep-whole fallback instead.
 */
export const stripQuoteSuffix = (input: string): string => {
    const s = fullSymbol(input);
    for (const q of QUOTE_SUFFIXES) {
        if (s.endsWith(q)) return s.slice(0, s.length - q.length);
    }
    return s;
};

/**
 * Base asset of a pair — never mangles a bare stablecoin: "USDC" stays "USDC"
 * (not "C"), "USDCUSDT" → "USDC", "BTCUSDT" → "BTC".
 */
export const baseOf = (input: string): string => {
    const s = fullSymbol(input);
    const stripped = stripQuoteSuffix(s);
    // A strip that ate the whole token meant it WAS a quote — keep it intact.
    return stripped.length > 0 ? stripped : s;
};

/** Trailing quote token, defaulting to USDT for a bare base ("BTC" → USDT). */
export const quoteOf = (input: string): string => {
    const s = fullSymbol(input);
    for (const q of QUOTE_SUFFIXES) if (s.endsWith(q) && s.length > q.length) return q;
    return 'USDT';
};

/** {base}/{quote} for display: "BTCUSDT" → "BTC/USDT"; a bare "BTC" → "BTC". */
export const display = (input: string): string => {
    const s = fullSymbol(input);
    for (const q of QUOTE_SUFFIXES) {
        if (s.endsWith(q) && s.length > q.length) return `${s.slice(0, s.length - q.length)}/${q}`;
    }
    return s;
};

export interface ParsedSymbol { full: string; base: string; quote: string }

/** One structured read of a symbol for code that needs base + quote together. */
export const parseSymbol = (input: string): ParsedSymbol => ({
    full: fullSymbol(input),
    base: baseOf(input),
    quote: quoteOf(input),
});

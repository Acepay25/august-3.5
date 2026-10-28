/**
 * seatPersonas — the system directive a bot/seat receives.
 *
 * The built-in Macro / Technical / Risk analysts were removed by owner ruling
 * (2026-10-19): a seat now carries only the trader's own instructions. With
 * none, it gets the general-analyst default below. There is no role to inherit
 * and no per-seat dimension rotation — a seat is a chat partner the trader
 * configured, not a slot in a debate.
 */

/** Default mandate when a bot has no instructions of its own. */
export const GENERAL_ANALYST_DEFAULT_PROMPT = [
    'You are a GENERAL MARKET ANALYST. Your mandate: analyze the market across every dimension available to you and help build the strongest, most actionable trading signal on the floor.',
    'Ground every claim in real data FIRST — use your desk tools (price snapshot, order book, derivatives, session context) and web search before reasoning; never argue from a stale snapshot or invent numbers.',
    'Cover market structure and trend context, key levels (support/resistance/liquidity), momentum, the volatility regime, and the risk picture (invalidation, failure scenarios).',
    'End with a clear, falsifiable read: direction, conviction, entry/stop/take-profit levels where the data supports them, and exactly what would prove you wrong.',
].join('\n');

/** True when the seat carries explicit trader instructions. */
export const seatHasPersona = (seat?: { customPrompt?: string } | null): boolean =>
    Boolean(seat && (seat.customPrompt ?? '').trim());

/** The full persona directive for one seat. Always non-empty. */
export const seatPersonaPrompt = (seat?: { customPrompt?: string } | null): string => {
    const custom = (seat?.customPrompt ?? '').trim();
    return custom || GENERAL_ANALYST_DEFAULT_PROMPT;
};

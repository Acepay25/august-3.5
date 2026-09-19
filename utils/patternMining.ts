/**
 * Setup mining, shared by the chart pipeline and the bots (WS-3.1).
 *
 * Both need the same coin/family/direction out of a user prompt at a moment
 * when no analysis exists yet. The rules lived in
 * hooks/analysisPipeline/memoryContext.ts, which the agents layer must not
 * import, and services/agents/botLearning.ts forked the coin regex — so bots
 * retrieved on a strictly weaker query than the analysts sitting next to them.
 * One copy here, imported by both.
 */

import { COMMON_WORDS } from '../constants/commonWords';

/** 'BTCUSDT' / 'BTC/USDT' / 'ETH' → 'BTC' / 'ETH'; undefined when the match is
 *  an ordinary English word rather than a ticker. */
export const mineCoinFromPrompt = (prompt: string): string | undefined => {
    const raw = prompt.match(/\b([A-Z]{2,10})(?:USDT?)?/)?.[1]?.toUpperCase();
    if (!raw || COMMON_WORDS.includes(raw)) return undefined;
    return raw;
};

/** Pattern-family keyword mining — runs at SEND time so retrieval has a family
 *  before the AI analysis completes (there is no analysis yet at send time).
 *  Falls back to undefined when no keyword matches. */
export const minePatternFromPrompt = (prompt: string): string | undefined => {
    const p = prompt.toUpperCase();
    if (p.includes('FAMILY A') || p.includes('EXHAUSTION') || p.includes('TRAP') || p.includes('FAKEOUT')) return 'Family A';
    if (p.includes('FAMILY B') || p.includes('REVERSAL')) return 'Family B';
    if (p.includes('FAMILY C') || p.includes('CONTINUATION')) return 'Family C';
    if (p.includes('OMEGA') || p.includes('MOMENTUM')) return 'Family Omega';
    return undefined;
};

/** The direction the user asked about, or Neutral when they did not say. */
export const mineDirectionFromPrompt = (prompt: string): 'Long' | 'Short' | 'Neutral' => {
    const lower = prompt.toLowerCase();
    return lower.includes('long') ? 'Long' : lower.includes('short') ? 'Short' : 'Neutral';
};

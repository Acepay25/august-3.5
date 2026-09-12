/**
 * tradingTips — what the dock shows while a model is thinking. The old row
 * said "Thinking · Ns", which told the user nothing they didn't know; a
 * waiting trader might as well get something useful. The rotation is
 * deterministic per second-tick so re-renders never flicker the same tip
 * away, and every third slot is PERSONAL: a habit line drawn from the
 * trader's own learned memory (traderLearner / profileMemory) — the tips
 * get more specific the longer August works with you.
 */

import { getActiveUsername } from './activeUser';
import { listProfileMemories } from '../services/learning/profileMemory';

export const TRADING_TIPS: readonly string[] = [
    'Plan the trade before the trade: entry, stop, target — or it is not a plan.',
    'Risk a fixed fraction per idea; streaks, not single trades, are what ruin accounts.',
    'A stop is a price that proves the thesis wrong — place it there, not at a comfort number.',
    'Lower timeframes noise out higher-timeframe levels; check the 4h before trusting the 5m.',
    'Funding crowded long? Squeezes fuel on the other side.',
    'Open interest rising with price is fresh money; falling with price is just covering.',
    'Wait for the retest — the first breakout candle pays the worst entry.',
    'A pin bar means nothing mid-range; it matters at a tested level.',
    'Journal the reason you entered, not the result — results are one sample.',
    'Two losing stops in a row on one idea: the market is telling you the level is wrong.',
    'Size down when volatility doubles; your stop distance just did.',
    'Basis stretched to extremes = leverage is crowded; fades get violent.',
    'If you cannot say what invalidates the idea in one sentence, you do not have an idea.',
    'Breakout retests that hold on a CLOSE are entries; wicks through are traps.',
    'Move stops to break-even only after the first structure holds — not on hope.',
    'The best exit is the one your plan named before you entered.',
    'Three consecutive closes outside a band is a walk, not a fade.',
    'Weekend candles lie on thin liquidity — confirm on Monday volume.',
    'Track your R multiple, not your win rate; one runner pays for five scratches.',
    'Divergence needs a trigger candle; the divergence alone is a thesis, not an entry.',
    'Before adding to a loser, ask: would I open this position fresh right now?',
    'Sessions matter: Asia ranges, London sweeps, New York delivers — mostly.',
    'A zone drawn from wicks is a suggestion; a zone tested twice is a level.',
    'Cut the research after the plan — over-confirmation is how bias gets dressed as diligence.',
    'If the tape against you accelerates mid-trade, the plan is stale — re-price it.',
    'Average entry on winners only; averaging losers is a hobby, not a strategy.',
    'Keep a max daily loss and honor it; revenge trades cost double.',
    'When every timeframe agrees, the trade is crowded — expect a shakeout first.',
    'Write the post-mortem while the emotions are fresh; tomorrow-you will rationalize.',
    'One setup, traded hundreds of times, beats a hundred setups traded once.',
];

const personalLine = (username: string, i: number): string | null => {
    try {
        const habits = listProfileMemories(username)
            .filter(e => e.kind === 'user' || e.kind === 'feedback');
        if (habits.length === 0) return null;
        const pick = habits[Math.abs(i) % habits.length];
        return pick.description.replace(/\.$/, '') + '.';
    } catch {
        return null;
    }
};

/** The tip for rotation slot `i` — every third slot prefers a personal
 *  habit when the trader has any learned yet. */
export const nextTip = (username: string, i: number): string => {
    if (i > 0 && i % 3 === 2) {
        const personal = personalLine(username, Math.floor(i / 3));
        if (personal) return personal;
    }
    return TRADING_TIPS[((i % TRADING_TIPS.length) + TRADING_TIPS.length) % TRADING_TIPS.length];
};

/** A stable tip for a seed (e.g. the entry id) — placeholders that appear
 *  once per message pick one deterministic tip instead of flickering. */
export const tipForSeed = (seed: string, username = getActiveUsername()): string => {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) h = ((h * 31) + seed.charCodeAt(i)) | 0;
    return nextTip(username, Math.abs(h));
};

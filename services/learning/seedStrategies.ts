/**
 * Seed strategy corpus — book priors for the skill library.
 *
 * Distilled from the crypto-executable subset of Kakushadze & Serur,
 * "151 Trading Strategies" (SSRN 3247865). The book's 151 entries are mostly
 * institutional fixed-income/convertible/real-estate plays; what transfers to
 * a perps-and-candles harness is the ~12 archetypal procedures below, one per
 * strategy family the vocabulary actually supports. They give the learning
 * loop a PRIOR instead of a blank slate: each lands as a `candidate` skill
 * with `prior: book`, so retrieval injects it from birth (labeled as a prior,
 * not as earned evidence) and the existing adherence + worth-gate machinery
 * immediately starts testing whether it earns its keep on THIS trader's tape.
 * A seed that never wins its evidence battle retires like any other skill —
 * the corpus is a starting hypothesis set, not dogma.
 *
 * Idempotent: ensureSeedSkills creates only slugs that do not exist yet, so
 * user edits, retirements and graveyard moves are never overwritten.
 */

import { getMemoryFiles, ensureHarnessFolders, createMemoryFile } from './MemoryFilesService';
import { serializeSkill, type SkillMeta } from './SkillMemoryService';
import { StrategyFamily } from '../../types/strategy';

interface SeedSpec {
    slug: string;
    meta: SkillMeta;
    title: string;
}

const base = {
    status: 'candidate' as const,
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    tradeIds: [] as string[],
    prior: 'book' as const,
};

const seed = (
    slug: string,
    title: string,
    extra: Partial<SkillMeta> & { kind: SkillMeta['kind']; strategyFamily: StrategyFamily; body: string },
): SeedSpec => ({
    slug,
    title,
    meta: { ...base, ...extra },
});

export const SEED_SKILLS: SeedSpec[] = [
    seed('book-trend-pullback', 'Repeat: trend-following pullback entry', {
        kind: 'repeat',
        strategyFamily: 'trend_following',
        family: 'Family C',
        regime: 'trending',
        horizon: 'swing',
        direction: 'Long',
        signals: 'HTF trend intact (higher highs/lows), price pulls back to the 20–50 EMA or prior broken resistance now acting as support, momentum oscillator resets to neutral without breaking structure.',
        invalidation: 'Close below the pullback low or the HTF swing low; the trend thesis is dead, not the trade.',
        sizing: 'Risk a fixed fraction per entry; size down half when the pullback depth exceeds one ATR beyond the mean.',
        ifCondition: 'trending regime with a clean pullback into dynamic support',
        thenAction: 'enter with the trend, stop beyond the swing, trail after TP1',
        description: 'Trend-following pullback: join the established direction only at value, never at the extension.',
        body: '**Trigger:** HTF trend + pullback to 20–50 EMA / broken level.\n**Procedure:** Wait for the reset, enter on the first bullish close reclaiming the pullback range, stop below the swing low, take partials into the prior high, trail the rest.\n**Invalidates:** A close below the pullback low or loss of HTF structure.',
    }),
    seed('book-trend-ribbon', 'Repeat: EMA-ribbon continuation', {
        kind: 'repeat',
        strategyFamily: 'trend_following',
        family: 'Family C',
        regime: 'trending',
        horizon: 'position',
        signals: 'EMA 9 > 21 > 50 > 200 fanned out and expanding, price above all four, ADX rising above 20.',
        invalidation: 'Ribbon compression (EMAs converging) or a daily close inside the 21 EMA.',
        sizing: 'Scale in thirds on each new leg; never add after the ribbon has been extended more than two ATRs.',
        ifCondition: 'fully fanned EMA ribbon with rising ADX',
        thenAction: 'hold and scale with the trend; stand aside when the ribbon compresses',
        description: 'Multi-EMA ribbon continuation: trend strength is visible in the fanning, so entries follow the fan, not hope.',
        body: '**Trigger:** Fanned 9/21/50/200 EMAs with expanding gaps and rising ADX.\n**Procedure:** Enter on leg breaks, add on each new higher low, exit the whole position when the ribbon compresses.\n**Invalidates:** EMA convergence or a close inside the fast band.',
    }),
    seed('book-mr-exhaustion-fade', 'Repeat: exhaustion fade at stretched extremes', {
        kind: 'repeat',
        strategyFamily: 'mean_reversion',
        family: 'Family A',
        regime: 'volatile',
        horizon: 'intraday',
        direction: 'Short',
        signals: 'Parabolic stretch ≥3 ATR from the mean, RSI >80/<20, climax volume, and a reversal candle closing back inside the range.',
        invalidation: 'A new extreme beyond the climax high/low — the repricing is real; never fade a fundamental catalyst.',
        sizing: 'Half normal size; the fade is a counter-trend trade and the book says so.',
        ifCondition: 'climactic stretch with reversal confirmation',
        thenAction: 'fade toward the mean with a tight stop beyond the extreme',
        description: 'Mean-reversion exhaustion fade: sell the climax, not the trend — confirmation candle first.',
        body: '**Trigger:** ≥3 ATR stretch + RSI extreme + climax volume + reversal close.\n**Procedure:** Enter on the confirmation close, target the 21 EMA / VWAP, stop just beyond the wick.\n**Invalidates:** Any print beyond the climax extreme.',
    }),
    seed('book-mr-vwap-snapback', 'Repeat: VWAP deviation snapback', {
        kind: 'repeat',
        strategyFamily: 'mean_reversion',
        family: 'Family A',
        regime: 'ranging',
        horizon: 'scalp',
        signals: 'Price ≥2 standard deviations from session VWAP inside an otherwise balanced day, no trend on the HTF.',
        invalidation: 'Session trend day emerging (VWAP holding as support/resistance through retests).',
        sizing: 'Fixed small size; one re-entry maximum.',
        ifCondition: 'ranging session with a 2-sigma VWAP stretch',
        thenAction: 'fade back to VWAP and take full profit at the mean',
        description: 'VWAP snapback: in balanced sessions, extremes revert to the volume-weighted mean.',
        body: '**Trigger:** 2σ VWAP deviation, flat HTF.\n**Procedure:** Fade the stretch, exit at VWAP — do not hope for the other side.\n**Invalidates:** A trend-day character shift (VWAP retests holding).',
    }),
    seed('book-breakout-expansion', 'Repeat: compressed-range breakout with volume', {
        kind: 'repeat',
        strategyFamily: 'breakout',
        family: 'Family Omega',
        regime: 'compression',
        horizon: 'swing',
        signals: 'Multi-day range contraction (Bollinger squeeze / falling ATR), then a decisive close beyond the boundary on ≥1.5× average volume.',
        invalidation: 'A close back inside the range — a failed break is an exit, not a drawdown to endure.',
        sizing: 'Full size only on the volume-confirmed break; half size on the retest entry.',
        ifCondition: 'compression resolving into a volume-backed range break',
        thenAction: 'enter the expansion, stop inside the old range',
        description: 'Breakout expansion: volatility compression precedes expansion; trade the resolution with volume proof.',
        body: '**Trigger:** Squeeze + decisive boundary close on expanded volume.\n**Procedure:** Enter the break or its first retest, stop inside the range, ride with structure trailing.\n**Invalidates:** Any close back inside the broken range.',
    }),
    seed('book-avoid-thin-breakout', 'Avoid: chasing low-volume breaks', {
        kind: 'avoid',
        strategyFamily: 'breakout',
        family: 'Family Omega',
        regime: 'volatile',
        horizon: 'intraday',
        signals: 'Break of a level on flat or declining volume, especially into stretched RSI.',
        invalidation: 'None — this is an avoid rule; the exception is a volume surge that arrives WITH the break.',
        sizing: 'n/a',
        ifCondition: 'a range break without volume expansion behind it',
        thenAction: 'do not chase; wait for the retest or the fade',
        description: 'Thin breakouts fail disproportionately — volume must confirm the break before it is a trade.',
        body: '**Trigger:** Level break on ≤1× average volume.\n**Procedure:** Stand aside; mark the level for a retest entry only if volume arrives.\n**Invalidates:** A genuine volume expansion on the break candle.',
    }),
    seed('book-range-fade-boundaries', 'Repeat: fade the range boundaries', {
        kind: 'repeat',
        strategyFamily: 'range_fade',
        family: 'Family B',
        regime: 'ranging',
        horizon: 'intraday',
        signals: 'Established range (≥2 touches each side), price at the boundary, momentum diverging into the edge.',
        invalidation: 'A close beyond the boundary with volume — the range is over; the fade becomes a breakout trade.',
        sizing: 'Full size at the boundary, stop just outside; never widen into the middle.',
        ifCondition: 'tested range boundary with divergence into the edge',
        thenAction: 'fade toward the opposite side, exit before the far edge',
        description: 'Range fade: in no-trend regimes the boundary is the edge; sell resistance, buy support, take the middle.',
        body: '**Trigger:** Third+ touch of a horizontal boundary with fading momentum.\n**Procedure:** Fade at the edge, target the range midpoint-to-far-edge, stop outside the range.\n**Invalidates:** A voluminous close beyond the boundary.',
    }),
    seed('book-avoid-holding-fade-through-break', 'Avoid: holding a fade through a real break', {
        kind: 'avoid',
        strategyFamily: 'range_fade',
        family: 'Family B',
        regime: 'trending',
        horizon: 'intraday',
        signals: 'A fade position still open after price closes and holds beyond the range boundary.',
        invalidation: 'None — the stop IS the rule.',
        sizing: 'n/a',
        ifCondition: 'a range fade whose boundary just broke and held',
        thenAction: 'exit at the stop; do not average against the new trend',
        description: 'A broken range is a trend, not a wider range — averaging a fade through the break is the classic blowup.',
        body: '**Trigger:** Fade open + confirmed boundary break.\n**Procedure:** Honor the stop immediately; re-evaluate as a breakout trade, not a fade.\n**Invalidates:** A same-candle reclaim of the boundary.',
    }),
    seed('book-vol-squeeze', 'Repeat: volatility squeeze expansion play', {
        kind: 'repeat',
        strategyFamily: 'volatility',
        family: 'Family Omega',
        regime: 'compression',
        horizon: 'intraday',
        signals: 'Bollinger bands inside Keltner channel (squeeze), ATR at multi-week lows, funding flat — expansion is due in either direction.',
        invalidation: 'The squeeze persists another full session without a boundary test.',
        sizing: 'Straddle the resolution: half size on each boundary stop-order, cancel the loser.',
        ifCondition: 'a mature squeeze with ATR at the lows',
        thenAction: 'trade the expansion on the first boundary break, both directions armed',
        description: 'Volatility regime trade: low vol begets high vol; position for the expansion, not the direction.',
        body: '**Trigger:** Squeeze + ATR floor.\n**Procedure:** Armed entries above/below the coil, take the first expansion leg, exit into the second climax.\n**Invalidates:** Time — a squeeze that never resolves is a no-trade.',
    }),
    seed('book-funding-crowding', 'Repeat: fade crowded funding positioning', {
        kind: 'repeat',
        strategyFamily: 'volatility',
        family: 'Family A',
        regime: 'volatile',
        horizon: 'intraday',
        signals: 'Funding rate at multi-week extremes (longs paying hard) while price stalls at the highs — the crowd is on one side and the tape refuses to confirm.',
        invalidation: 'Funding normalizes without a price break (the crowd left quietly; no squeeze fuel).',
        sizing: 'Half size; the timing of a squeeze is unknowable even when the positioning is right.',
        ifCondition: 'extreme funding + stalling price at the extreme',
        thenAction: 'position for the squeeze move against the crowd with a wide-but-defined stop',
        description: 'Crowding fade: extreme funding marks one-sided positioning; price stall turns it into squeeze fuel.',
        body: '**Trigger:** Funding extreme + price stall at the high/low.\n**Procedure:** Enter against the crowd on the first structure break, target the liquidation pocket.\n**Invalidates:** Funding reset without a move.',
    }),
    seed('book-pairs-ratio-reversion', 'Repeat: ETH/BTC ratio reversion', {
        kind: 'repeat',
        strategyFamily: 'pairs_stat_arb',
        family: undefined,
        regime: 'ranging',
        horizon: 'swing',
        direction: 'Long',
        signals: 'ETH/BTC ratio stretched ≥2σ from its 90-day mean while BOTH legs trade in their own ranges — the dislocation is relative, not directional.',
        invalidation: 'A regime break in either leg (one asset trends while the other ranges) — the pair assumption is dead.',
        sizing: 'Equal notional both legs; the trade is the spread, never the beta.',
        ifCondition: 'ratio z-score ≥2 with both legs ranging',
        thenAction: 'trade the ratio back to the mean, hedged long/short the two legs',
        description: 'Pairs reversion: when the ratio stretches inside a stable market, trade the spread and hedge the direction.',
        body: '**Trigger:** Ratio ≥2σ stretched, both legs ranging.\n**Procedure:** Long the laggard / short the leader at equal notional, exit at the ratio mean.\n**Invalidates:** Either leg breaking its own range.',
    }),
    seed('book-basis-carry', 'Repeat: funding basis carry', {
        kind: 'repeat',
        strategyFamily: 'market_neutral',
        family: undefined,
        regime: 'trending',
        horizon: 'position',
        direction: 'Long',
        signals: 'Persistently high perp funding vs spot in a strong uptrend — short perp / long spot harvests the carry with near-zero delta.',
        invalidation: 'Funding flipping negative or the basis compressing below fee costs; a violent trend leg that forces the spot leg out.',
        sizing: 'Delta-neutral equal notional; this is a carry trade, size for the funding stream, not the price.',
        ifCondition: 'sustained positive funding with wide perp-spot basis',
        thenAction: 'run the delta-neutral carry until the basis compresses',
        description: 'Basis carry: harvest funding as market-neutral income while the crowd pays to stay long.',
        body: '**Trigger:** Funding sustained high, basis wide.\n**Procedure:** Long spot + short perp at equal size, roll until funding normalizes.\n**Invalidates:** Funding flip or basis below costs.',
    }),
];

/** True when a seed's skill file already exists (any state — the user may
 *  have edited, retired or graveyarded it; seeding must never resurrect). */
const seedExists = (slug: string): boolean =>
    getMemoryFiles().files.some(f => f.name.toLowerCase() === `${slug.toLowerCase()}.md`);

/**
 * Create any missing seed skills in the notebook's skills folder.
 * Idempotent and best-effort: boot telemetry must never break the app.
 * Returns the slugs actually created (for tests / logging).
 */
export const ensureSeedSkills = async (username: string): Promise<string[]> => {
    try {
        await ensureHarnessFolders(username);
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
        if (!folder) return [];
        const created: string[] = [];
        for (const spec of SEED_SKILLS) {
            if (seedExists(spec.slug)) continue;
            await createMemoryFile(
                folder.id,
                `${spec.slug}.md`,
                serializeSkill(spec.meta, spec.title),
                username,
                true,
            );
            created.push(spec.slug);
        }
        return created;
    } catch {
        return [];
    }
};

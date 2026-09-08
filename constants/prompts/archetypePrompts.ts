/**
 * Strategy archetypes for debate seats (Kakushadze & Serur, "151 Trading
 * Strategies" — SSRN 3247865).
 *
 * The book's style taxonomy is the disagreement engine: a trend-follower and
 * a mean-reverter look at the SAME chart and structurally disagree, because
 * their edges live in opposite regimes. The flat-floor debate (lens mode off,
 * 2–5 seats) previously differentiated seats only by mandate (structure /
 * entry / risk) — three seats could still converge on one strategy style.
 * Rotating an archetype per seat index forces strategy-level divergence
 * from the first sentence, which is exactly what the sealed conviction
 * auction and the moderator's COMMIT/DISSENT matrix need.
 *
 * Archetype ids ARE strategy-family ids (types/strategy) wherever one exists,
 * so a seat's stance and the family vocabulary the verdict plan names are
 * the same axis. Lens mode is deliberately untouched: its macro/technical/
 * risk personas already carry the differentiation.
 */

import { StrategyFamily } from '../../types/strategy';

export interface StrategyArchetype {
    id: string;
    name: string;
    /** The seat's standing bias — one sentence, prompt-ready. */
    stance: string;
    /** The family this archetype trades (for plan/vocabulary alignment). */
    family?: StrategyFamily;
}

export const STRATEGY_ARCHETYPES: StrategyArchetype[] = [
    {
        id: 'trend_follower',
        name: 'Trend-Follower',
        family: 'trend_following',
        stance: 'You trade WITH the dominant direction only: pullback entries in an established trend, invalidation beyond structure, and standing aside when no trend exists. A range is not a setup to you — it is a wait.',
    },
    {
        id: 'mean_reversion',
        name: 'Mean-Reverter',
        family: 'mean_reversion',
        stance: 'You fade statistical extremes: stretched moves away from VWAP/mean with exhaustion evidence, expecting reversion. You never fight a fundamental repricing, and a stretched trend WITHOUT exhaustion is a no-trade, not a short.',
    },
    {
        id: 'breakout',
        name: 'Breakout Hunter',
        family: 'breakout',
        stance: 'You trade compression then expansion: decisive breaks of range or structure with volume confirmation. A failed break is an immediate exit, not a hope — your edge dies without the follow-through.',
    },
    {
        id: 'range_fade',
        name: 'Range Fade',
        family: 'range_fade',
        stance: 'In no-trend regimes you sell resistance and buy support with tight invalidation just outside the boundary. The fade IS the edge; you step aside the moment a trend establishes and say so.',
    },
    {
        id: 'pairs_stat_arb',
        name: 'Stat-Arb / Market-Neutral',
        family: 'pairs_stat_arb',
        stance: 'You trade relative value, not raw direction: spread dislocations between correlated assets, funding/basis carry, hedged beta. If the trade only works if the market goes one way, it is not your trade — say what the directional seats are missing.',
    },
];

/** Deterministic seat rotation: seat i gets archetype i (mod list length).
 *  Stable across rounds and re-observes, so a seat keeps its identity for
 *  the whole debate. Negative/NaN indices fall back to the first archetype. */
export const archetypeForSeat = (seatIndex: number): StrategyArchetype => {
    const n = Number.isFinite(seatIndex) ? Math.max(0, Math.floor(seatIndex)) : 0;
    return STRATEGY_ARCHETYPES[n % STRATEGY_ARCHETYPES.length];
};

/** One prompt-ready line naming the seat's archetype. */
export const archetypeDirectiveLine = (seatIndex: number): string => {
    const a = archetypeForSeat(seatIndex);
    return `Your strategy archetype: ${a.name} — ${a.stance} Argue from this vantage; where the chart clearly favors another archetype, name which and why — but do not abandon your lens to agree.`;
};

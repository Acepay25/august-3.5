/**
 * netRiskReward — the ONE cost model, expressed in R.
 *
 * The app had NO cost model at all. Every `realizedR`, every win rate, every
 * calibration bucket and the whole skill ledger were **gross**: the field the
 * skill ledger called `netR` was the sum of GROSS R multiples, so the name
 * lied (audit finding F-13). The gates define the loosest trade the app will
 * allow — R:R 1.2 at Low, a scalp stop of ≤ 1 % — and a 0.10 % round trip
 * against a 1 % stop is 0.10 R: at a 50 % win rate and R:R 1.2 the gross
 * expectancy is +0.10 R, and the round trip consumes exactly that. The
 * breakeven win rate moves from 45.5 % to 50.0 %.
 *
 * This module is the arithmetic for that charge, and nothing else. It is
 * **pure** — no Preferences, no storage, no imports — so the journal write
 * path, the skill ledger and a future replay harness can all call it and get
 * the same number.
 *
 * ## The approved parameters (owner, 2026-10-20)
 *
 * **5 bps taker / 2 bps maker, ZERO slippage, with a visible "slippage not
 * modeled" label.** The slippage line is LABELLED, never a silent zero: an
 * unlabelled zero reads as a claim the model never made, which is the same
 * class of defect as the "fresh packet" claim. `slippageModeled` is therefore
 * typed as the literal `false` — the compiler refuses any attempt to make it
 * true without changing this file on purpose.
 *
 * These are module constants on purpose. Making the fee tier user-configurable
 * is a follow-up: it needs a `PREF_KEYS` entry, and the cost is a per-account
 * fact, not an app default.
 *
 * ## Units
 *
 * `stopDistancePct` is a **PERCENT** (a 1 % stop is `1`, not `0.01`) — the
 * convention `services/validation/AccuracyValidationService.ts` and
 * `utils/ticketSize.ts` already use for stop distances. Fees and slippage are
 * **basis points** (5 bps = 0.05 %).
 *
 * ## "Unknown" is a first-class answer
 *
 * A cost that cannot be computed is returned as `null` with `known: false` and
 * a reason — never as a misleading `0`. `0` is a real cost (a free trade), so
 * it cannot double as "I do not know". Every division is guarded.
 */

/** The owner's approved fee tier (2026-10-20): 5 bps per side, taker. */
export const FEE_TAKER_BPS = 5;

/** The owner's approved maker tier (2026-10-20): 2 bps per side. */
export const FEE_MAKER_BPS = 2;

/**
 * Slippage is **not modelled**. Zero is a LABEL, not a claim that slippage
 * was zero — see `slippageModeled` on every result below.
 */
export const SLIPPAGE_BPS = 0;

/**
 * The label that must ride every cost-adjusted number. A trader reading a
 * net figure has to be told that the cost inside it covers fees only.
 */
export const SLIPPAGE_NOT_MODELED_LABEL = 'slippage not modeled';

/** Why a cost could not be computed. */
export type CostUnknownReason =
    /** The plan's stop distance is missing, zero, negative or not a number. */
    | 'stop-distance'
    /** The fee is missing or not a finite number. */
    | 'fee'
    /** The gross R is missing or not a finite number. */
    | 'gross-r';

export interface RoundTripCostInput {
    /**
     * Fee charged on EACH side, in basis points (1 bp = 0.01 %). Defaults to
     * `FEE_TAKER_BPS`: taker is the conservative assumption — a limit order
     * can still be filled as a taker — so a cost model that guesses low is
     * the one that flatters the ledger.
     */
    feeBpsPerSide?: number;
    /**
     * Slippage for the whole round trip, in basis points. Defaults to
     * `SLIPPAGE_BPS` (0 — NOT modelled). Passing a non-zero value does NOT
     * make `slippageModeled` true: this module has no slippage MODEL, and
     * saying otherwise would be the silent claim the label exists to prevent.
     */
    slippageBps?: number;
    /** The plan's stop distance as a PERCENT of price (a 1 % stop is `1`). */
    stopDistancePct: number;
}

export interface RoundTripCost {
    /**
     * The round-trip cost in R (multiples of the plan's risk), or `null` when
     * it cannot be computed. Never a misleading `0`.
     */
    costR: number | null;
    /** `true` when `costR` is a real number. */
    known: boolean;
    /**
     * ALWAYS `false`. Slippage is not modelled, so no cost derived from this
     * module may be presented as if it had been.
     */
    slippageModeled: false;
    /** Why the cost is unknown. Absent when `known` is true. */
    unknown?: CostUnknownReason;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Round to 4 dp — a 0.1 R cost needs the precision, and the ledger sums many. */
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * The plan's stop distance as a PERCENT of price.
 *
 * The cost model needs this in one place, in one unit, and so does every
 * caller that wants to charge a fee: "one R" IS the risk distance, so a cost
 * in R is the cost as a fraction of price divided by this. `0` means the
 * distance is not measurable (a missing or unusable level) — never a guess.
 */
export const stopDistancePercent = (entry: number, stopLoss: number): number => {
    if (!finite(entry) || !finite(stopLoss) || entry <= 0 || stopLoss <= 0) return 0;
    return (Math.abs(entry - stopLoss) / entry) * 100;
};

/**
 * The round-trip cost of a trade, in R.
 *
 * `costR = (feeBpsPerSide × 2 + slippageBps) / 10000 ÷ (stopDistancePct / 100)`
 *
 * — the round-trip fee as a fraction of price, divided by the risk distance,
 * because "one R" IS the risk distance. A 10 bps round trip against a 1 % stop
 * is 0.10 R.
 */
export const roundTripCostR = (input: RoundTripCostInput): RoundTripCost => {
    const feeBpsPerSide = input.feeBpsPerSide ?? FEE_TAKER_BPS;
    const slippageBps = input.slippageBps ?? SLIPPAGE_BPS;

    if (!finite(input.stopDistancePct) || input.stopDistancePct <= 0) {
        return { costR: null, known: false, slippageModeled: false, unknown: 'stop-distance' };
    }
    if (!finite(feeBpsPerSide) || feeBpsPerSide < 0 || !finite(slippageBps) || slippageBps < 0) {
        return { costR: null, known: false, slippageModeled: false, unknown: 'fee' };
    }

    const stopDistanceFraction = input.stopDistancePct / 100;
    const costFraction = ((feeBpsPerSide * 2) + slippageBps) / 10000;
    return { costR: round4(costFraction / stopDistanceFraction), known: true, slippageModeled: false };
};

export interface NetRiskRewardInput {
    /** The GROSS R multiple of the trade — negative for a loss. */
    grossR: number;
    /** The plan's stop distance as a PERCENT of price (a 1 % stop is `1`). */
    stopDistancePct: number;
    /** Fee per side in bps. Defaults to `FEE_TAKER_BPS`. */
    feeBpsPerSide?: number;
    /** Slippage for the round trip in bps. Defaults to `SLIPPAGE_BPS` (not modelled). */
    slippageBps?: number;
}

export interface NetRiskReward {
    /** The GROSS R multiple, echoed back so a caller can show both numbers. */
    grossR: number;
    /** The NET R multiple (gross − cost), or `null` when it cannot be computed. */
    netR: number | null;
    /** The cost charged in R, or `null` when unknown. */
    costR: number | null;
    /** `true` when `netR` and `costR` are real numbers. */
    known: boolean;
    /** ALWAYS `false` — the slippage is not modelled. */
    slippageModeled: false;
    /** Why the figures are unknown. Absent when `known` is true. */
    unknown?: CostUnknownReason;
    /**
     * One line for the trader: what the number includes and, explicitly, what
     * it does not. Empty when the figures are unknown.
     */
    label: string;
}

/**
 * The NET R multiple of a trade: gross R minus the round-trip cost.
 *
 * The cost is charged on a LOSS as well as a win — you paid the fees and got
 * stopped — so `netR` for a −1 R loss at a 0.1 R cost is −1.1, not −1.
 */
export const netRiskReward = (input: NetRiskRewardInput): NetRiskReward => {
    if (!finite(input.grossR)) {
        return {
            grossR: 0, netR: null, costR: null, known: false,
            slippageModeled: false, unknown: 'gross-r', label: '',
        };
    }
    const cost = roundTripCostR({
        feeBpsPerSide: input.feeBpsPerSide,
        slippageBps: input.slippageBps,
        stopDistancePct: input.stopDistancePct,
    });
    if (!cost.known) {
        return {
            grossR: input.grossR, netR: null, costR: null, known: false,
            slippageModeled: false, unknown: cost.unknown, label: '',
        };
    }
    const feeBpsPerSide = input.feeBpsPerSide ?? FEE_TAKER_BPS;
    const roundTripBps = (feeBpsPerSide * 2) + (input.slippageBps ?? SLIPPAGE_BPS);
    return {
        grossR: input.grossR,
        netR: round4(input.grossR - (cost.costR as number)),
        costR: cost.costR,
        known: true,
        slippageModeled: false,
        label: `net of ${roundTripBps} bps round trip (${feeBpsPerSide} bps/side) · ${SLIPPAGE_NOT_MODELED_LABEL}`,
    };
};

/**
 * The win rate at which a plan with this payoff ratio breaks even AFTER the
 * round-trip cost.
 *
 * With a reward ratio `r` and a per-trade cost `c` (both in R), a win nets
 * `r − c` and a loss costs `1 + c`, so `w·(r − c) = (1 − w)·(1 + c)` gives
 * `w = (1 + c) / (1 + r)`. With no cost this is the familiar `1 / (1 + r)`.
 *
 * Returns a PERCENT (0–100), or `null` when it cannot be computed.
 */
export const breakEvenWinRate = (input: {
    /** The plan's payoff ratio (reward per unit of risk) — the planned R:R. */
    rewardRatio: number;
    /** The round-trip cost in R, or `null` when unknown. */
    costR: number | null;
}): number | null => {
    if (!finite(input.rewardRatio) || input.rewardRatio <= -1) return null;
    // An UNKNOWN cost is charged as no cost, which makes this the LOWER BOUND
    // on the true breakeven rather than the bar itself: any real cost raises
    // it. The app's own fee tier is a constant, so the unknown case only
    // arises when the plan's stop distance is not measurable — and a plan
    // whose risk distance is unknown has no breakeven worth quoting.
    const cost = input.costR === null || !finite(input.costR) ? 0 : input.costR;
    const win = (1 + cost) / (1 + input.rewardRatio);
    if (!finite(win)) return null;
    return round4(win * 100);
};

export interface NetEdgeInput {
    /** The probability the plan claims, as a fraction (0–1). */
    winProbability: number;
    /** The plan's payoff ratio (reward per unit of risk) — the planned R:R. */
    rewardRatio: number;
    /** The plan's stop distance as a PERCENT of price. */
    stopDistancePct: number;
    feeBpsPerSide?: number;
    slippageBps?: number;
}

export interface NetEdge {
    /** Net expectancy in R at the plan's own probability. */
    netEdgeR: number | null;
    /** What a win pays after the round trip. */
    netWinR: number | null;
    /** What a loss costs after the round trip (a negative number). */
    netLossR: number | null;
    costR: number | null;
    known: boolean;
    /** ALWAYS `false` — this module has no slippage model. */
    slippageModeled: false;
    unknown?: CostUnknownReason;
    /** One line for the card: the arithmetic, as refused on. */
    label: string;
}

/**
 * The net expectancy of a plan at its OWN probability:
 *
 *   netEdge = p × (R − c) + (1 − p) × (−1 − c)
 *
 * That is the `minEdge` refusal (E-43): a plan at 45 % with a 1.1 R:R is
 * negative after the round trip, and the app used to present it anyway. The
 * loss is charged at −1R (the plan's own stop); the 1.5R extended zone is a
 * policy the caller can model separately, not a number this arithmetic invents.
 */
export const netEdgeR = (input: NetEdgeInput): NetEdge => {
    if (!finite(input.winProbability) || input.winProbability < 0 || input.winProbability > 1) {
        return {
            netEdgeR: null, netWinR: null, netLossR: null, costR: null,
            known: false, slippageModeled: false, unknown: 'gross-r', label: '',
        };
    }
    if (!finite(input.rewardRatio)) {
        return {
            netEdgeR: null, netWinR: null, netLossR: null, costR: null,
            known: false, slippageModeled: false, unknown: 'gross-r', label: '',
        };
    }
    const cost = roundTripCostR({
        feeBpsPerSide: input.feeBpsPerSide,
        slippageBps: input.slippageBps,
        stopDistancePct: input.stopDistancePct,
    });
    if (!cost.known || cost.costR === null) {
        return {
            netEdgeR: null, netWinR: null, netLossR: null, costR: null,
            known: false, slippageModeled: false, unknown: cost.unknown, label: '',
        };
    }
    const netWinR = round4(input.rewardRatio - cost.costR);
    const netLossR = round4(-1 - cost.costR);
    const netEdge = round4(
        input.winProbability * netWinR + (1 - input.winProbability) * netLossR,
    );
    const roundTripBps = ((input.feeBpsPerSide ?? FEE_TAKER_BPS) * 2) + (input.slippageBps ?? SLIPPAGE_BPS);
    return {
        netEdgeR: netEdge,
        netWinR,
        netLossR,
        costR: cost.costR,
        known: true,
        slippageModeled: false,
        label: `${(input.winProbability * 100).toFixed(0)}% × ${netWinR.toFixed(2)}R + ${((1 - input.winProbability) * 100).toFixed(0)}% × ${netLossR.toFixed(2)}R = ${netEdge.toFixed(2)}R net of ${roundTripBps} bps (${SLIPPAGE_NOT_MODELED_LABEL})`,
    };
};

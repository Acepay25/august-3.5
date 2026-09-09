import { TradeAnalysis } from '../types';

/** One labeled step in the sizing decision — every multiplier the ticket
 *  applies is recorded with its reason and shown to the user, mirroring the
 *  Clodds kelly.ts transparency trail. A size is never an unexplained number. */
export interface SizeAdjustment {
    type: 'neutral' | 'risk-veto' | 'skill-veto' | 'gate-cap' | 'downgrade' | 'grade-tier' | 'equity';
    /** Human label explaining this specific step. */
    label: string;
    /** Multiplier this step imposes on the full size (0 = zeroed, 1 = no change). */
    fractionEffect: number;
}

export interface TicketSize {
    label: 'full' | 'half' | 'none';
    fraction: number;
    reason: string;
    /** The full trail of labeled downgrades that produced this ticket, in the
     *  order evaluated. Empty only for an uncapped FULL ticket. */
    adjustments: SizeAdjustment[];
}

/** The sizing reason callers match on when equity is unconfigured. */
export const EQUITY_NOT_SET = 'Equity not set';

export interface ContractSize extends TicketSize {
    equityUsd: number;
    leverage: number;
    riskUsd: number;
    notionalUsd: number;
    qty: number | null;
    unit: string;
    line: string;
    riskPercent: number;
}

export interface LiquidationBuffer {
    stopMovePct: number;
    liquidationMovePct: number;
    bufferPct: number;
    line: string;
}

export const computeTicketSize = (analysis: TradeAnalysis): TicketSize => {
    if (analysis.confidence === 'Avoid' || analysis.direction === 'Neutral' || analysis.riskVeto) {
        const label = analysis.riskVeto || 'No trade';
        return {
            label: 'none',
            fraction: 0,
            reason: label,
            adjustments: [{ type: analysis.riskVeto ? 'risk-veto' : 'neutral', label, fractionEffect: 0 }],
        };
    }
    const skill = (analysis.validationWarnings ?? []).find(w => /SKILL VETO|NOTEBOOK SKILL VETO/i.test(w));
    if (skill) return {
        label: 'none', fraction: 0, reason: 'Skill veto',
        adjustments: [{ type: 'skill-veto', label: 'Skill veto — a learned notebook rule blocks this setup', fractionEffect: 0 }],
    };
    const cap = analysis.gateResult?.confidenceCap;
    if (typeof cap === 'number' && cap < 0.7) {
        const label = `Gate cap ${Math.round(cap * 100)}%`;
        return {
            label: 'half', fraction: 0.5, reason: label,
            adjustments: [{ type: 'gate-cap', label: `${label} — the risk gate caps confidence below 70%`, fractionEffect: 0.5 }],
        };
    }
    if (analysis.originalConfidence === 'High' && analysis.confidence !== 'High') {
        const label = `Downgraded from ${analysis.originalConfidence}`;
        return {
            label: 'half', fraction: 0.5, reason: label,
            adjustments: [{ type: 'downgrade', label: `${label} — a validation penalty cut the confidence`, fractionEffect: 0.5 }],
        };
    }
    return { label: 'full', fraction: 1, reason: 'Uncapped', adjustments: [] };
};

const parseNum = (value?: string): number | undefined => {
    if (!value) return undefined;
    const n = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Equity risk scaled by ticket fraction, sized off Entry→SL.
 *  extraAdjustments carries the caller-computed grade-tier step (risk% is
 *  folded into the riskPercent argument upstream, so it can't be recovered
 *  here) — it is appended to the ticket-level trail. */
export const computeContractSize = (
    analysis: TradeAnalysis,
    equityUsd: number,
    leverage: number,
    riskPercent = 1,
    extraAdjustments: SizeAdjustment[] = [],
): ContractSize => {
    const base = computeTicketSize(analysis);
    const trail = [...base.adjustments, ...extraAdjustments];
    const lev = leverage > 0 ? leverage : 1;
    const riskPct = Number.isFinite(riskPercent) && riskPercent > 0
        ? Math.min(10, Math.max(0.1, riskPercent))
        : 1;
    const eq = equityUsd > 0 ? equityUsd : 0;
    // Fail closed on unknown equity. The previous $10,000 stand-in sized a
    // phantom position and printed a confident risk line for a user who never
    // configured an account — the number looked real and was not. A trade the
    // ticket already vetoes keeps its own (more specific) reason below.
    if (eq <= 0 && base.fraction > 0) {
        return {
            ...base,
            label: 'none',
            fraction: 0,
            reason: EQUITY_NOT_SET,
            adjustments: [...trail, { type: 'equity', label: 'Nothing sized — set your account equity in Settings → Risk', fractionEffect: 0 }],
            equityUsd: 0,
            leverage: lev,
            riskUsd: 0,
            notionalUsd: 0,
            qty: null,
            unit: '',
            line: 'Equity not set — add your account equity in Settings to size this trade',
            riskPercent: riskPct,
        };
    }
    if (base.fraction <= 0) {
        return {
            ...base,
            adjustments: trail,
            equityUsd: eq,
            leverage: lev,
            riskUsd: 0,
            notionalUsd: 0,
            qty: null,
            unit: '',
            line: 'No size',
            riskPercent: riskPct,
        };
    }
    const entry = parseNum(analysis.entryPoints?.[0]?.price);
    const sl = parseNum(analysis.stopLoss);
    const riskUsd = eq * (riskPct / 100) * base.fraction;
    const stopDist = entry && sl ? Math.abs(entry - sl) / entry : 0;
    const qty = entry && stopDist > 0 ? riskUsd / (entry * stopDist) : null;
    const notionalUsd = qty && entry ? qty * entry : riskUsd * lev;
    const coin = (analysis.coinName || '').replace(/USDT$/i, '') || 'qty';
    const qtyText = qty !== null
        ? `${qty >= 1 ? qty.toFixed(3) : qty.toPrecision(3)} ${coin}`
        : `${lev}x notional`;
    return {
        ...base,
        adjustments: trail,
        equityUsd: eq,
        leverage: lev,
        riskUsd,
        notionalUsd,
        qty,
        unit: coin,
        line: `${qtyText} · $${Math.round(riskUsd)} risk`,
        riskPercent: riskPct,
    };
};

/**
 * Isolated-margin wipe vs the ticket stop. Positive buffer = SL is inside
 * liquidation.
 *
 * `liquidationMovePct = 100 / lev` is the ISOLATED-margin approximation
 * (maintenance margin ignored, so it overstates the true distance). Under
 * CROSS margin the liquidation price depends on the whole account balance,
 * not this ticket — a per-ticket buffer is meaningless, so cross mode
 * returns null with a note instead of a misleading number.
 */
export const computeLiquidationBuffer = (
    entry?: string,
    stopLoss?: string,
    leverage = 1,
    marginMode: 'isolated' | 'cross' = 'isolated',
): LiquidationBuffer | null => {
    const lev = leverage > 0 ? leverage : 1;
    if (lev < 2) return null;
    if (marginMode === 'cross') return null;
    const entryN = parseNum(entry);
    const slN = parseNum(stopLoss);
    if (!entryN || !slN) return null;
    const stopMovePct = (Math.abs(entryN - slN) / entryN) * 100;
    const liquidationMovePct = 100 / lev;
    const bufferPct = liquidationMovePct - stopMovePct;
    if (bufferPct <= 0) {
        return {
            stopMovePct,
            liquidationMovePct,
            bufferPct,
            line: `SL is past isolated liquidation at ${lev}x`,
        };
    }
    return {
        stopMovePct,
        liquidationMovePct,
        bufferPct,
        line: `Liq buffer ${bufferPct.toFixed(1)}% · SL uses ${stopMovePct.toFixed(1)}% of ${liquidationMovePct.toFixed(1)}% to liq`,
    };
};

// ─── Grade-tiered risk + Kelly advisory (Batch 2) ─────────────────────────────

export interface RiskTier {
    /** Risk percent the grade scales the base riskPercent to. */
    riskPercent: number;
    /** Short card line explaining the tier. */
    line: string;
}

/**
 * Grade-tiered risk: the moderator's setup grade scales the base risk —
 * A → full base (a verified trader's A-setup runs the stated risk),
 * B → half, C/D → no-trade guidance (the sizing already reflects a fraction
 * of 0 via ticket vetoes in most C/D cases; this tier makes the rule explicit
 * for the card). Deterministic — the app computes, the card displays.
 */
export const gradeRiskTier = (
    grade: TradeAnalysis['grade'],
    baseRiskPercent: number,
): RiskTier => {
    const base = Number.isFinite(baseRiskPercent) && baseRiskPercent > 0 ? baseRiskPercent : 1;
    if (grade === 'A') return { riskPercent: base, line: `Grade A — full ${base}% risk` };
    if (grade === 'B') return { riskPercent: base / 2, line: `Grade B — half risk (${(base / 2).toFixed(2)}%)` };
    if (grade === 'C' || grade === 'D' || grade === 'F') {
        return { riskPercent: base / 4, line: `Grade ${grade} — quarter risk only (${(base / 4).toFixed(2)}%), treat as no-trade guidance` };
    }
    return { riskPercent: base, line: `${base}% risk` };
};

/** Grade-tier risk PLUS its sizing-trail entry, computed in one place so the
 *  pipeline stamp and the card (two producers of the same math) always agree
 *  on the adjustment that appears in the trail. */
export const gradeRiskTierWithAdjustment = (
    grade: TradeAnalysis['grade'],
    baseRiskPercent: number,
): RiskTier & { adjustment: SizeAdjustment } => {
    const tier = gradeRiskTier(grade, baseRiskPercent);
    const base = Number.isFinite(baseRiskPercent) && baseRiskPercent > 0 ? baseRiskPercent : 1;
    const multiplier = tier.riskPercent / base;
    const adjustment: SizeAdjustment = {
        type: 'grade-tier',
        label: tier.line,
        fractionEffect: Number.isFinite(multiplier) ? Math.round(multiplier * 100) / 100 : 1,
    };
    return { ...tier, adjustment };
};

export interface KellyAdvisory {
    /** Full-Kelly fraction of equity (0 when history is too thin). */
    fullKelly: number;
    /** Quarter- and half-Kelly fractions (the displayed, saner numbers). */
    quarterKelly: number;
    halfKelly: number;
    /** Trades the estimate is built on (wins + losses). */
    sampleSize: number;
    /** Advisory line for the ticket sheet; empty when history is too thin. */
    line: string;
}

/**
 * Kelly advisory from journaled history: f* = W − (1−W)/R, where R is the
 * realized payoff ratio (average win dollars ÷ average loss dollars).
 * Displayed at quarter/half Kelly with a noisy-edge warning — a small journal
 * makes Kelly a random number generator, so the advisory only renders with
 * ≥ 20 closed trades.
 */
export const kellyAdvisory = (
    wins: number,
    losses: number,
    avgWinUsd: number,
    avgLossUsd: number,
): KellyAdvisory => {
    // Normalize magnitudes: journal losses are stored NEGATIVE (the capture
    // flow writes -abs(pnl)), and R = avgWin/avgLoss needs magnitudes.
    const win = Math.abs(avgWinUsd);
    const loss = Math.abs(avgLossUsd);
    const n = wins + losses;
    if (wins < 1 || losses < 1 || n < 20 || win <= 0 || loss <= 0) {
        return { fullKelly: 0, quarterKelly: 0, halfKelly: 0, sampleSize: n, line: '' };
    }
    const w = wins / n;
    const r = win / loss;
    const full = w - (1 - w) / r;
    if (full <= 0) {
        return {
            fullKelly: full,
            quarterKelly: 0,
            halfKelly: 0,
            sampleSize: n,
            line: `Journal edge is negative (W=${(w * 100).toFixed(0)}%, R=${r.toFixed(2)}) — Kelly says no size; risk the minimum or paper-trade.`,
        };
    }
    const half = full / 2;
    const quarter = full / 4;
    return {
        fullKelly: full,
        quarterKelly: quarter,
        halfKelly: half,
        sampleSize: n,
        line: `Kelly f*=${(full * 100).toFixed(1)}% · half ${(half * 100).toFixed(1)}% · quarter ${(quarter * 100).toFixed(1)}% (n=${n}, ${n < 40 ? 'noisy edge — trust the smaller fractions' : 'journal-derived'})`,
    };
};

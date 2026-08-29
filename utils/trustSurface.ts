/**
 * trustSurface — rendered-side trust helpers (Batch 7, plan §5).
 *
 * Pure functions, no side effects: the deterministic math the trust research
 * says a human-command harness must show (funding carry relative to the
 * verdict, deterministic-claim softening on rendered copy, amendment diffs
 * so a moved stop is an explicit revision and never a silent overwrite).
 */

import { TradeAnalysis } from '../types';

// ─── Funding carry-cost (§5.5) ──────────────────────────────────────────────

export interface FundingCarry {
    /** Signed cost to THIS position per 8h funding interval, percent of
     *  notional. Positive = the position pays; negative = it receives. */
    costPctPer8h: number;
    /** Card line; empty when funding is unknown or the direction is neutral. */
    line: string;
}

/**
 * Verdict-relative funding framing. Binance funding is the 8h rate where a
 * POSITIVE value means longs pay shorts; the carry flips with the position.
 * The panel already shows the raw rate — what was missing is "what does
 * holding THIS direction cost me", which changes the target horizon.
 */
export const fundingCarryCost = (
    direction: string | undefined,
    fundingRate: number | undefined,
): FundingCarry => {
    if (typeof fundingRate !== 'number' || !Number.isFinite(fundingRate) || fundingRate === 0) {
        return { costPctPer8h: 0, line: '' };
    }
    if (direction !== 'Long' && direction !== 'Short') {
        return { costPctPer8h: 0, line: '' };
    }
    const costPctPer8h = direction === 'Long' ? fundingRate * 100 : -fundingRate * 100;
    const abs = Math.abs(costPctPer8h);
    const verb = costPctPer8h > 0 ? 'pays' : 'receives';
    const perDay = abs * 3; // three 8h intervals
    const line = `Funding carry: this ${direction.toLowerCase()} ${verb} ~${abs.toFixed(4)}%/8h (~${perDay.toFixed(3)}%/day) — carry compounds over the hold horizon`;
    return { costPctPer8h, line };
};

/** Direction-agnostic carry note for the debate snapshot (the verdict isn't
 *  known yet, so both sides are stated). */
export const fundingCarrySnapshotLine = (fundingRate: number | undefined): string => {
    if (typeof fundingRate !== 'number' || !Number.isFinite(fundingRate)) return '';
    const pct = fundingRate * 100;
    if (pct === 0) return 'Funding 0.0000%/8h — no carry either way.';
    return `Funding ${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%/8h — ${pct > 0 ? 'longs pay / shorts receive' : 'shorts pay / longs receive'}; grade a multi-hour hold with carry in mind.`;
};

// ─── Rendered-copy sweep (§5g) ──────────────────────────────────────────────

/**
 * Deterministic-claim softening for rendered verdict/share text. The prompt
 * side bans these words (plan 1.2f); this is the belt-and-braces sweep on
 * whatever still reaches the screen — "will hit" is a prediction stated as a
 * fact, and the SEC AI-washing precedent says the rendered copy must read as
 * analysis, not certainty. Only the clearest deterministic modals are
 * touched; ordinary prose passes through untouched.
 */
const HEDGE_RULES: { pattern: RegExp; replace: (m: string) => string }[] = [
    // Trading-vocabulary allowlist: prediction verbs the rendered copy must
    // never state as facts ("will hit the target", "will invalidate"). A
    // catch-all "will …" would mangle harmless prose ("will be monitored").
    { pattern: /\bwill\s+(?:not\s+)?(hit|reach|touch|break|pump|dump|go|test|invalidate|trigger|bounce|reject|rally|fall|rise|drop|moon|crash|print|close)\b/gi, replace: m => m.replace(/^will/i, 'may') },
    { pattern: /\b(is|are)\s+certain\s+to\b/gi, replace: () => 'likely to' },
    { pattern: /\bguaranteed?\b/gi, replace: () => 'not guaranteed' },
    { pattern: /\b(certainly|definitely|assuredly|surely|inevitably)\b/gi, replace: () => 'likely' },
    { pattern: /\b(no doubt|for sure|can'?t miss|sure thing|lock(ed)? in)\b/gi, replace: () => 'no certainty' },
];

export interface CopySweepResult {
    text: string;
    /** The deterministic claims that were softened (for the audit trail). */
    softened: string[];
}

export const sweepDeterministicClaims = (text: string): CopySweepResult => {
    const softened: string[] = [];
    let out = text;
    for (const rule of HEDGE_RULES) {
        out = out.replace(rule.pattern, (m: string) => {
            softened.push(m);
            return rule.replace(m);
        });
    }
    return { text: out, softened };
};

/** The standing framing line appended to share/export copy. */
export const FINANCIAL_ADVICE_DISCLAIMER = 'Analysis, not financial advice — probabilistic read of one setup; the market can disagree.';

// ─── Plan amendment diff (§5b) ──────────────────────────────────────────────

const priceOf = (v?: string): number | undefined => {
    if (!v) return undefined;
    const n = Number(v.replace(/[$,\s]/g, '').split(/[-–]/)[0]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Human-readable diff between a prior published plan and its revision — the
 * "explicit amendment, never overwrite" record. Compares entry/SL/TP prices
 * and direction; returns '' when nothing material moved.
 */
export const planAmendmentDiff = (prior: TradeAnalysis, next: TradeAnalysis): string => {
    const bits: string[] = [];
    const px = (v: number): string => v >= 1000 ? v.toFixed(0) : v.toFixed(2);
    if (prior.direction && next.direction && prior.direction !== next.direction) {
        bits.push(`direction ${prior.direction} → ${next.direction}`);
    }
    const pe = priceOf(prior.entryPoints?.[0]?.price);
    const ne = priceOf(next.entryPoints?.[0]?.price);
    if (pe && ne && pe !== ne) bits.push(`entry $${px(pe)} → $${px(ne)}`);
    const ps = priceOf(prior.stopLoss);
    const ns = priceOf(next.stopLoss);
    if (ps && ns && ps !== ns) bits.push(`SL $${px(ps)} → $${px(ns)}`);
    const pt = priceOf(prior.takeProfit?.[0]?.price);
    const nt = priceOf(next.takeProfit?.[0]?.price);
    if (pt && nt && pt !== nt) bits.push(`TP1 $${px(pt)} → $${px(nt)}`);
    if (prior.confidence && next.confidence && prior.confidence !== next.confidence) {
        bits.push(`confidence ${prior.confidence} → ${next.confidence}`);
    }
    return bits.join(' · ');
};

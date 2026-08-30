/**
 * debateScience — Batch 4 structure changes (plan §1.2), as pure helpers the
 * debate engine composes into prompts and metadata.
 *
 * Research anchors live in the plan: identity sycophancy (anonymize seat-to-
 * seat, keep lens identity), targeted devil beats free-form challenge,
 * FinCom disagree-or-commit beats naive consensus, log-odds averaging is
 * dragged toward 50% (so the ensemble line is extremized and SCORED, never
 * trusted), urgency-framed calls lose money (vocabulary flag).
 */

import { DebateTurn } from '../../types';
import { FinComMarker } from '../../types/learning';

export type { FinComMarker };

// ─── b) Seat anonymization + homogeneous-roster warning ────────────────────

export interface SeatAlias {
    /** provider name → seat-facing alias (lens role when assigned, else Seat N). */
    aliasOf: Record<string, string>;
    /** Replace every known seat name in `text` with its alias. Unknown
     *  names pass through (moderator-facing text is not anonymized). */
    anonymize: (text: string) => string;
}

const LENS_ALIASES: Record<string, string> = {
    technical: 'Technical Analyst',
    macro: 'Macro Analyst',
    risk: 'Risk Analyst',
    sentiment: 'Sentiment Analyst',
};

/**
 * Build the seat-anonymization map for one debate. Lens identities are the
 * useful structure (Technical/Macro/Risk) — model identity is the bias
 * channel (arxiv 2510.07517: models favor their own outputs), so seats see
 * lens roles, not provider names. Deterministic seat numbering fills the gaps.
 *
 * `resolveLens` maps a seat name to its lens role (undefined when lenses are
 * off or the seat is unassigned).
 */
export const buildSeatAliases = (
    seatNames: string[],
    resolveLens?: (name: string) => string | undefined,
): SeatAlias => {
    const aliasOf: Record<string, string> = {};
    let seatNum = 1;
    const used = new Set<string>();
    for (const name of seatNames) {
        const lens = resolveLens?.(name);
        let alias = lens ? (LENS_ALIASES[lens.toLowerCase()] ?? `Seat ${seatNum}`) : `Seat ${seatNum}`;
        // Lens collisions (two Technical seats): fall back to seat numbers.
        if (used.has(alias)) alias = `Seat ${seatNum}`;
        used.add(alias);
        aliasOf[name] = alias;
        seatNum++;
    }
    return {
        aliasOf,
        anonymize: (text: string): string => {
            let out = text;
            // Longest name first so overlapping names replace fully.
            for (const name of Object.keys(aliasOf).sort((a, b) => b.length - a.length)) {
                out = out.split(name).join(aliasOf[name]);
            }
            return out;
        },
    };
};

/** True when two or more seats share the same provider id AND model. */
export const findHomogeneousPairs = (
    seats: { providerId: string; model: string; name: string }[],
): string[] => {
    const byIdentity = new Map<string, string[]>();
    for (const s of seats) {
        const key = `${s.providerId}|${s.model}`;
        byIdentity.set(key, [...(byIdentity.get(key) ?? []), s.name]);
    }
    const pairs: string[] = [];
    for (const names of byIdentity.values()) {
        if (names.length >= 2) pairs.push(names.join(' + '));
    }
    return pairs;
};

/** The warning line injected into the debate context (warn, never block). */
export const homogeneousRosterWarning = (pairs: string[]): string => {
    if (pairs.length === 0) return '';
    return `**ROSTER WARNING:** seats ${pairs.join(', ')} run the SAME model — expect correlated errors and shallow "disagreement" (a homogeneous floor loses to isolated self-correction). Weight independent seats' dissent accordingly.`;
};

// ─── c) Targeted devil question ────────────────────────────────────────────

export interface DevilClaims {
    floorDirection?: string;
    entry?: string;
    invalidation?: string;
    takeProfit?: string;
}

/**
 * The red-team question must NAME specific claims — free-form "challenge the
 * floor" degenerates into sycophancy. Each probe names the concrete price or
 * decision under attack; missing values drop out rather than rendering
 * placeholders.
 */
export const buildTargetedDevilQuestion = (claims: DevilClaims): string => {
    const probes: string[] = [];
    if (claims.entry) {
        probes.push(`the entry trigger at ${claims.entry} — what is the SPECIFIC price event that must happen first, and does this entry chase an already-extended move?`);
    }
    if (claims.invalidation) {
        probes.push(`the invalidation at ${claims.invalidation} — does a BODY close beyond it actually invalidate the thesis, or do wicks matter (sweep semantics)? Is the stop resting in the retail cluster just beyond an obvious level?`);
    }
    if (claims.takeProfit) {
        probes.push(`the target at ${claims.takeProfit} — what standing liquidity sits BEFORE it and gets hit first?`);
    }
    probes.push('hidden correlation — if several seats here share a dollar leg (same direction, correlated coins or leverage stacking), the "diversified" floor is ONE concentrated bet; name the shared leg if it exists');
    probes.push('gap/liquidation risk beyond the stated stop — wick-through-liquidation then reversal, funding-pin risk, or a session open that gaps past the invalidation');
    probes.push('regime mismatch — does this playbook actually work in the CURRENT regime, or is this an A-setup in the wrong context?');
    probes.push('the revenge check — is this entry about the market, or about making back a loss?');
    const dir = claims.floorDirection ? `The floor leans ${claims.floorDirection}. ` : '';
    return `Attack THESE specific claims — vague "it might fail" adds nothing: ${dir}${probes.map((p, i) => `(${i + 1}) ${p}`).join(' ')}`;
};

// ─── f) Vocabulary ban (flag, don't rewrite — the grade decides) ───────────

export const BANNED_VOCABULARY = /\b(urgent|urgently|easy|guaranteed|can'?t miss|sure thing|no-brainer|locked in|slam dunk|free money)\b/gi;

/** Banned urgency-framed words found in a model output (empty = clean). */
export const flagBannedVocabulary = (text: string): string[] => {
    const hits = text.match(BANNED_VOCABULARY) ?? [];
    return [...new Set(hits.map(h => h.toLowerCase()))];
};

// ─── g) FinCom disagree-or-commit markers ──────────────────────────────────

const FINCOM_LINE = /^\s*(COMMIT|DISSENT)\s*:\s*([^—\n]+?)\s*(?:—|-)\s*(.+)$/gm;

/** Parse COMMIT:/DISSENT: lines out of a turn (case-sensitive marker, lenient dash). */
export const parseFinComMarkers = (text: string): FinComMarker[] => {
    const markers: FinComMarker[] = [];
    for (const m of text.matchAll(FINCOM_LINE)) {
        const stance = m[1] === 'COMMIT' ? 'commit' : 'dissent';
        markers.push({ seat: m[2].trim(), stance, why: m[3].trim() });
    }
    return markers;
};

/** Attach parsed markers to a turn (mutates a copy in the caller's map). */
export const withFinComMetadata = (turn: DebateTurn): DebateTurn => {
    const text = turn.text ?? '';
    const markers = parseFinComMarkers(text);
    if (markers.length === 0) return turn;
    return { ...turn, fincom: markers };
};

// ─── d) Deterministic ensemble line ────────────────────────────────────────

export interface SeatConviction {
    seat: string;
    /** Sealed conviction 0-100. */
    conviction: number;
    /** Fitness weight (calibration-derived); defaults to 1. */
    weight?: number;
}

export interface EnsembleLine {
    /** Aggregated probability 0-100 for the floor's directional stance. */
    probabilityPct: number;
    /** Extremization alpha applied (1 = plain log-odds mean — the honest
     *  starting point until ≥50 graded signals per band exist). */
    alpha: number;
    seats: number;
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Fitness-weighted log-odds mean of the sealed convictions, extremized by
 * alpha. Convictions of 0/100 are clamped to 1/99 (log-odds is unbounded).
 * alpha starts at 1 (plain mean — Satopää: plain averaging is dragged toward
 * 50%) and is fitted on realized outcomes only once ≥50 graded signals per
 * band exist; it NEVER overrides the moderator.
 */
export const computeEnsembleLine = (
    convictions: SeatConviction[],
    alpha = 1,
): EnsembleLine | null => {
    const valid = convictions.filter(c => Number.isFinite(c.conviction));
    if (valid.length === 0) return null;
    let wSum = 0;
    let logitSum = 0;
    for (const c of valid) {
        const w = c.weight && Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 1;
        const p = Math.min(99, Math.max(1, c.conviction)) / 100;
        logitSum += w * logit(p);
        wSum += w;
    }
    const meanLogit = logitSum / wSum;
    const p = sigmoid(alpha * meanLogit);
    return { probabilityPct: p * 100, alpha, seats: valid.length };
};

/** Verdict-context block: show the line to the moderator as a SCORED input, never an override. */
export const formatEnsembleLineBlock = (line: EnsembleLine | null): string => {
    if (!line) return '';
    return `**DETERMINISTIC ENSEMBLE LINE (scored, advisory):** ${line.probabilityPct.toFixed(1)}% — log-odds mean of ${line.seats} sealed convictions (alpha=${line.alpha}). This is a fitness-weighted aggregate, NOT a vote and NOT an override: your verdict must remain defensible on the evidence, and both this line and your probability will be Brier-scored against the realized outcome.`;
};

// ─── a) Context-match-first round block ────────────────────────────────────

/**
 * The debate's first exchange settles context BEFORE thesis: regime, session
 * window, pending events — and "NO TRADE today" is a first-class outcome,
 * not a failure ("days with no trades beat losing days").
 */
export const CONTEXT_MATCH_DIRECTIVE = `**CONTEXT-MATCH FIRST (this round's opening obligation):** Before any thesis, state in one line: regime (trend/range/chop), session window and whether it is a kill zone, and any pending high-impact event. Then the match verdict: does TODAY's context match this playbook — yes or no? If NO, your stance for this debate is NO TRADE (that is a first-class outcome here — days with no trades beat losing days), and you argue why the setup should be skipped EVEN IF the chart pattern is textbook.`;

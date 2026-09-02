/**
 * Pre-read capture (Batch 5, plan §5a) — an OPT-IN training mode. When on,
 * the settled verdict card stays hidden until the user commits their own
 * direction + confidence BEFORE the reveal (cognitive forcing). The journal
 * then shows user-prior vs verdict vs outcome: the human-Brier vs
 * machine-Brier display that fights algorithm appreciation / automation
 * bias. Off by default — the friction can hurt satisfaction.
 *
 * Pure helpers here; the gate UI is components/chat/PreReadGate, the commit
 * handler lives in App.tsx, the copy-to-trade hop in useTradeLogging, and
 * the journal read-out in components/journal/Journal.tsx.
 */

import { UserPriorCall } from '../types/message';
import { LoggedTrade } from '../types/trade';

const PREF_KEY = 'pre_read_capture_v1';

/** The toggle (Settings → Harness). Default OFF per plan §5a. */
export const loadPreReadEnabled = (): boolean => {
    try {
        return localStorage.getItem(PREF_KEY) === 'true';
    } catch {
        return false;
    }
};

export const savePreReadEnabled = (enabled: boolean): boolean => {
    try {
        localStorage.setItem(PREF_KEY, String(enabled));
    } catch { /* best-effort */ }
    return enabled;
};

export interface PriorVsVerdict {
    direction: 'AGREE' | 'DISAGREE' | 'USER_FLAT' | 'NO_VERDICT';
    /** Signed agreement: +1 agree, -1 disagree (Flat/absent = 0). */
    agreement: number;
    /** Verdict probability (0-100) when the analysis declared one. */
    verdictPct: number | null;
}

/** Direction agreement between the user's committed prior and the verdict. */
export const comparePriorToVerdict = (
    prior: UserPriorCall | undefined,
    verdict: { direction?: string; probability?: number } | undefined,
): PriorVsVerdict | null => {
    if (!prior) return null;
    const vd = verdict?.direction;
    if (!vd || vd === 'Neutral') return { direction: 'NO_VERDICT', agreement: 0, verdictPct: null };
    if (prior.direction === 'Flat') return { direction: 'USER_FLAT', agreement: 0, verdictPct: verdict?.probability ?? null };
    const agree = prior.direction === vd;
    return {
        direction: agree ? 'AGREE' : 'DISAGREE',
        agreement: agree ? 1 : -1,
        verdictPct: typeof verdict?.probability === 'number' ? verdict.probability : null,
    };
};

/** Squared error of a 0-100 probability against a realized outcome. */
const brierTerm = (pct: number, win: boolean): number => {
    const p = Math.min(100, Math.max(0, pct)) / 100;
    return (p - (win ? 1 : 0)) ** 2;
};

export interface HumanCalibrationRow {
    /** Closed trades with a committed prior call. */
    n: number;
    /** Mean Brier of the USER's prior (confidence vs outcome). */
    humanBrier: number | null;
    /** Mean Brier of the VERDICT probability over the same rows. */
    verdictBrier: number | null;
    /** % of priors that agreed with the verdict direction. */
    agreePct: number | null;
    /** Win rate when the user disagreed with the verdict (the
     *  over-rule honesty number — is the gut better than the floor?). */
    disagreeWinRate: number | null;
}

/**
 * Journal read-out: user-prior vs verdict vs outcome over the closed rows
 * that carry a committed prior call. Null when nobody has pre-read yet.
 */
export const buildHumanCalibration = (trades: LoggedTrade[]): HumanCalibrationRow | null => {
    const rows = trades.filter(t =>
        (t.outcome === 'WIN' || t.outcome === 'LOSS')
        && t.userPriorCall
        && Number.isFinite(t.userPriorCall.confidencePct));
    if (rows.length === 0) return null;
    const win = (t: LoggedTrade) => t.outcome === 'WIN';
    const humanBrier = rows.reduce((s, t) => s + brierTerm(t.userPriorCall!.confidencePct, win(t)), 0) / rows.length;
    const withVerdictP = rows.filter(t => typeof t.analysis?.probability === 'number' && (t.analysis?.probability ?? 0) > 0);
    const verdictBrier = withVerdictP.length > 0
        ? withVerdictP.reduce((s, t) => s + brierTerm(t.analysis!.probability, win(t)), 0) / withVerdictP.length
        : null;
    const cmp = rows.map(t => comparePriorToVerdict(t.userPriorCall, t.analysis));
    const directional = cmp.filter((c): c is PriorVsVerdict => !!c && (c.direction === 'AGREE' || c.direction === 'DISAGREE'));
    const agreeN = directional.filter(c => c.direction === 'AGREE').length;
    const disagreeRows = rows.filter((t, i) => cmp[i]?.direction === 'DISAGREE');
    return {
        n: rows.length,
        humanBrier,
        verdictBrier,
        agreePct: directional.length > 0 ? (agreeN / directional.length) * 100 : null,
        disagreeWinRate: disagreeRows.length > 0
            ? (disagreeRows.filter(win).length / disagreeRows.length) * 100
            : null,
    };
};

/** One-line plain-language framing for the journal card. */
export const humanCalibrationLine = (row: HumanCalibrationRow | null): string => {
    if (!row) return '';
    const parts = [`over ${row.n} pre-read trade(s)`];
    if (row.humanBrier !== null && row.verdictBrier !== null) {
        parts.push(row.humanBrier <= row.verdictBrier
            ? `your calls were BETTER calibrated than the verdict (Brier ${row.humanBrier.toFixed(2)} vs ${row.verdictBrier.toFixed(2)})`
            : `the verdict out-calibrated you (Brier ${row.verdictBrier.toFixed(2)} vs yours ${row.humanBrier.toFixed(2)})`);
    }
    if (row.agreePct !== null) parts.push(`you agreed with the floor ${row.agreePct.toFixed(0)}% of the time`);
    if (row.disagreeWinRate !== null) parts.push(`when you over-ruled it, you won ${row.disagreeWinRate.toFixed(0)}%`);
    return parts.join(' · ');
};

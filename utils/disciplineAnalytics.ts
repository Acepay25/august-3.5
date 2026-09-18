/**
 * disciplineAnalytics — deterministic discipline analytics.
 *
 * Pure client-side aggregation over LoggedTrade[]. The research claim: these
 * specific views changed trader behavior where raw P&L dashboards did not —
 * the adherence split (Edgewonk's flagship insight: rule-following beats
 * "winning"), the mistake-cost table (Σ PnL per tag), performance after the
 * first red trade (73% of one auditor's losses came after it), and giveback
 * (green days that finished red — overtrading into a lead).
 *
 * PnL basis: pnlAmount (dollars) when present, else pnlPercent converted
 * through the SessionGuard risk-base convention — the same rule the guard
 * uses, so rows from both capture paths are counted.
 */

import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { rowPnlUsd } from '../services/validation/SessionGuardService';

export interface DisciplineRow {
    label: string;
    n: number;
    winRate: number;
    profitFactor: number;
    avgR: number | null;
    totalPnlUsd: number;
}

export interface MistakeCostRow {
    tag: string;
    n: number;
    totalPnlUsd: number;
}

export interface DisciplineAnalytics {
    /** Rule-followed vs rule-broken — the Edgewonk flagship split. */
    adherence: { followed: DisciplineRow; broken: DisciplineRow };
    /** Σ PnL per mistake tag, most expensive first. */
    mistakeCost: MistakeCostRow[];
    /** Trades AFTER the day's first red trade (vs before) — UTC day buckets. */
    afterFirstRed: { after: DisciplineRow; before: DisciplineRow };
    /** Green UTC days that finished red, and the day P&Ls handed back. */
    giveback: { days: number; dayPnls: number[] };
    /** Closed trades with a computed R-multiple. */
    rSample: number;
    avgR: number | null;
    /**
     * Excursion coverage. `n` counts only trades whose candle validation
     * measured a live-window MAE/MFE — a different, smaller population than
     * `rSample`, so the means must never be read as portfolio-wide.
     */
    /** `n` counts rows with an MAE measured; capture needs BOTH a best move
     *  and a settled percent, so it is a strictly smaller subset — one shared
     *  `n` over both means reads as "12 trades averaged +38%" when only 4
     *  contributed the second number. */
    excursion: {
        n: number;
        meanMaePct: number | null;
        captureN: number;
        meanCapturePct: number | null;
    };
}

/**
 * Share of the best move the trade offered that was actually realized, in
 * percent. Both operands are leveraged account percents, so the ratio is
 * dimensionless and leverage cancels. Null when either side is unmeasured —
 * which is every trade logged before the post-mortem began writing excursions.
 * Floored at 0 (a stopped trade captured nothing) but deliberately not capped
 * at 100, because a figure above it means the two measurements disagree and
 * that is worth seeing rather than hiding.
 */
export const captureEfficiencyPct = (t: LoggedTrade): number | null => {
    const best = t.maxFavorableExcursion;
    const realized = t.pnlPercent;
    if (typeof best !== 'number' || !Number.isFinite(best) || best <= 0) return null;
    if (typeof realized !== 'number' || !Number.isFinite(realized)) return null;
    return Math.round(Math.max(0, (realized / best) * 100) * 10) / 10;
};

const isClosed = (t: LoggedTrade): boolean =>
    t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS;

/** Dollar PnL of a row — pnlAmount authoritative, pnlPercent converted
 * Through the position's margin or the planned risk base (
 *  the old formula divided by 100 twice and treated a leveraged POSITION
 *  percent as percent-of-equity, deflating autopilot rows ~100×). Shares
 *  the SessionGuard converter so the two surfaces can't disagree. */
const pnlUsd = (t: LoggedTrade): number => rowPnlUsd(t, 10_000, 1);

const emptyRow = (label: string): DisciplineRow => ({
    label, n: 0, winRate: 0, profitFactor: 0, avgR: null, totalPnlUsd: 0,
});

const buildRow = (label: string, trades: LoggedTrade[]): DisciplineRow => {
    const closed = trades.filter(isClosed);
    if (closed.length === 0) return emptyRow(label);
    const wins = closed.filter(t => t.outcome === TradeOutcome.WIN);
    const losses = closed.filter(t => t.outcome === TradeOutcome.LOSS);
    const grossWin = wins.reduce((s, t) => s + pnlUsd(t), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + pnlUsd(t), 0));
    const rs = closed.map(effectiveRMultiple).filter((r): r is number => r !== undefined);
    return {
        label,
        n: closed.length,
        winRate: (wins.length / closed.length) * 100,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
        avgR: rs.length > 0 ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
        totalPnlUsd: closed.reduce((s, t) => s + pnlUsd(t), 0),
    };
};

/** UTC day key for the post-red and giveback buckets. */
const utcDayKey = (ts: string | undefined): string | null => {
    if (!ts) return null;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
};

export const buildDisciplineAnalytics = (trades: LoggedTrade[]): DisciplineAnalytics => {
    const followed = trades.filter(t => t.followedPlan === true);
    const broken = trades.filter(t => t.followedPlan === false);

    // Mistake-cost table: Σ PnL per tag, most expensive first.
    const tagPnl = new Map<string, { n: number; pnl: number }>();
    for (const t of trades) {
        for (const tag of t.mistakeTags ?? []) {
            const cur = tagPnl.get(tag) ?? { n: 0, pnl: 0 };
            cur.n += 1;
            cur.pnl += pnlUsd(t);
            tagPnl.set(tag, cur);
        }
    }
    const mistakeCost: MistakeCostRow[] = [...tagPnl.entries()]
        .map(([tag, v]) => ({ tag, n: v.n, totalPnlUsd: v.pnl }))
        .sort((a, b) => a.totalPnlUsd - b.totalPnlUsd); // most negative first

    // Post-first-red split: within each UTC day, trades after the day's first
    // LOSS vs everything before it (days with no red count as "before").
    const after: LoggedTrade[] = [];
    const before: LoggedTrade[] = [];
    const byDay = new Map<string, LoggedTrade[]>();
    for (const t of trades) {
        const key = utcDayKey(t.timestamp);
        if (!key) continue;
        byDay.set(key, [...(byDay.get(key) ?? []), t]);
    }
    for (const dayTrades of byDay.values()) {
        const ordered = [...dayTrades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        let redSeen = false;
        for (const t of ordered) {
            if (redSeen) after.push(t);
            else before.push(t);
            if (t.outcome === TradeOutcome.LOSS) redSeen = true;
        }
    }

    // Giveback: UTC days whose cumulative closed P&L peaked above zero and
    // finished below zero — overtrading into a lead.
    const givebackDays: number[] = [];
    for (const dayTrades of byDay.values()) {
        const ordered = [...dayTrades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        let running = 0;
        let peaked = false;
        for (const t of ordered) {
            if (!isClosed(t)) continue;
            running += pnlUsd(t);
            if (running > 0) peaked = true;
        }
        if (peaked && running < 0) givebackDays.push(running);
    }

    const rs = trades.filter(isClosed).map(effectiveRMultiple).filter((r): r is number => r !== undefined);

    // Excursions exist only where the post-mortem's candle validation resolved
    // an exit, so this is a subset — averaging it against the whole book would
    // silently invent the missing rows as zero.
    const mae = trades.map(t => t.maxAdverseExcursion).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const capture = trades.map(captureEfficiencyPct).filter((v): v is number => v !== null);

    return {
        adherence: {
            followed: buildRow('Followed plan', followed),
            broken: buildRow('Broke plan', broken),
        },
        mistakeCost,
        afterFirstRed: {
            after: buildRow('After first red', after),
            before: buildRow('Before first red', before),
        },
        giveback: { days: givebackDays.length, dayPnls: givebackDays },
        rSample: rs.length,
        avgR: rs.length > 0 ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
        excursion: {
            n: mae.length,
            meanMaePct: mae.length > 0 ? Math.round((mae.reduce((s, v) => s + v, 0) / mae.length) * 10) / 10 : null,
            captureN: capture.length,
            meanCapturePct: capture.length > 0
                ? Math.round((capture.reduce((s, v) => s + v, 0) / capture.length) * 10) / 10
                : null,
        },
    };
};

/**
 * Realized R-multiple from a LEVERAGED account percent.
 *
 * `pnlPercent` on a trade row is the leveraged figure (see
 * `LoggedTrade.pnlPercent`, and `OutcomeAutopilotService.computePnLFromPrice`
 * which derives it through `leveragedMovePercent`), but an entry→SL distance is
 * inherently a raw price move. Dividing one by the other silently multiplies R
 * by the leverage — a genuine −1R on a 20× position used to be persisted as
 * −20R. Supplying the trade's leverage removes that factor; omitting it falls
 * back to 1×, which is correct for unleveraged rows and keeps pre-existing
 * callers and fixtures reading the same way they always did.
 */
export const computeRMultiple = (
    entry: string | undefined,
    stopLoss: string | undefined,
    pnlPercent: number | undefined,
    leverage?: number,
): number | undefined => {
    const num = (v?: string): number | undefined => {
        if (!v) return undefined;
        const n = Number(v.replace(/[$,\s]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const e = num(entry);
    const s = num(stopLoss);
    if (!e || !s || typeof pnlPercent !== 'number' || !Number.isFinite(pnlPercent)) return undefined;
    const stopMovePct = (Math.abs(e - s) / e) * 100;
    if (stopMovePct <= 0) return undefined;
    const lev = typeof leverage === 'number' && leverage > 0 ? leverage : 1;
    const r = pnlPercent / (stopMovePct * lev);
    return Number.isFinite(r) ? r : undefined;
};

/**
 * The R to aggregate for one trade: the candle-measured figure when the
 * post-mortem resolved one, otherwise R re-derived from the row's own entry,
 * stop and leveraged percent.
 *
 * Re-derived rather than trusting the stored `rMultiple` because rows logged
 * before `computeRMultiple` learned about leverage carry a figure up to
 * DEFAULT_LEVERAGE (100×) too large — `pnlPercent` is leveraged while the
 * entry→stop distance is not. Nothing on the row marks which era it came from,
 * so there is no safe version fence; deriving from the same inputs answers both
 * correctly. Only where the inputs are missing (a hand-entered R) does the
 * stored figure survive, and then it survives uncorrected — an unknown
 * leverage cannot be divided out.
 */
export const effectiveRMultiple = (t: LoggedTrade): number | undefined => {
    if (typeof t.realizedR === 'number' && Number.isFinite(t.realizedR)) return t.realizedR;
    const derived = computeRMultiple(
        t.analysis?.entryPoints?.[0]?.price,
        t.analysis?.stopLoss,
        t.pnlPercent,
        t.leverage,
    );
    if (derived !== undefined) return derived;
    return typeof t.rMultiple === 'number' && Number.isFinite(t.rMultiple) ? t.rMultiple : undefined;
};

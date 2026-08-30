/**
 * disciplineAnalytics — deterministic discipline analytics (Batch 5, plan §4.4).
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
}

const isClosed = (t: LoggedTrade): boolean =>
    t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS;

/** Dollar PnL of a row — pnlAmount authoritative, pnlPercent via the risk base. */
const pnlUsd = (t: LoggedTrade): number => {
    if (typeof t.pnlAmount === 'number' && Number.isFinite(t.pnlAmount)) return t.pnlAmount;
    if (typeof t.pnlPercent === 'number' && Number.isFinite(t.pnlPercent)) {
        // Leveraged percent through the 1%-of-equity risk base (SessionGuard
        // convention: -200 leveraged = -$200 on $10k).
        return (t.pnlPercent / 100) * 10_000 * 0.01;
    }
    return 0;
};

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
    const rs = closed.map(t => t.rMultiple).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
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

    const rs = trades.filter(isClosed).map(t => t.rMultiple).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));

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
    };
};

/**
 * Realized R-multiple from the leveraged percents: pnlPercent ÷ stop-move
 * percent (entry→SL distance). Deterministic, and undefined when either side
 * is missing — never a fabricated 0R.
 */
export const computeRMultiple = (
    entry: string | undefined,
    stopLoss: string | undefined,
    pnlPercent: number | undefined,
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
    const r = pnlPercent / stopMovePct;
    return Number.isFinite(r) ? r : undefined;
};

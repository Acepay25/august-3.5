/**
 * SessionGuardService — deterministic session-state guardrails (Batch 2).
 *
 * Pure functions over the profile tradeLog: realized day P&L (UTC), trades
 * opened today, and the current loss streak decide verdicts. No LLM, no
 * side effects — the research is unambiguous that these numbers must not be
 * negotiable in the moment ("over 63% of traders have lost an account in a
 * single day"; 73% of one auditor's losses came after the day's first red).
 *
 * Prop-firm defaults (research-tight end; the looser FTMO set — 3%/3 trades/
 * 60 min — is available through the config):
 *   - daily-loss limit: 2% of equity (Topstep auto-flatten level)
 *   - max trades/day: 2 (one win = done; one loss = one attempt then done)
 *   - streak pause: 2 consecutive losses
 *   - post-loss cooldown: 4h (cortisol clears ~90 min; the guard adds margin)
 *
 * Breaker behavior: warn at 50% of the daily cap, hard interstitial at 80%,
 * stand-down at 100% until the next UTC day. This is an advisory app, not a
 * broker: warn-first, never hard-block, with an explicit "continue anyway"
 * override that is itself journaled (overrideAt + overrideReason).
 */

import { LoggedTrade } from '../../types/trade';
import { TradeOutcome } from '../../types/enums';

export interface SessionGuardConfig {
    /** Daily loss limit as a fraction of equity (0.02 = 2%). */
    dailyLossLimitPct: number;
    /** Max trades opened per UTC day. */
    maxTradesPerDay: number;
    /** Consecutive-loss count that triggers a streak pause. */
    lossStreakPause: number;
    /** Post-loss cooldown in minutes. */
    postLossCooldownMin: number;
}

export const DEFAULT_SESSION_GUARD: SessionGuardConfig = {
    dailyLossLimitPct: 0.02,
    maxTradesPerDay: 2,
    lossStreakPause: 2,
    postLossCooldownMin: 240,
};

/** FTMO's looser preset — the config alternative named in the research. */
export const FTMO_SESSION_GUARD: SessionGuardConfig = {
    ...DEFAULT_SESSION_GUARD,
    dailyLossLimitPct: 0.03,
    maxTradesPerDay: 3,
};

export type GuardLevel = 'clear' | 'notice' | 'warning' | 'standdown';

export interface SessionGuardVerdict {
    /** Worst active level — drives the banner color and the interstitial. */
    level: GuardLevel;
    /** Realized P&L for the current UTC day, in dollars. */
    dayPnlUsd: number;
    /** Equity fraction the day P&L represents (0 when equity unknown). */
    dayPnlPct: number;
    /** Trades opened in the current UTC day (any non-skipped entry). */
    tradesToday: number;
    /** Consecutive losses ending at the most recent closed trade. */
    lossStreak: number;
    /** True when the daily-loss limit is fully consumed. */
    dailyLossHit: boolean;
    /** True when today's trade count reached the cap. */
    tradeCapHit: boolean;
    /** True when the loss streak reached the pause threshold. */
    streakPauseActive: boolean;
    /** Cooldown end time (ISO) when a post-loss cooldown is running. */
    cooldownActiveUntil?: string;
    /** Human-readable lines for the banner + debate-context block. */
    warnings: string[];
    /** 0-1 usage of the daily loss budget (drives warn/interstitial tiers). */
    lossBudgetUsed: number;
}

const MS_PER_DAY = 86_400_000;

/** UTC midnight of the day containing `now` (or the current instant). */
export const utcDayStart = (now: Date = new Date()): Date => {
    const d = new Date(now);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const isOpenOfDay = (ts: string | undefined, dayStart: number, now: number): boolean => {
    if (!ts) return false;
    const t = Date.parse(ts);
    return Number.isFinite(t) && t >= dayStart && t <= now;
};

/**
 * Today's realized P&L in dollars. pnlAmount is authoritative when present;
 * pnlPercent is a leveraged-percent fallback converted through the risk
 * fraction of equity (a percent-only row still counts toward the breaker —
 * ignoring it would let autopilot rows escape the guard).
 */
const dayPnl = (trades: LoggedTrade[], dayStart: number, now: number, equityUsd: number): number => {
    let total = 0;
    for (const t of trades) {
        if (!isOpenOfDay(t.timestamp, dayStart, now)) continue;
        if (typeof t.pnlAmount === 'number' && Number.isFinite(t.pnlAmount)) {
            total += t.pnlAmount;
        } else if (typeof t.pnlPercent === 'number' && Number.isFinite(t.pnlPercent) && equityUsd > 0) {
            total += (t.pnlPercent / 100) * equityUsd * 0.01;
        }
    }
    return total;
};

/** Consecutive losses ending at the most recent CLOSED trade (wins reset). */
const currentLossStreak = (trades: LoggedTrade[], now: number): number => {
    const closed = trades
        .filter(t => t.timestamp && Date.parse(t.timestamp) <= now
            && (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let streak = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
        if (closed[i].outcome === TradeOutcome.LOSS) streak++;
        else break;
    }
    return streak;
};

/**
 * The session-state verdict for right now. `now` and `equityUsd` are
 * parameters (not reads) so tests can pin the UTC boundary.
 */
export const assessSession = (
    trades: LoggedTrade[],
    equityUsd: number,
    config: SessionGuardConfig = DEFAULT_SESSION_GUARD,
    now: Date = new Date(),
): SessionGuardVerdict => {
    const nowMs = now.getTime();
    const dayStart = utcDayStart(now).getTime();
    const pnl = dayPnl(trades, dayStart, nowMs, equityUsd);
    const eq = equityUsd > 0 ? equityUsd : 10_000;
    const lossBudgetUsd = eq * config.dailyLossLimitPct;
    // Only losses consume the budget — a green day never trips the breaker.
    const lossConsumedUsd = Math.min(0, pnl);
    const lossBudgetUsed = lossBudgetUsd > 0 ? Math.min(1, Math.abs(lossConsumedUsd) / lossBudgetUsd) : 0;
    const dayPct = eq > 0 ? pnl / eq : 0;

    const tradesToday = trades.filter(t =>
        isOpenOfDay(t.timestamp, dayStart, nowMs)
        && t.outcome !== TradeOutcome.SKIPPED
        && t.outcome !== TradeOutcome.ENTRY_NOT_HIT,
    ).length;

    const streak = currentLossStreak(trades, nowMs);
    const dailyLossHit = lossBudgetUsed >= 1;
    const tradeCapHit = tradesToday >= config.maxTradesPerDay;
    const streakPauseActive = streak >= config.lossStreakPause;

    // Post-loss cooldown: the most recent CLOSED trade is a loss and it is
    // younger than the cooldown window.
    const closed = trades
        .filter(t => t.timestamp && Date.parse(t.timestamp) <= nowMs
            && (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const lastClosed = closed[closed.length - 1];
    let cooldownActiveUntil: string | undefined;
    if (lastClosed?.outcome === TradeOutcome.LOSS && lastClosed.timestamp) {
        const endsAt = Date.parse(lastClosed.timestamp) + config.postLossCooldownMin * 60_000;
        if (endsAt > nowMs) cooldownActiveUntil = new Date(endsAt).toISOString();
    }

    const warnings: string[] = [];
    if (dailyLossHit) {
        warnings.push(`Daily loss limit hit (${Math.abs(dayPct * 100).toFixed(2)}% of equity) — stand down until the next UTC day.`);
    } else if (lossBudgetUsed >= 0.8) {
        warnings.push(`${Math.round(lossBudgetUsed * 100)}% of the daily loss budget used — one more loss trips the limit.`);
    } else if (lossBudgetUsed >= 0.5) {
        warnings.push(`${Math.round(lossBudgetUsed * 100)}% of the daily loss budget used.`);
    }
    if (tradeCapHit) {
        warnings.push(`Trade cap reached (${tradesToday}/${config.maxTradesPerDay} today) — the session is over.`);
    } else if (tradesToday === config.maxTradesPerDay - 1) {
        warnings.push(`${tradesToday}/${config.maxTradesPerDay} trades used today.`);
    }
    if (streakPauseActive) {
        warnings.push(`${streak} losses in a row — streak pause: step back and review before the next trade.`);
    }
    if (cooldownActiveUntil) {
        const mins = Math.ceil((Date.parse(cooldownActiveUntil) - nowMs) / 60_000);
        warnings.push(`Post-loss cooldown active for ~${mins} more minute${mins === 1 ? '' : 's'}.`);
    }

    const level: GuardLevel = dailyLossHit || tradeCapHit
        ? 'standdown'
        : lossBudgetUsed >= 0.8 || streakPauseActive || cooldownActiveUntil
            ? 'warning'
            : lossBudgetUsed >= 0.5 || tradesToday === config.maxTradesPerDay - 1
                ? 'notice'
                : 'clear';

    return {
        level,
        dayPnlUsd: pnl,
        dayPnlPct: dayPct,
        tradesToday,
        lossStreak: streak,
        dailyLossHit,
        tradeCapHit,
        streakPauseActive,
        cooldownActiveUntil,
        warnings,
        lossBudgetUsed,
    };
};

/** Compact block injected into the debate context so the moderator can weigh it. */
export const formatGuardContextBlock = (verdict: SessionGuardVerdict): string => {
    if (verdict.level === 'clear' && verdict.tradesToday === 0 && verdict.lossStreak === 0) return '';
    const lines = [
        `**TRADER SESSION STATE (deterministic — weigh this when grading):**`,
        `Trades today: ${verdict.tradesToday} · Day P&L: ${verdict.dayPnlUsd >= 0 ? '+' : ''}$${Math.round(verdict.dayPnlUsd)} (${(verdict.dayPnlPct * 100).toFixed(2)}% of equity)`,
    ];
    if (verdict.lossStreak > 0) lines.push(`Current loss streak: ${verdict.lossStreak}`);
    for (const w of verdict.warnings) lines.push(`- ${w}`);
    return lines.join('\n');
};

/**
 * Next UTC midnight after `now` — the earliest a stand-down can lift. Exposed
 * for the banner's "until 00:00 UTC" copy.
 */
export const nextUtcMidnight = (now: Date = new Date()): Date =>
    new Date(utcDayStart(now).getTime() + MS_PER_DAY);

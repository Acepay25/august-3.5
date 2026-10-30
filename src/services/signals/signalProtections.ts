/**
 * signalProtections — the four "stop digging" rules a desk applies to itself,
 * expressed in R rather than in dollars.
 *
 * The reference's bots carry protections (stoploss guards, cooldowns, drawdown
 * breakers, low-profit retirement). August shipped signals with only a shadow
 * gate: it would emit the eleventh losing call in a row and merely record the
 * outcome. These rules read SETTLED signals only — no new fetch, no model —
 * and answer one question at emission time: is this seat currently allowed to
 * speak on this instrument?
 *
 *  1. Cooldown — the last N settled calls all lost, and the newest loss is
 *     inside the cooldown window.
 *  2. Drawdown breaker — the last W settled calls sum to at most −X R.
 *  3. Low-profit retirement — a full window that still sums to ≤ 0 R: the
 *     setup family is not paying for its own costs.
 *
 * `never_triggered` fills are not losses and are excluded (outcomeR is 0 by
 * the resolver's own definition). A blocked emission does NOT write a signal:
 * the record must not claim a call the app refused to stand behind.
 */
import type { SignalDirection } from '../../types/signal';

export interface ProtectionHistory {
    coin: string;
    direction: SignalDirection;
    /** Settled R after costs. Null for a call that never filled / is open. */
    outcomeR: number | null;
    /** When it settled, ms. Null while open. */
    settledAt: number | null;
}

export interface ProtectionConfig {
    /** How many settled calls the window reads. */
    window: number;
    /** Consecutive losses that trip the cooldown. */
    cooldownLosses: number;
    cooldownMs: number;
    /** Window sum at or below this R blocks emission. */
    maxDrawdownR: number;
    /** Fills needed before the low-profit rule may fire. */
    minSample: number;
}

export const SIGNAL_PROTECTIONS: ProtectionConfig = {
    window: 20,
    cooldownLosses: 3,
    cooldownMs: 6 * 60 * 60_000,
    maxDrawdownR: -6,
    minSample: 8,
};

export interface ProtectionVerdict {
    blocked: boolean;
    rule?: 'cooldown' | 'drawdown' | 'low-profit';
    reason?: string;
    /** How many settled calls the rule read. */
    sample: number;
    windowR: number;
}

const r1 = (v: number): string => v.toFixed(1);

export const signalProtectionVerdict = (
    history: readonly ProtectionHistory[],
    candidate: { coin: string; direction: SignalDirection; now?: number },
    cfg: ProtectionConfig = SIGNAL_PROTECTIONS,
): ProtectionVerdict => {
    const settled = history
        .filter(h => h.outcomeR !== null && h.settledAt !== null && Number.isFinite(h.outcomeR) && Number.isFinite(h.settledAt))
        .sort((a, b) => (a.settledAt as number) - (b.settledAt as number))
        .slice(-cfg.window);
    const windowR = settled.reduce((sum, h) => sum + (h.outcomeR as number), 0);
    const base: ProtectionVerdict = { blocked: false, sample: settled.length, windowR: Math.round(windowR * 100) / 100 };
    if (settled.length === 0) return base;

    const tail = settled.slice(-cfg.cooldownLosses);
    const now = candidate.now ?? Date.now();
    const newest = settled[settled.length - 1].settledAt as number;
    if (tail.length === cfg.cooldownLosses && tail.every(h => (h.outcomeR as number) < 0) && now - newest < cfg.cooldownMs) {
        return {
            ...base, blocked: true, rule: 'cooldown',
            reason: `cooling down: the last ${cfg.cooldownLosses} settled calls lost (${r1(tail.reduce((s, h) => s + (h.outcomeR as number), 0))}R); no new signal for ${Math.ceil((cfg.cooldownMs - (now - newest)) / 60_000)} more minutes`,
        };
    }
    if (settled.length >= cfg.minSample && windowR <= cfg.maxDrawdownR) {
        return {
            ...base, blocked: true, rule: 'drawdown',
            reason: `drawdown breaker: the last ${settled.length} settled calls are ${r1(windowR)}R; no new signal until it resets`,
        };
    }
    if (settled.length >= cfg.minSample && windowR <= 0) {
        return {
            ...base, blocked: true, rule: 'low-profit',
            reason: `this setup is not paying for its costs: the last ${settled.length} settled calls are ${r1(windowR)}R`,
        };
    }
    return base;
};

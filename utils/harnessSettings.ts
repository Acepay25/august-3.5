export type PromptAbRate = 0 | 0.1 | 0.5;

import {
    DEFAULT_SESSION_GUARD,
    FTMO_SESSION_GUARD,
    SessionGuardConfig,
} from '../services/validation/SessionGuardService';

export interface HarnessSettings {
    equityUsd: number;
    riskPercent: number;
    promptAbRate: PromptAbRate;
    debateCostCapUsd: number;
    pinnedPromptLane?: 'live' | 'control';
    /** Analysts may call live desk tools (search, derivatives, session) before the brief. Default on. */
    deskToolsEnabled: boolean;
    /** Session-guard preset (plan §3b/§14-8): 'default' = research-tight
     *  (2%/2 trades/2-streak/4h), 'ftmo' = the looser alternative
     *  (3%/3 trades). Individual overrides win over the preset. */
    guardPreset?: 'default' | 'ftmo';
    guardDailyLossPct?: number;
    guardMaxTradesPerDay?: number;
    guardPostLossCooldownMin?: number;
}

const KEY = 'harness_settings_v1';

const read = (): Partial<HarnessSettings> => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Partial<HarnessSettings>;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export const getHarnessSettings = (): HarnessSettings => {
    const stored = typeof localStorage === 'undefined' ? {} : read();
    const rate = stored.promptAbRate;
    return {
        equityUsd: typeof stored.equityUsd === 'number' && stored.equityUsd > 0 ? stored.equityUsd : 10_000,
        riskPercent: typeof stored.riskPercent === 'number' && stored.riskPercent > 0
            ? Math.min(10, Math.max(0.1, stored.riskPercent))
            : 1,
        promptAbRate: rate === 0 || rate === 0.1 || rate === 0.5 ? rate : 0.1,
        debateCostCapUsd: typeof stored.debateCostCapUsd === 'number' && stored.debateCostCapUsd >= 0
            ? stored.debateCostCapUsd
            : 0.5,
        pinnedPromptLane: stored.pinnedPromptLane === 'live' || stored.pinnedPromptLane === 'control'
            ? stored.pinnedPromptLane
            : undefined,
        deskToolsEnabled: stored.deskToolsEnabled !== false,
        guardPreset: stored.guardPreset === 'ftmo' ? 'ftmo' : stored.guardPreset === 'default' ? 'default' : undefined,
        guardDailyLossPct: typeof stored.guardDailyLossPct === 'number' && stored.guardDailyLossPct > 0 ? stored.guardDailyLossPct : undefined,
        guardMaxTradesPerDay: typeof stored.guardMaxTradesPerDay === 'number' && stored.guardMaxTradesPerDay >= 1 ? stored.guardMaxTradesPerDay : undefined,
        guardPostLossCooldownMin: typeof stored.guardPostLossCooldownMin === 'number' && stored.guardPostLossCooldownMin >= 0 ? stored.guardPostLossCooldownMin : undefined,
    };
};

export const saveHarnessSettings = (next: Partial<HarnessSettings>): HarnessSettings => {
    const merged = { ...getHarnessSettings(), ...next };
    try {
        localStorage.setItem(KEY, JSON.stringify(merged));
    } catch { /* ignore */ }
    return merged;
};

/**
 * Resolve the live SessionGuardConfig from the stored settings (plan §14-8):
 * preset base + per-field overrides, all clamped to sane ranges. This is
 * the single source every assessSession call site reads, so the FTMO preset
 * and the user's own limits actually take effect.
 */
export const getSessionGuardConfig = (): SessionGuardConfig => {
    const s = getHarnessSettings();
    const base = s.guardPreset === 'ftmo' ? FTMO_SESSION_GUARD : DEFAULT_SESSION_GUARD;
    const pct = typeof s.guardDailyLossPct === 'number' && s.guardDailyLossPct > 0 && s.guardDailyLossPct <= 25
        ? s.guardDailyLossPct : base.dailyLossLimitPct * 100;
    const cap = typeof s.guardMaxTradesPerDay === 'number' && s.guardMaxTradesPerDay >= 1 && s.guardMaxTradesPerDay <= 20
        ? Math.floor(s.guardMaxTradesPerDay) : base.maxTradesPerDay;
    const cool = typeof s.guardPostLossCooldownMin === 'number' && s.guardPostLossCooldownMin >= 0 && s.guardPostLossCooldownMin <= 1440
        ? Math.floor(s.guardPostLossCooldownMin) : base.postLossCooldownMin;
    return {
        dailyLossLimitPct: pct / 100,
        maxTradesPerDay: cap,
        lossStreakPause: base.lossStreakPause,
        postLossCooldownMin: cool,
        tradeRiskPercent: s.riskPercent,
    };
};

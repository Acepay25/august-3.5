import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.5d — regime-mix drift sentinel: the market's 30-day regime mix vs the
// mix during which a skill's evidence accumulated. Divergence ⇒
// stale-by-regime ⇒ downweighted in retrieval until fresh evidence in the
// current mix re-converges (the flag is derived live, so it auto-clears).

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import {
    skillEvidenceMixWeights,
    regimeMixL1,
    isRegimeMixDivergent,
    isStaleByRegime,
    regimeRankFactor,
    REGIME_MIX_L1_THRESHOLD,
    STALE_BY_REGIME_DOWNWEIGHT,
} from '../utils/regimeSentinel';
import { hydrateRegimeLedger, recordRegimeDay } from '../services/learning/regimeLedger';

const USER = 'rg-user';
const dateOf = (daysAgo: number): string =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

describe('regimeMixSentinel (pure math)', () => {
    it('normalizes regimeStats counts into weights via the ledger mapping', () => {
        const w = skillEvidenceMixWeights({
            trending: { w: 9, l: 1 },
            ranging: { w: 1, l: 1 },
        });
        expect(w).toEqual({ trending: 10 / 12, ranging: 2 / 12 });
    });

    it('returns null when the skill has no regime-resolved evidence', () => {
        expect(skillEvidenceMixWeights(undefined)).toBeNull();
        expect(skillEvidenceMixWeights({ trending: { w: 0, l: 0 } })).toBeNull();
    });

    it('computes L1 distance and respects the divergence threshold', () => {
        const trendingOnly = { trending: 1 };
        const current = { trending: 0.83, ranging: 0.17 };
        expect(regimeMixL1(trendingOnly, current)).toBeCloseTo(0.34, 5);
        expect(isRegimeMixDivergent(trendingOnly, current)).toBe(false);

        const rangingOnly = { ranging: 1 };
        expect(regimeMixL1(rangingOnly, current)).toBeCloseTo(1.66, 5);
        expect(isRegimeMixDivergent(rangingOnly, current)).toBe(true);
    });

    it('treats the threshold boundary as NOT divergent (strict >)', () => {
        // L1 exactly 0.6
        const a = { trending: 0.7, ranging: 0.3 };
        const b = { trending: 0.4, ranging: 0.6 };
        expect(regimeMixL1(a, b)).toBeCloseTo(0.6, 5);
        expect(0.6).toBeGreaterThanOrEqual(REGIME_MIX_L1_THRESHOLD);
        expect(isRegimeMixDivergent(a, b)).toBe(false);
    });

    it('null mix on either side is never divergent', () => {
        expect(regimeMixL1(null, { trending: 1 })).toBeNull();
        expect(isRegimeMixDivergent(null, null)).toBe(false);
        expect(isRegimeMixDivergent({ trending: 1 }, null)).toBe(false);
    });

    it('auto-clears when fresh evidence re-converges the mixes', () => {
        const current = { trending: 0.83, ranging: 0.17 };
        const staleSkill = { ranging: 1 };          // whole library in the other regime
        const refreshedSkill = { trending: 0.83, ranging: 0.17 }; // evidence now tracks the market
        expect(isRegimeMixDivergent(staleSkill, current)).toBe(true);
        expect(isRegimeMixDivergent(refreshedSkill, current)).toBe(false);
    });
});

describe('regimeMixSentinel (live ledger cache)', () => {
    beforeEach(async () => {
        store = {};
        await hydrateRegimeLedger(USER);
        // 25 trending days + 5 ranging days ending today — a 30-day window.
        for (let i = 0; i < 25; i++) {
            await recordRegimeDay({ date: dateOf(i), coin: 'BTCUSDT', regime: 'trending' }, USER);
        }
        for (let i = 25; i < 30; i++) {
            await recordRegimeDay({ date: dateOf(i), coin: 'BTCUSDT', regime: 'ranging' }, USER);
        }
    });

    it('flags a skill evidenced in the OTHER regime and downweights it', () => {
        const rangingSkill = { regimeStats: { ranging: { w: 9, l: 1 } } };
        expect(isStaleByRegime(rangingSkill, 'BTCUSDT')).toBe(true);
        expect(regimeRankFactor(rangingSkill, 'BTCUSDT')).toBe(STALE_BY_REGIME_DOWNWEIGHT);
    });

    it('does not flag a skill evidenced in the dominant regime', () => {
        const trendingSkill = { regimeStats: { trending: { w: 9, l: 1 } } };
        expect(isStaleByRegime(trendingSkill, 'BTCUSDT')).toBe(false);
        expect(regimeRankFactor(trendingSkill, 'BTCUSDT')).toBe(1);
    });

    it('is silent when the ledger has no data for the coin', () => {
        const skill = { regimeStats: { ranging: { w: 9, l: 1 } } };
        expect(isStaleByRegime(skill, 'ETHUSDT')).toBe(false);
        expect(regimeRankFactor(skill, 'ETHUSDT')).toBe(1);
    });
});

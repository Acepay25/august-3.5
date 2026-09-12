/**
 * tradePlanLevels — the pure half of the harness level-watch: level ids are
 * stable per plan, touch detection is direction-aware, fired levels never
 * re-ping, the stale-plan guard suppresses tick-0 pings for dead/paid plans,
 * and the model-facing renderers name every level by id.
 */

import { describe, it, expect } from 'vitest';
import {
    buildPlanLevels, detectLevelHits, staleLevelsAtArm, describePlanForModel, formatLevelHitForModel,
    type WatchPlan,
} from '../services/trade/tradePlanLevels';

const LONG: WatchPlan = {
    planId: 'btc-abc', symbol: 'BTCUSDT', direction: 'Long',
    entry: 100, stopLoss: 90, takeProfits: [110, 120],
};
const SHORT: WatchPlan = {
    planId: 'eth-def', symbol: 'ETHUSDT', direction: 'Short',
    entry: 3000, stopLoss: 3100, takeProfits: [2900],
};

const never = (): boolean => false;

describe('buildPlanLevels', () => {
    it('derives ENTRY, SL and one TP level per target with stable ids', () => {
        const levels = buildPlanLevels(LONG);
        expect(levels.map(l => l.id)).toEqual(['btc-abc:ENTRY', 'btc-abc:SL', 'btc-abc:TP1', 'btc-abc:TP2']);
        expect(levels.map(l => l.kind)).toEqual(['entry', 'sl', 'tp', 'tp']);
        expect(levels[3].tpIndex).toBe(2);
        // Deterministic: same plan → same ids (the latch depends on it).
        expect(buildPlanLevels(LONG).map(l => l.id)).toEqual(levels.map(l => l.id));
    });
});

describe('detectLevelHits — Long (entry/SL below, TP above)', () => {
    it('entry fires on a pullback touch, and only once', () => {
        const levels = buildPlanLevels(LONG);
        const hits = detectLevelHits(levels, 'Long', 105, 100, never);
        expect(hits.map(h => h.levelId)).toEqual(['btc-abc:ENTRY']);
        expect(hits[0].hitPrice).toBe(100);
        // The latch suppresses a repeat on the next touch.
        expect(detectLevelHits(levels, 'Long', 100, 99, id => id === 'btc-abc:ENTRY')).toEqual([]);
    });

    it('a mid-tick crossing still fires (touch test subsumes the gap)', () => {
        const levels = buildPlanLevels(LONG);
        // Price leaps 101 → 88 in one tick, blowing through entry AND stop.
        const hits = detectLevelHits(levels, 'Long', 101, 88, never);
        expect(hits.map(h => h.levelId)).toEqual(['btc-abc:ENTRY', 'btc-abc:SL']);
    });

    it('TP fires above, not below; SL fires below, not above', () => {
        const levels = buildPlanLevels(LONG);
        expect(detectLevelHits(levels, 'Long', 109, 110, never).map(h => h.levelId)).toEqual(['btc-abc:TP1']);
        expect(detectLevelHits(levels, 'Long', 111, 109.9, never).map(h => h.levelId)).toEqual([]);
        // A tick that only dips between SL and entry touches nothing.
        expect(detectLevelHits(levels, 'Long', 95, 95, never).map(h => h.levelId)).toEqual([]);
        // The stop print crosses ENTRY too — with ENTRY already latched, only
        // the SL speaks.
        expect(detectLevelHits(levels, 'Long', 95, 90, id => id === 'btc-abc:ENTRY').map(h => h.levelId))
            .toEqual(['btc-abc:SL']);
    });

    it('an unchanged tick fires nothing (the 1s feed repeats its mark)', () => {
        const levels = buildPlanLevels(LONG);
        expect(detectLevelHits(levels, 'Long', 89, 89, never)).toEqual([]);
        // …but the FIRST tick (prev null) is judged on the plain touch test.
        expect(detectLevelHits(levels, 'Long', null, 89, never).map(h => h.levelId)).toEqual(['btc-abc:ENTRY', 'btc-abc:SL']);
    });

    it('garbage prices are ignored', () => {
        const levels = buildPlanLevels(LONG);
        expect(detectLevelHits(levels, 'Long', 100, NaN, never)).toEqual([]);
        expect(detectLevelHits(levels, 'Long', 100, 0, never)).toEqual([]);
    });
});

describe('detectLevelHits — Short (mirrored)', () => {
    it('entry/SL fire ABOVE, TP fires BELOW', () => {
        const levels = buildPlanLevels(SHORT);
        expect(detectLevelHits(levels, 'Short', 2950, 3000, never).map(h => h.levelId)).toEqual(['eth-def:ENTRY']);
        // The 3100 stop print also crosses the 3000 entry above it.
        expect(detectLevelHits(levels, 'Short', 3050, 3100, id => id === 'eth-def:ENTRY').map(h => h.levelId))
            .toEqual(['eth-def:SL']);
        expect(detectLevelHits(levels, 'Short', 2950, 2900, never).map(h => h.levelId)).toEqual(['eth-def:TP1']);
        expect(detectLevelHits(levels, 'Short', 2950, 2950, never)).toEqual([]);
    });
});

describe('staleLevelsAtArm — the stale-plan guard', () => {
    it('a plan already through its stop latches EVERY level silently', () => {
        // Long armed while the market sits below the stop — pinging "SL HIT"
        // on tick 0 for a dead plan is noise.
        expect(staleLevelsAtArm(LONG, 85).sort()).toEqual(
            ['btc-abc:ENTRY', 'btc-abc:SL', 'btc-abc:TP1', 'btc-abc:TP2'],
        );
    });

    it('a plan already at a target latches every level too', () => {
        expect(staleLevelsAtArm(LONG, 125)).toEqual(
            expect.arrayContaining(['btc-abc:SL']),
        );
        expect(staleLevelsAtArm(LONG, 125).length).toBe(4);
    });

    it('an entry already in range is NOT stale — the zone is live', () => {
        // Long armed at 95: below entry but above the stop → arm normally;
        // ENTRY fires on the first tick like any other touch.
        expect(staleLevelsAtArm(LONG, 95)).toEqual([]);
    });

    it('no price at arm (cold feed) → no suppression', () => {
        expect(staleLevelsAtArm(LONG, null)).toEqual([]);
    });
});

describe('describePlanForModel', () => {
    it('names each level with its id and flags fired ones', () => {
        const text = describePlanForModel(LONG, ['btc-abc:ENTRY']);
        expect(text).toContain('btc-abc:ENTRY');
        expect(text).toContain('Entry 100 — FIRED [btc-abc:ENTRY]');
        expect(text).toContain('Stop loss 90 [btc-abc:SL]');
        expect(text).toContain('Already fired: btc-abc:ENTRY');
        expect(text).toContain('never re-announce');
        expect(text).toContain('Advisory only');
    });
    it('fresh plan says nothing has fired', () => {
        expect(describePlanForModel(LONG, [])).toContain('No level has fired yet');
    });
});

describe('formatLevelHitForModel — the harness signal', () => {
    it('names the plan, the hit level by id, the mark, and prior fires', () => {
        const levels = buildPlanLevels(LONG);
        const [hit] = detectLevelHits(levels, 'Long', 110.5, 110, () => false);
        const text = formatLevelHitForModel(LONG, hit, ['btc-abc:ENTRY', 'btc-abc:TP1']);
        expect(text).toMatch(/^\[HARNESS SIGNAL — price event, not the user\]/);
        expect(text).toContain('Plan btc-abc: TP1 @ 110 HIT (mark 110');
        expect(text).toContain('Level id btc-abc:TP1');
        // The other fired level is listed; the just-fired one is not.
        expect(text).toContain('Already fired: btc-abc:ENTRY');
        expect(text).toContain('refer to levels by id');
        expect(text).toContain('Do not re-announce fired levels');
    });
    it('a first fire says so explicitly', () => {
        const hit = { levelId: 'eth-def:SL', kind: 'sl' as const, label: 'Stop loss', price: 3100, hitPrice: 3105, at: Date.now() };
        expect(formatLevelHitForModel(SHORT, hit, [])).toContain('This is the first level of this plan to fire');
    });
});

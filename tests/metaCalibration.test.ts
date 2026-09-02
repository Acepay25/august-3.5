import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.5b — Meta-calibration: the loop learns about the loop. Three
// deterministic ratios (worth-gate precision / refinement recovery /
// eval-verdict agreement) maintained by recorders at the ground-truth points,
// computed + persisted weekly, with a P7 harness-lesson when the worth gate's
// precision decays. The harness-lesson store is localStorage-backed (jsdom).

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
    recordWorthGateApproval,
    recordWorthGateConfirm,
    recordRefinementOutcome,
    recordEvalAgreement,
    computeMetaCalibrationRatios,
    loadMetaCalibration,
    runWeeklyMetaCalibration,
    META_PRECISION_FLOOR,
    META_GATE_SAMPLE_MIN,
} from '../services/learning/metaCalibration';
import { listHarnessLessons, resetHarnessLessonCache } from '../services/learning/harnessLessons';

const USER = 'mc-user';

describe('meta-calibration recorders', () => {
    beforeEach(() => {
        store = {};
        resetHarnessLessonCache();
        localStorage.clear();
    });

    it('tracks a gate approval → first confirm via the pending watch', async () => {
        await recordWorthGateApproval(USER, 'BTC short setup');
        await recordWorthGateConfirm(USER, 'BTC short setup');
        const d = await loadMetaCalibration(USER);
        expect(d.worthGateApproved).toBe(1);
        expect(d.worthGateConfirmed).toBe(1);
        expect(d.pendingGateWatch).toEqual([]);
        expect(computeMetaCalibrationRatios(d).worthGatePrecision).toBe(1);
    });

    it('never confirms a skill the gate did not approve', async () => {
        await recordWorthGateConfirm(USER, 'btc short setup');
        const d = await loadMetaCalibration(USER);
        expect(d.worthGateConfirmed).toBe(0);
        expect(d.pendingGateWatch).toHaveLength(0);
    });

    it('an approved-but-unconfirmed skill stays in the pending watch', async () => {
        await recordWorthGateApproval(USER, 'btc short setup');
        const d = await loadMetaCalibration(USER);
        expect(d.worthGateConfirmed).toBe(0);
        expect(d.pendingGateWatch).toContain('btc short setup');
        expect(computeMetaCalibrationRatios(d).worthGatePrecision).toBe(0);
    });

    it('counts refinements and eval agreement once per verdict era', async () => {
        await recordRefinementOutcome(USER, true);
        await recordRefinementOutcome(USER, false);
        await recordEvalAgreement(USER, 's.md|2026-01-01T00:00:00Z', true);
        // Same era again — must NOT double count (including an opposite view).
        await recordEvalAgreement(USER, 's.md|2026-01-01T00:00:00Z', false);
        await recordEvalAgreement(USER, 's.md|2026-02-01T00:00:00Z', false);
        const d = await loadMetaCalibration(USER);
        expect(d.refinements).toBe(2);
        expect(d.refinementsRecovered).toBe(1);
        expect(d.evalVerdicts).toBe(2);
        expect(d.evalVerdictsAgreed).toBe(1);
        const r = computeMetaCalibrationRatios(d);
        expect(r.refinementRecovery).toBe(0.5);
        expect(r.evalAgreement).toBe(0.5);
    });

    it('empty data yields null ratios (no sample = no claim)', async () => {
        const d = await loadMetaCalibration(USER);
        expect(computeMetaCalibrationRatios(d)).toEqual({
            worthGatePrecision: null,
            refinementRecovery: null,
            evalAgreement: null,
        });
    });
});

describe('runWeeklyMetaCalibration', () => {
    beforeEach(() => {
        store = {};
        resetHarnessLessonCache();
        localStorage.clear();
    });

    it('persists ratios and emits a decay lesson when the gate precision falls below the floor', async () => {
        const approvals = META_GATE_SAMPLE_MIN + 1;
        for (let i = 0; i < approvals; i++) {
            await recordWorthGateApproval(USER, `cond ${i}`);
        }
        await recordWorthGateConfirm(USER, 'cond 0'); // 1 of 11 confirmed
        const ratios = await runWeeklyMetaCalibration(USER);
        expect(ratios.worthGatePrecision).toBeCloseTo(1 / approvals, 5);
        expect(ratios.worthGatePrecision).toBeLessThan(META_PRECISION_FLOOR);
        const decayLessons = listHarnessLessons().filter(l => l.pattern === 'worth-gate-precision-decay');
        expect(decayLessons).toHaveLength(1);
        expect(decayLessons[0].lesson.length).toBeGreaterThan(20); // contains a proposal, not a stub
    });

    it('does not emit the decay lesson below the sample floor', async () => {
        await recordWorthGateApproval(USER, 'good cond');
        await recordWorthGateConfirm(USER, 'good cond');
        await runWeeklyMetaCalibration(USER); // 1 approval < floor sample
        expect(listHarnessLessons().filter(l => l.pattern === 'worth-gate-precision-decay')).toHaveLength(0);
    });

    it('does not emit the decay lesson above the floor', async () => {
        const n = META_GATE_SAMPLE_MIN;
        for (let i = 0; i < n; i++) {
            await recordWorthGateApproval(USER, `ok cond ${i}`);
            await recordWorthGateConfirm(USER, `ok cond ${i}`); // 100% precision
        }
        await runWeeklyMetaCalibration(USER);
        expect(listHarnessLessons().filter(l => l.pattern === 'worth-gate-precision-decay')).toHaveLength(0);
    });
});

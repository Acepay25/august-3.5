/**
 * The per-DAY half of stage 20r's plan quota. The per-run half is a turn-local
 * counter and dies with the turn; this one has to survive a reload, a crash and
 * the eight hours between runs — which is why it is storage, and why the
 * boundary is a LOCAL calendar day: a trader who schedules "every morning at
 * 09:00" means their morning, and a UTC boundary would spend two days of quota
 * in one local afternoon.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prefStore = vi.hoisted(() => new Map<string, unknown>());
const prefFns = vi.hoisted(() => ({
    getPreferenceObject: vi.fn(async (k: string) => prefStore.get(k)),
    getPreferenceArray: vi.fn(async (k: string) => prefStore.get(k) ?? []),
    setPreferenceObject: vi.fn(async (k: string, v: unknown) => { prefStore.set(k, v); }),
    removePreference: vi.fn(async (k: string) => { prefStore.delete(k); }),
}));
vi.mock('../services/infrastructure/PreferencesService', () => prefFns);

import {
    automationPlanDay, loadAutomationPlanCount, recordAutomationPlan, MAX_PLANS_PER_DAY,
} from '../services/automation/AutomationService';

const KEY = 'automation_plans_v1_tester_a1';

describe('automationPlanDay', () => {
    it('is the LOCAL calendar day, zero-padded', () => {
        expect(automationPlanDay(new Date(2026, 9, 18, 23, 59, 59))).toBe('2026-10-18');
        expect(automationPlanDay(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
    });

    it('rolls over at local midnight, not at a UTC one', () => {
        // Two instants one hour apart that straddle local midnight; whatever the
        // host offset, they must not share a day label if they are on different
        // local dates — which is the property the cap depends on.
        const before = new Date(2026, 9, 18, 23, 30);
        const after = new Date(2026, 9, 19, 0, 30);
        expect(automationPlanDay(before)).not.toBe(automationPlanDay(after));
    });
});

describe('the day ledger', () => {
    beforeEach(() => prefStore.clear());

    it('counts up and returns the number AFTER this plan', async () => {
        expect(await recordAutomationPlan('tester', 'a1')).toBe(1);
        expect(await recordAutomationPlan('tester', 'a1')).toBe(2);
        expect(await loadAutomationPlanCount('tester', 'a1')).toBe(2);
    });

    it('reads a stale day as zero, so a full ledger cannot stick', async () => {
        prefStore.set(KEY, { day: '1999-01-01', count: 99 });
        expect(await loadAutomationPlanCount('tester', 'a1')).toBe(0);
        expect(await recordAutomationPlan('tester', 'a1')).toBe(1);
        expect((prefStore.get(KEY) as { day: string }).day).toBe(automationPlanDay());
    });

    it('reads junk — a number, a wrong shape, a missing count — as zero', async () => {
        for (const junk of [42, null, { day: automationPlanDay() }, { count: 3 }, 'x']) {
            prefStore.set(KEY, junk);
            expect(await loadAutomationPlanCount('tester', 'a1')).toBe(0);
        }
    });

    it('still returns the plan when the write is refused, because losing the run is worse', async () => {
        // A full origin quota rejects the write while the cache keeps serving.
        prefFns.setPreferenceObject.mockRejectedValueOnce(new Error('quota exceeded'));
        await expect(recordAutomationPlan('tester', 'a1')).resolves.toBe(1);
    });

    it('is per automation, so one busy schedule cannot spend another’s quota', async () => {
        await recordAutomationPlan('tester', 'a1');
        expect(await loadAutomationPlanCount('tester', 'a2')).toBe(0);
    });

    it('caps a day at a handful of plans, never at zero', () => {
        expect(MAX_PLANS_PER_DAY).toBeGreaterThan(0);
        expect(MAX_PLANS_PER_DAY).toBeLessThanOrEqual(5);
    });
});

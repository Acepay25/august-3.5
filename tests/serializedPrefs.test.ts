import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regressions for the 2026-09-15 deep-dive "unlocked read-modify-write on
// shared prefs" class: the serializedPrefs helper, the hardened
// getPreferenceArray read, and the two recorders (MemoryInjectionService,
// metaCalibration) plus the raw-blob consumers (AutomationService,
// passMining) routed through them.
//
// These run against the REAL PreferencesService on jsdom localStorage (the
// native Capacitor path is what's stubbed), so the read/write race under
// test is the production one.

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/preferences', () => ({
    Preferences: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
    },
}));
// metaCalibration's lesson sink would drag the whole harness-lesson store in;
// it is not under test here.
vi.mock('../services/learning/harnessLessons', () => ({
    recordHarnessLesson: vi.fn(),
}));

import {
    getPreferenceObject,
    getPreferenceArray,
    setPreferenceObject,
} from '../services/infrastructure/PreferencesService';
import { withSerializedPref } from '../services/infrastructure/serializedPrefs';
import {
    recordMemoryInjection,
    getRecentMemoryInjections,
} from '../services/learning/MemoryInjectionService';
import {
    recordWorthGateApproval,
    recordWorthGateConfirm,
    recordRefinementOutcome,
    recordEvalAgreement,
    loadMetaCalibration,
} from '../services/learning/metaCalibration';
import { loadAutomationConfigs, loadAutomationRuns } from '../services/automation/AutomationService';
import { loadPassRecords } from '../services/learning/passMining';

const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

describe('withSerializedPref (per-key promise queue)', () => {
    it('serializes tasks on the same key: reads never interleave with another task\'s write', async () => {
        const order: string[] = [];
        const a = withSerializedPref('q1', async () => {
            order.push('a-start');
            await sleep(20);
            order.push('a-end');
            return 'A';
        });
        const b = withSerializedPref('q1', async () => {
            order.push('b-start');
            await sleep(1);
            order.push('b-end');
            return 'B';
        });
        expect(await Promise.all([a, b])).toEqual(['A', 'B']);
        expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    });

    it('does not block tasks under a different key', async () => {
        const order: string[] = [];
        const a = withSerializedPref('kA', async () => {
            order.push('a-start');
            await sleep(20);
            order.push('a-end');
        });
        const b = withSerializedPref('kB', async () => {
            order.push('b-start');
        });
        await Promise.all([a, b]);
        // b ran concurrently — it finished while a still slept.
        expect(order[0]).toBe('a-start');
        expect(order[1]).toBe('b-start');
    });

    it('a rejecting task propagates to its caller but does not poison the queue', async () => {
        await expect(withSerializedPref('kP', async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        const after = await withSerializedPref('kP', async () => 'ok');
        expect(after).toBe('ok');
    });
});

describe('getPreferenceArray (checked array read)', () => {
    beforeEach(() => localStorage.clear());

    it('returns [] for missing, unparseable, object, and scalar blobs', async () => {
        expect(await getPreferenceArray('pa-nothing')).toEqual([]);
        localStorage.setItem('pa-corrupt', '{nope');
        expect(await getPreferenceArray('pa-corrupt')).toEqual([]);
        await setPreferenceObject('pa-object', { not: 'an array' });
        expect(await getPreferenceArray('pa-object')).toEqual([]);
        await setPreferenceObject('pa-number', 42);
        expect(await getPreferenceArray('pa-number')).toEqual([]);
    });

    it('drops junk items through the guard (nulls, strings, wrong shapes)', async () => {
        await setPreferenceObject('pa-mixed', [
            null,
            'junk',
            7,
            { id: 'keep-1', schedule: { cron: '* * * * *' } },
            { name: 'missing id' },
        ]);
        const ok = await getPreferenceArray<{ id: string }>(
            'pa-mixed',
            (item): item is { id: string } =>
                !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
        );
        expect(ok.map(x => x.id)).toEqual(['keep-1']);
        // Without a guard only the Array.isArray check applies — items pass.
        const raw = await getPreferenceArray<unknown>('pa-mixed');
        expect(raw).toHaveLength(5);
        // A clean empty array stays an empty array (not null-fallback).
        await setPreferenceObject('pa-empty', []);
        expect(await getPreferenceArray('pa-empty')).toEqual([]);
    });

    it('hardens the exact sites the audit flagged: automation + pass blobs', async () => {
        // Junk configs used to flow straight into the scheduler's .map/.filter.
        await setPreferenceObject('automations_v1_harden-u', ['x', null, 5]);
        expect(await loadAutomationConfigs('harden-u')).toEqual([]);
        // Mixed: only the structurally valid config survives.
        await setPreferenceObject('automations_v1_harden-u', [
            null,
            { id: 'a1', name: 'Morning scan', enabled: true, schedule: { cron: '0 9 * * *' } },
            { id: 999, name: 'bad id type', enabled: true, schedule: { cron: '* * * * *' } },
            { id: 'a2', name: 'no schedule' },
        ]);
        const configs = await loadAutomationConfigs('harden-u');
        expect(configs.map(c => c.id)).toEqual(['a1']);

        await setPreferenceObject('automation_runs_v1_harden-u_x1', [42, 'nope']);
        expect(await loadAutomationRuns('harden-u', 'x1')).toEqual([]);

        // Pass records: unknown resolutions must not survive into the sweep's
        // known-map / clustering.
        await setPreferenceObject('pass_mining_v1_harden-u', [
            null,
            { tradeId: 't1', resolution: 'WAT?' },
            { tradeId: 't2', resolution: 'CORRECT_PASS', coin: 'BTCUSDT' },
            { resolution: 'OPEN' },
        ]);
        const records = await loadPassRecords('harden-u');
        expect(records.map(r => r.tradeId)).toEqual(['t2']);
    });
});

describe('MemoryInjectionService serialized RMW', () => {
    beforeEach(() => localStorage.clear());

    it('two (many) concurrent appends ALL survive — the lost-update class', async () => {
        const user = 'inj-race';
        await Promise.all([
            recordMemoryInjection(user, { stage: 'opening', audience: 'seat1', runId: 'r1', sources: [{ path: 'skills/a.md', kind: 'skill' }] }),
            recordMemoryInjection(user, { stage: 'opening', audience: 'seat2', runId: 'r1', sources: [{ path: 'skills/b.md', kind: 'skill' }] }),
            recordMemoryInjection(user, { stage: 'verdict', audience: 'moderator', runId: 'r1', sources: [{ path: 'skills/a.md', kind: 'skill' }] }),
        ]);
        const recs = await getRecentMemoryInjections(user);
        // Unserialized, concurrent read→append→write collapsed this to 1.
        expect(recs).toHaveLength(3);
        expect(recs.map(r => r.stage).sort()).toEqual(['opening', 'opening', 'verdict']);
    });

    it('getRecentMemoryInjections drops junk records (never feeds r.sources throws)', async () => {
        const user = 'inj-junk';
        await setPreferenceObject(`memory_injections_v1_${user}`, [
            { ts: '2026-09-15T00:00:00.000Z', stage: 'verdict', audience: 'mod', sources: [{ path: 'skills/a.md', kind: 'skill' }] },
            null,
            'junk',
            { stage: 'no-ts-no-sources' },
        ]);
        const recs = await getRecentMemoryInjections(user);
        expect(recs).toHaveLength(1);
        expect(recs[0].stage).toBe('verdict');
    });
});

describe('metaCalibration serialized RMW', () => {
    beforeEach(() => localStorage.clear());

    it('concurrent recorders all land (counters + watch list survive the race)', async () => {
        const user = 'meta-race';
        await Promise.all([
            recordWorthGateApproval(user, 'IF BTC short in Family A'),
            recordWorthGateApproval(user, 'IF ETH long in Family B'),
            recordRefinementOutcome(user, true),
            recordEvalAgreement(user, 'era-1', true),
        ]);
        const d = await loadMetaCalibration(user);
        // Without the per-key queue the last read (all four read the SAME
        // empty blob) wins and the others vanish.
        expect(d.worthGateApproved).toBe(2);
        expect(d.pendingGateWatch).toHaveLength(2);
        expect(d.refinements).toBe(1);
        expect(d.refinementsRecovered).toBe(1);
        expect(d.evalVerdicts).toBe(1);
        expect(d.evalErasCounted).toEqual(['era-1']);
    });

    it('approval → confirm keeps the watch ledger consistent under concurrency', async () => {
        const user = 'meta-confirm';
        await Promise.all([
            recordWorthGateApproval(user, 'IF a'),
            recordWorthGateApproval(user, 'IF b'),
            recordWorthGateApproval(user, 'IF c'),
        ]);
        await Promise.all([
            recordWorthGateConfirm(user, 'IF a'),
            recordWorthGateConfirm(user, 'IF b'),
        ]);
        const d = await loadMetaCalibration(user);
        expect(d.worthGateApproved).toBe(3);
        expect(d.worthGateConfirmed).toBe(2);
        expect(d.pendingGateWatch).toEqual(['if c']);
    });

    it('a junk persisted blob is normalized, not spread into poison', async () => {
        const user = 'meta-junk';
        await setPreferenceObject(`meta_calibration_v1_${user}`, {
            worthGateApproved: 'many',
            pendingGateWatch: { 0: 'not-an-array' },
            evalErasCounted: [null, 'era-ok', 7],
        });
        // The recorder must survive the junk blob and count normally instead
        // of the old TypeError-in-a-catch silent drop.
        await recordWorthGateApproval(user, 'IF next');
        const d = await loadMetaCalibration(user);
        expect(d.worthGateApproved).toBe(1);
        expect(d.pendingGateWatch).toEqual(['if next']);
        expect(d.evalErasCounted).toEqual(['era-ok']);
    });
});

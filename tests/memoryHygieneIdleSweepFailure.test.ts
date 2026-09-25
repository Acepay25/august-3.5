/**
 * A provider that is offline must not cost the pass everything after it.
 *
 * `runSkillIdleSweep` is the only step of the hygiene pass that needs the
 * network. It was the one call left unguarded, so a connection error in it
 * landed in the pass-wide catch and skipped steps 6 (veto retraction) and 7
 * (lift review) — both pure arithmetic over data already on disk — and the
 * Health tab lost their verdicts over a transient network fault.
 *
 * Observed in the running app, not theorised: the stored log read
 *   "Idle sweep ABORTED: OpenRouter · anthropic/claude-opus-4: Connection
 *    error.. Whatever it switched before failing is already applied"
 * with no veto or lift line anywhere in the pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string) => {
        const raw = store[key];
        return Array.isArray(raw) ? raw : [];
    }),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const { idleSweep } = vi.hoisted(() => ({ idleSweep: vi.fn() }));
vi.mock('../services/learning/skillIdleLifecycle', async importOriginal => {
    const actual = await importOriginal<typeof import('../services/learning/skillIdleLifecycle')>();
    return { ...actual, runSkillIdleSweep: idleSweep };
});

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { runMemoryHygiene, loadHygieneLog } from '../services/learning/memoryHygiene';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';

const USER = 'hygiene-offline-provider';

beforeEach(async () => {
    store = {};
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    idleSweep.mockReset();
    await initMemoryFiles(USER);
});

describe('hygiene pass survives a provider outage', () => {
    it('records the idle-sweep failure and still runs the steps after it', async () => {
        idleSweep.mockRejectedValue(new Error('Connection error.'));

        const res = await runMemoryHygiene(USER, { providerConfigs: [], trades: [] });

        const texts = (await loadHygieneLog(USER)).map(l => l.text);
        const joined = texts.join('\n');

        // The failure is reported, not swallowed…
        expect(joined).toMatch(/Idle skill sweep did not run/i);
        expect(joined).toMatch(/Connection error/);
        // …and the two steps that need no network both still reported.
        expect(joined).toMatch(/Veto ledger/i);
        expect(joined).toMatch(/Lift review/i);

        // The pass returned normally instead of taking the abort branch: the
        // graveyard is the last step to report, and its result came back set.
        expect(res.graveyardCollected).toBe(0);
        expect(joined).not.toMatch(/ABORTED/);
    });

    it('still stamps the log, so isHygieneDue sees a finished pass', async () => {
        idleSweep.mockRejectedValue(new Error('Connection error.'));

        await runMemoryHygiene(USER, { providerConfigs: [] });

        // The pass logged a timestamped entry rather than dying silently —
        // the due-check reads the newest line's atMs.
        const log = await loadHygieneLog(USER);
        expect(log.length).toBeGreaterThan(0);
        expect(log[log.length - 1].atMs).toBeGreaterThan(0);
    });

    it('leaves a working sweep exactly as it was', async () => {
        idleSweep.mockResolvedValue({
            examined: 3, suspended: [], revived: [], archived: [], lines: [], exempt: 0, configError: null,
        });

        const res = await runMemoryHygiene(USER, { providerConfigs: [], trades: [] });

        expect(res.skillsSuspended).toBe(0);
        expect(res.skillsRevived).toBe(0);
        const joined = (await loadHygieneLog(USER)).map(l => l.text).join('\n');
        expect(joined).toMatch(/Idle skill sweep: 3 skills inspected/);
        expect(joined).not.toMatch(/did not run/);
    });
});

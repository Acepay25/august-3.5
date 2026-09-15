import { describe, it, expect, vi, beforeEach } from 'vitest';

// GlobalLearningService init-guard regressions (deep-dive 2026-09-15, item 2):
// a FAILED calibration load must never be treated as "initialized" — the old
// catch set _isInitialized=true, so the next updateCalibration persisted the
// constructor's EMPTY state over the user's real history.

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
    },
    Directory: { Data: 'data' },
    Encoding: { UTF8: 'utf8' },
}));

let prefGetCalls = 0;
let prefGetImpl: (key: string) => unknown = () => null;
let prefWrites: Array<{ key: string; value: unknown }> = [];
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => {
        prefGetCalls += 1;
        return prefGetImpl(key) ?? null;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        prefWrites.push({ key, value });
    }),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = prefGetImpl(key);
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    removePreference: vi.fn(async () => { /* unused */ }),
}));

import { Filesystem } from '@capacitor/filesystem';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import type { GranularCalibrationEntry } from '../types';

const readFileMock = Filesystem.readFile as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = Filesystem.writeFile as unknown as ReturnType<typeof vi.fn>;

/** Web-build reality: the Capacitor filesystem always rejects, so Preferences
 *  is the only store. */
const fsUnavailableOnWeb = (): void => {
    readFileMock.mockRejectedValue(new Error('Filesystem.readFile() is not implemented on web platforms!'));
    writeFileMock.mockRejectedValue(new Error('Filesystem.writeFile() is not implemented on web platforms!'));
};

const entry = (n: number): GranularCalibrationEntry => ({
    timestamp: `2026-09-1${n}T12:00:00.000Z`,
    confidence: 'High',
    outcome: 'WIN',
    coin: 'BTCUSDT',
});

/** A stored calibration that updateCalibration must never clobber blindly. */
const storedCalibration = () => ({
    overallStats: { wins: 40, losses: 10, total: 50 },
    confidenceLevels: {},
    granularEntries: [{ marker: 'REAL-HISTORY-ENTRY' }],
    lastUpdated: '2026-09-01T00:00:00.000Z',
});

describe('GlobalLearningService init/load guards', () => {
    beforeEach(async () => {
        prefGetCalls = 0;
        prefWrites = [];
        prefGetImpl = () => null;
        // Start from a known-unloaded state for every test.
        await GlobalLearningService.setActiveUser(`user-${Math.random().toString(36).slice(2, 8)}`);
    });

    it('a storage-unreachable load does NOT mark initialized, and the next update never saves', async () => {
        fsUnavailableOnWeb();
        prefGetImpl = () => { throw new Error('QuotaExceededError: storage unreachable'); };
        const user = 'gl-unreachable';
        await GlobalLearningService.setActiveUser(user);

        // updateCalibration re-attempts the load (fails again) and must
        // REFUSE — neither the filesystem nor the Preferences fallback may
        // receive the empty baseline.
        await GlobalLearningService.updateCalibration(entry(1));
        expect(writeFileMock).not.toHaveBeenCalled();
        expect(prefWrites).toHaveLength(0);
    });

    it('after a failed load, a recovered store still holds the real history', async () => {
        fsUnavailableOnWeb();
        prefGetImpl = () => { throw new Error('storage unreachable'); };
        await GlobalLearningService.setActiveUser('gl-recover');
        await GlobalLearningService.updateCalibration(entry(1));
        expect(prefWrites).toHaveLength(0);

        // Storage recovers with the user's real calibration on disk.
        prefGetImpl = (key: string) => (key.includes('gl-recover') ? storedCalibration() : null);
        await GlobalLearningService.updateCalibration(entry(2));

        expect(prefWrites.length).toBeGreaterThan(0);
        const saved = prefWrites[prefWrites.length - 1].value as ReturnType<typeof storedCalibration>;
        // The update applied ON TOP of the loaded history, not over it.
        expect(JSON.stringify(saved)).toContain('REAL-HISTORY-ENTRY');
    });

    it('a successful empty load (fresh user) marks initialized and saves', async () => {
        fsUnavailableOnWeb();
        prefGetImpl = () => null;
        await GlobalLearningService.setActiveUser('gl-fresh');
        await GlobalLearningService.updateCalibration(entry(1));
        // Fresh user + readable (empty) storage → the save is legitimate.
        expect(prefWrites.some(w => w.key.includes('gl-fresh'))).toBe(true);
    });

    it('initialize() is memoized: concurrent callers share one load', async () => {
        fsUnavailableOnWeb();
        // A FAILING load keeps _isInitialized false, which is when concurrent
        // initialize() calls must collapse onto the single in-flight promise.
        prefGetImpl = () => { throw new Error('storage offline'); };
        prefGetCalls = 0;
        const switcher = GlobalLearningService.setActiveUser(null);
        const p1 = GlobalLearningService.initialize();
        const p2 = GlobalLearningService.initialize();
        expect(p1).toBe(p2);
        await Promise.all([switcher, p1, p2]);
        // Exactly ONE load ran — the double-init race used to fire two.
        expect(prefGetCalls).toBe(1);
    });

    it('a superseded (profile-switched) in-flight load does not mark initialized for the new user', async () => {
        fsUnavailableOnWeb();
        let release: (v: null) => void = () => undefined;
        let getCall = 0;
        prefGetImpl = () => {
            getCall += 1;
            // Only the FIRST read (the old profile's scoped key) stalls; the
            // rest resolve empty so each load finishes cleanly.
            return getCall === 1
                ? new Promise<null>(resolve => { release = resolve; })
                : null;
        };
        const slow = GlobalLearningService.setActiveUser('gl-slow');
        const superseded = GlobalLearningService.setActiveUser('gl-new');
        // Yield first: the stalled load's promise (and its `release`) only
        // get created once the queued Filesystem rejections resume.
        await new Promise(resolve => setTimeout(resolve, 0));
        // The switch bumped the generation; unblock the stale first load.
        release(null);
        await Promise.all([slow, superseded]);
        // Any save that happens now must belong to the CURRENT user only.
        prefWrites = [];
        await GlobalLearningService.updateCalibration(entry(3));
        // gl-new loaded successfully (empty) → the save is legitimate, and it
        // never touches the superseded gl-slow key.
        for (const w of prefWrites) {
            expect(String(w.key)).toContain('gl-new');
        }
    });
});

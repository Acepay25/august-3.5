/**
 * A notebook at its trigger tier must CAUSE a cleanup, not just report one.
 *
 * The budget from workstream #2 had three effects: measure, refuse growth, and
 * log. The pass that shrinks the blob was scheduled purely by a 7-day clock, and
 * `cleanupIsDue` — the dedup helper written for the pressure path — had no
 * production caller at all, so reaching the trigger tier could leave the blob
 * oversized for six more days with a green test suite the whole time.
 *
 * These assert the wiring in both directions: pressure shortens the wait, the
 * dedup window bounds how often it may do so, and nothing about the weekly rule
 * gets longer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    stored: null as { lines?: Array<{ atMs: number; text: string }> } | null,
    wantsCleanup: false,
}));

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async () => h.stored),
    setPreferenceObject: vi.fn(async () => {}),
    removePreference: vi.fn(async () => {}),
}));

// The notebook's live measurement, which `isHygieneDue` now consults. Mocked at
// the seam so this stays a test of the SCHEDULER, not of blob serialization.
vi.mock('../services/learning/MemoryFilesService', () => ({
    notebookWantsCleanup: () => h.wantsCleanup,
}));

import { isHygieneDue } from '../services/learning/memoryHygiene';
import { CLEANUP_DEDUP_WINDOW_MS } from '../utils/memoryBudget';

const USER = 'pressure-tester';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const stampLastPassAt = (atMs: number | null) => {
    h.stored = atMs === null ? null : { lines: [{ atMs, text: 'pass' }] };
};

describe('the pressure path into the hygiene scheduler', () => {
    beforeEach(() => {
        h.wantsCleanup = false;
        stampLastPassAt(null);
    });

    it('is not due on a fresh-enough pass with no pressure', async () => {
        stampLastPassAt(NOW - 3 * DAY_MS);
        expect(await isHygieneDue(USER, NOW)).toBe(false);
    });

    it('runs the weekly clock when the notebook is comfortable', async () => {
        stampLastPassAt(NOW - 8 * DAY_MS);
        expect(await isHygieneDue(USER, NOW)).toBe(true);
    });

    it('shortens the wait when the notebook reaches its trigger tier', async () => {
        // Three days in, the weekly rule says wait four more. The budget says now.
        stampLastPassAt(NOW - 3 * DAY_MS);
        h.wantsCleanup = true;
        expect(await isHygieneDue(USER, NOW)).toBe(true);
    });

    it('dedups the pressure path so a pass cannot be launched every keystroke', async () => {
        stampLastPassAt(NOW - Math.floor(CLEANUP_DEDUP_WINDOW_MS / 2));
        h.wantsCleanup = true;
        expect(await isHygieneDue(USER, NOW)).toBe(false);
    });

    it('re-arms for pressure once the dedup window has passed', async () => {
        stampLastPassAt(NOW - CLEANUP_DEDUP_WINDOW_MS - 1000);
        h.wantsCleanup = true;
        expect(await isHygieneDue(USER, NOW)).toBe(true);
    });

    it('never LENGTHENS the wait because a pass ran recently', async () => {
        // A week-old pass is due whatever the notebook looks like.
        stampLastPassAt(NOW - 9 * DAY_MS);
        h.wantsCleanup = false;
        expect(await isHygieneDue(USER, NOW)).toBe(true);
        h.wantsCleanup = true;
        expect(await isHygieneDue(USER, NOW)).toBe(true);
    });

    it('treats an unmeasured notebook as no request, so boot order cannot stall it', async () => {
        // MemoryFilesService reports null before the blob loads: the weekly rule
        // still decides, and the pressure rule never claims a pass it cannot see.
        stampLastPassAt(NOW - 2 * DAY_MS);
        h.wantsCleanup = false;
        expect(await isHygieneDue(USER, NOW)).toBe(false);
    });

    it('runs a first-ever pass regardless of pressure', async () => {
        stampLastPassAt(null);
        expect(await isHygieneDue(USER, NOW)).toBe(true);
    });
});

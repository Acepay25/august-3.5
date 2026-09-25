/**
 * WS-4 — the graveyard retention sweep.
 *
 * `skillGraveyard` declares exactly one retention rule: the newest
 * `MAX_TOMBSTONES` records (applied by `write`, honored by `read`). The sweep
 * enforces THAT against what is already persisted and clears the rows every
 * reader already ignores — it invents no age window, because the store has
 * none: a retirement record stays useful as long as the archived skill file it
 * mirrors, and revival is a draft-time test (`findArchiveTwin`), not a timer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { runMemoryHygiene, loadHygieneLog } from '../services/learning/memoryHygiene';
import {
    runGraveyardSweep, listTombstones, graveyardBlock, MAX_TOMBSTONES,
    recordTombstone, type SkillTombstone,
} from '../services/learning/skillGraveyard';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';

const USER = 'graveyard-sweep-user';
const PREF_KEY = `skill_graveyard_v1_${USER}`;
const DAY = 86_400_000;

const tomb = (slug: string, ageDays: number): SkillTombstone => ({
    slug,
    reason: 'insufficient-evidence',
    sampleN: 4,
    liftPts: -2,
    retiredAt: new Date(Date.now() - ageDays * DAY).toISOString(),
});

/** Seed past `recordTombstone` on purpose: its `write` applies the cap, so the
 *  only way to hold a store that outgrew retention is the way it actually
 *  happens — rows persisted before the cap existed, or by a path that skipped
 *  `write`. */
const seedRaw = (rows: unknown[]): void => { store[PREF_KEY] = rows; };

beforeEach(async () => {
    store = {};
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    await initMemoryFiles(USER);
});

describe('runGraveyardSweep', () => {
    it('collects only what the declared retention already excludes', async () => {
        // s-0 is the newest … s-41 the oldest; plus one unreadable row and one
        // stale shadow of s-7 (an older record for a slug since refreshed).
        const rows: unknown[] = Array.from({ length: MAX_TOMBSTONES + 2 },
            (_, i) => tomb(`s-${i}`, i));
        rows.push({ reason: 'eval-hurts' } as unknown as SkillTombstone); // no slug
        rows.push(tomb('s-7', 999));                                      // duplicate
        seedRaw(rows);
        expect(rows).toHaveLength(MAX_TOMBSTONES + 4);

        const res = await runGraveyardSweep(USER);
        expect(res).toEqual({
            examined: MAX_TOMBSTONES + 4,
            malformed: 1,
            duplicates: 1,
            // s-40 and s-41 are the two past the newest-40 boundary.
            expired: 2,
            retained: MAX_TOMBSTONES,
            collected: 4,
            wrote: true,
        });

        const kept = await listTombstones(USER);
        expect(kept).toHaveLength(MAX_TOMBSTONES);
        expect(kept[0].slug).toBe('s-0');
        expect(kept[kept.length - 1].slug).toBe('s-39');
        // LIVE (inside retention) entries survive untouched…
        expect(kept.map(t => t.slug)).toContain('s-39');
        expect(kept.map(t => t.slug)).not.toContain('s-40');
        expect(kept.map(t => t.slug)).not.toContain('s-41');
        // …and the duplicate collapses to the NEWEST record for that slug.
        const s7 = kept.find(t => t.slug === 's-7')!;
        expect(Date.parse(s7.retiredAt)).toBeGreaterThan(Date.now() - 8 * DAY);
        // Nothing else about the block changed shape.
        expect((await graveyardBlock(USER)).split('\n')).toHaveLength(MAX_TOMBSTONES);
    });

    it('leaves an inside-retention graveyard alone and says so', async () => {
        await recordTombstone(USER, { slug: 'recent-retire', reason: 'eval-hurts', sampleN: 6, liftPts: -4 });
        const before = await listTombstones(USER);

        const res = await runGraveyardSweep(USER);
        expect(res.collected).toBe(0);
        expect(res.wrote).toBe(false);
        expect(res.retained).toBe(1);
        expect(await listTombstones(USER)).toEqual(before);
    });

    it('writes its counts into the hygiene log the Health tab renders', async () => {
        seedRaw([
            ...Array.from({ length: MAX_TOMBSTONES + 3 }, (_, i) => tomb(`x-${i}`, i)),
            { nope: true } as unknown as SkillTombstone,
        ]);

        const res = await runMemoryHygiene(USER, { providerConfigs: [] });
        // 3 past the cap + 1 unreadable row.
        expect(res.graveyardCollected).toBe(4);
        const line = (await loadHygieneLog(USER)).map(l => l.text)
            .find(t => /graveyard/i.test(t))!;
        expect(line).toMatch(/collected 4 records/i);
        expect(line).toMatch(/3 past the 40-record retention/i);
        expect(line).toMatch(/1 unreadable/i);
        expect(line).toMatch(/40 kept/i);
        // The graveyard line is one of the lines the pass reports in-memory too.
        expect(res.lines).toContain(line);

        // A clean graveyard still reports, rather than going quiet.
        const again = await runMemoryHygiene(USER, { providerConfigs: [] });
        expect(again.graveyardCollected).toBe(0);
        const line2 = (await loadHygieneLog(USER)).map(l => l.text)
            .find(t => /graveyard/i.test(t))!;
        expect(line2).toMatch(/40 tombstones, inside its retention/i);
        expect(line2).toMatch(/new evidence, not a timer/i);
    });
});

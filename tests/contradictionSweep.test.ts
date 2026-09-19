import { describe, it, expect, vi, beforeEach } from 'vitest';

// Contradiction sweep: two LIVE skills with overlapping conditions and
// conflicting actions must surface a merge/priority proposal, deduped so the
// same pair is not re-queued every week.

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { findContradictingPairs, runContradictionSweep, SkillForSweep } from '../utils/contradictionSweep';
import { initMemoryFiles, getMemoryFiles, createMemoryFile, deleteMemoryFile } from '../services/learning/MemoryFilesService';

const USER = 'cs-user';
const skill = (slug: string, kind: 'avoid' | 'repeat', ifCondition: string, thenAction: string): SkillForSweep =>
    ({ slug, kind, ifCondition, thenAction });

describe('findContradictingPairs', () => {
    it('finds a pair with ≥2 shared condition tokens and opposite kinds', () => {
        const pairs = findContradictingPairs([
            skill('a', 'repeat', 'btc london sweep short reclaim', 'enter after the reclaim'),
            skill('b', 'avoid', 'btc london sweep short', 'skip the short'),
        ]);
        expect(pairs).toHaveLength(1);
        expect(pairs[0].overlap).toBeGreaterThanOrEqual(2);
        expect(pairs[0].conflict).toBe('opposite-kind');
    });

    it('finds an opposite-direction conflict with the same kind', () => {
        const pairs = findContradictingPairs([
            skill('a', 'repeat', 'btc premium sweep long', 'buy the long'),
            skill('b', 'repeat', 'btc premium sweep short', 'short it'),
        ]);
        expect(pairs).toHaveLength(1);
        expect(pairs[0].conflict).toBe('opposite-direction');
    });

    it('ignores pairs whose conditions barely overlap', () => {
        const pairs = findContradictingPairs([
            skill('a', 'repeat', 'btc london long', 'enter'),
            skill('b', 'avoid', 'eth asia short', 'skip'),
        ]);
        expect(pairs).toHaveLength(0);
    });

    it('ignores consistent pairs (same kind, same direction)', () => {
        const pairs = findContradictingPairs([
            skill('a', 'repeat', 'btc london sweep short', 'enter short'),
            skill('b', 'repeat', 'btc london sweep short', 'enter short same setup'),
        ]);
        expect(pairs).toHaveLength(0);
    });
});

describe('runContradictionSweep', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-sweep-repeat.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
wins: 3
losses: 1
ifCondition: btc london sweep short reclaim
thenAction: enter after the reclaim
tradeIds: a1
---

# Repeat
`, USER, true);
        await createMemoryFile(skills.id, 'btc-sweep-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
wins: 1
losses: 3
ifCondition: btc london sweep short
thenAction: skip the short
tradeIds: b1
---

# Avoid
`, USER, true);
    });

    it('reports every count the hygiene line is made of', () => {
        const first = runContradictionSweep(USER);
        // Two evidenced live skills ⇒ exactly one pair compared.
        expect(first.pairsExamined).toBe(1);
        expect(first.conflicts).toBe(1);
        expect(first.queued).toBe(1);
        expect(first.dismissed).toBe(0);

        const again = runContradictionSweep(USER);
        // Same pair, still pending ⇒ the fingerprint dedupe dismisses it, and
        // the pass says so instead of reporting zero work.
        expect(again).toEqual({ pairsExamined: 1, conflicts: 1, queued: 0, dismissed: 1 });

        const stored = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0].kind).toBe('contradiction');
        expect(stored[0].text).toContain('btc-sweep-repeat');
    });

    it('reports the work it examined when there is nothing to queue', async () => {
        // Leave exactly one evidenced live skill: a pair count of zero is the
        // honest "looked at everything, found nothing", not a silent no-op.
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const victim = getMemoryFiles().files.find(
            f => f.folderId === skills.id && f.name === 'btc-sweep-avoid.md',
        )!;
        await deleteMemoryFile(victim.id, USER);
        expect(runContradictionSweep(USER)).toEqual({
            pairsExamined: 0, conflicts: 0, queued: 0, dismissed: 0,
        });
    });
});

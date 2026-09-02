import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.4c — contradiction sweep: two LIVE skills with overlapping conditions and
// conflicting actions must surface a merge/priority proposal, deduped so the
// same pair is not re-queued every week.

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

import { findContradictingPairs, runContradictionSweep, SkillForSweep } from '../utils/contradictionSweep';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';

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

    it('queues one deduped proposal per contradicting pair', () => {
        const queued = runContradictionSweep(USER);
        expect(queued).toBe(1);
        const again = runContradictionSweep(USER);
        expect(again).toBe(0); // pending fingerprint dedupe
        const stored = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0].kind).toBe('contradiction');
        expect(stored[0].text).toContain('btc-sweep-repeat');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.4a/§8.4b — skill graveyard + retirement taxonomy: tombstone lines for
// retired skills, creation dedup against the ARCHIVE (exact + token-shuffled
// twins → REVIVAL card, never a silent re-creation), reason mapping, and the
// per-reason re-entry rules.

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
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
    ensureSkillsArchiveFolderUnlocked,
    ARCHIVE_FOLDER_NAME,
} from '../services/learning/MemoryFilesService';
import {
    findArchiveTwin,
    recordTombstone,
    listTombstones,
    graveyardBlock,
    retirementReasonFromHistory,
    reEntryRuleForReason,
    queueRevivalProposal,
} from '../services/learning/skillGraveyard';

const USER = 'gy-user';

const HIST = JSON.stringify([
    {
        status: 'confirmed',
        validFrom: '2026-07-01T00:00:00.000Z',
        reason: 'insufficient-evidence',
        invalidAt: '2026-08-01T00:00:00.000Z',
    },
]);

const retiredSkill = (name: string, ifCondition: string): string => `---
status: retired
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 3
losses: 2
ifCondition: ${ifCondition}
thenAction: wait for the reclaim
history: ${HIST}
tradeIds: t1
---

# Retired twin
`;

describe('skillGraveyard (archive dedup, tombstones, taxonomy)', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
        // Emulate the archive sweep: retired files live in skills-archive.
        const archive = await ensureSkillsArchiveFolderUnlocked(USER);
        expect(archive).not.toBeNull();
    });

    it('finds an exact retired twin in the archive', async () => {
        const archive = getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME)!;
        await createMemoryFile(archive.id, 'btc-short-twin.md', retiredSkill('btc-short-twin.md', 'btc short setup'), USER, false);
        const twin = findArchiveTwin(USER, 'BTC short setup');
        expect(twin).not.toBeNull();
        expect(twin!.slug).toBe('btc-short-twin');
        expect(twin!.how).toBe('exact');
        expect(twin!.reason).toBe('insufficient-evidence');
        expect(twin!.sampleN).toBe(5);
    });

    it('finds a token-shuffled twin (same condition, reordered words)', async () => {
        const archive = getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME)!;
        await createMemoryFile(archive.id, 'btc-reclaim-twin.md', retiredSkill('btc-reclaim-twin.md', 'setup btc reclaim short'), USER, false);
        const twin = findArchiveTwin(USER, 'btc short setup reclaim');
        expect(twin).not.toBeNull();
        expect(twin!.slug).toBe('btc-reclaim-twin');
        expect(twin!.how).toBe('tokens');
    });

    it('ignores a LIVE skill (archive dedup only covers retired)', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-live.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
wins: 4
losses: 1
ifCondition: btc live setup
tradeIds: t2
---
# Live
`, USER, true);
        expect(findArchiveTwin(USER, 'btc live setup')).toBeNull();
    });

    it('queues a REVIVAL review card with the re-entry rule, deduped by fingerprint', () => {
        const twin = { slug: 'btc-twin', ifCondition: 'btc short setup', reason: 'superseded' as const, sampleN: 5, how: 'exact' as const };
        const first = queueRevivalProposal(USER, twin);
        const second = queueRevivalProposal(USER, twin);
        expect(first).not.toBeNull();
        expect(second).toBeNull(); // same fingerprint already pending
        const stored = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0].kind).toBe('revival');
        expect(stored[0].text).toContain('superseded');
    });

    it('writes tombstone lines incl. reason, sample and lift; capped at 40', async () => {
        for (let i = 0; i < 45; i++) {
            await recordTombstone(USER, { slug: `s-${i}`, reason: 'insufficient-evidence', sampleN: i, liftPts: i % 5 === 0 ? -3 : null });
        }
        const lines = (await graveyardBlock(USER)).split('\n');
        expect(lines.length).toBeLessThanOrEqual(40);
        expect(lines[0]).toContain('s-44'); // newest first
        expect(lines[lines.length - 1]).toContain('s-5'); // oldest kept (0-4 dropped)
        expect(lines[lines.length - 1]).toContain('lift -3pt');
        expect((await listTombstones(USER)).length).toBe(40);
    });

    it('maps ledger transition reasons to the retirement taxonomy', () => {
        expect(retirementReasonFromHistory('insufficient-evidence')).toBe('insufficient-evidence');
        expect(retirementReasonFromHistory('superseded')).toBe('superseded');
        expect(retirementReasonFromHistory('worth-gate merge')).toBe('superseded');
        expect(retirementReasonFromHistory('eval hurts ×2 (evidence)')).toBe('eval-hurts');
        expect(retirementReasonFromHistory('user-veto')).toBe('user-veto');
        expect(retirementReasonFromHistory('regime-shifted')).toBe('regime-shifted');
        expect(retirementReasonFromHistory('evidence')).toBe('insufficient-evidence');
    });

    it('per-reason re-entry rules: only eval-hurts/user-veto require explicit human action', () => {
        expect(reEntryRuleForReason('regime-shifted')).toContain('auto-revive');
        expect(reEntryRuleForReason('insufficient-evidence')).toContain('more evidence');
        expect(reEntryRuleForReason('superseded')).toContain('successor');
        expect(reEntryRuleForReason('eval-hurts')).toContain('explicit human action');
        expect(reEntryRuleForReason('user-veto')).toContain('explicit human action');
    });
});

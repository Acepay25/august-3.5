import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The idle skill lifecycle: a skill that stops describing the market stops
 * being injected, and one that stays out of prompts is filed into the archive
 * folder retirement already uses.
 *
 * The cases here are weighted toward the two ways this feature could have been
 * built wrong and looked fine on inspection:
 *   - the sweep's own write resetting the clock it is judged on (a suspend →
 *     revive loop at the weekly cadence), and
 *   - an unrelated attribution write recomputing `enabled` from `status` and
 *     silently un-suspending the skill on the next closed trade.
 */

const DAY = 86_400_000;

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
vi.mock('../services/providers/GenericProviderService', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getQuickResponse: (async () => '') as any,
}));
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loadProviderConfigs: (async () => []) as any,
    getReadyProviders: (configs: unknown[]) => configs,
}));

import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
    ARCHIVE_FOLDER_NAME,
} from '../services/learning/MemoryFilesService';
import {
    applySkillEvidence,
    parseSkillMarkdown,
    serializeSkill,
    skillEnabledFlag,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import {
    SKILL_IDLE_ARCHIVE_DAYS,
    SKILL_IDLE_SUSPEND_DAYS,
    idleDaysFor,
    idleExemptionFor,
    idleStageOf,
    idleWindowsInvalid,
    runSkillIdleSweep,
} from '../services/learning/skillIdleLifecycle';
import { listTombstones } from '../services/learning/skillGraveyard';
import { runMemoryHygiene } from '../services/learning/memoryHygiene';
import { queueLearningProposal } from '../utils/learningQueue';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'idle-lifecycle-user';
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const skill = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'repeat',
    coin: 'BTCUSDT',
    direction: 'Short',
    family: 'Family A',
    regime: 'ranging',
    wins: 10,
    losses: 2,
    consecutiveLosses: 0,
    tradeIds: ['old-1'],
    lastEvidenceAt: ago(10),
    body: 'Fade exhaustion prints in ranging BTC.',
    ...over,
});

const seed = async (name: string, meta: SkillMeta, enabled = true): Promise<string> => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, name, serializeSkill(meta, name), USER, enabled);
    return name;
};

const row = (name: string) => {
    const file = getMemoryFiles().files.find(f => f.name === name)!;
    return { file, meta: parseSkillMarkdown(file.content)! };
};

const matchingTrade = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short',
        detectedPatternFamily: 'Family A', strategy: 'mean reversion fade',
    } as never,
    outcome: TradeOutcome.LOSS,
    marketRegime: 'ranging',
    timestamp: new Date(NOW).toISOString(),
} as LoggedTrade);

/** `void recordTombstone(...)` is fire-and-forget; flush it before asserting. */
const settle = (): Promise<void> => new Promise(res => setTimeout(res, 0));

describe('idle lifecycle: the clock', () => {
    it('refuses to run when the stages are not ordered', () => {
        expect(idleWindowsInvalid()).toBeNull();
        expect(idleWindowsInvalid(90, 90)).toMatch(/0 < suspend/);
        expect(idleWindowsInvalid(180, 90)).toMatch(/0 < suspend/);
        expect(idleWindowsInvalid(0, 90)).toMatch(/0 < suspend/);
    });

    it('measures idleness from the newest earned clock', () => {
        const file = { createdAt: NOW - 900 * DAY, updatedAt: NOW - 900 * DAY };
        expect(idleDaysFor(skill({ lastEvidenceAt: ago(200), lastMatchedAt: ago(3) }), file, NOW))
            .toBe(3);
        expect(idleDaysFor(skill({ lastEvidenceAt: ago(3), lastMatchedAt: ago(200) }), file, NOW))
            .toBe(3);
    });

    /** A notebook write bumps `file.updatedAt`, so if the clock took the max of
     *  it, suspending a skill would reset its own idle counter. */
    it('does not let the storage write timestamp override an earned clock', () => {
        const meta = skill({ lastEvidenceAt: ago(500), lastMatchedAt: undefined });
        const justWritten = { createdAt: NOW - 500 * DAY, updatedAt: NOW };
        expect(idleDaysFor(meta, justWritten, NOW)).toBe(500);
    });

    it('falls back to the file stamps only for a legacy row with no earned clock', () => {
        const meta = skill({ lastEvidenceAt: undefined, lastMatchedAt: undefined });
        expect(idleDaysFor(meta, { createdAt: NOW - 40 * DAY, updatedAt: NOW - 30 * DAY }, NOW))
            .toBe(30);
    });

    it('reads an unreadable clock as zero idle, never as infinite', () => {
        const meta = skill({ lastEvidenceAt: 'not a date', lastMatchedAt: undefined });
        expect(idleDaysFor(meta, { createdAt: Number.NaN, updatedAt: Number.NaN }, NOW)).toBe(0);
    });
});

describe('idle lifecycle: exemptions', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    const none = new Set<string>();
    const cases: Array<[string, Partial<SkillMeta>]> = [
        ['book seed', { prior: 'book' }],
        ['retired', { status: 'retired' }],
        ['superseded', { supersededBy: 'other-skill' }],
        ['eval verdict', { evalVerdict: 'hurts' }],
        ['shadow window', { shadow: { kind: 'repeat', body: 'z', startedAt: ago(1), seen: 2, wins: 1, losses: 1 } }],
    ];
    it.each(cases)('exempts a %s skill', (_label, over) => {
        expect(idleExemptionFor(skill(over), 'a-slug', none)).toBeTruthy();
    });

    it('exempts a skill with an inbox decision pending on it', () => {
        expect(idleExemptionFor(skill(), 'a-slug', new Set(['a-slug']))).toBe('decision pending');
    });

    /** The sweep exists to finish what the demotion proposal never did, so a
     *  pending `demote` must not be read as a veto — that would exempt every
     *  skill this feature was written for. */
    it('is not blocked by a pending demote proposal', async () => {
        await seed('quiet.md', skill({ lastEvidenceAt: ago(120), lastMatchedAt: ago(120) }));
        queueLearningProposal({
            kind: 'demote', skillSlug: 'quiet', text: 'demote it?',
            fingerprint: 'stale-demote|quiet',
        }, USER);

        const res = await runSkillIdleSweep(USER, { now: NOW });
        expect(res.suspended).toEqual(['quiet']);
    });
});

describe('idle lifecycle: the sweep', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    it('suspends a silent skill without touching its record or its status', async () => {
        await seed('quiet.md', skill({ lastEvidenceAt: ago(120), lastMatchedAt: ago(120) }));

        const res = await runSkillIdleSweep(USER, { now: NOW });

        expect(res.suspended).toEqual(['quiet']);
        const { file, meta } = row('quiet.md');
        expect(file.enabled).toBe(false);
        expect(meta.status).toBe('confirmed');
        expect(meta.wins).toBe(10);
        expect(meta.losses).toBe(2);
        expect(meta.suspendedAt).toBe(new Date(NOW).toISOString());
        // Still in the active library — only the archive stage moves folders.
        expect(getMemoryFiles().folders.find(f => f.id === file.folderId)!.name).toBe('skills');
        expect(res.lines.join(' ')).toMatch(/Suspended 1 skill idle for 90\+ days/);
    });

    it('leaves a skill that is still earning alone', async () => {
        await seed('fresh.md', skill());
        const res = await runSkillIdleSweep(USER, { now: NOW });
        expect(res.suspended).toHaveLength(0);
        expect(row('fresh.md').file.enabled).toBe(true);
    });

    it('never suspends on the day the window merely equals the old default', async () => {
        await seed('edge.md', skill({ lastEvidenceAt: ago(SKILL_IDLE_SUSPEND_DAYS - 1) }));
        expect((await runSkillIdleSweep(USER, { now: NOW })).suspended).toHaveLength(0);
    });

    /** Rollout safety: upgrading must not empty a long-quiet library in one
     *  pass, because archiving keys on the suspension, not on a second idle
     *  computation. */
    it('does not archive on the pass that first suspends', async () => {
        await seed('ancient.md', skill({ lastEvidenceAt: ago(900), lastMatchedAt: undefined }));

        const res = await runSkillIdleSweep(USER, { now: NOW });

        expect(res.suspended).toEqual(['ancient']);
        expect(res.archived).toHaveLength(0);
        expect(row('ancient.md').file.folderId)
            .not.toBe(getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME)?.id);
    });

    it('archives a skill that stayed suspended past the archive window, tombstoned as idle', async () => {
        await seed('gone.md', skill({
            lastEvidenceAt: ago(400),
            lastMatchedAt: ago(400),
            suspendedAt: ago(SKILL_IDLE_ARCHIVE_DAYS + 5),
        }));

        const res = await runSkillIdleSweep(USER, { now: NOW });

        expect(res.archived).toEqual(['gone']);
        expect(res.suspended).toHaveLength(0);
        const archive = getMemoryFiles().folders.find(f => f.name === ARCHIVE_FOLDER_NAME)!;
        const { file, meta } = row('gone.md');
        expect(file.folderId).toBe(archive.id);
        expect(file.enabled).toBe(false);
        // Archived, not judged: the status survives so a revival reads honestly.
        expect(meta.status).toBe('confirmed');
        await settle();
        expect((await listTombstones(USER)).find(t => t.slug === 'gone')?.reason).toBe('idle');
    });

    it('revives a suspended skill whose trigger matched a trade since', async () => {
        await seed('back.md', skill({
            lastEvidenceAt: ago(400),
            lastMatchedAt: ago(5),
            suspendedAt: ago(60),
        }));

        const res = await runSkillIdleSweep(USER, { now: NOW });

        expect(res.revived).toEqual(['back']);
        const { file, meta } = row('back.md');
        expect(file.enabled).toBe(true);
        expect(meta.suspendedAt).toBeUndefined();
    });

    /** The loop that a max-with-`updatedAt` clock would have created: the
     *  suspension write bumps the timestamp, so the next pass reads zero idle
     *  and switches the skill back on, forever. */
    it('is a no-op when run twice at the same instant', async () => {
        await seed('quiet.md', skill({ lastEvidenceAt: ago(120), lastMatchedAt: ago(120) }));

        const first = await runSkillIdleSweep(USER, { now: NOW });
        const after = row('quiet.md');
        const second = await runSkillIdleSweep(USER, { now: NOW });
        const after2 = row('quiet.md');

        expect(first.suspended).toEqual(['quiet']);
        expect(second.suspended).toHaveLength(0);
        expect(second.revived).toHaveLength(0);
        expect(second.archived).toHaveLength(0);
        expect(second.lines).toHaveLength(0);
        expect(after2.file.content).toBe(after.file.content);
        expect(after2.file.enabled).toBe(false);
    });

    /** The sweep stays quiet when it did nothing; the auditable line is the
     *  hygiene pass's job, because a pass that can switch content off has to
     *  show up in the Health tab even when the answer was "nothing". */
    it('is reported by the weekly hygiene pass whether or not it acted', async () => {
        await seed('fresh.md', skill());
        expect((await runSkillIdleSweep(USER, { now: NOW })).lines).toHaveLength(0);

        const hygiene = await runMemoryHygiene(USER, { now: NOW });
        expect(hygiene.skillsSuspended).toBe(0);
        expect(hygiene.skillsRevived).toBe(0);
        expect(hygiene.skillsArchived).toBe(0);
        expect(hygiene.lines.join(' ')).toMatch(/Idle skill sweep: 1 skill inspected/);

        await seed('quiet.md', skill({ lastEvidenceAt: ago(400), lastMatchedAt: ago(400) }));
        const next = await runMemoryHygiene(USER, { now: NOW });
        expect(next.skillsSuspended).toBe(1);
        expect(next.lines.join(' ')).toMatch(/Suspended 1 skill idle for 90\+ days/);
    });

    it('does nothing at all when the windows are impossible', async () => {
        await seed('quiet.md', skill({ lastEvidenceAt: ago(900) }));

        const res = await runSkillIdleSweep(USER, { now: NOW, suspendDays: 90, archiveDays: 90 });

        expect(res.configError).toMatch(/0 < suspend/);
        expect(res.examined).toBe(0);
        expect(row('quiet.md').file.enabled).toBe(true);
    });

    it('honours injected windows, and archives only off a suspension', async () => {
        await seed('quiet.md', skill({ lastEvidenceAt: ago(10), lastMatchedAt: ago(10) }));

        // 10 days idle crosses neither window.
        expect((await runSkillIdleSweep(USER, { now: NOW, suspendDays: 20, archiveDays: 30 }))
            .suspended).toHaveLength(0);

        // A 5-day window catches it, and the same instant cannot also archive
        // it — the archive stage has nothing to measure yet.
        const suspender = await runSkillIdleSweep(USER, { now: NOW, suspendDays: 5, archiveDays: 30 });
        expect(suspender.suspended).toEqual(['quiet']);
        expect(suspender.archived).toHaveLength(0);

        // 31 days after the suspension, with the trigger still silent, it goes.
        const later = await runSkillIdleSweep(USER, {
            now: NOW + 31 * DAY, suspendDays: 5, archiveDays: 30,
        });
        expect(later.archived).toEqual(['quiet']);
        expect(later.suspended).toHaveLength(0);
    });

    it('exposes the stage to readers without re-deriving it from enabled', () => {
        const archiveId = 'archive-folder';
        expect(idleStageOf(skill({ suspendedAt: ago(1) }), { folderId: 'skills' }, archiveId)).toBe('suspended');
        expect(idleStageOf(skill(), { folderId: archiveId }, archiveId)).toBe('archived');
        // A user-retired skill is also disabled, and must not read as idle.
        expect(idleStageOf(skill({ status: 'retired' }), { folderId: 'skills' }, archiveId)).toBe('live');
    });
});

describe('enabled flag: one source of truth', () => {
    it('keeps a retired or suspended skill out, and everything else in', () => {
        expect(skillEnabledFlag(skill())).toBe(true);
        expect(skillEnabledFlag(skill({ status: 'retired' }))).toBe(false);
        expect(skillEnabledFlag(skill({ suspendedAt: ago(1) }))).toBe(false);
        expect(skillEnabledFlag(skill({ status: 'retired', suspendedAt: ago(1) }))).toBe(false);
    });

    /** The trap this feature nearly walked into: the CONTROL and OVERRIDDEN
     *  attribution branches rewrite the file with `enabled` recomputed from
     *  `status`, which would un-suspend a skill the first time its trigger
     *  matched a trade after suspension — undoing the lifecycle on the next
     *  closed trade, with no error anywhere. */
    it('survives an attribution write for a suspended skill', async () => {
        await seed('quiet.md', skill({
            lastEvidenceAt: ago(120),
            lastMatchedAt: ago(120),
            suspendedAt: ago(30),
        }));

        await applySkillEvidence(matchingTrade('new-9'), USER, [matchingTrade('new-9')]);

        const { file, meta } = row('quiet.md');
        expect(file.enabled).toBe(false);
        expect(meta.suspendedAt).toBe(ago(30));
        // It was not in the prompt, so the outcome may not land on its record.
        expect(meta.wins).toBe(10);
        expect(meta.losses).toBe(2);
        expect(meta.controlIds ?? []).toContain('new-9');
        // And matching is exactly what the revival clock needs.
        expect(meta.lastMatchedAt).toBe(new Date(NOW).toISOString());
    });

    it('keeps crediting an enabled skill the way it always did', async () => {
        await seed('live.md', skill({ tradeIds: ['old-1'] }));

        await applySkillEvidence(matchingTrade('new-10'), USER, [matchingTrade('new-10')]);

        const { meta } = row('live.md');
        expect(meta.tradeIds).toContain('new-10');
        expect(meta.lastEvidenceAt).toBe(new Date(NOW).toISOString());
    });
});

describe('frontmatter round-trip', () => {
    it('persists both new clocks and drops them when absent', () => {
        const withBoth = skill({ lastMatchedAt: ago(4), suspendedAt: ago(9) });
        const parsed = parseSkillMarkdown(serializeSkill(withBoth, 'x'))!;
        expect(parsed.lastMatchedAt).toBe(ago(4));
        expect(parsed.suspendedAt).toBe(ago(9));

        const parsedClean = parseSkillMarkdown(serializeSkill(skill(), 'x'))!;
        expect(parsedClean.lastMatchedAt).toBeUndefined();
        expect(parsedClean.suspendedAt).toBeUndefined();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-1 (review fix plan): the learning queue was WRITE-ONLY — five passes
// queued proposals and nothing read them. The SkillsGrid panel now renders
// them, and the apply paths below actuate the three kinds that have a
// deterministic action (displacement, revival, demote). These tests pin the
// apply functions + the queue's dedupe/dismiss contract.

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
} from '../services/learning/MemoryFilesService';
import {
    parseSkillMarkdown,
    applyDisplacementProposal,
    applyRevivalProposal,
    applyDemoteProposal,
} from '../services/learning/SkillMemoryService';
import {
    queueLearningProposal,
    listLearningProposals,
    dismissLearningProposal,
} from '../utils/learningQueue';

const USER = 'lq-user';

const skillMd = (status: string, ifCondition: string, extra = ''): string => `---
status: ${status}
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 4
losses: 1
ifCondition: ${ifCondition}
thenAction: wait for the reclaim
tradeIds: t1
${extra}---

# Body
`;

const findSkill = (name: string) =>
    getMemoryFiles().files.find(f => f.name === name);

describe('learning queue apply paths (P0-1)', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    it('displacement: retires incumbent to archive AND installs the challenger as candidate', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'old-incumbent.md', skillMd('confirmed', 'old trigger condition here'), USER);
        const ok = await applyDisplacementProposal('old-incumbent', USER, {
            kind: 'repeat',
            wins: 6,
            losses: 0,
            ifCondition: 'new challenger trigger clause',
            thenAction: 'fade into the reclaim',
        });
        expect(ok).toBe(true);
        const retired = findSkill('old-incumbent.md')!;
        expect(parseSkillMarkdown(retired.content)!.status).toBe('retired');
        const archive = getMemoryFiles().folders.find(f => f.name === 'archive');
        expect(retired.folderId).toBe(archive?.id);
        // The challenger the gate compared must actually land — as candidate.
        const created = getMemoryFiles().files.filter(f => f.folderId === skills.id && f.name !== 'old-incumbent.md');
        expect(created.length).toBe(1);
        const meta = parseSkillMarkdown(created[0].content)!;
        expect(meta.status).toBe('candidate');
        expect(meta.ifCondition).toBe('new challenger trigger clause');
    });

    it('displacement with no challenger clauses still retires the incumbent (returns true)', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'solo.md', skillMd('confirmed', 'solo trigger clause'), USER);
        expect(await applyDisplacementProposal('solo', USER)).toBe(true);
        expect(parseSkillMarkdown(findSkill('solo.md')!.content)!.status).toBe('retired');
    });

    it('displacement on a missing slug returns false (UI keeps the proposal + explains)', async () => {
        expect(await applyDisplacementProposal('ghost', USER)).toBe(false);
    });

    it('revival: archived retired twin comes back as candidate in the live folder', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'twin.md', skillMd('retired', 'twin trigger clause'), USER);
        const archive = await ensureSkillsArchiveFolderUnlocked(USER);
        const file = findSkill('twin.md')!;
        // Move it to the archive like the retirement sweep does.
        await createMemoryFile(archive!.id, 'twin.md', skillMd('retired', 'twin trigger clause'), USER);
        // Remove the live copy so only the archived one exists.
        const live = getMemoryFiles().files.find(f => f.name === 'twin.md' && f.folderId === skills.id)!;
        const { deleteMemoryFile } = await import('../services/learning/MemoryFilesService');
        await deleteMemoryFile(live.id, USER);
        expect(findSkill('twin.md')!.folderId).toBe(archive!.id);

        const ok = await applyRevivalProposal('twin', USER);
        expect(ok).toBe(true);
        const revived = findSkill('twin.md')!;
        expect(revived.folderId).toBe(skills.id);
        const meta = parseSkillMarkdown(revived.content)!;
        expect(meta.status).toBe('candidate'); // never straight to confirmed
    });

    it('demote: confirmed zero-evidence skill drops to candidate', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'zombie.md', skillMd('confirmed', 'zombie trigger clause'), USER);
        expect(await applyDemoteProposal('zombie', USER)).toBe(true);
        expect(parseSkillMarkdown(findSkill('zombie.md')!.content)!.status).toBe('candidate');
    });

    it('queue contract: fingerprint dedupe, dismiss, newest-first list', () => {
        const base = { kind: 'rescope' as const, text: 't', fingerprint: 'fp-1', skillSlug: 'x' };
        expect(queueLearningProposal(base, USER)).not.toBeNull();
        expect(queueLearningProposal(base, USER)).toBeNull(); // dedupe
        const second = queueLearningProposal({ ...base, fingerprint: 'fp-2' }, USER);
        expect(second).not.toBeNull();
        expect(listLearningProposals(USER)).toHaveLength(2);
        dismissLearningProposal(second!.id, USER);
        expect(listLearningProposals(USER).map(p => p.fingerprint)).toEqual(['fp-1']);
    });
});

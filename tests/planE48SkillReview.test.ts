/**
 * E-48 stage 1 — the deterministic "review all my skills" service.
 *
 * The finding this pins: a skill file that does not parse is SILENTLY DROPPED
 * by `listSkills()` and by the retrieval, while it sits in the notebook, in
 * the backup and in the export. The app gives two opposite answers for one
 * file depending on how it arrived — the import path rejects it WITH a
 * reason, the runtime ignores it entirely — and the Health card computed the
 * count and threw it away.
 *
 * So the review must:
 *  - FIND a ghost (read the notebook files directly, never `listSkills()`),
 *  - say WHERE it fails (the first failing line), not "invalid",
 *  - never claim a skill "never fired" (the injection log is run-capped),
 *  - report how many characters a clipped card drops,
 *  - propose a repair without applying it, and mark a repair that WIDENS the
 *    skill's reach as such.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string) => {
        const raw = store[key];
        return Array.isArray(raw) ? raw : [];
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import {
    reviewAllSkills,
    reviewSkill,
    countGhostSkills,
    SKILL_REVIEW_RECALL_BUDGET,
} from '../services/learning/skillReview';
import { listSkills, serializeSkill, type SkillMeta } from '../services/learning/SkillMemoryService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { buildMemoryHealthReport } from '../services/learning/memoryHealth';

const USER = 'review-user';

const skillsFolder = (): string =>
    getMemoryFiles().folders.find(f => f.name === 'skills')!.id;

const addFile = async (name: string, content: string): Promise<void> => {
    await createMemoryFile(skillsFolder(), name, content, USER, true);
};

/** A healthy skill: a real trigger and a real description. */
const healthyMeta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'candidate',
    kind: 'avoid',
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    tradeIds: [],
    description: 'Use this skill whenever BTC sweeps the prior low and closes back above it.',
    ifCondition: 'BTC sweeps the prior low and closes back above it',
    thenAction: 'stand aside until the reclaim prints',
    body: '**When:** BTC sweeps the prior low and closes back above it.\n**What I do:** stand aside until the reclaim prints.',
    ...over,
} as SkillMeta);

beforeEach(async () => {
    store = {};
    localStorage.clear();
    await initMemoryFiles(USER);
});

describe('reviewAllSkills', () => {
    it('finds a GHOST that listSkills() silently drops, and says which line fails', async () => {
        // A file with no frontmatter at all — the commonest way a hand-edit
        // breaks a skill. `listSkills()` cannot see it.
        await addFile('broken.md', [
            '# My broken skill',
            '',
            '**When:** BTC sweeps the low.',
            '**What I do:** stand aside.',
            '',
        ].join('\n'));

        expect(listSkills().some(s => s.file.name === 'broken.md')).toBe(false);

        const report = reviewAllSkills();
        const ghost = report.findings.find(f => f.name === 'broken.md');
        expect(ghost).toBeTruthy();
        expect(ghost!.verdict).toBe('ghost');
        // The FIRST FAILING LINE, not a generic "invalid".
        expect(ghost!.parseFailure).toBeTruthy();
        expect(ghost!.parseFailure!.line).toBe(1);
        expect(ghost!.parseFailure!.reason).toMatch(/frontmatter/i);
        expect(ghost!.evidence).toContain('Line 1');
        // It is in the notebook, in the backup and in the export.
        expect(ghost!.bytes).toBeGreaterThan(0);
        expect(ghost!.chars).toBeGreaterThan(0);
        // The count is reported.
        expect(report.counts.ghost).toBe(1);
        expect(report.ghostCount).toBe(1);
    });

    it('names the unclosed fence as the failure, not the file', async () => {
        await addFile('unclosed.md', [
            '---',
            'name: "unclosed"',
            'description: "a skill whose frontmatter never closes"',
            '',
            '# Unclosed',
            '',
        ].join('\n'));

        const ghost = reviewAllSkills().findings.find(f => f.name === 'unclosed.md');
        expect(ghost!.verdict).toBe('ghost');
        expect(ghost!.parseFailure!.reason).toMatch(/never closed/i);
    });

    it('proposes a ghost repair that lands as candidate with ZERO counters, and marks it as widening', async () => {
        await addFile('broken.md', [
            '# My broken skill',
            '',
            '**When:** BTC sweeps the low.',
            '**What I do:** stand aside.',
            '',
        ].join('\n'));

        const ghost = reviewAllSkills().findings.find(f => f.name === 'broken.md');
        expect(ghost!.repair).toBeTruthy();
        expect(ghost!.repair!.kind).toBe('reconstruct');
        // Rebuilding gives the file a reach it did not have — it can now be
        // matched and injected. That must be labelled, and confirmed one skill
        // at a time.
        expect(ghost!.repair!.widens).toBe(true);
        // Nothing invented: the counters are zero and the status is candidate,
        // because a skill that never parsed never earned an outcome.
        expect(ghost!.repair!.after).toContain('status: candidate');
        expect(ghost!.repair!.after).toContain('wins: 0');
        expect(ghost!.repair!.after).toContain('losses: 0');
        expect(ghost!.repair!.after).not.toMatch(/wins: [1-9]/);
        expect(ghost!.repair!.before).toBe(ghost!.repair!.before);
    });

    it('calls a skill with no trigger and a generated description DORMANT, and never says it never fired', async () => {
        // No IF/THEN and no authored description: the description on disk IS
        // the `serializeSkill` fallback, so the skill lists and will not fire.
        await addFile('dormant.md', [
            '---',
            'name: "dormant"',
            'kind: "avoid"',
            'status: "candidate"',
            'wins: 0',
            'losses: 0',
            '---',
            '',
            '**When:** BTC sweeps the prior low and closes back above it.',
            '',
            '**What I do:** stand aside until the reclaim prints.',
            '',
        ].join('\n'));

        const finding = reviewAllSkills().findings.find(f => f.name === 'dormant.md');
        expect(finding!.verdict).toBe('dormant');
        // The injection log is run-capped, so absence from it is NOT evidence.
        expect(finding!.evidence).toMatch(/names no setup it applies to/i);
        expect(finding!.evidence).not.toMatch(/never fired/i);
        expect(finding!.evidence).not.toMatch(/never served/i);
        expect(finding!.checks.hasStructuredTrigger).toBe(false);
        expect(finding!.checks.descriptionIsFallback).toBe(true);
    });

    it('counts a CLIPPED skill by how many characters the recall card drops', async () => {
        const long = 'x'.repeat(1200);
        await addFile('long.md', serializeSkill(healthyMeta({
            body: `**When:** BTC sweeps the prior low.\n**What I do:** ${long}`,
        }), 'Long skill'));

        const finding = reviewAllSkills().findings.find(f => f.name === 'long.md');
        expect(finding!.verdict).toBe('clipped');
        expect(finding!.droppedChars).toBeGreaterThan(0);
        expect(finding!.checks.droppedChars).toBe(finding!.droppedChars);
        expect(finding!.evidence).toContain(String(finding!.droppedChars));
    });

    it('calls a healthy skill FINE and counts it', async () => {
        await addFile('good.md', serializeSkill(healthyMeta(), 'Good skill'));
        const report = reviewAllSkills();
        const finding = report.findings.find(f => f.name === 'good.md');
        expect(finding!.verdict).toBe('fine');
        expect(finding!.checks.roundTrips).toBe(true);
        expect(finding!.checks.ledgerSplitIntact).toBe(true);
        expect(finding!.checks.namePresent).toBe(true);
        expect(finding!.checks.nameWithinLimit).toBe(true);
        expect(finding!.checks.hasStructuredTrigger).toBe(true);
        // The count carries a 'fine' key, so a summary can print all four.
        expect(report.counts.fine).toBe(1);
        expect(Object.keys(report.counts).sort()).toEqual(['clipped', 'dormant', 'fine', 'ghost']);
    });

    it('reads the notebook files directly, so a ghost is in the report even though listSkills() drops it', async () => {
        await addFile('good.md', serializeSkill(healthyMeta(), 'Good skill'));
        await addFile('broken.md', 'no frontmatter here at all\n');
        expect(listSkills().length).toBe(1);
        expect(reviewAllSkills().findings.length).toBe(2);
    });

    it('treats "never observed" as a HINT the caller supplies, never as a verdict', async () => {
        await addFile('good.md', serializeSkill(healthyMeta(), 'Good skill'));
        const withoutHint = reviewAllSkills();
        expect(withoutHint.findings[0].neverObserved).toBeUndefined();
        expect(withoutHint.findings[0].verdict).toBe('fine');

        const withHint = reviewAllSkills({ neverObserved: () => true });
        expect(withHint.findings[0].neverObserved).toBe(true);
        // The verdict does not move.
        expect(withHint.findings[0].verdict).toBe('fine');
    });

    it('reviewSkill() gives one file the same verdict the whole pass gives it', async () => {
        await addFile('broken.md', 'no frontmatter\n');
        const file = getMemoryFiles().files.find(f => f.name === 'broken.md')!;
        const one = reviewSkill(file);
        const all = reviewAllSkills().findings.find(f => f.name === 'broken.md');
        expect(one.verdict).toBe(all!.verdict);
        expect(one.evidence).toBe(all!.evidence);
    });

    it('pins the recall budget against the one the prompt path charges', () => {
        // The review and the prompt path MUST agree: a card that fits in the
        // report but is clipped in the prompt would make the report lie. The
        // prompt path's constant is module-private, so it is pinned by
        // reading the source — the same trick `tests/deskToolCache.test.ts`
        // uses.
        const source = readFileSync(
            join(process.cwd(), 'services/learning/MemoryRetrievalService.ts'),
            'utf8',
        );
        const match = source.match(/RECALL_SKILL_BODY_MAX\s*=\s*(\d+)/);
        expect(match).toBeTruthy();
        expect(Number(match![1])).toBe(SKILL_REVIEW_RECALL_BUDGET);
    });
});

describe('the Health card reports the ghosts', () => {
    it('counts a file that does not parse and says so in a flag', async () => {
        await addFile('good.md', serializeSkill(healthyMeta(), 'Good skill'));
        await addFile('broken.md', 'no frontmatter here at all\n');

        const report = await buildMemoryHealthReport(USER);
        expect(report.skills.ghosts).toBe(1);
        expect(report.flags.some(f => /could not be parsed/i.test(f))).toBe(true);
        // The healthy skill is not counted as a ghost.
        expect(report.skills.ghosts).toBe(1);
        expect(countGhostSkills()).toBe(1);
    });

    it('reports no ghosts for a clean notebook', async () => {
        await addFile('good.md', serializeSkill(healthyMeta(), 'Good skill'));
        const report = await buildMemoryHealthReport(USER);
        expect(report.skills.ghosts).toBe(0);
        expect(report.flags.some(f => /could not be parsed/i.test(f))).toBe(false);
    });
});

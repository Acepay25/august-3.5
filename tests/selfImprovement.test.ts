import { describe, it, expect, vi, beforeEach } from 'vitest';

// §4.6 — self-improvement loop (plan §4.6 A→E): episodes → fingerprints →
// tier-1 scoring → (judge-gated) distilling → measurement. Default is
// extract-only: the judge gate must be recorded before ANYTHING is drafted,
// and every distill step ends in a human-gated queue, never an action.

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
    extractEpisodes,
    fingerprintEpisodes,
    fingerprintOfEpisode,
    isFlagged,
    classifyDistillAction,
    recordJudgePrecision,
    isJudgeEnabled,
    runSelfImprovementPass,
    EPISODE_RETENTION_DAYS,
    FLAG_MIN_OCCURRENCES,
} from '../services/learning/selfImprovement';
import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { listSkillDrafts, takeSkillDraft } from '../utils/skillDrafts';
import { ingestCraftedSkill } from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'si-user';
const LESSON = '**Key Lesson:** Wait for the 15m reclaim before entering.';

const makeLoss = (id: string, daysAgo: number, cause = 'SETUP_EDGE_FAILURE'): LoggedTrade => ({
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A', entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }] } as any,
    outcome: TradeOutcome.LOSS,
    timestamp: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    postMortem: LESSON,
    rootCauseClass: cause as LoggedTrade['rootCauseClass'],
});

describe('A: extractEpisodes', () => {
    it('extracts outcome-linked episodes from closed post-mortems with 180d retention', () => {
        const eps = extractEpisodes([
            makeLoss('fresh-1', 5),
            makeLoss('old-1', EPISODE_RETENTION_DAYS + 40),
            { ...makeLoss('pending-1', 1), outcome: TradeOutcome.PENDING } as LoggedTrade,
        ]);
        expect(eps.map(e => e.tradeId)).toEqual(['fresh-1']);
        expect(eps[0].rootCauseClass).toBe('SETUP_EDGE_FAILURE');
        expect(eps[0].outcome).toBe('loss');
        expect(eps[0].keyLesson).toContain('15m reclaim');
    });
});

describe('B: fingerprints + tier-1 scoring', () => {
    it('dedupes both occurrences into one fingerprint with a stable cause', () => {
        const fps = fingerprintEpisodes([
            makeLoss('a', 10),
            makeLoss('b', 20),
        ] as unknown as Parameters<typeof fingerprintEpisodes>[0]);
        expect(fps).toHaveLength(1);
        expect(fps[0].count).toBe(2);
        expect(fps[0].stable).toBe(true);
        expect(isFlagged(fps[0])).toBe(true);
        expect(isFlagged({ ...fps[0], count: 1 })).toBe(false); // below FLAG_MIN_OCCURRENCES
    });

    it('buckets unclassifiable episodes as unknown:<first-line>', () => {
        const eps = [makeLoss('a', 10)] as unknown as Parameters<typeof fingerprintEpisodes>[0];
        eps[0].rootCauseClass = undefined;
        const fps = fingerprintEpisodes(eps);
        expect(fps[0].fp).toContain('unknown:');
        expect(fps[0].stable).toBe(false);
        expect(isFlagged(fps[0])).toBe(false);
    });
});

describe('C: judge gate (extract-only default)', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    it('is disabled by default (ruling 1: extract-only until precision gate)', async () => {
        expect(await isJudgeEnabled(USER)).toBe(false);
    });

    it('ignores a precision record below the gate (0.8 / 30 samples)', async () => {
        await recordJudgePrecision(USER, 0.7, 30);
        expect(await isJudgeEnabled(USER)).toBe(false);
        await recordJudgePrecision(USER, 0.9, 5);
        expect(await isJudgeEnabled(USER)).toBe(false);
        await recordJudgePrecision(USER, 0.9, 30);
        expect(await isJudgeEnabled(USER)).toBe(true);
    });
});

describe('D/E: end-to-end seeded loop (judge gate then full chain)', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    it('extract-only drafts NOTHING until the gate is recorded', async () => {
        const trades = [makeLoss('x1', 5), makeLoss('x2', 8)];
        const out = await runSelfImprovementPass(USER, trades);
        expect(out.judgeEnabled).toBe(false);
        expect(out.flagged).toBeGreaterThanOrEqual(1);
        expect(out.drafts).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('inject failure → fingerprint → flagged → draft → approve → recurrence → revision proposal', async () => {
        await recordJudgePrecision(USER, 0.9, 30);
        const trades = [makeLoss('e1', 30), makeLoss('e2', 10)];
        const pass1 = await runSelfImprovementPass(USER, trades);
        expect(pass1.judgeEnabled).toBe(true);
        expect(pass1.flagged).toBe(1);
        expect(pass1.drafts).toBe(1);

        // The DRAFT landed in the skill-draft inbox (human gate).
        const drafts = listSkillDrafts(USER);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].crafted.ifCondition.length).toBeGreaterThanOrEqual(8);

        // Human APPROVES: take the draft, ingest it as a live skill.
        const draft = takeSkillDraft(drafts[0].id, USER) ?? drafts[0];
        await ingestCraftedSkill(makeLoss('e0', 40), draft.crafted, USER);

        // Simulate RECURRENCE: a third occurrence of the same failure.
        const withRecurrence = [...trades, makeLoss('e3', 2)];
        const pass2 = await runSelfImprovementPass(USER, withRecurrence);
        expect(pass2.revisionProposals).toBe(1);

        // A revision proposal (never a silent rewrite) is now in the queue.
        const props = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        const revision = props.find((p: { fingerprint: string }) => String(p.fingerprint).startsWith('recurrence|'));
        expect(revision).toBeTruthy();
        expect(String(revision.text)).toContain('did not prevent recurrence');
    });

    it('classifies distill actions: no cover → create; shallow → amend-trigger; deep → amend-body', () => {
        const fp = { fp: 'btc|short|family a|wait for the 15m reclaim before entering', count: 3, firstSeen: '', lastSeen: '', rootCauseClass: 'SETUP_EDGE_FAILURE', stable: true };
        const noCover = classifyDistillAction(fp, []);
        expect(noCover.type).toBe('create');

        const slugA = { slug: 'btc-short-family-a', meta: { ifCondition: 'btc short' } } as never;
        expect(classifyDistillAction(fp, [slugA]).type).toBe('amend-trigger');

        const slugB = { slug: 'btc-short-family-a', meta: { ifCondition: 'btc short family a wait for the 15m reclaim before entering' } } as never;
        expect(classifyDistillAction(fp, [slugB]).type).toBe('amend-body');
    });
});

describe('D: demote suggestions', async () => {
    it('a confirmed, evidence-free, never-injected skill gets a demote SUGGESTION', async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'ghost-skill.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
wins: 0
losses: 0
ifCondition: btc ghost setup
thenAction: wait for the phantom
tradeIds: none
---
# Ghost
`, USER, true);
        const { queueDemoteSuggestions } = await import('../services/learning/selfImprovement');
        const { listSkills } = await import('../services/learning/SkillMemoryService');
        const skillsL = listSkills().map(({ file, meta }) => ({ slug: file.name.replace(/\.md$/i, ''), meta }));
        const queued = await queueDemoteSuggestions(USER, skillsL, []);
        expect(queued).toBe(1);
        const props = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        expect(props[0].kind).toBe('demote');
        expect(props[0].text).toContain('demote SUGGESTION');
    });
});

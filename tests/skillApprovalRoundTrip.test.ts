import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PHASE 0 — the skill proposal approval flow reported success for a write that
 * never happened.
 *
 * A model's `propose_skill` call lands a PENDING DRAFT in localStorage. The
 * human presses Save, sees "Skill saved", and no skill appears. `coachAllowDraft`
 * deleted the draft, fired the notebook write with `void`, and toasted success
 * unconditionally — while `ingestCraftedSkill*Unlocked` has seven bare `return`s
 * that write nothing, and `createMemoryFileUnlocked` throws on a name collision
 * that no caller caught.
 *
 * Reproduced against the real notebook before any code changed:
 *   AFTER-FIRST ret=undefined skills=1        (worked)
 *   AFTER-DUP   ret=undefined skills=1        (wrote nothing — SAME return)
 *   same slug + different IF clause → Unhandled error:
 *   Error: "funding-exhaustion-long.md" already exists in this folder
 *       at createMemoryFileUnlocked (MemoryFilesService.ts:676)
 *       at ingestCraftedSkillFromDraftUnlocked (SkillMemoryService.ts:2225)
 *
 * The guard is a READ-BACK, so it also covers any silent return added later.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string) => [] as unknown[]),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../utils/activeUser', () => ({ getActiveUsername: () => 'test-user' }));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    ingestCraftedSkillFromDraft,
    isApprovedSkill,
    listSkills,
    parseSkillMarkdown,
} from '../services/learning/SkillMemoryService';
import { approveSkillDraft } from '../services/learning/skillApproval';
import { applyRescopeProposal } from '../services/learning/SkillMemoryService';
import { listSkillDrafts, queueSkillDraft } from '../utils/skillDrafts';
import { listLearningProposals } from '../utils/learningQueue';
import { executeDeskTool } from '../services/analysis/DeskToolsService';
import type { CraftedSkill } from '../schemas/learning';
import type { LoggedTrade } from '../types';

const USER = 'test-user';

const craft = (over: Partial<CraftedSkill> = {}): CraftedSkill => ({
    name: 'Funding exhaustion long',
    kind: 'repeat',
    when: 'funding has run positive for many sessions and price stalls at swept lows',
    steps: ['Confirm the funding streak', 'Wait for a 1h close back above the swept low', 'Enter with stop under the wick'],
    inputs: [],
    validate: 'Confirm the sweep on the live chart before acting',
    output: 'A defined long entry with a stop under the liquidity low',
    approval: 'A human approves before it is ever applied',
    ifCondition: 'funding positive 8 sessions and the daily low was swept',
    thenAction: 'go long only after a 1h close back above the swept level',
    ...over,
});

const queueDraft = (crafted: CraftedSkill, tradeId = 'chat-1', coin = 'BTC'): void => {
    queueSkillDraft({ tradeId, coin, crafted }, USER);
};

const triggers = (): string[] => listSkills().map(s => (s.meta.ifCondition ?? '').toLowerCase());
const names = (): string[] => listSkills().map(s => s.file.name.toLowerCase());

beforeEach(async () => {
    localStorage.clear();
    store = {};
    await initMemoryFiles(USER);
});

describe('approving a draft creates the skill, and says so only when it did', () => {
    it('round trip: press Save → the trigger is readable back out of the library', async () => {
        queueDraft(craft());
        const draft = listSkillDrafts(USER)[0];

        const result = await approveSkillDraft(draft, USER, []);

        expect(result.created).toBe(true);
        expect(triggers()).toContain(draft.crafted.ifCondition.toLowerCase());
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('reports the file it wrote instead of resolving void like a no-op', async () => {
        queueDraft(craft());
        const result = await approveSkillDraft(listSkillDrafts(USER)[0], USER, []);
        expect(result).toEqual({ created: true, slug: 'funding-exhaustion-long.md' });
    });

    it('P0-1: approving a CLOSED-trade draft stamps human approval so the skill activates', async () => {
        // The production shape: usePostMortem queues drafts with
        // tradeId: closed.id and both approval callers pass the real journal.
        // The trade-backed branch previously built its SkillMeta with no
        // `approvedBy`/`prior`, so `isApprovedSkill` was false and the skill
        // silently never injected — while the card read "Active".
        queueDraft(craft(), 'trade-closed-1');
        const draft = listSkillDrafts(USER)[0];
        const closedTrade = {
            id: 'trade-closed-1',
            outcome: 'WIN',
            analysis: { coinName: 'BTC', direction: 'Long', detectedPatternFamily: 'Family A' },
            postMortem: 'IF funding positive 8 sessions THEN wait for the reclaim close. Lesson learned.',
        } as unknown as LoggedTrade;

        const result = await approveSkillDraft(draft, USER, [closedTrade]);

        expect(result.created).toBe(true);
        const skill = listSkills()[0];
        expect(skill.meta.approvedBy).toBe('human');
        expect(isApprovedSkill(skill.meta)).toBe(true);
        expect(skill.meta.tradeIds).toContain('trade-closed-1');
    });
});

describe('the write that used to be reported as a save', () => {
    it('a trigger that is already a live skill reads as DUPLICATE, not as saved', async () => {
        const crafted = craft();
        await ingestCraftedSkillFromDraft(crafted, 'BTC', USER, undefined, 'human');

        // A second draft, same IF clause, different name — exactly what the
        // tombstone/dedup gap lets through.
        queueDraft(craft({ name: 'Funding exhaustion long v2' }, ), 'chat-2');
        const dup = await approveSkillDraft(listSkillDrafts(USER)[0], USER, []);

        expect(dup.created ? 'created' : dup.reason).toBe('duplicate');
        expect(names().filter(n => n.includes('funding'))).toHaveLength(1);
        // Consumed — its trigger is live — but the UI is told which one it got.
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('an ineligible trade no longer destroys the draft behind a success toast', async () => {
        // The production shape: a post-mortem draft whose trade never closed
        // (or closed FLAT). ingestCraftedSkill returns at its first guard,
        // wrote nothing, and resolved — so the old handler said "Skill saved"
        // and the draft was already gone.
        queueDraft(craft(), 'trade-1');
        const draft = listSkillDrafts(USER)[0];
        const openTrade = { id: 'trade-1' } as unknown as LoggedTrade;

        const result = await approveSkillDraft(draft, USER, [openTrade]);

        expect(result.created).toBe(false);
        expect(result.created ? 'created' : result.reason).toBe('not-written');
        expect(names()).toHaveLength(0);
        // The retry is still possible: the inbox keeps the row.
        expect(listSkillDrafts(USER).map(d => d.id)).toEqual([draft.id]);
    });

    it('a name collision writes a second file instead of throwing into the void', async () => {
        await ingestCraftedSkillFromDraft(craft(), 'BTC', USER, undefined, 'human');
        // Same NAME, different trigger: the trigger dedupe does not fire, and
        // before this fix createMemoryFileUnlocked threw on the duplicate slug
        // while the caller toasted success.
        queueDraft(craft({ ifCondition: 'a completely different trigger clause entirely' }), 'chat-9');

        const result = await approveSkillDraft(listSkillDrafts(USER)[0], USER, []);

        expect(result.created).toBe(true);
        expect(names()).toEqual(expect.arrayContaining([
            'funding-exhaustion-long.md', 'funding-exhaustion-long-2.md',
        ]));
    });
});

describe('a notebook with no harness folders', () => {
    /**
     * `ensureHarnessFoldersUnlocked` returns early unless at least one
     * DEFAULT_FOLDERS name is already present (MemoryFilesService.ts:200), so
     * for a notebook that has none of them — an import with custom folders —
     * the skills folder is genuinely never created and
     * `ingestCraftedSkillFromDraftUnlocked` reaches its `if (!folder) return`.
     * That return wrote nothing and resolved undefined, which is the same
     * silent-success shape Phase 0 was about.
     */
    it('names the reason instead of resolving void', async () => {
        const mf = getMemoryFiles();
        mf.folders = [{ id: 'custom', name: 'my-notes', order: 0 }] as typeof mf.folders;
        mf.files = [];

        const result = await ingestCraftedSkillFromDraft(craft(), 'BTC', USER, undefined, 'human');

        expect(result).toEqual({ created: false, reason: 'no-skills-folder' });
        expect(listSkills()).toHaveLength(0);
    });

    it('and the approval path tells the human that reason', async () => {
        const mf = getMemoryFiles();
        mf.folders = [{ id: 'custom', name: 'my-notes', order: 0 }] as typeof mf.folders;
        mf.files = [];
        queueDraft(craft(), 'chat-x');

        const result = await approveSkillDraft(listSkillDrafts(USER)[0], USER, []);

        expect(result.created ? 'created' : result.reason).toBe('no-skills-folder');
        expect(listSkillDrafts(USER)).toHaveLength(1);
    });
});

describe('the desk tool that feeds this inbox', () => {
    it('propose_skill queues a draft that really is approvable', async () => {
        const { executeDeskTool, clearDeskToolCache } = await import('../services/analysis/DeskToolsService');
        clearDeskToolCache();
        const call = await executeDeskTool({
            id: 'x1',
            name: 'propose_skill',
            arguments: {
                name: 'Session-open fade short',
                kind: 'avoid',
                coin: 'ETH',
                when: 'price rallies into the first fifteen minutes of the US session and stalls',
                steps: JSON.stringify([
                    'Mark the session-open high',
                    'Refuse longs above it until it is taken out on a close',
                    'Short a reclaim failure with stop above the high',
                ]),
                validate: 'Confirm on the live chart that the high held twice',
                output: 'A short with a defined stop above the session-open high',
                approval: 'A human approves this draft before it is applied',
                if_condition: 'us session open high held twice on closing prices',
                then_action: 'short a reclaim failure with the stop above that high',
                reason: 'the last three ETH longs taken at the open all stopped out',
            },
        });
        expect(call.ok).toBe(true);
        const draft = listSkillDrafts(USER)[0];
        expect(draft.crafted.name).toBe('Session-open fade short');

        const approved = await approveSkillDraft(draft, USER, []);
        expect(approved.created).toBe(true);
        expect(triggers()).toContain('us session open high held twice on closing prices');
    });
});

describe('applyRescopeProposal against the real notebook', () => {
    const NEW = {
        ifCondition: 'us session open high held twice on closing prices',
        thenAction: 'short a reclaim failure with the stop above that high',
    };

    it('rewrites the stored clauses and proves it by reading the file back', async () => {
        const original = craft();
        await ingestCraftedSkillFromDraft(original, 'BTC', USER, undefined, 'human');
        expect(triggers()).toContain(original.ifCondition.toLowerCase());

        const ok = await applyRescopeProposal('funding-exhaustion-long', NEW, USER);

        expect(ok).toEqual({ applied: true });
        expect(triggers()).toContain(NEW.ifCondition.toLowerCase());
        expect(triggers()).not.toContain(original.ifCondition.toLowerCase());
        // A rewrite is one skill moved, not a second skill born.
        expect(names().filter(n => n.includes('funding'))).toHaveLength(1);
    });

    it('refuses a clause below the bar and leaves the skill exactly as it was', async () => {
        const original = craft();
        await ingestCraftedSkillFromDraft(original, 'BTC', USER, undefined, 'human');

        const ok = await applyRescopeProposal(
            'funding-exhaustion-long',
            { ifCondition: 'too short', thenAction: NEW.thenAction },
            USER,
        );

        expect(ok).toEqual({ applied: false, reason: 'below-bar' });
        expect(triggers()).toEqual([original.ifCondition.toLowerCase()]);
    });

    it('names the missing skill for a slug that is not a live skill', async () => {
        expect(await applyRescopeProposal('no-such-skill', NEW, USER)).toEqual({ applied: false, reason: 'no-target' });
    });
});

// ─── A2 slice 3: the WHOLE chain a seat walks to re-scope one of my skills ────
// Nothing here mocks the applier, the queue or the notebook: the desk tool
// proposes, the queue holds it, a person approves, and the FILE is re-read off
// the store. This is the path that did not exist before A2 — the seat could
// propose, and the row could only ever be dismissed.

describe('revise_skill → queue → approve → skill updated', () => {
    it('the clauses a seat wrote are the clauses the live skill ends up with', async () => {
        const original = craft();
        await ingestCraftedSkillFromDraft(original, 'BTC', USER, undefined, 'human');
        const fileBytes = () => getMemoryFiles().files
            .find(f => f.name === 'funding-exhaustion-long.md')?.content ?? '';
        expect(fileBytes()).toContain(original.ifCondition);

        const receipt = await executeDeskTool({
            id: 'rev-1',
            name: 'revise_skill',
            arguments: {
                skill_slug: 'funding-exhaustion-long',
                reason: 'It fires on 3-session funding streaks too and loses there; only 8+ is the real edge.',
                if_condition: 'funding positive 14 sessions and the daily low was swept',
                then_action: 'go long only after a 4h close back above the swept level',
                predicate: 'close > open',
            },
        });
        expect(receipt.ok).toBe(true);

        const queued = listLearningProposals(USER);
        expect(queued).toHaveLength(1);
        expect(queued[0].kind).toBe('rescope');
        expect(queued[0].skillSlug).toBe('funding-exhaustion-long');
        // A proposal is a PROPOSAL: the live skill is untouched until a human acts.
        expect(fileBytes()).toContain(original.ifCondition);

        // The panel's Apply passes this same payload object (pinned in
        // learningQueuePanel.test.tsx / coachThread.test.tsx).
        const clauses = queued[0].payload as { ifCondition: string; thenAction: string; predicate: string };
        expect(await applyRescopeProposal(queued[0].skillSlug!, clauses, USER)).toEqual({ applied: true });

        expect(fileBytes()).toContain('funding positive 14 sessions and the daily low was swept');
        expect(fileBytes()).toContain('go long only after a 4h close back above the swept level');
        expect(fileBytes()).toContain('close > open');
        expect(fileBytes()).not.toContain(original.ifCondition);
        // The prose line the body carries (and a seat reads back) moved WITH the
        // front matter — otherwise the file claims two different triggers.
        expect(fileBytes()).toContain(
            '**My rule:** when funding positive 14 sessions and the daily low was swept, I go long only after a 4h close back above the swept level',
        );
        // One skill moved, not a second one born.
        expect(names().filter(n => n.includes('funding'))).toHaveLength(1);
        expect(listSkills()).toHaveLength(1);
    });
});

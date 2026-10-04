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

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    ingestCraftedSkillFromDraft,
    listSkills,
} from '../services/learning/SkillMemoryService';
import { approveSkillDraft } from '../services/learning/skillApproval';
import { listSkillDrafts, queueSkillDraft } from '../utils/skillDrafts';
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

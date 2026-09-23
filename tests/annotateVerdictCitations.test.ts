import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * E4 — `cites()`' third arm. The citation-stamp docstring always PROMISED a
 * join on the skill's IF clause ("a majority of the significant words of
 * its IF clause") but the code only checked the file stem and the title
 * words, so a verdict that followed a skill by paraphrasing its condition
 * was stamped `cited:false` → 'overridden': evidence starved, amendment
 * proposals queued against skills the verdict actually obeyed. These tests
 * pin the join end-to-end through the real store:
 *   1. zero overlap → cited:false → 'overridden'
 *   2. IF clause paraphrased (majority of its words, NO stem and NO title
 *      words) → cited:true → 'followed' — the arm that was missing
 *   3. the ≥3-word floor: two shared IF words do NOT cite a long clause
 *   4. every significant title word → cited:true
 *   5. the file stem → cited:true
 *
 * The fixture skill is seeded through `serializeSkill` and read back by
 * the service's own dynamic loader (`loadSkillConditions`), so the test
 * exercises the real round-trip: serialized `ifCondition:` frontmatter →
 * `parseSkillMarkdown` → slug-keyed map → join.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    // Notebook init reads the RAW value so "no key" and "unparseable blob"
    // stay distinguishable — the store holds parsed objects, so stringify on
    // the way out (same contract as tests/memoryFilesService.test.ts).
    getPreference: vi.fn(async (key: string) => {
        const v = store[key];
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? v : JSON.stringify(v);
    }),
    setPreference: vi.fn(async (key: string, value: string) => {
        store[key] = value;
    }),
    hasPreference: vi.fn(async (key: string) => store[key] !== undefined && store[key] !== null),
    getAllKeys: vi.fn(async () => Object.keys(store)),
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

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { serializeSkill } from '../services/learning/SkillMemoryService';
import type { SkillMeta } from '../services/learning/SkillMemoryService';
import {
    recordMemoryInjection,
    getRecentMemoryInjections,
    annotateVerdictCitations,
    skillAdherenceForRun,
} from '../services/learning/MemoryInjectionService';

const USER = 'cite-join-user';
const RUN_ID = 'run-cite-1';
const SKILL_FILE = 'btc-paraphrase-test.md';
/** Nine significant words, ALL longer than 3 chars, so the join's
 *  length filter drops none of them: the floor (≥3) and the majority
 *  (>4.5 ⇒ ≥5) are both measurable against a known denominator. */
const CONDITION = 'reclaim prints higher lows above the rising average support zone';

const skillMeta: SkillMeta = {
    status: 'confirmed',
    kind: 'repeat',
    wins: 3,
    losses: 2,
    consecutiveLosses: 0,
    tradeIds: ['t1', 't2', 't3'],
    body: 'Enter only on the reclaim that prints higher lows above the rising average support zone.',
    ifCondition: CONDITION,
};

/** Stamp one verdict against the seeded run and read BOTH sides of the
 *  join: the raw `cited` flag on the record and the adherence verdict the
 *  evidence path derives from it. */
const stampAndRead = async (verdict: string): Promise<{ cited: boolean | undefined; adherence: unknown }> => {
    await annotateVerdictCitations(USER, verdict, RUN_ID);
    const recs = await getRecentMemoryInjections(USER);
    const cited = recs[0]?.sources.find(s => s.path === `skills/${SKILL_FILE}`)?.cited;
    const adherence = await skillAdherenceForRun(USER, SKILL_FILE, RUN_ID);
    return { cited, adherence };
};

describe('annotateVerdictCitations — stem, title, and IF-clause joins', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USER);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(
            skills.id,
            SKILL_FILE,
            serializeSkill(skillMeta, 'BTC reclaim paraphrase test'),
            USER,
            true,
        );
        await recordMemoryInjection(USER, {
            stage: 'verdict',
            audience: 'moderator',
            coin: 'BTCUSDT',
            sources: [{ path: `skills/${SKILL_FILE}`, kind: 'skill', chars: 320 }],
            runId: RUN_ID,
        });
    });

    it('a verdict sharing no words with the skill stays cited:false → overridden', async () => {
        const { cited, adherence } = await stampAndRead(
            'Position sizing stays flat and the session ends without any signal.',
        );
        expect(cited).toBe(false);
        expect(adherence).toBe('overridden');
    });

    it('a verdict that PARAPHRASES the IF clause cites it → followed (the missing arm)', async () => {
        // 6 of the 9 IF words — a majority — with NO file stem and NO title
        // words ('paraphrase'/'test' deliberately absent), so arm 3 alone
        // can produce this result.
        const { cited, adherence } = await stampAndRead(
            'We take it only when the reclaim runs higher into the rising average — the support zone holding is the tell.',
        );
        expect(cited).toBe(true);
        expect(adherence).toBe('followed');
    });

    it('the ≥3-word floor: two shared IF words do not cite a long clause', async () => {
        const { cited, adherence } = await stampAndRead(
            'The rising average held into the close.',
        );
        expect(cited).toBe(false);
        expect(adherence).toBe('overridden');
    });

    it('carrying every significant title word still cites', async () => {
        const { cited, adherence } = await stampAndRead(
            'The paraphrase test we logged says skip this one.',
        );
        expect(cited).toBe(true);
        expect(adherence).toBe('followed');
    });

    it('echoing the file stem still cites', async () => {
        const { cited, adherence } = await stampAndRead(
            `Applied ${SKILL_FILE} directly to this read.`,
        );
        expect(cited).toBe(true);
        expect(adherence).toBe('followed');
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Temporal-ledger invariant: EVERY path that changes a skill's status must
 * leave a queryable `history` entry, otherwise skillStatusAt replay silently
 * loses eras ("what did I believe before this eval?"). Covers:
 *   • applySkillEvidence        → reason 'evidence'
 *   • maybeMergeSkill fold      → reason 'worth-gate merge'
 *   • applyReviewRecommendation → reason 'manual-review:*'
 *   • setSkillStatus            → reason 'manual'
 * The merge arm is the regression guard for a stamp-after-assign no-op:
 * stampStatusTransition early-returns once meta.status already equals the
 * next status, so the stamp must happen BEFORE the assignment.
 */

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

// No memory model configured → the refinement LLM phase is skipped, so the
// merge path exercises pure evidence folding.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => null),
}));

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import {
    applySkillEvidence,
    applyReviewRecommendation,
    maybeMergeSkill,
    setSkillStatus,
    parseSkillMarkdown,
    skillStatusAt,
} from '../services/learning/SkillMemoryService';
import type { SkillMeta } from '../services/learning/SkillMemoryService';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'ledger-user';

const makeTrade = (id: string, outcome: TradeOutcome): LoggedTrade => ({
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }],
        stopLoss: 105,
        takeProfit: [{ price: 90 }],
    } as any,
    outcome,
    timestamp: new Date().toISOString(),
    postMortem: '**Key Lesson:** Wait for the 15m reclaim before entering.',
});

// Fresh enough to skip evidence decay (>30 days stale halves counts), but
// not "now" so the seeded era clearly predates the transition under test.
const EVIDENCE_TS = () => new Date(Date.now() - 5000).toISOString();
const ORIGIN_TS = () => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const seedSkill = async (opts: {
    name: string;
    kind: 'repeat' | 'avoid';
    wins: number;
    losses: number;
}): Promise<{ fileId: string }> => {
    await initMemoryFiles(USER);
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, opts.name, `---
status: candidate
kind: ${opts.kind}
coin: BTCUSDT
direction: Short
family: Family A
wins: ${opts.wins}
losses: ${opts.losses}
ifCondition: BTC short setup in Family A
thenAction: follow the documented procedure
lastEvidenceAt: ${EVIDENCE_TS()}
modified: ${ORIGIN_TS()}
tradeIds: seed-a,seed-b
---

# Seeded skill

**When:** BTC short in Family A
**What I do:** wait for the reclaim.
`, USER, true);
    return { fileId: file.id };
};

const readMeta = (fileId: string): SkillMeta => {
    const file = getMemoryFiles().files.find(f => f.id === fileId)!;
    const meta = parseSkillMarkdown(file.content);
    if (!meta) throw new Error('seeded skill no longer parses');
    return meta;
};

/** The ledger's open-interval shape: closed eras, then one open tail. */
const expectLedgerWellFormed = (meta: SkillMeta): void => {
    const history = meta.history ?? [];
    expect(history.length).toBeGreaterThanOrEqual(2);
    history.slice(0, -1).forEach(entry => {
        expect(entry.invalidAt, 'superseded era must be closed').toBeTruthy();
    });
    expect(history[history.length - 1].invalidAt).toBeFalsy();
};

describe('Skill status changes always stamp the temporal ledger', () => {
    beforeEach(() => {
        store = {};
    });

    it('evidence-driven transition stamps reason "evidence" and replays', async () => {
        const { fileId } = await seedSkill({ name: 'btc-short-repeat.md', kind: 'repeat', wins: 2, losses: 2 });
        // WIN → sample 5, winRate 0.6 → candidate becomes confirmed.
        await applySkillEvidence(makeTrade('ev-1', TradeOutcome.WIN), USER);

        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expectLedgerWellFormed(meta);
        const last = meta.history![meta.history!.length - 1];
        expect(last.status).toBe('confirmed');
        expect(last.reason).toBe('evidence');
        // Replay: now sees the confirmed era; the backfilled origin era is
        // still queryable at its own validFrom.
        expect(skillStatusAt(meta, Date.now())).toBe('confirmed');
        expect(skillStatusAt(meta, meta.history![0].validFrom)).toBe('candidate');
    });

    it('worth-gate merge stamps reason "worth-gate merge"', async () => {
        const { fileId } = await seedSkill({ name: 'btc-short-avoid.md', kind: 'avoid', wins: 2, losses: 2 });
        // LOSS folds in → sample 5, winRate 0.4 → avoid skill confirms.
        const trade = makeTrade('m-1', TradeOutcome.LOSS);
        await maybeMergeSkill('btc-short-avoid.md', trade, [trade], USER);

        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expect(meta.wins).toBe(2);
        expect(meta.losses).toBe(3);
        expectLedgerWellFormed(meta);
        const last = meta.history![meta.history!.length - 1];
        expect(last.status).toBe('confirmed');
        expect(last.reason).toBe('worth-gate merge');
    });

    it('dashboard review stamps reason "manual-review:*"', async () => {
        const { fileId } = await seedSkill({ name: 'btc-short-review.md', kind: 'repeat', wins: 1, losses: 1 });
        await applyReviewRecommendation(fileId, 'promote', USER);

        const meta = readMeta(fileId);
        expect(meta.status).toBe('confirmed');
        expectLedgerWellFormed(meta);
        expect(meta.history![meta.history!.length - 1].reason).toBe('manual-review:promote');
    });

    it('manual setSkillStatus stamps reason "manual"', async () => {
        const { fileId } = await seedSkill({ name: 'btc-short-manual.md', kind: 'repeat', wins: 1, losses: 1 });
        await setSkillStatus(fileId, 'retired', USER);

        const meta = readMeta(fileId);
        expect(meta.status).toBe('retired');
        expectLedgerWellFormed(meta);
        expect(meta.history![meta.history!.length - 1].reason).toBe('manual');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.2a birth certificate (review fix P0-3): every skill pre-registers a
// falsifiable claim (prediction). evaluateClaim existed but was called
// NOWHERE — the scheduler asked the generic hurts/helps question and the
// ladder never consulted the claim. This suite pins the wiring: the claim
// rides recordEvalVerdict (stamped + surfaced in evalDetail), an UNMET
// claim blocks fresh promotion, met/pending claims do not, and
// claimTestedEvidence round-trips through the frontmatter.

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

import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, serializeSkill } from '../services/learning/SkillMemoryService';
import { recordEvalVerdict } from '../services/learning/SkillEvalService';
import { evaluateClaim } from '../utils/skillPrediction';

const USERNAME = 'claim-user';
const helps = { verdict: 'helps' as const, flips: 3, alignedFlips: 3 };

const pred = (lift: number, horizon: number): string =>
    JSON.stringify({ expectedLiftPts: lift, horizonTrades: horizon, scope: { coin: 'BTC' } });

const seed = async (name: string, wins: number, losses: number, prediction?: string): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, `${name}.md`, `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Long
family: Family A
wins: ${wins}
losses: ${losses}
ifCondition: BTC long setup in Family A
thenAction: take the long
tradeIds: a,b,c,d,e,f
${prediction ? `prediction: ${prediction}\n` : ''}---

# Repeat BTC long (${name})
`, USERNAME, true);
    return file.id;
};

const readMeta = (fileId: string) => {
    const file = getMemoryFiles().files.find(f => f.id === fileId)!;
    return parseSkillMarkdown(file.content)!;
};

describe('§8.2a birth certificate wiring', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USERNAME);
    });

    it('claimTestedEvidence round-trips through serialize/parse', () => {
        const meta = {
            status: 'candidate', kind: 'repeat', wins: 1, losses: 1, consecutiveLosses: 0,
            tradeIds: [], ifCondition: 'x', thenAction: 'y', body: 'b',
            modifiedAt: new Date().toISOString(),
            prediction: { expectedLiftPts: 10, horizonTrades: 10, scope: {} },
            claimTestedEvidence: 7,
        } as never;
        const parsed = parseSkillMarkdown(serializeSkill(meta as never, 'T'))!;
        expect(parsed.claimTestedEvidence).toBe(7);
    });

    it('recordEvalVerdict tests the claim and stamps sample + detail', async () => {
        // horizon 5 reached (sample 10), bar 0.5+0.10=0.6, winRate 0.5 → UNMET.
        const id = await seed('unmet', 5, 5, pred(10, 5));
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.claimTestedEvidence).toBe(10);
        expect(meta.evalDetail).toContain('claim UNMET');
    });

    it('pending claim (horizon not reached) is recorded as pending, not a failure', async () => {
        const id = await seed('pending', 3, 2, pred(10, 20)); // sample 5 < 20
        await recordEvalVerdict(id, helps, USERNAME);
        expect(readMeta(id).evalDetail).toContain('claim horizon not reached');
    });

    it('UNMET claim blocks fresh promotion (helps ×2, sample sufficient)', async () => {
        const id = await seed('blocked', 5, 5, pred(10, 5)); // winRate .5 < bar .6
        await recordEvalVerdict(id, helps, USERNAME);
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.evalStreak).toBe(2);
        expect(meta.status).toBe('candidate'); // claim refused the tier
    });

    it('MET claim allows promotion', async () => {
        const id = await seed('earned', 8, 2, pred(10, 5)); // .8 ≥ .6
        await recordEvalVerdict(id, helps, USERNAME);
        await recordEvalVerdict(id, helps, USERNAME);
        expect(readMeta(id).status).toBe('confirmed');
    });

    it('skills without a prediction keep the old promotion behavior', async () => {
        const id = await seed('legacy', 5, 5); // no prediction line
        await recordEvalVerdict(id, helps, USERNAME);
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.status).toBe('confirmed');
        expect(meta.claimTestedEvidence).toBeUndefined();
    });

    it('evaluateClaim: avoid skills are judged inverted (suppressed setups must lose)', () => {
        const p = { expectedLiftPts: 10, horizonTrades: 5, scope: {} };
        // Avoid claims: the followed win rate must stay BELOW 0.5 - lift.
        expect(evaluateClaim('avoid', p, { wins: 1, losses: 6 }).met).toBe(true); // .143 ≤ .4
        expect(evaluateClaim('avoid', p, { wins: 4, losses: 3 }).met).toBe(false); // .571 > .4
    });
});

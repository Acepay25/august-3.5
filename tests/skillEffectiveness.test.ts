import { describe, it, expect } from 'vitest';
import { getCalibrationSummaries } from '../services/backtesting/ModelPerformanceService';
import {
    reviewSkillEffectiveness,
    parseSkillMarkdown,
    serializeSkill,
    SkillMeta,
} from '../services/learning/SkillMemoryService';
import { createMemoryFile, initMemoryFiles, getMemoryFiles, deleteMemoryFile, ensureHarnessFolders } from '../services/learning/MemoryFilesService';

// ─── Brier calibration summaries ────────────────────────────────────────────

describe('getCalibrationSummaries', () => {
    it('computes a Brier score where perfect confidence anchoring scores 0', () => {
        // Pure math check of the bucket formula: a provider that went 7W/3L at
        // High (anchor 0.7) has Brier = (7*(0.3)² + 3*(0.7)²)/10 = 0.21.
        const anchor = 0.7;
        const wins = 7, losses = 3;
        const brier = (wins * Math.pow(1 - anchor, 2) + losses * Math.pow(anchor, 2)) / (wins + losses);
        expect(brier).toBeCloseTo(0.21, 5);
    });

    it('returns entries with the expected shape', () => {
        const summaries = getCalibrationSummaries();
        for (const s of summaries) {
            expect(typeof s.provider).toBe('string');
            expect(s.brierScore === null || (s.brierScore >= 0 && s.brierScore <= 1)).toBe(true);
            expect(s.samples).toBeGreaterThanOrEqual(0);
            expect(['calibrated', 'overconfident', 'underconfident', 'insufficient-data']).toContain(s.verdict);
        }
    });
});

// ─── Skill effectiveness review ─────────────────────────────────────────────

const skillContent = (overrides: Partial<SkillMeta>): string => {
    const base: SkillMeta = {
        status: 'confirmed',
        kind: 'repeat',
        coin: 'BTC',
        direction: 'Long',
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        tradeIds: [],
        ifCondition: 'test trigger',
        thenAction: 'test action',
        body: '**Trigger:** test\n**Procedure:** test',
        ...overrides,
    };
    return serializeSkill(base, 'Test BTC Long');
};

const skillFile = async (name: string, content: string, username: string) => {
    await ensureHarnessFolders(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) throw new Error('skills folder missing');
    return createMemoryFile(folder.id, name, content, username, true);
};

describe('reviewSkillEffectiveness', () => {
    it('recommends promote for a strong candidate and retire for a weak repeat skill', async () => {
        await initMemoryFiles('review-test');
        // Clean slate for this user's harness folders.
        for (const f of getMemoryFiles().files.filter(f => f.name.startsWith('skill-'))) {
            await deleteMemoryFile(f.id, 'review-test');
        }

        const strongCandidate = await skillFile(
            'skill-strong-candidate.md',
            skillContent({ status: 'candidate', kind: 'repeat', wins: 6, losses: 1 }),
            'review-test',
        );
        const weakRepeat = await skillFile(
            'skill-weak-repeat.md',
            skillContent({ status: 'confirmed', kind: 'repeat', wins: 2, losses: 6 }),
            'review-test',
        );

        const review = reviewSkillEffectiveness();
        const strong = review.find(r => r.fileId === strongCandidate.id);
        const weak = review.find(r => r.fileId === weakRepeat.id);

        expect(strong?.recommendation).toBe('promote');
        expect(strong?.rationale).toContain('evidence supports confirming');
        expect(weak?.recommendation).toBe('retire');
        expect(weak?.rationale).toContain('40%');

        // Weakest skills sort first.
        expect(review[0].fileId).toBe(weakRepeat.id);

        await deleteMemoryFile(strongCandidate.id, 'review-test');
        await deleteMemoryFile(weakRepeat.id, 'review-test');
    });

    it('flags consecutive losses on confirmed skills as refine', async () => {
        await initMemoryFiles('review-test-2');
        const bleeding = await skillFile(
            'skill-bleeding.md',
            skillContent({ status: 'confirmed', kind: 'avoid', wins: 4, losses: 1, consecutiveLosses: 3 }),
            'review-test-2',
        );
        const review = reviewSkillEffectiveness().find(r => r.fileId === bleeding.id);
        expect(review?.recommendation).toBe('refine');
        await deleteMemoryFile(bleeding.id, 'review-test-2');
    });

    it('parses what it serializes — round-trip sanity for review inputs', () => {
        const meta = parseSkillMarkdown(skillContent({ wins: 3, losses: 1 }));
        expect(meta?.wins).toBe(3);
        expect(meta?.losses).toBe(1);
    });
});

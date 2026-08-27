import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { parseSkillMarkdown, MIN_SAMPLE_CONFIRMED } from '../services/learning/SkillMemoryService';
import { recordEvalVerdict } from '../services/learning/SkillEvalService';

const USERNAME = 'eval-promotion-test';
const helps = { verdict: 'helps' as const, flips: 3, alignedFlips: 3 };

const seedCandidate = async (name: string, wins: number, losses: number, history?: string): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, `${name}.md`, `---
status: candidate
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: ${wins}
losses: ${losses}
ifCondition: BTC short setup in Family A
thenAction: skip the short
tradeIds: a,b,c,d,e,f
${history ? `history: ${history}\n` : ''}---

# Avoid BTC short (${name})
`, USERNAME, true);
    return file.id;
};

const readMeta = (fileId: string) => {
    const file = getMemoryFiles().files.find(f => f.id === fileId)!;
    return parseSkillMarkdown(file.content)!;
};

describe('sequential-eval promotion of fresh candidates', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('promotes a fresh candidate after 2 consecutive helps when sample is sufficient', async () => {
        const id = await seedCandidate('fresh', 2, 4); // sample 6 >= MIN_SAMPLE_CONFIRMED
        await recordEvalVerdict(id, helps, USERNAME);
        expect(readMeta(id).status).toBe('candidate'); // streak 1 — not yet
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.status).toBe('confirmed');
        expect(meta.evalStreak).toBe(2);
        const last = meta.history?.[meta.history.length - 1];
        expect(last?.reason).toMatch(/promotion/);
    });

    it('does NOT promote a fresh candidate below the sample gate', async () => {
        const id = await seedCandidate('thin', 1, 1); // sample 2 < MIN_SAMPLE_CONFIRMED
        await recordEvalVerdict(id, helps, USERNAME);
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.status).toBe('candidate');
        expect(meta.evalStreak).toBe(2);
    });

    it('rehabilitates an eval-demoted candidate regardless of the sample gate', async () => {
        // Last history entry: a candidate demoted by evals ('eval hurts …').
        const history = JSON.stringify([
            { status: 'confirmed', validFrom: '2026-08-01T00:00:00.000Z', invalidAt: '2026-08-05T00:00:00.000Z' },
            { status: 'candidate', validFrom: '2026-08-05T00:00:00.000Z', reason: 'eval hurts ×2 (0/3)' },
        ]);
        const id = await seedCandidate('rehab', 1, 2, history); // sample 3 < gate, but rehab is exempt
        await recordEvalVerdict(id, helps, USERNAME);
        await recordEvalVerdict(id, helps, USERNAME);
        const meta = readMeta(id);
        expect(meta.status).toBe('confirmed');
        const last = meta.history?.[meta.history.length - 1];
        expect(last?.reason).not.toMatch(/promotion/); // rehabilitation, not fresh promotion
    });

    it('exposes the shared sample threshold', () => {
        expect(MIN_SAMPLE_CONFIRMED).toBe(5);
    });
});

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

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { readSettledBeliefs } from '../services/learning/settledBeliefs';
import {
    isWeeklyRollupDue,
    runWeeklyRollup,
    runWeeklyRollupIfDue,
} from '../services/learning/weeklyRollup';
import { ROLLUP_NOTES_FILE_NAME } from '../services/learning/DoctrineConsolidationService';

const USERNAME = 'weekly-rollup-test';

const seedSkill = async (name: string, wins: number, losses: number, status = 'confirmed'): Promise<void> => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const ids = Array.from({ length: Math.max(1, wins + losses) }, (_, i) => `${name}-${i}`).join(',');
    await createMemoryFile(folder.id, `${name}.md`, `---
status: ${status}
kind: avoid
coin: BTCUSDT
direction: Short
family: breakout
regime: ranging
wins: ${wins}
losses: ${losses}
thenAction: wait for the 15m reclaim before shorting ${name}
tradeIds: ${ids}
---

# Avoid BTCUSDT Short breakout (${name})

Wait for the reclaim.
`, USERNAME, true);
};

const rollupNotesContent = (): string | undefined => {
    const { files, folders } = getMemoryFiles();
    const profile = folders.find(f => f.name === 'profile');
    return files.find(f => f.folderId === profile?.id && f.name === ROLLUP_NOTES_FILE_NAME)?.content;
};

describe('isWeeklyRollupDue', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('is due when never run, not due right after a run', async () => {
        expect(await isWeeklyRollupDue(USERNAME)).toBe(true);
        await runWeeklyRollup(USERNAME);
        expect(await isWeeklyRollupDue(USERNAME)).toBe(false);
    });

    it('is due again after 7 days', async () => {
        await runWeeklyRollup(USERNAME);
        const in8Days = Date.now() + 8 * 24 * 60 * 60 * 1000;
        expect(await isWeeklyRollupDue(USERNAME, in8Days)).toBe(true);
    });
});

describe('runWeeklyRollup', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('distills a high-sample confirmed skill into a settled belief', async () => {
        await seedSkill('strong', 2, 5); // sample 7 >= 6
        const res = await runWeeklyRollup(USERNAME);
        expect(res.beliefsUpserted).toBe(1);
        const beliefs = readSettledBeliefs();
        expect(beliefs).toHaveLength(1);
        expect(beliefs[0].slug).toBe('strong');
        expect(beliefs[0].evidenceCount).toBe(7);
        expect(beliefs[0].body).toContain('wait for the 15m reclaim');
    });

    it('routes low-sample confirmed skills to rollup notes, not beliefs', async () => {
        await seedSkill('emerging', 2, 2); // sample 4 < 6
        const res = await runWeeklyRollup(USERNAME);
        expect(res.beliefsUpserted).toBe(0);
        expect(res.notesWritten).toBe(true);
        expect(readSettledBeliefs()).toHaveLength(0);
        const notes = rollupNotesContent() ?? '';
        expect(notes).toContain('Emerging patterns');
        expect(notes).toContain('emerging');
    });

    it('never edits doctrine.md directly', async () => {
        await seedSkill('strong', 2, 5);
        await runWeeklyRollup(USERNAME);
        const { files } = getMemoryFiles();
        expect(files.some(f => f.name === 'doctrine.md')).toBe(false);
    });

    it('runWeeklyRollupIfDue returns null when not due', async () => {
        await runWeeklyRollup(USERNAME);
        expect(await runWeeklyRollupIfDue(USERNAME)).toBeNull();
    });
});

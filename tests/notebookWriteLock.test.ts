import { describe, it, expect, beforeEach } from 'vitest';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, serializeSkill, titleFromMeta, applySkillEvidence } from '../services/learning/SkillMemoryService';
import { appendDiaryEntry } from '../services/learning/MemoryFilesService';
import type { LoggedTrade, TradeAnalysis } from '../types';

// Write-lock regression: concurrent writers (fire-and-forget trade sync vs
// awaited post-mortem sync vs detached eval stamping) must never lose updates.

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'WIN' as never,
    timestamp: new Date().toISOString(),
    ...overrides,
});

const seedConfirmed = async (username: string): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const meta = {
        status: 'confirmed',
        kind: 'avoid',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        wins: 1,
        losses: 6,
        consecutiveLosses: 0,
        tradeIds: ['a', 'b', 'c'],
        ifCondition: 'BTC short in Family A',
        thenAction: 'skip',
        body: '**Trigger:** BTC short in Family A\n**Procedure:** skip the short.',
        // Fresh evidence so the decay pass doesn't halve the seed counts.
        lastEvidenceAt: new Date().toISOString(),
    } as never as Parameters<typeof serializeSkill>[0];
    const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', serializeSkill(meta, titleFromMeta(meta)), username, true);
    return file.id;
};

describe('notebook write lock (concurrent writers)', () => {
    beforeEach(() => { /* fresh user per test via initMemoryFiles */ });

    it('two concurrent evidence passes on the same skill both land (no lost update)', async () => {
        await initMemoryFiles('lock-user');
        const fileId = await seedConfirmed('lock-user');
        const before = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;

        // Fire-and-forget + awaited sync racing each other, like production.
        await Promise.all([
            applySkillEvidence(makeTrade({ id: 'w1' }), 'lock-user', [makeTrade({ id: 'w1' })]),
            applySkillEvidence(makeTrade({ id: 'w2' }), 'lock-user', [makeTrade({ id: 'w2' })]),
        ]);

        const after = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
        expect(after.wins).toBe(before.wins + 2);
        expect(after.tradeIds).toContain('w1');
        expect(after.tradeIds).toContain('w2');
    });

    it('concurrent diary appends for the same coin both land', async () => {
        await initMemoryFiles('lock-diary');
        await Promise.all([
            appendDiaryEntry(makeTrade({ id: 'd1', analysis: { coinName: 'ETHUSDT' } as TradeAnalysis }), 'lock-diary'),
            appendDiaryEntry(makeTrade({ id: 'd2', analysis: { coinName: 'ETHUSDT' } as TradeAnalysis }), 'lock-diary'),
        ]);
        const diary = getMemoryFiles().files.find(f => f.name === 'ETHUSDT.md')!;
        expect(diary?.content).toContain('id: d1');
        expect(diary?.content).toContain('id: d2');
    });

    it('a failing write does not poison the chain for later writers', async () => {
        await initMemoryFiles('lock-poison');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await expect(createMemoryFile(skills.id, 'dup.md', 'x', 'lock-poison', true)).resolves.toBeTruthy();
        // Duplicate name throws — but must not break the next queued write.
        await expect(createMemoryFile(skills.id, 'dup.md', 'y', 'lock-poison', true)).rejects.toThrow(/already exists/);
        await expect(createMemoryFile(skills.id, 'other.md', 'z', 'lock-poison', true)).resolves.toBeTruthy();
    });
});

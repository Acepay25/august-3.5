import { describe, it, expect } from 'vitest';
import {
    getMemoryFilesContext,
    handleRecallTool,
    listRetrievedMemorySources,
    type MemoryStage,
} from '../services/learning/MemoryRetrievalService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { migrateIfThenRulesToSkills } from '../services/learning/IfThenMigrationService';
import { initializeLearningRules, saveLearningRules } from '../services/learning/LearningRulesService';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import type { LoggedTrade, TradeAnalysis } from '../types';

// ROUND-24m simplification contract tests:
// budgeted slices, no diary, mistakes escalate to silence, recall tool.

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'LOSS' as never,
    timestamp: '2026-08-09T12:00:00.000Z',
    ...overrides,
});

const seedConfirmedSkill = async (username: string): Promise<void> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short setup in Family A without a reclaim close
thenAction: skip the short until the reclaim candle closes
tradeIds: a,b,c
---

# Avoid BTC short

**When:** BTC short setup in Family A without a reclaim close
**What I do:** skip the short until the reclaim candle closes.
`, username, true);
};

describe('ROUND-24m retrieval budget + slices', () => {
    it('keeps every stage context under its budget (plus doctrine header overhead)', async () => {
        await initMemoryFiles('budget-user');
        await seedConfirmedSkill('budget-user');
        const stages: MemoryStage[] = ['opening', 'rebuttal', 'verdict'];
        for (const stage of stages) {
            const ctx = getMemoryFilesContext(
                { coin: 'BTCUSDT', direction: 'Short', family: 'Family A' },
                undefined,
                'analyst',
                stage,
            );
            // 900/400/600 budgets + ~300 chars of frame/doctrine header.
            expect(ctx.length).toBeLessThan(2200);
        }
    });

    it('never injects diary files even when they match the coin', async () => {
        await initMemoryFiles('diary-user');
        const folder = getMemoryFiles().folders.find(f => f.name === 'trader-diary')!;
        await createMemoryFile(folder.id, 'BTCUSDT.md', '# BTCUSDT Trade Diary\n\n## Aug 9\n- WIN ✅ (+3.2%)\n- What I learned: Wait for the 15m reclaim.', 'diary-user', true);
        const ctx = getMemoryFilesContext({ coin: 'BTCUSDT', direction: 'Short' });
        expect(ctx).not.toContain('WIN ✅');
        expect(ctx).not.toContain('trader-diary/');
    });

    it('silences the recurring-mistakes line once a skill owns the cluster', async () => {
        await initMemoryFiles('mistakes-user');
        const rules = getMemoryFiles().folders.find(f => f.name === 'rules')!;
        await createMemoryFile(rules.id, 'recurring-mistakes.md', '# My Recurring Mistakes\n\n- ⚠️ **4× BTCUSDT Short** avg -2.1% — last Aug 9. I keep losing here.\n- ⚠️ **3× ETHUSDT Long** avg -1.4% — last Aug 8. I keep losing here.\n', 'mistakes-user', true);

        // No skill yet → the BTCUSDT line shows.
        const before = getMemoryFilesContext({ coin: 'BTCUSDT', direction: 'Short' });
        expect(before).toContain('4× BTCUSDT Short');

        // Skill created → line goes quiet.
        await seedConfirmedSkill('mistakes-user');
        const after = getMemoryFilesContext({ coin: 'BTCUSDT', direction: 'Short' });
        expect(after).not.toContain('4× BTCUSDT Short');
        // Unrelated cluster (ETH) still surfaces when queried.
        const eth = getMemoryFilesContext({ coin: 'ETHUSDT', direction: 'Long' });
        expect(eth).toContain('3× ETHUSDT Long');
    });

    it('injects similar-trade history at verdict only', async () => {
        await initMemoryFiles('verdict-user');
        const trades = [makeTrade({ id: 'x1' }), makeTrade({ id: 'x2' })];
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };
        expect(getMemoryFilesContext(q, trades, 'analyst', 'opening')).not.toContain('Similar closed trades');
        expect(getMemoryFilesContext(q, trades, 'analyst', 'verdict')).toContain('Similar closed trades');
    });
});

describe('recall tool (pull-over-push)', () => {
    it('returns matched skill + mistakes for a topic', async () => {
        await initMemoryFiles('recall-user');
        await seedConfirmedSkill('recall-user');
        const out = handleRecallTool({ topic: 'BTC short' });
        expect(out).toContain('SKILL CONFIRMED');
        expect(out.toLowerCase()).toContain('reclaim');
    });

    it('answers gracefully when the notebook is empty', async () => {
        await initMemoryFiles('recall-empty');
        const out = handleRecallTool({ topic: 'SOL long' });
        expect(out).toContain('No notebook memory');
    });

    it('requires a topic', async () => {
        const out = handleRecallTool({ topic: '' });
        expect(out).toContain('error');
    });
});

describe('IF/THEN rules → skills migration', () => {
    it('creates candidate skills from legacy rules, idempotently', async () => {
        await initMemoryFiles('migrate-user');
        const storage = initializeLearningRules();
        storage.rules = [{
            id: 'rule-mig-1',
            ifCondition: 'BTC sweeps the London low then reclaims it',
            thenAction: 'wait for the 15m close back inside before entering',
            sourceTradeId: 'rule-trade-1',
            outcome: 'LOSS',
            coin: 'BTCUSDT',
            direction: 'Short',
            createdAt: new Date().toISOString(),
            useCount: 0,
        } as never];
        saveLearningRules(storage);

        const first = await migrateIfThenRulesToSkills('migrate-user', [makeTrade({ id: 'rule-trade-1' })]);
        expect(first.created).toBe(1);

        const skills = getMemoryFiles().files.filter(f => f.folderId === getMemoryFiles().folders.find(fd => fd.name === 'skills')?.id);
        const migrated = skills
            .map(f => parseSkillMarkdown(f.content))
            .find(m => m?.ifCondition?.toLowerCase().includes('sweeps the london low'));
        expect(migrated).toBeTruthy();
        expect(migrated!.status).toBe('candidate');
        expect(migrated!.kind).toBe('avoid');

        // Second run: nothing new.
        const second = await migrateIfThenRulesToSkills('migrate-user', [makeTrade({ id: 'rule-trade-1' })]);
        expect(second.created).toBe(0);
        expect(second.skipped).toBe(1);
    });
});

describe('source list reflects the new slices', () => {
    it('lists doctrine/identity/skill/mistakes/similar — never diary', async () => {
        await initMemoryFiles('sources-user');
        await seedConfirmedSkill('sources-user');
        const sources = listRetrievedMemorySources({ coin: 'BTCUSDT', direction: 'Short', family: 'Family A' });
        expect(sources.some(s => s.path === 'skills/btc-short-avoid.md')).toBe(true);
        expect(sources.some(s => s.kind === 'diary')).toBe(false);
    });
});

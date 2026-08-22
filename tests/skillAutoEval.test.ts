import { describe, it, expect, beforeEach } from 'vitest';
import {
    isSkillDueForEval,
    pickDueSkill,
    runDueSkillEval,
    resetAutoEvalBudget,
    setSessionEvalsRun as sessionEvalsRunSet,
    MAX_AUTO_EVALS_PER_SESSION,
} from '../services/learning/SkillEvalScheduler';
import { evaluateSkill } from '../services/learning/SkillEvalService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import type { LoggedTrade, TradeAnalysis } from '../types';

// ROUND-25c: the harness evaluates its own skills — no user action.

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'LOSS' as never,
    timestamp: '2026-08-09T12:00:00.000Z',
    ...overrides,
});

const seedConfirmed = async (username: string, extra = ''): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short setup in Family A
thenAction: skip the short
tradeIds: a,b,c
${extra}---

# Avoid BTC short

**When:** BTC short in Family A
**What I do:** skip.
`, username, true);
    return file.id;
};

describe('auto-eval scheduler (ROUND-25c)', () => {
    beforeEach(() => resetAutoEvalBudget());

    it('a confirmed skill with enough matched history is due when never evaluated', async () => {
        await initMemoryFiles('due-user');
        const fileId = await seedConfirmed('due-user');
        const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
        expect(isSkillDueForEval(meta, [makeTrade(), makeTrade({ id: 't2' }), makeTrade({ id: 't3' })])).toBe(true);
    });

    it('is not due within the cooldown / trade-count gates after an eval', async () => {
        await initMemoryFiles('cooldown-user');
        const fileId = await seedConfirmed('cooldown-user', 'lastEvalAt: 2026-08-20T12:00:00.000Z\n');
        const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
        // Only trades AFTER lastEvalAt count toward the between-gate; these are all before it.
        expect(isSkillDueForEval(meta, [makeTrade()])).toBe(false);
    });

    it('candidates are never audited (only authority-holders)', async () => {
        await initMemoryFiles('cand-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const file = await createMemoryFile(skills.id, 'eth-long-avoid.md', `---
status: candidate
kind: avoid
coin: ETHUSDT
direction: Long
wins: 0
losses: 2
ifCondition: ETH long chop
thenAction: skip
tradeIds: x,y
---

# Avoid ETH long
`, 'cand-user', true);
        const meta = parseSkillMarkdown(file.content)!;
        expect(isSkillDueForEval(meta, [makeTrade({ id: 'e1', analysis: { coinName: 'ETHUSDT', direction: 'Long' } as TradeAnalysis })])).toBe(false);
    });

    it('runDueSkillEval stamps the verdict and respects the session budget', async () => {
        await initMemoryFiles('sched-user');
        await seedConfirmed('sched-user');
        const trades = [makeTrade(), makeTrade({ id: 't2' }), makeTrade({ id: 't3' })];
        const runner = async (_t: LoggedTrade, { skillEnabled }: { skillEnabled: boolean }) =>
            skillEnabled ? { confidence: 'Avoid', direction: 'Neutral' } : { confidence: 'High', direction: 'Short' };

        const first = await runDueSkillEval(trades, 'sched-user', { runner, config: {} as never, username: 'sched-user' });
        expect(first.ran).toBe(true);
        expect(first.verdict).toBe('helps');

        const content = getMemoryFiles().files.find(f => f.name === 'btc-short-avoid.md')!.content;
        expect(content).toMatch(/evalVerdict: helps \(3\/3\)/);
        expect(content).toContain('lastEvalAt:');

        // Cooldown: just-evaluated skill is not immediately due again.
        const rerun = await runDueSkillEval(trades, 'sched-user', { runner, config: {} as never, username: 'sched-user' });
        expect(rerun.ran).toBe(false);

        // Session budget: once MAX evals have run this session, nothing is due.
        resetAutoEvalBudget();
        sessionEvalsRunSet(MAX_AUTO_EVALS_PER_SESSION);
        expect(pickDueSkill(trades)).toBeNull();
    });

    it("'hurts' verdict demotes a confirmed skill via deriveStatus on next evidence pass", async () => {
        await initMemoryFiles('hurt-user');
        await seedConfirmed('hurt-user');
        // Simulate the scheduler recording a hurts verdict...
        const file = getMemoryFiles().files.find(f => f.name === 'btc-short-avoid.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        meta.evalVerdict = 'hurts';
        const { serializeSkill, titleFromMeta, applySkillEvidence } =
            await import('../services/learning/SkillMemoryService');
        const { updateMemoryFile } = await import('../services/learning/MemoryFilesService');
        await updateMemoryFile(file.id, { content: serializeSkill(meta, titleFromMeta(meta)) }, 'hurt-user');

        // ...then new evidence lands: status must NOT re-confirm.
        const win = makeTrade({ id: 'fresh-win', outcome: 'WIN' as never });
        await applySkillEvidence(win, 'hurt-user', [win]);
        const updated = parseSkillMarkdown(
            getMemoryFiles().files.find(f => f.name === 'btc-short-avoid.md')!.content
        )!;
        expect(updated.evalVerdict).toBe('hurts');
        expect(updated.status).not.toBe('confirmed');
    });

    it('evaluateSkill remains importable and pure (regression)', async () => {
        expect(typeof evaluateSkill).toBe('function');
    });
});

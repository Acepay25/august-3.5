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

// The harness evaluates its own skills — no user action.

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

describe('auto-eval scheduler', () => {
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
        // Simulate the scheduler recording a hurts verdict…
        // NOTE: evalStreak 2 is included because recordEvalVerdict only
        // DEMOTES after two consecutive 'hurts' runs (sequential-evidence
        // gate) — a streak-less stub used to "pass" only because the
        // missing lastEvidenceAt collapsed the lifetime counts to below
        // the confirmation sample (an unrelated decay bug, now fixed).
        const file = getMemoryFiles().files.find(f => f.name === 'btc-short-avoid.md')!;
        const meta = parseSkillMarkdown(file.content)!;
        meta.evalVerdict = 'hurts';
        meta.evalStreak = 2;
        meta.lastEvalAt = new Date().toISOString();
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

    it('a fresh hurts pin does NOT block auto-retirement (the retire band wins)', async () => {
        await initMemoryFiles('retire-hurts-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const now = new Date().toISOString();
        // 2W/8L REPEAT skill — deep inside the retire band (sample ≥ 6,
        // winRate 0.2 < 0.4) — carrying a fresh, streak-reached 'hurts'
        // verdict. Pre-fix the status-agnostic hurts pin early-returned
        // 'candidate' ABOVE the retire band, so a skill the effectiveness
        // review recommends retiring could never auto-retire for 30 days.
        const file = await createMemoryFile(skills.id, 'btc-short-repeat.md', `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 2
losses: 8
ifCondition: BTC short setup in Family A
thenAction: take the short
evalVerdict: hurts
evalStreak: 2
lastEvalAt: ${now}
lastEvidenceAt: ${now}
tradeIds: a,b,c
---

# Repeat BTC short
`, 'retire-hurts-user', true);
        const { applySkillEvidence } = await import('../services/learning/SkillMemoryService');
        const loss = makeTrade({ id: 'hurt-loss', outcome: 'LOSS' as never });
        await applySkillEvidence(loss, 'retire-hurts-user', [loss]);
        const meta = parseSkillMarkdown(
            getMemoryFiles().files.find(f => f.id === file.id)!.content
        )!;
        // Retirement stats win over the pin; the pin only holds ABOVE the
        // retire floor (blocked-promotion behavior covered by the
        // streak-expiry test below).
        expect(meta.status).toBe('retired');
    });

    it('a hurts-demoted candidate becomes due for re-evaluation once the gates pass', async () => {
        await initMemoryFiles('recover-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const lastEvalAt = new Date(Date.now() - 3 * 86_400_000).toISOString(); // cooldown (24h) passed
        const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: candidate
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short setup in Family A
thenAction: skip the short
evalVerdict: hurts (0/2)
lastEvalAt: ${lastEvalAt}
tradeIds: a,b,c
---

# Avoid BTC short
`, 'recover-user', true);
        const meta = parseSkillMarkdown(file.content)!;
        // 10 closed trades after lastEvalAt satisfy EVAL_MIN_TRADES_BETWEEN.
        const tradeTime = new Date(Date.now() - 2 * 86_400_000).toISOString();
        const trades = Array.from({ length: 10 }, (_, i) => makeTrade({ id: `r${i}`, timestamp: tradeTime }));
        expect(isSkillDueForEval(meta, trades)).toBe(true);
    });

    it('a hurts-demoted candidate within the cooldown is not due', async () => {
        await initMemoryFiles('recover-cooldown-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const lastEvalAt = new Date(Date.now() - 2 * 3_600_000).toISOString(); // 2h ago < 24h cooldown
        const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: candidate
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short setup in Family A
thenAction: skip the short
evalVerdict: hurts (0/2)
lastEvalAt: ${lastEvalAt}
tradeIds: a,b,c
---

# Avoid BTC short
`, 'recover-cooldown-user', true);
        const meta = parseSkillMarkdown(file.content)!;
        const tradeTime = new Date(Date.now() - 1 * 3_600_000).toISOString();
        const trades = Array.from({ length: 10 }, (_, i) => makeTrade({ id: `c${i}`, timestamp: tradeTime }));
        expect(isSkillDueForEval(meta, trades)).toBe(false);
    });

    /**
     * The due gate used to count EVERY closed trade since the last eval, so
     * ten unrelated ETH trades re-triggered an audit of a stale BTC skill. The
     * eval then re-ran on the same historical cases, the near-deterministic
     * runner reproduced the same flips, and the streak advanced on evidence
     * that had not changed.
     */
    it('unrelated trades since the last eval do not make a skill due', async () => {
        await initMemoryFiles('unrelated-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const lastEvalAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
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
lastEvalAt: ${lastEvalAt}
tradeIds: a,b,c
---

# Avoid BTC short
`, 'unrelated-user', true);
        const meta = parseSkillMarkdown(file.content)!;
        const tradeTime = new Date(Date.now() - 2 * 86_400_000).toISOString();
        // 10 closed trades, none of which match the skill's setup. The family
        // must share NO word segment with 'Family A' — familiesRelate treats
        // any two labels containing the literal word "family" as related, so
        // 'Family Z' would still have counted as a match.
        const unrelated = Array.from({ length: 10 }, (_, i) => makeTrade({
            id: `u${i}`,
            timestamp: tradeTime,
            analysis: { coinName: 'ETHUSDT', direction: 'Long', detectedPatternFamily: 'liquidity-sweep' } as TradeAnalysis,
        }));
        expect(isSkillDueForEval(meta, unrelated)).toBe(false);
    });

    it('hurts demotions respect the sequential streak gate and the staleness expiry on evidence passes', async () => {
        await initMemoryFiles('stale-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        // Healthy avoid skill (winRate ≤ 0.4 → confirmed by outcomes alone).
        // lastEvidenceAt is fresh so evidence decay stays out of the picture.
        const seed = async (username: string, lastEvalAt: string, evalStreak?: number): Promise<string> => {
            const file = await createMemoryFile(skills.id, `stale-${username}.md`, `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 2
losses: 6
ifCondition: BTC short setup in Family A
thenAction: skip the short
evalVerdict: hurts (0/2)
lastEvalAt: ${lastEvalAt}
lastEvidenceAt: ${new Date().toISOString()}
${evalStreak ? `evalStreak: ${evalStreak}` : ''}
tradeIds: a,b,c
---

# Avoid BTC short
`, username, true);
            return file.id;
        };

        const { serializeSkill, titleFromMeta, applySkillEvidence } =
            await import('../services/learning/SkillMemoryService');
        const { updateMemoryFile } = await import('../services/learning/MemoryFilesService');
        const win = makeTrade({ id: 'fresh-win', outcome: 'WIN' as never });

        // Fresh verdict (2 days old) with the streak bar REACHED: demotion
        // still active — the evidence pass keeps the skill benched.
        await initMemoryFiles('stale-fresh');
        const freshId = await seed('stale-fresh', new Date(Date.now() - 2 * 86_400_000).toISOString(), 2);
        const freshMeta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === freshId)!.content)!;
        await updateMemoryFile(freshId, { content: serializeSkill(freshMeta, titleFromMeta(freshMeta)) }, 'stale-fresh');
        await applySkillEvidence(win, 'stale-fresh', [win]);
        expect(parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === freshId)!.content)!.status).toBe('candidate');

        // Fresh verdict but a SINGLE 'hurts' (no streak yet): the sequential
        // gate holds — one noisy A/B run cannot bench a confirmed skill, so
        // outcomes alone decide, and they say confirmed.
        await initMemoryFiles('stale-single');
        const singleId = await seed('stale-single', new Date(Date.now() - 2 * 86_400_000).toISOString());
        const singleMeta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === singleId)!.content)!;
        await updateMemoryFile(singleId, { content: serializeSkill(singleMeta, titleFromMeta(singleMeta)) }, 'stale-single');
        await applySkillEvidence(win, 'stale-single', [win]);
        expect(parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === singleId)!.content)!.status).toBe('confirmed');

        // Stale verdict (40 days old), streak reached but EXPIRED — outcomes
        // alone decide, and they say confirmed.
        await initMemoryFiles('stale-old');
        const oldId = await seed('stale-old', new Date(Date.now() - 40 * 86_400_000).toISOString(), 2);
        const oldMeta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === oldId)!.content)!;
        await updateMemoryFile(oldId, { content: serializeSkill(oldMeta, titleFromMeta(oldMeta)) }, 'stale-old');
        await applySkillEvidence(win, 'stale-old', [win]);
        expect(parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === oldId)!.content)!.status).toBe('confirmed');
    });

    it('evaluateSkill remains importable and pure (regression)', async () => {
        expect(typeof evaluateSkill).toBe('function');
    });
});

import { describe, it, expect } from 'vitest';
import {
    evaluateSkill,
    selectEvalTrades,
    recordEvalVerdict,
} from '../services/learning/SkillEvalService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import type { LoggedTrade, TradeAnalysis } from '../types';

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'LOSS' as never,
    timestamp: '2026-08-09T12:00:00.000Z',
    ...overrides,
});

const seedSkill = async (username: string): Promise<string> => {
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
---

# Avoid BTC short

**When:** \${SYMBOL} short in Family A during \${REGIME}
**What I do:** skip the short until the reclaim closes.
`, username, true);
    return file.id;
};

describe('SkillEvalService (with-skill vs without-skill A/B)', () => {
    it('selects only matching historical trades, capped', async () => {
        await initMemoryFiles('eval-user');
        const fileId = await seedSkill('eval-user');
        const meta = parseSkillMarkdown(getMemoryFiles().files.find(f => f.id === fileId)!.content)!;
        const trades = [
            makeTrade({ id: 'm1' }),
            makeTrade({ id: 'm2', timestamp: '2026-08-10T12:00:00.000Z' }),
            makeTrade({ id: 'other', analysis: { coinName: 'ETHUSDT', direction: 'Long' } as TradeAnalysis }),
        ];
        const picked = selectEvalTrades(meta, trades);
        expect(picked.map(t => t.id).sort()).toEqual(['m1', 'm2']);
    });

    it('detects aligned flips: avoid skill drops confidence', async () => {
        await initMemoryFiles('eval-flip');
        const fileId = await seedSkill('eval-flip');
        const trades = [makeTrade({ id: 'm1' })];
        // Baseline (skill off): High short. With skill: Avoid + Neutral.
        const runner = async (_t: LoggedTrade, { skillEnabled }: { skillEnabled: boolean }) =>
            skillEnabled
                ? { confidence: 'Avoid', direction: 'Neutral' }
                : { confidence: 'High', direction: 'Short' };

        const res = await evaluateSkill(fileId, 'eval-flip', trades, {} as never, runner);
        expect(res.error).toBeUndefined();
        expect(res.flips).toBe(1);
        expect(res.alignedFlips).toBe(1);
        expect(res.misalignedFlips).toBe(0);
        expect(res.verdict).toBe('helps');
    });

    it('detects misaligned flips: skill raises confidence on a loser', async () => {
        await initMemoryFiles('eval-mis');
        const fileId = await seedSkill('eval-mis');
        const trades = [makeTrade({ id: 'm1' })];
        const runner = async (_t: LoggedTrade, { skillEnabled }: { skillEnabled: boolean }) =>
            skillEnabled
                ? { confidence: 'High', direction: 'Short' }
                : { confidence: 'Low', direction: 'Short' };

        const res = await evaluateSkill(fileId, 'eval-mis', trades, {} as never, runner);
        expect(res.flips).toBe(1);
        expect(res.misalignedFlips).toBe(1);
        expect(res.verdict).toBe('hurts');
    });

    it('is inconclusive when the skill never changes the decision', async () => {
        await initMemoryFiles('eval-same');
        const fileId = await seedSkill('eval-same');
        const trades = [makeTrade({ id: 'm1' })];
        const runner = async () => ({ confidence: 'Medium', direction: 'Short' });
        const res = await evaluateSkill(fileId, 'eval-same', trades, {} as never, runner);
        expect(res.flips).toBe(0);
        expect(res.verdict).toBe('inconclusive');
    });

    it('never mutates the notebook and hands the real skill to the enabled arm', async () => {
        await initMemoryFiles('eval-restore');
        const fileId = await seedSkill('eval-restore');
        const seen: { skillEnabled: boolean; hasRealBody: boolean }[] = [];
        const runner = async (_t: LoggedTrade, { skillEnabled, skill }: { skillEnabled: boolean; skill?: { content: string } }) => {
            seen.push({ skillEnabled, hasRealBody: !!skill?.content?.includes('# Avoid BTC short') });
            return skillEnabled ? { confidence: 'Avoid', direction: 'Neutral' } : { confidence: 'High', direction: 'Short' };
        };

        const before = JSON.stringify(getMemoryFiles());
        const res = await evaluateSkill(fileId, 'eval-restore', [makeTrade()], {} as never, runner);
        const after = JSON.stringify(getMemoryFiles());

        expect(after).toBe(before); // no enabled flip-flop, no frontmatter writes mid-eval
        expect(res.error).toBeUndefined();
        // Context rides along on BOTH arms — the runner itself gates rendering
        // on skillEnabled (that's what keeps the notebook untouched).
        expect(seen).toEqual([
            { skillEnabled: false, hasRealBody: true },
            { skillEnabled: true, hasRealBody: true },
        ]);
        expect(getMemoryFiles().files.find(f => f.id === fileId)!.enabled).toBe(true);
    });

    it('records the verdict into skill frontmatter', async () => {
        await initMemoryFiles('eval-record');
        const fileId = await seedSkill('eval-record');
        await recordEvalVerdict(fileId, { verdict: 'helps', flips: 2, alignedFlips: 2 }, 'eval-record');
        const content = getMemoryFiles().files.find(f => f.id === fileId)!.content;
        expect(content).toMatch(/evalVerdict: helps \(2\/2\)/);
        expect(content).toContain('lastEvalAt:');
    });
});

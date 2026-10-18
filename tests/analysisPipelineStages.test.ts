import { describe, it, expect } from 'vitest';
import { minePatternFromPrompt, assemblePipelineMemoryContext } from '../hooks/analysisPipeline/memoryContext';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { serializeSkill, titleFromMeta } from '../services/learning/SkillMemoryService';
import { createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { SkillMeta } from '../services/learning/SkillMemoryService';
import type { LoggedTrade } from '../types';

// Pipeline stage modules extracted out of useAnalysisPipeline — pure units
// that are now testable without mounting the 3k-line send hook.
// buildModelsUsedRecord's unit tests went with it: the record it built keyed one
// model per SEAT, and a send now answers from exactly one model.

describe('minePatternFromPrompt', () => {
    it('maps keyword families at send time', () => {
        expect(minePatternFromPrompt('BTC short — exhaustion wick into resistance')).toBe('Family A');
        expect(minePatternFromPrompt('strong momentum push')).toBe('Family Omega');
        expect(minePatternFromPrompt('momentum continuation setup')).toBe('Family C');
        expect(minePatternFromPrompt('reversal setup')).toBe('Family B');
        expect(minePatternFromPrompt('nothing recognizable here')).toBeUndefined();
    });
});

describe('assemblePipelineMemoryContext', () => {
    const trade = (over: Partial<LoggedTrade>): LoggedTrade => ({
        id: over.id ?? 't1',
        outcome: 'LOSS' as never,
        timestamp: new Date().toISOString(),
        analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as never,
        ...over,
    });

    it('derives the setup query and filters loss-priming rows by coin+direction', async () => {
        await initMemoryFiles('stage-user');
        const ctx = await assemblePipelineMemoryContext(
            'Watching BTC short on the 15m — exhaustion risk',
            [
                trade({ id: 'match-1' }),
                trade({ id: 'wrong-side', analysis: { coinName: 'BTCUSDT', direction: 'Long' } as never }),
                trade({ id: 'wrong-coin', analysis: { coinName: 'ETHUSDT', direction: 'Short' } as never }),
            ],
            null,
        );
        expect(ctx.detectedLearningCoin).toBe('BTC');
        expect(ctx.pendingDirection).toBe('Short');
        expect(ctx.pendingPattern).toBe('Family A');
        expect(ctx.memoryQuery.coin).toBe('BTC');
        expect(ctx.lossPrimingRows.map(r => r.outcome ? r : null)).toBeTruthy();
        expect(ctx.lossPrimingRows.some(r => r.coin === 'ETHUSDT')).toBe(false);
    });

    it('injects matched skills for the derived setup', async () => {
        await initMemoryFiles('stage-skill-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const meta = {
            status: 'confirmed', kind: 'avoid', coin: 'BTCUSDT', direction: 'Short', family: 'Family A',
            wins: 2, losses: 6, consecutiveLosses: 0, tradeIds: [],
            ifCondition: 'BTC short in Family A', thenAction: 'skip',
            // An injected rule must be an approved one (activation gate); this row
            // stands for a pre-existing library entry, so it carries the migration's
            // own marker rather than a made-up human.
            approvedBy: 'grandfathered',
            body: '**Trigger:** t\n**Procedure:** skip.',
        } as SkillMeta;
        await createMemoryFile(skills.id, 'btc-short-avoid.md', serializeSkill(meta, titleFromMeta(meta)), 'stage-skill-user', true);

        const ctx = await assemblePipelineMemoryContext('BTC short fakeout watch', [], null);
        expect(ctx.memoryRetrieved.some(src => src.path === 'skills/btc-short-avoid.md')).toBe(true);
        expect(ctx.memoryFilesContext).toContain('btc-short-avoid');
    });
});

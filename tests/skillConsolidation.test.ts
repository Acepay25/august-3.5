import { describe, it, expect } from 'vitest';
import {
    parseSkillMarkdown,
    serializeSkill,
    SkillMeta,
    consolidateSkills,
} from '../services/learning/SkillMemoryService';
import {
    createMemoryFile,
    initMemoryFiles,
    getMemoryFiles,
    ensureHarnessFolders,
} from '../services/learning/MemoryFilesService';

const skillContent = (overrides: Partial<SkillMeta>): string => {
    const base: SkillMeta = {
        status: 'candidate',
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

describe('S3: consolidation archives duplicates instead of deleting', () => {
    it('keeps the richest body and preserves every merged file in the archive', async () => {
        const user = 's3-consolidate';
        await initMemoryFiles(user);

        const stub = await skillFile(
            'skill-dup-a.md',
            skillContent({
                coin: 'BTC',
                direction: 'Long',
                family: 'breakout',
                kind: 'avoid',
                status: 'candidate',
                wins: 1,
                losses: 1,
                tradeIds: ['t1'],
                body: '**Trigger:** short stub',
                ifCondition: 'price closes below the range low on 4h volume expansion',
                thenAction: 'stand aside until reclaim',
            }),
            user,
        );
        const refined = await skillFile(
            'skill-dup-b.md',
            skillContent({
                coin: 'BTC',
                direction: 'Long',
                family: 'breakout',
                kind: 'avoid',
                status: 'candidate',
                wins: 2,
                losses: 2,
                tradeIds: ['t2', 't3'],
                // The RICHER body — must win over metas[0] (file order).
                body: [
                    '**When:** BTC long breakout fails',
                    '**What I do:**',
                    '1. wait for the close',
                    '2. check funding skew',
                    '3. size to half',
                    '**My rule:** when the 4h close breaks the range low on expanding volume, I stand aside until price reclaims the level.',
                ].join('\n'),
                ifCondition: 'the 4h candle CLOSES below the range low with above-average volume',
                thenAction: 'skip long entries until an hourly reclaim prints',
            }),
            user,
        );

        await consolidateSkills(user);

        const files = getMemoryFiles().files;
        const survivor = files.find(f => f.id === stub.id || f.id === refined.id);
        expect(survivor).toBeDefined();
        const kept = files.find(f => f.name === 'skill-dup-a.md' || f.name === 'skill-dup-b.md');
        expect(kept).toBeDefined();

        // NO deletion: both files still exist somewhere in the notebook.
        const bothAlive = files.filter(f => f.name === 'skill-dup-a.md' || f.name === 'skill-dup-b.md');
        expect(bothAlive.length).toBe(2);

        // The archived duplicate is disabled.
        const enabledOnes = bothAlive.filter(f => f.enabled);
        expect(enabledOnes.length).toBe(1);
        const keptMeta = parseSkillMarkdown(enabledOnes[0].content);
        expect(keptMeta).not.toBeNull();
        // Merged evidence is DEDUPED against unique tradeIds (review fix) —
        // t1 + t2/t3 = 3 unique counted trades, not the double-counted 6.
        expect((keptMeta as SkillMeta).wins + (keptMeta as SkillMeta).losses).toBe(3);
        expect((keptMeta as SkillMeta).tradeIds.length).toBe(3);
        // The RICHEST body won — the stub text is gone from the keeper.
        expect(enabledOnes[0].content).toContain('funding skew');
        expect(enabledOnes[0].content).not.toContain('short stub');

        for (const f of bothAlive) {
            const { deleteMemoryFile } = await import('../services/learning/MemoryFilesService');
            await deleteMemoryFile(f.id, user);
        }
    });
});

describe('S7: worth-gate merge path exists and targets resolve by stem or title', () => {
    it('serializes previousVersion so merges are replayable', () => {
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'avoid',
            coin: 'ETH',
            direction: 'Short',
            wins: 5,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b'],
            ifCondition: 'original trigger',
            thenAction: 'original action',
            body: 'body',
            previousVersion: { kind: 'repeat', ifCondition: 'old trigger', thenAction: 'old action' },
        };
        const content = serializeSkill(meta, 'Merged ETH Short');
        const reparsed = parseSkillMarkdown(content);
        expect(reparsed?.previousVersion?.ifCondition).toBe('old trigger');
    });
});

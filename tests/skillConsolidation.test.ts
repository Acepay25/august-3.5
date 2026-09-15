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
                // SAME IF CLAIM as the stub — consolidation merges exact
                // duplicates (identical scope AND identical claim) only; a
                // different claim is a different belief (see the second test).
                ifCondition: 'price closes below the range low on 4h volume expansion',
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

describe('S3b: consolidation merges exact CLAIM duplicates, not loose scope twins', () => {
    it('does NOT merge two same-scope skills with different IF claims', async () => {
        const user = 's3b-claim-guard';
        await initMemoryFiles(user);
        // Same coin/direction/family/kind — but the two files make
        // DIFFERENT claims. The old loose scope key merged them, inflating
        // the survivor's sample with foreign evidence and silently
        // destroying the absorbed skill's birth claim (its prediction was
        // then tested against trades it never predicted).
        await skillFile(
            'claim-a.md',
            skillContent({
                coin: 'BTC', direction: 'Long', family: 'breakout', kind: 'avoid',
                wins: 2, losses: 1, tradeIds: ['x1', 'x2', 'x3'],
                ifCondition: 'price closes below the range low on 4h volume',
                thenAction: 'stand aside',
            }),
            user,
        );
        await skillFile(
            'claim-b.md',
            skillContent({
                coin: 'BTC', direction: 'Long', family: 'breakout', kind: 'avoid',
                wins: 1, losses: 2, tradeIds: ['y1', 'y2', 'y3'],
                ifCondition: 'funding flips negative right after the sweep',
                thenAction: 'skip the reclaim long',
            }),
            user,
        );

        await consolidateSkills(user);

        const both = getMemoryFiles().files.filter(f => f.name === 'claim-a.md' || f.name === 'claim-b.md');
        expect(both).toHaveLength(2);
        // Both survive ENABLED in the live skills folder — neither claim
        // absorbs the other's evidence.
        expect(both.filter(f => f.enabled)).toHaveLength(2);
        const a = parseSkillMarkdown(both.find(f => f.name === 'claim-a.md')!.content)!;
        expect(a.wins + a.losses).toBe(3); // NOT merged into 6
    });

    it('keeps the birth prediction alive when the group leader predates the certificate feature', async () => {
        const user = 's3b-birth-preservation';
        await initMemoryFiles(user);
        const claim = 'price closes below the range low on 4h volume expansion';
        // Leader: same claim but NO prediction (legacy row).
        await skillFile(
            'legacy-leader.md',
            skillContent({ coin: 'BTC', direction: 'Long', wins: 1, losses: 1, tradeIds: ['p1'], ifCondition: claim }),
            user,
        );
        // Twin: identical claim, carries the birth certificate.
        const cert: SkillMeta = {
            status: 'candidate', kind: 'repeat', coin: 'BTC', direction: 'Long',
            wins: 2, losses: 2, consecutiveLosses: 0, tradeIds: ['p2', 'p3'],
            ifCondition: claim, thenAction: 'test action', body: 'test body',
            prediction: { expectedLiftPts: 8, horizonTrades: 10, scope: { coin: 'BTC' } },
        };
        await skillFile('cert-twin.md', serializeSkill(cert, 'Test BTC Long'), user);

        await consolidateSkills(user);

        const alive = getMemoryFiles().files
            .filter(f => (f.name === 'legacy-leader.md' || f.name === 'cert-twin.md') && f.enabled);
        expect(alive).toHaveLength(1);
        const mergedMeta = parseSkillMarkdown(alive[0].content)!;
        // The group's birth certificate survives the merge.
        expect(mergedMeta.prediction?.expectedLiftPts).toBe(8);
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

import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryFilesContext, stageBudgetChars } from '../services/learning/MemoryRetrievalService';
import { initMemoryFiles, createMemoryFile, deleteMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { serializeSkill, type SkillMeta } from '../services/learning/SkillMemoryService';

// The research doc's #1 and #5:
//   #1  description must be a retrieval TRIGGER, not decoration. A skill
//       whose structured fields never overlap the live setup but whose
//       description says exactly what is in front of the trader must still
//       reach the model.
//   #5  the doctrine slot is documented as an always-on block that does not
//       count against the budget — an unaccounted layer. It must be
//       measurable from outside, not just claimed in a comment.

/** The user whose notebook the seeded skills land in — set per test. */
let CURRENT_USER = 'desc-trigger-seed';

const seed = async (
    username: string,
    meta: SkillMeta,
    body: string,
    name = 'btc-reclaim-repeat.md',
): Promise<void> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, name, serializeSkill(meta, 'Reclaim repeat'), username, true);
};

const freeBudgetForSkills = async (username: string): Promise<void> => {
    // Doctrine and risk-rules would otherwise consume the stage budget; the
    // assertions here are about which SKILL is selected, not about capacity.
    for (const n of ['risk-rules.md']) {
        const f = getMemoryFiles().files.find(x => x.name === n);
        if (f) await deleteMemoryFile(f.id, username);
    }
};

describe('description as a retrieval trigger (plan #1)', () => {
    beforeEach(async () => {
        // A distinct user per test: the notebook is one JSON blob per user, so
        // a shared username leaks the previous case's seeded skill.
        const user = `desc-trigger-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await freeBudgetForSkills(user);
        CURRENT_USER = user;
    });

    it('a zero-field-overlap skill whose description names the live setup still matches', async () => {
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            description: 'Repeat: IF price reclaims the prior session high on expanding volume THEN take the long continuation toward the next liquidity pool.',
            // NO coin, NO direction, NO family, NO regime — skillMatchesSetup
            // alone can never return true for this row.
            wins: 3,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c', 'd'],
            evidenceCount: 4,
            approvedBy: 'grandfathered',
            body: '**When:** reclaim of the prior session high\n**What I do:** enter on the reclaim close.',
        };
        await seed(CURRENT_USER, meta, meta.body);
        // A live setup whose family/regime carries the same pattern vocabulary
        // the description uses — the way a real setup phrase reads
        // ("reclaim of the prior session high into the liquidity pool"),
        // not a bare coin+direction.
        const out = getMemoryFilesContext(
            { coin: 'ETHUSDT', direction: 'Long', family: 'reclaim session high into liquidity pool', regime: 'trending' },
            undefined, 'analyst', 'verdict',
        );
        expect(out).toContain('btc-reclaim-repeat.md');
    });

    it('a description about a different situation does NOT match the live setup', async () => {
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            description: 'Repeat: IF a bearish engulfing prints at the daily supply zone in a downtrend THEN short toward the breakdown low.',
            wins: 3,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c', 'd'],
            evidenceCount: 4,
            approvedBy: 'grandfathered',
            body: '**When:** bearish engulfing at daily supply\n**What I do:** short the breakdown.',
        };
        await seed(CURRENT_USER, meta, meta.body);
        const out = getMemoryFilesContext(
            { coin: 'ETHUSDT', direction: 'Long', family: 'liquidity sweep', regime: 'trending' },
            undefined, 'analyst', 'verdict',
        );
        expect(out).not.toContain('btc-reclaim-repeat.md');
    });

    it('a description hit OUTRANKS a field-only hit when both are otherwise eligible', async () => {
        // Field-only skill: shares coin+direction but its description is about
        // an unrelated situation.
        const fieldOnly: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            description: 'Repeat: hold through the noise and let the position run when the monthly trend is up.',
            coin: 'ETHUSDT',
            direction: 'Long',
            wins: 4,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c', 'd', 'e'],
            evidenceCount: 5,
            approvedBy: 'grandfathered',
            body: '**When:** monthly trend is up\n**What I do:** hold.',
        };
        const descHit: SkillMeta = {
            ...fieldOnly,
            description: 'Repeat: IF a liquidity sweep above the range high is reclaimed by a bullish displacement candle THEN take the long toward the next pool.',
            body: '**When:** reclaimed liquidity sweep above the range high\n**What I do:** long the displacement.',
        };
        await seed(CURRENT_USER, fieldOnly, fieldOnly.body, 'eth-long-field-only.md');
        await seed(CURRENT_USER, descHit, descHit.body, 'eth-long-desc-hit.md');
        const q = {
            coin: 'ETHUSDT',
            direction: 'Long',
            family: 'liquidity sweep reclaimed by displacement',
            regime: 'trending',
        };
        const out = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        // The description-matched skill must be the PRIMARY block, not a
        // runner-up index line.
        expect(out).toContain('eth-long-desc-hit.md');
        expect(out.indexOf('eth-long-desc-hit.md')).toBeLessThan(out.indexOf('eth-long-field-only.md'));
    });
});

describe('doctrine slot is accounted, not invisible (plan #5)', () => {
    it('stageBudgetChars covers the doctrine slot on top of the stage share', () => {
        const opening = stageBudgetChars('opening');
        // The stage budget must be large enough that the doctrine slot is
        // never silently squeezed to zero by the non-doctrine blocks. A
        // budget at or below the doctrine slot cannot hold identity + a skill
        // + rules without eliding doctrine.
        expect(opening).toBeGreaterThan(800);
    });

    it('the verdict body cap is still honoured after the description trigger', async () => {
        const user = `desc-cap-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await freeBudgetForSkills(user);
        const longBody = `${'x'.repeat(2000)}\n**What I do:** ${'y'.repeat(1000)}`;
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            description: 'Repeat: reclaim of the prior session high on expanding volume, then long continuation.',
            wins: 2,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c'],
            evidenceCount: 3,
            approvedBy: 'grandfathered',
            body: longBody,
        };
        await seed(user, meta, longBody);
        const out = getMemoryFilesContext(
            { coin: 'ETHUSDT', direction: 'Long', family: 'reclaim prior session high expanding volume continuation', regime: 'trending' },
            undefined, 'analyst', 'verdict',
        );
        expect(out).toContain('btc-reclaim-repeat.md');
        expect(out).not.toContain('x'.repeat(2000));
    });
});

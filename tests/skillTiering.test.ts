import { describe, it, expect } from 'vitest';
import {
    getMemoryFilesContext,
    handleRecallTool,
} from '../services/learning/MemoryRetrievalService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';

// ROUND-25 progressive-disclosure + invocation-control + dynamic-context tests.

const seedSkill = async (username: string, extra = ''): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const file = await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
ifCondition: BTC short in Family A
thenAction: skip
tradeIds: a,b,c
${extra}---

# Avoid BTC short

**When:** \${SYMBOL} short during \${REGIME}
**What I do:** skip the short.
`, username, true);
    return file.id;
};

describe('tiered skill injection (ROUND-25)', () => {
    it('opening/rebuttal get the index line; verdict gets the full body', async () => {
        await initMemoryFiles('tier-user');
        await seedSkill('tier-user');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A', regime: 'ranging' };

        const opening = getMemoryFilesContext(q, undefined, 'analyst', 'opening');
        expect(opening).toMatch(/AVOID \[confirmed/);
        expect(opening).not.toContain('What I do'); // no body at tier 1

        const verdict = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        expect(verdict).toContain('What I do'); // full body at tier 2
    });

    it('substitutes ${SYMBOL} and ${REGIME} at assembly time', async () => {
        await initMemoryFiles('subst-user');
        await seedSkill('subst-user');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A', regime: 'ranging' };
        const verdict = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        expect(verdict).toContain('BTCUSDT short during ranging');
        expect(verdict).not.toContain('${SYMBOL}');
    });

    it('recall serves the full substituted body with freshness', async () => {
        await initMemoryFiles('recall-full');
        await seedSkill('recall-full');
        const out = handleRecallTool({ topic: 'BTC short' }, undefined);
        expect(out).toContain('What I do');
        expect(out).toContain('BTCUSDT');
        expect(out).toMatch(/evidence .* old|no counted evidence yet/);
    });
});

describe('audience invocation control (ROUND-25)', () => {
    it('audience: analyst hides the skill from moderator assembly', async () => {
        await initMemoryFiles('aud-user');
        await seedSkill('aud-user', 'audience: analyst\n');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };
        const analyst = getMemoryFilesContext(q, undefined, 'analyst', 'opening');
        const moderator = getMemoryFilesContext(q, undefined, 'moderator', 'opening');
        expect(analyst).toMatch(/AVOID \[/);
        expect(moderator).not.toMatch(/AVOID \[/);
    });

    it('default is all audiences', async () => {
        await initMemoryFiles('aud-all');
        await seedSkill('aud-all');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };
        expect(getMemoryFilesContext(q, undefined, 'moderator', 'opening')).toMatch(/AVOID \[/);
    });
});

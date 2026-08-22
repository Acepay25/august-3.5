import { describe, it, expect } from 'vitest';
import {
    getMemoryFilesContext,
    handleRecallTool,
} from '../services/learning/MemoryRetrievalService';
import {
    initMemoryFiles,
    createMemoryFile,
    deleteMemoryFile,
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

    it('a blocked best-match surfaces the second-best skill instead of an empty slot', async () => {
        await initMemoryFiles('aud-fallback');
        // Best match (confirmed, biggest sample) is analyst-only…
        await seedSkill('aud-fallback', 'audience: analyst\n');
        // …second match (candidate, smaller sample) is unrestricted.
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-repeat.md', `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 1
ifCondition: BTC short in Family A
thenAction: size down
tradeIds: d,e
---

# Repeat BTC short
`, 'aud-fallback', true);
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };

        const analyst = getMemoryFilesContext(q, undefined, 'analyst', 'opening');
        expect(analyst).toMatch(/btc-short-avoid\.md/);

        // Before the fix, the moderator slot went silently empty.
        const moderator = getMemoryFilesContext(q, undefined, 'moderator', 'opening');
        expect(moderator).toMatch(/btc-short-repeat\.md/);
        expect(moderator).not.toMatch(/btc-short-avoid\.md/);
    });
});

describe('top-K + conflict retrieval (ROUND-26)', () => {
    const seedPair = async (username: string): Promise<void> => {
        await seedSkill(username); // confirmed avoid, btc-short-avoid.md
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-repeat.md', `---
status: candidate
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 1
ifCondition: BTC short in Family A
thenAction: size down
tradeIds: d,e
---

# Repeat BTC short

**When:** \${SYMBOL} short in Family A
**What I do:** size down.
`, username, true);
    };

    it('recall lists runners-up as index lines, not just the top skill', async () => {
        await initMemoryFiles('topk-recall');
        await seedPair('topk-recall');
        const out = handleRecallTool({ topic: 'BTC short' }, undefined);
        // Top match: full body. Runner-up: one-line index entry.
        expect(out).toContain('# Avoid BTC short');
        expect(out).toContain('SKILL (also matches)');
        expect(out).toContain('REPEAT [candidate');
        expect(out).toContain('size down');
    });

    it('verdict stage surfaces runners-up as index lines; opening stays single-skill', async () => {
        await initMemoryFiles('topk-verdict');
        await seedPair('topk-verdict');
        // Free the whole verdict budget for skill blocks.
        const rules = getMemoryFiles().files.find(f => f.name === 'risk-rules.md');
        if (rules) await deleteMemoryFile(rules.id, 'topk-verdict');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };

        const verdict = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        expect(verdict).toContain('btc-short-avoid.md');
        expect(verdict).toContain('btc-short-repeat.md');

        const opening = getMemoryFilesContext(q, undefined, 'analyst', 'opening');
        expect(opening).toContain('btc-short-avoid.md');
        expect(opening).not.toContain('btc-short-repeat.md');
    });

    it('flags avoid-vs-repeat conflicts instead of silently tie-breaking', async () => {
        await initMemoryFiles('conflict-user');
        await seedPair('conflict-user');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };

        const verdict = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        expect(verdict).toContain('[notebook conflict]');
        expect(verdict).toContain('AVOID and a REPEAT');

        // Single-kind setups stay quiet, and opening (tier 1) never carries it.
        const opening = getMemoryFilesContext(q, undefined, 'analyst', 'opening');
        expect(opening).not.toContain('[notebook conflict]');
    });

    it('no conflict line when only one kind matches', async () => {
        await initMemoryFiles('noconflict-user');
        await seedSkill('noconflict-user');
        const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };
        expect(getMemoryFilesContext(q, undefined, 'analyst', 'verdict')).not.toContain('[notebook conflict]');
    });
});

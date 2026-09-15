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
import { serializeSkill, type SkillMeta } from '../services/learning/SkillMemoryService';

// Progressive-disclosure + invocation-control + dynamic-context tests.

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

describe('tiered skill injection', () => {
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
        // ${SYMBOL}/${REGIME} substituted in the BODY — previously this
        // line passed because the raw frontmatter (`coin: BTCUSDT`) leaked
        // into the recall text, not because substitution worked.
        expect(out).toContain('BTC short during');
        expect(out).not.toContain('coin: BTCUSDT');
        expect(out).toMatch(/evidence .* old|no counted evidence yet/);
    });
});

describe('audience invocation control', () => {
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

describe('top-K + conflict retrieval', () => {
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

describe('frontmatter never eats the skill budget', () => {
    // The verdict slice caps the injected skill at 400 chars and recall at
    // 700. Real skill files carry 25-35 lines of YAML frontmatter — when the
    // injection pushed the RAW file, the metadata consumed the entire budget
    // and the actual PROCEDURE was truncated away. These seeds are produced
    // by serializeSkill itself (exactly what the writer persists), so the
    // raw markdown is over a kilobyte of frontmatter before the body begins.
    const MARKER = 'LATE-BODY-MARKER stand aside until the reclaim close prints';

    const seedRealSizeSkill = async (username: string): Promise<string> => {
        const iso = new Date().toISOString();
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'avoid',
            description: 'Avoid: IF BTC short in Family A without a reclaim close THEN skip the short — learned from a cluster of losing shorts in the ranging tape.',
            coin: 'BTCUSDT',
            direction: 'Short',
            family: 'Family A',
            regime: 'ranging',
            wins: 1,
            losses: 7,
            consecutiveLosses: 2,
            tradeIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
            evidenceCount: 10,
            ifCondition: 'BTC short setup in Family A without a reclaim close',
            thenAction: 'skip the short until the reclaim candle closes',
            strategyFamily: 'mean_reversion',
            horizon: 'intraday',
            recentOutcomes: 'LLWLWLLL',
            prediction: { expectedLiftPts: 5, horizonTrades: 10, scope: { coin: 'BTC', family: 'Family A', regime: 'ranging' } },
            lastEvidenceAt: iso,
            modifiedAt: iso,
            evalVerdict: 'helps',
            evalDetail: '3/3',
            lastEvalAt: iso,
            controlIds: ['c1', 'c2'],
            history: [
                { status: 'candidate', validFrom: '2026-08-01T00:00:00.000Z', invalidAt: '2026-08-05T00:00:00.000Z', reason: 'evidence' },
                { status: 'confirmed', validFrom: '2026-08-05T00:00:00.000Z', reason: 'evidence' },
            ],
            body: `**When:** BTC short in Family A\n**Procedure:** ${MARKER}.`,
        };
        const content = serializeSkill(meta, 'Avoid BTC short');
        // The guard the old 10-line stubs failed to provide: in the RAW file
        // the marker sits far beyond the 400-char verdict cap, so a raw-push
        // implementation CANNOT pass this test.
        expect(content.indexOf(MARKER)).toBeGreaterThan(400);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-real-size-avoid.md', content, username, true);
        return content;
    };

    const q = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A', regime: 'ranging' };

    it('verdict body injection delivers the procedure past the frontmatter, under the cap', async () => {
        await initMemoryFiles('fm-verdict');
        await seedRealSizeSkill('fm-verdict');
        const verdict = getMemoryFilesContext(q, undefined, 'analyst', 'verdict');
        expect(verdict).toContain(MARKER);
        // Budget buys procedure text, not YAML bookkeeping.
        expect(verdict).not.toContain('status: confirmed');
        expect(verdict).not.toContain('recentOutcomes:');
        expect(verdict).not.toContain('controlIds:');
    });

    it('recall also serves the body, not the raw frontmatter', async () => {
        await initMemoryFiles('fm-recall');
        await seedRealSizeSkill('fm-recall');
        const out = handleRecallTool({ topic: 'BTC short' });
        expect(out).toContain(MARKER);
        expect(out).not.toContain('recentOutcomes:');
        expect(out).not.toContain('claimTestedEvidence');
    });
});

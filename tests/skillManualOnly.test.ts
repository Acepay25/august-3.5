import { describe, it, expect } from 'vitest';
import {
    serializeSkill,
    parseSkillMarkdown,
    resolveInvokedSkills,
    formatInvokedSkillSection,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';

// Plan #6, reframed after verifying the codebase: no skill can ACT (there is
// no trade-placing tool — `present_trade` ends in a human "Log this trade"
// click, and tradeChatContext states the harness never places trades). What
// Claude's `disable-model-invocation` buys HERE is the honest missing gap: a
// skill that is background knowledge the trader reads with `/slug` but that
// is never handed to a seat unprompted.

const seedSkill = async (username: string, name: string): Promise<void> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const meta: SkillMeta = {
        status: 'confirmed',
        kind: 'repeat',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        description: 'Repeat: BTC short in Family A — size down rather than skip.',
        wins: 3,
        losses: 1,
        consecutiveLosses: 0,
        tradeIds: ['a', 'b', 'c', 'd'],
        evidenceCount: 4,
        approvedBy: 'grandfathered',
        ifCondition: 'BTC short in Family A',
        thenAction: 'size down',
        body: '**When:** BTC short in Family A\n**What I do:** size down.',
    };
    await createMemoryFile(skills.id, name, serializeSkill(meta, 'BTC short'), username, true);
};

const MATCHING_QUERY = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A', regime: 'ranging' };

describe('manualOnly frontmatter round-trip', () => {
    it('serializes and parses back to true', () => {
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            wins: 1,
            losses: 0,
            consecutiveLosses: 0,
            tradeIds: ['a'],
            evidenceCount: 1,
            manualOnly: true,
            body: '**When:** something\n**What I do:** act.',
        };
        const content = serializeSkill(meta, 'T');
        expect(content).toContain('manualOnly: true');
        expect(parseSkillMarkdown(content)?.manualOnly).toBe(true);
    });

    it('is ABSENT (not false) when unset — legacy rows must stay byte-identical', () => {
        const meta: SkillMeta = {
            status: 'confirmed',
            kind: 'repeat',
            wins: 1,
            losses: 0,
            consecutiveLosses: 0,
            tradeIds: ['a'],
            evidenceCount: 1,
            body: '**When:** something\n**What I do:** act.',
        };
        const content = serializeSkill(meta, 'T');
        expect(content).not.toContain('manualOnly');
        expect(parseSkillMarkdown(content)?.manualOnly).toBeUndefined();
    });
});

describe('manualOnly gates auto-injection', () => {
    it('a manualOnly skill is NOT injected even though it matches perfectly', async () => {
        const user = `mo-inject-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        // The normal skill is the control: identical scoping, no manualOnly.
        await seedSkill(user, 'btc-short-auto.md');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-manual.md', serializeSkill({
            status: 'confirmed',
            kind: 'repeat',
            coin: 'BTCUSDT',
            direction: 'Short',
            family: 'Family A',
            wins: 9,
            losses: 0,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
            evidenceCount: 9,
            approvedBy: 'grandfathered',
            manualOnly: true,
            body: '**When:** BTC short in Family A\n**What I do:** read only.',
        }, 'Manual only'), user, true);

        // Sanity: without the flag the manual skill would outrank the control
        // (9W/0L vs 3W/1L). If the gate works it must not appear at all.
        const out = getMemoryFilesContext(MATCHING_QUERY, undefined, 'analyst', 'verdict');
        expect(out).not.toContain('btc-short-manual.md');
        // The control still injects — the gate removes one skill, not the slot.
        expect(out).toContain('btc-short-auto.md');
    });

    it('/slug invocation STILL serves a manualOnly skill — the human asked', async () => {
        const user = `mo-invoke-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-manual.md', serializeSkill({
            status: 'confirmed',
            kind: 'repeat',
            coin: 'BTCUSDT',
            direction: 'Short',
            family: 'Family A',
            wins: 3,
            losses: 1,
            consecutiveLosses: 0,
            tradeIds: ['a', 'b', 'c', 'd'],
            evidenceCount: 4,
            approvedBy: 'grandfathered',
            manualOnly: true,
            body: '**When:** BTC short in Family A\n**What I do:** read only.',
        }, 'Manual only'), user, true);

        const rows = resolveInvokedSkills(['btc-short-manual']);
        expect(rows[0].found).toBe(true);
        expect(rows[0].body).toContain('read only');
        const section = formatInvokedSkillSection(rows);
        expect(section).toContain('btc-short-manual');
        expect(section).toContain('read only');
    });

    it('a skill WITHOUT the field still injects (legacy fails open)', async () => {
        const user = `mo-legacy-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        await seedSkill(user, 'btc-short-legacy.md');
        const out = getMemoryFilesContext(MATCHING_QUERY, undefined, 'analyst', 'verdict');
        expect(out).toContain('btc-short-legacy.md');
    });
});

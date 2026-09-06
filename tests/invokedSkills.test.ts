import { describe, it, expect, beforeEach } from 'vitest';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    formatInvokedSkillSection,
    resolveInvokedSkills,
    skillBody,
} from '../services/learning/SkillMemoryService';

// The /slug invocation path: invoked slugs resolve to their ACTUAL content
// and format into a system section every seat receives. "Apply skill X"
// without skill X's text is a wish, not an instruction.

describe('skillBody', () => {
    it('strips frontmatter and trims', () => {
        const md = '---\nstatus: confirmed\nkind: avoid\n---\nSkip the entry.\nWait for the retest.';
        expect(skillBody(md)).toBe('Skip the entry.\nWait for the retest.');
    });

    it('returns plain content untouched (no frontmatter)', () => {
        expect(skillBody('just prose')).toBe('just prose');
    });
});

describe('formatInvokedSkillSection', () => {
    it('is empty when nothing was invoked', () => {
        expect(formatInvokedSkillSection([])).toBe('');
    });

    it('labels found skills with kind and status and includes the body', () => {
        const section = formatInvokedSkillSection([
            { slug: 'btc-short-avoid', found: true, kind: 'avoid', status: 'confirmed', body: 'Skip the entry.' },
        ]);
        expect(section).toContain('## Invoked notebook skills');
        expect(section).toContain('### btc-short-avoid — avoid skill · confirmed');
        expect(section).toContain('Skip the entry.');
    });

    it('states missing slugs instead of silently dropping them', () => {
        const section = formatInvokedSkillSection([
            { slug: 'no-such-skill', found: false },
        ]);
        expect(section).toContain('### no-such-skill — not found');
        expect(section).toContain('No notebook skill named "no-such-skill" exists');
    });
});

describe('resolveInvokedSkills', () => {
    beforeEach(async () => {
        await initMemoryFiles('invoked-skills-user');
    });

    it('resolves a slug to its body case-insensitively and reports misses', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'btc-short-avoid.md', '---\nstatus: confirmed\nkind: avoid\n---\nSkip the entry.', 'invoked-skills-user', true);

        const rows = resolveInvokedSkills(['BTC-Short-Avoid', 'ghost-skill']);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ slug: 'BTC-Short-Avoid', found: true, kind: 'avoid', status: 'confirmed' });
        expect(rows[0].body).toBe('Skip the entry.');
        expect(rows[1]).toMatchObject({ slug: 'ghost-skill', found: false });
    });

    it('formats a full round trip: resolve then format', async () => {
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(skills.id, 'risk-first.md', '---\nstatus: candidate\nkind: repeat\n---\nSize before entry.', 'invoked-skills-user', true);
        const section = formatInvokedSkillSection(resolveInvokedSkills(['risk-first']));
        expect(section).toContain('### risk-first — repeat skill · candidate');
        expect(section).toContain('Size before entry.');
    });
});

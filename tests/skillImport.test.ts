import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { importSkillFiles } from '../services/learning/SkillImportService';
import { listSkills } from '../services/learning/SkillMemoryService';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { getActiveUsername } from '../utils/activeUser';

const USER = 'tester';

// getActiveUsername reads localStorage; jsdom localStorage is per-test-file.
// The notebook store must be bootstrapped (initMemoryFiles) before imports
// can land — same pattern as contradictionSweep.test.ts.
beforeEach(async () => {
    window.localStorage.setItem('august_active_user', USER);
    await initMemoryFiles(USER);
});
afterEach(() => {
    window.localStorage.clear();
});

const validSkill = (name: string, trigger: string): { name: string; content: string } => ({
    name,
    content: [
        '---',
        'status: candidate',
        'kind: avoid',
        'wins: 0',
        'losses: 0',
        `ifCondition: ${trigger}`,
        'thenAction: stand aside and wait for confirmation',
        'tradeIds: ',
        '---',
        '',
        `# ${name}`,
        '',
        'Body of the skill.',
    ].join('\n'),
});

describe('SkillImportService (import skills the models can use)', () => {
    it('imports a valid skill file into the skills folder', async () => {
        const result = await importSkillFiles([validSkill('imported-skill', 'price sweeps the weekly low')]);
        expect(result.imported).toEqual(['imported-skill']);
        expect(result.failed).toHaveLength(0);
        expect(listSkills().some(s => s.file.name === 'imported-skill.md')).toBe(true);
    });

    it('rejects non-skill files with a visible reason (never silent)', async () => {
        const result = await importSkillFiles([{ name: 'notes.md', content: '# Just some notes\n\nNo frontmatter here.' }]);
        expect(result.imported).toHaveLength(0);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].reason).toContain('frontmatter');
    });

    it('skips duplicates by trigger (same ifCondition already learned)', async () => {
        await importSkillFiles([validSkill('first-import', 'identical trigger text')]);
        const second = await importSkillFiles([validSkill('second-import', 'identical trigger text')]);
        expect(second.skipped).toEqual(['second-import']);
        expect(second.imported).toHaveLength(0);
    });

    it('never overwrites: a name collision gets a -2 suffix', async () => {
        await importSkillFiles([validSkill('collide', 'trigger A')]);
        const second = await importSkillFiles([validSkill('collide', 'trigger B — different')]);
        expect(second.imported).toHaveLength(1);
        expect(listSkills().filter(s => s.file.name.startsWith('collide')).length).toBe(2);
    });
});

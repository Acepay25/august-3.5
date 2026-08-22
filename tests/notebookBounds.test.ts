import { describe, it, expect } from 'vitest';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
    writeModelNote,
} from '../services/learning/MemoryFilesService';
import { consolidateSkills, parseSkillMarkdown, serializeSkill, titleFromMeta } from '../services/learning/SkillMemoryService';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

// Bounds pass: retired skills leave the active folder, AI-written notes stay
// capped, and the active skill set cannot grow without limit.

const seedSkill = async (username: string, name: string, meta: Partial<SkillMeta>): Promise<string> => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    const full: SkillMeta = {
        status: 'retired',
        kind: 'avoid',
        coin: 'BTCUSDT',
        direction: 'Short',
        family: 'Family A',
        wins: 0,
        losses: 8,
        consecutiveLosses: 0,
        tradeIds: [],
        ifCondition: 'BTC short in Family A',
        thenAction: 'skip',
        body: '**Trigger:** BTC short in Family A\n**Procedure:** skip the short.',
        ...meta,
    };
    const file = await createMemoryFile(skills.id, name, serializeSkill(full, titleFromMeta(full)), username, true);
    return file.id;
};

describe('retired-skill archiving', () => {
    it('consolidation moves retired skills to the archive folder, keeping their content', async () => {
        await initMemoryFiles('archive-user');
        const id = await seedSkill('archive-user', 'btc-short-avoid.md', { status: 'retired' });

        await consolidateSkills('archive-user');

        const folders = getMemoryFiles().folders;
        const archive = folders.find(f => f.name === 'archive');
        expect(archive).toBeTruthy();
        const archived = getMemoryFiles().files.find(f => f.id === id)!;
        expect(archived.folderId).toBe(archive!.id);
        expect(archived.content).toContain('skip'); // record kept, just out of circulation
        // No longer counts as an active skill.
        const skillsFolder = folders.find(f => f.name === 'skills')!;
        expect(getMemoryFiles().files.some(f => f.folderId === skillsFolder.id && f.id === id)).toBe(false);
    });

    it('non-retired skills stay put', async () => {
        await initMemoryFiles('keep-user');
        const id = await seedSkill('keep-user', 'btc-short-repeat.md', { status: 'candidate', kind: 'repeat', wins: 3, losses: 1 });
        await consolidateSkills('keep-user');
        const folders = getMemoryFiles().folders;
        const archive = folders.find(f => f.name === 'archive');
        const file = getMemoryFiles().files.find(f => f.id === id)!;
        expect(archive ? file.folderId !== archive.id : true).toBe(true);
        expect(parseSkillMarkdown(file.content)!.status).toBe('candidate');
    });
});

describe('AI-written note caps', () => {
    it('append-mode notes keep the head plus at most 30 sections', async () => {
        await initMemoryFiles('notes-cap');
        for (let i = 0; i <= 33; i++) {
            await writeModelNote({
                folder: 'lessons',
                fileName: 'chop-days',
                decision: 'append',
                content: `Lesson number ${i} — the chop took another scalp.`,
            } as never, 'notes-cap');
        }
        const note = getMemoryFiles().files.find(f => f.name === 'chop-days.md')!;
        const parts = note.content.split('\n\n---\n\n');
        expect(parts.length - 1).toBeLessThanOrEqual(30); // sections, head excluded
        expect(note.content).toContain('Lesson number 33'); // newest survives
        expect(note.content).toContain('Lesson number 0'); // the file HEAD stays
        expect(note.content).not.toContain('Lesson number 3 '); // oldest SECTION trimmed
    });

    it('a folder never holds more than 40 harness-written notes', async () => {
        await initMemoryFiles('notes-count');
        for (let i = 0; i < 41; i++) {
            await writeModelNote({
                folder: 'lessons',
                fileName: `note-${String(i).padStart(2, '0')}`,
                decision: 'create',
                content: `Note body ${i}.`,
            } as never, 'notes-count');
        }
        const lessons = getMemoryFiles().folders.find(f => f.name === 'lessons')!;
        const auto = getMemoryFiles().files.filter(f => f.folderId === lessons.id && f.autoManaged);
        expect(auto.length).toBeLessThanOrEqual(40);
        expect(auto.some(f => f.name === 'note-40.md')).toBe(true); // newest present
        expect(auto.some(f => f.name === 'note-00.md')).toBe(false); // oldest pruned
    });
});

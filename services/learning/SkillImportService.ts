/**
 * SkillImportService — import skill files the user brings from outside
 * (a .md export from another august profile, a shared file, etc.) into
 * the harness's skills folder so the models can USE them in debates.
 *
 * Validation is strict but honest: a file must parse as a skill
 * (serializeSkill frontmatter shape — kind, status, ifCondition/… via
 * parseSkillMarkdown). Files that fail validation are reported, never
 * silently dropped. Names never overwrite: a colliding slug gets -2, -3…
 */

import { parseSkillMarkdown, listSkillSlugs } from './SkillMemoryService';
import { createMemoryFile, getMemoryFiles } from './MemoryFilesService';
import { getActiveUsername } from '../../utils/activeUser';
import { slugifyName } from './MemoryFilesService';

export interface SkillImportResult {
    imported: string[];
    skipped: string[];
    failed: Array<{ name: string; reason: string }>;
}

/** Find the skills folder id (creating the harness folders if needed). */
const skillsFolderId = async (username: string): Promise<string | null> => {
    const ensure = await import('./MemoryFilesService').then(m => m.ensureHarnessFolders(username));
    void ensure;
    return getMemoryFiles().folders.find(f => f.name === 'skills')?.id ?? null;
};

/** Unique file name in the skills folder: `slug.md`, `slug-2.md`, … */
const uniqueName = (base: string): string => {
    const existing = new Set(getMemoryFiles().files.map(f => f.name.toLowerCase()));
    const clean = `${slugifyName(base.replace(/\.md$/i, '')) || 'skill'}.md`;
    if (!existing.has(clean.toLowerCase())) return clean;
    for (let i = 2; i < 100; i += 1) {
        const candidate = `${clean.replace(/\.md$/, '')}-${i}.md`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${Date.now()}.md`;
};
/**
 * Import raw skill markdown strings (one per file). Returns a per-file
 * outcome so the UI can show exactly what happened.
 */
export const importSkillFiles = async (files: Array<{ name: string; content: string }>): Promise<SkillImportResult> => {
    const username = getActiveUsername();
    const result: SkillImportResult = { imported: [], skipped: [], failed: [] };
    if (files.length === 0) return result;
    const folderId = await skillsFolderId(username);
    if (!folderId) {
        return { imported: [], skipped: [], failed: files.map(f => ({ name: f.name, reason: 'Skills folder unavailable' })) };
    }
    for (const file of files) {
        const meta = parseSkillMarkdown(file.content);
        if (!meta) {
            result.failed.push({ name: file.name, reason: 'Not a skill file — missing or invalid skill frontmatter' });
            continue;
        }
        // Same trigger already learned → skip as duplicate (honest, not
        // silent). Skills WITHOUT a trigger condition dedupe on the
        // normalized title (the first `# heading`), so frontmatter-less
        // bodies can't be imported repeatedly under shuffled names.
        const triggerKey = (meta.ifCondition ?? `#title:${(meta.body.match(/^#\s+(.+)$/m)?.[1] ?? file.name).trim().toLowerCase()}`).toLowerCase();
        const dup = getMemoryFiles().files.filter(f => f.name.toLowerCase().endsWith('.md'))
            .some(f => {
                const other = parseSkillMarkdown(f.content);
                if (!other) return false;
                const otherKey = (other.ifCondition ?? `#title:${(other.body.match(/^#\s+(.+)$/m)?.[1] ?? f.name).trim().toLowerCase()}`).toLowerCase();
                return otherKey === triggerKey;
            });
        if (dup) {
            result.skipped.push(file.name);
            continue;
        }
        const existingSlugs = listSkillSlugs();
        const slug = slugifyName(file.name.replace(/\.md$/i, '')) || slugifyName(meta.body.slice(0, 40)) || 'skill';
        void existingSlugs;
        try {
            await createMemoryFile(folderId, uniqueName(file.name), file.content, username, false);
            result.imported.push(file.name);
        } catch (err) {
            result.failed.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) });
        }
    }
    return result;
};

/** Read a FileList of .md files into per-file outcomes. One unreadable
 *  file must NOT sink the batch (matches the service's "report, never
 *  silently drop" contract): successes carry content, failures carry a
 *  reason and surface as normal import failures in the UI. */
export interface SkillFileRead {
    name: string;
    content?: string;
    error?: string;
}

export const readSkillFiles = async (fileList: FileList | File[]): Promise<SkillFileRead[]> => {
    const results = await Promise.allSettled(
        Array.from(fileList).map(file => new Promise<{ name: string; content: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') resolve({ name: file.name, content: reader.result });
                else reject(new Error('File is not readable as text'));
            };
            reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
            reader.readAsText(file);
        })),
    );
    return results.map((r, i) =>
        r.status === 'fulfilled'
            ? { name: r.value.name, content: r.value.content }
            : { name: (Array.from(fileList)[i] as File).name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
    );
};

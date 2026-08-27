/**
 * Per-lens memory files (Phase 3).
 *
 * Three notebook files, one per analyst seat:
 *   lens/macro.md      — regime ledger + regime-level lessons (Macro seat)
 *   lens/technical.md  — pattern-frequency stats + structure lessons (Technical seat)
 *   lens/risk.md       — failure-mode stats + R:R lessons (Risk seat)
 *
 * The doctrine rewriter reads all three and the lens-prompt assembler injects
 * the matching file into the matching seat. Default 'all' skills still
 * inject into every seat; per-lens-scope skills inject only into their
 * declared seat (see SkillMemoryService.lensScope).
 *
 * Storage lives in the existing memory_files_v1_<user> Preferences blob —
 * no new key, no new persistence path. Migration: ensureHarnessFoldersUnlocked
 * adds the lens/ folder for legacy users on next boot.
 */

import { AnalystRole } from '../../types';
import type { MemoryFile } from '../../types';
import {
    createMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    getMemoryFiles,
    updateMemoryFileUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';

export const LENS_FOLDER = 'lens';
export const LENS_FILES: Record<AnalystRole, string> = {
    [AnalystRole.MACRO_VOLATILITY]: 'macro.md',
    [AnalystRole.TECHNICAL_ANALYST]: 'technical.md',
    [AnalystRole.RISK_EXECUTION]: 'risk.md',
    // UNASSIGNED has no dedicated file.
    [AnalystRole.UNASSIGNED]: '',
};

/** Map an `AnalystRole` (or any role-shaped string) to its lens file name.
 *  Returns '' when the role has no dedicated file (UNASSIGNED). */
export const lensFileForRole = (role: string | AnalystRole | undefined): string => {
    if (!role) return '';
    if (role === AnalystRole.MACRO_VOLATILITY) return LENS_FILES[AnalystRole.MACRO_VOLATILITY];
    if (role === AnalystRole.TECHNICAL_ANALYST) return LENS_FILES[AnalystRole.TECHNICAL_ANALYST];
    if (role === AnalystRole.RISK_EXECUTION) return LENS_FILES[AnalystRole.RISK_EXECUTION];
    const r = String(role).toLowerCase();
    if (r.includes('macro') || r.includes('volatility')) return LENS_FILES[AnalystRole.MACRO_VOLATILITY];
    if (r.includes('technical') || r.includes('chart')) return LENS_FILES[AnalystRole.TECHNICAL_ANALYST];
    if (r.includes('risk') || r.includes('execution')) return LENS_FILES[AnalystRole.RISK_EXECUTION];
    return '';
};

const findLensFile = (filename: string): MemoryFile | undefined => {
    const { files, folders } = getMemoryFiles();
    const folder = folders.find(f => f.name === LENS_FOLDER);
    if (!folder) return undefined;
    return files.find(f => f.folderId === folder.id && f.name === filename);
};

/** Sync read of a lens file's content. Returns '' when missing or disabled. */
export const readLensMemory = (role: string | AnalystRole): string => {
    const filename = lensFileForRole(role);
    if (!filename) return '';
    const file = findLensFile(filename);
    if (!file || !file.enabled) return '';
    return file.content;
};

/** Cap the injected block at this many characters. Anything longer is
 *  truncated with an ellipsis; the lens prompt assembler also enforces its
 *  own per-stage budget. */
export const LENS_MEMORY_BLOCK_MAX = 250;

/** Lens files stay bounded: keep only the newest N bullet lines. */
export const MAX_LENS_MEMORY_LINES = 40;

export const summarizeLensMemory = (role: string | AnalystRole, max = LENS_MEMORY_BLOCK_MAX): string => {
    const content = readLensMemory(role);
    if (!content) return '';
    if (content.length <= max) return content;
    return `${content.slice(0, max).trimEnd()}\n…`;
};

/** One-line summary for the doctrine block. Reads the first markdown
 *  heading (line starting with `# `) and returns up to 160 chars. Returns ''
 *  when the file is empty. */
export const lensMemoryDoctrineLine = (role: string | AnalystRole): string => {
    const content = readLensMemory(role);
    if (!content) return '';
    const heading = content.split('\n').find(l => l.startsWith('# '))?.replace(/^#\s+/, '').trim();
    if (!heading) return '';
    return heading.length > 160 ? `${heading.slice(0, 159).trimEnd()}…` : heading;
};

/** Append a line to a lens file. Creates the file (and folder) on first write.
 *  Used by the regime recorder, the pattern-frequency stat collector, and the
 *  risk-stats writer. Caller must already hold the username (typically via
 *  the analysis pipeline). */
export const appendLensMemoryLine = async (
    role: string | AnalystRole,
    line: string,
    username: string,
): Promise<void> => {
    const filename = lensFileForRole(role);
    if (!filename) return;
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    await withNotebookWriteLock(async () => {
        await ensureHarnessFoldersUnlocked(username);
        const { files, folders } = getMemoryFiles();
        const folder = folders.find(f => f.name === LENS_FOLDER);
        if (!folder) return;
        const stamp = new Date().toISOString().slice(0, 10);
        const existing = files.find(f => f.folderId === folder.id && f.name === filename);
        if (existing) {
            // Persist through the unlocked API — mutating the cache object
            // alone never reaches Preferences, so the line would be lost on
            // next load. Keep the file bounded: header + newest N lines.
            const lines = existing.content.split('\n');
            const header: string[] = [];
            const body: string[] = [];
            for (const l of lines) {
                if (body.length === 0 && !l.startsWith('- ')) header.push(l);
                else body.push(l);
            }
            const kept = [...body, `- ${cleaned} · ${stamp}`].filter(l => l.trim() !== '').slice(-MAX_LENS_MEMORY_LINES);
            const stamped = `${header.join('\n').trimEnd()}\n\n${kept.join('\n')}`;
            await updateMemoryFileUnlocked(existing.id, { content: stamped }, username);
        } else {
            const headerByFile: Record<string, string> = {
                'macro.md': '# Macro Lens Memory',
                'technical.md': '# Technical Lens Memory',
                'risk.md': '# Risk Lens Memory',
            };
            const header = headerByFile[filename] ?? '# Lens Memory';
            await createMemoryFileUnlocked(
                folder.id,
                filename,
                `${header}\n\n- ${cleaned} · ${stamp}`,
                username,
                true,
            );
        }
    });
};

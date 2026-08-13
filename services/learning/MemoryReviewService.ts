/**
 * One-shot notebook review: after Memory files change, the Memory model
 * reads the index and writes profile/suggestions.md for the user.
 * It does not rewrite other files.
 */

import { ProviderConfig } from '../../types/provider';
import { getQuickResponse } from '../providers/GenericAnalysisService';
import { sanitizeAIResponse } from '../../utils/sanitizers';
import {
    createMemoryFile,
    getMemoryFiles,
    getMemoryFilesIndex,
    SUGGESTIONS_FILE_NAME,
    updateMemoryFile,
    withSilentMemoryPersist,
} from './MemoryFilesService';

const REVIEW_SYSTEM = `You are the trader's notebook reviewer. Read the CURRENT NOTEBOOK index (folders, files, excerpts). Suggest what the trader should do next. Do not rewrite files yourself.

Cover:
- Contradictions or duplicates to merge
- Stale or empty files to edit or drop
- Missing playbooks given what is already logged
- Skills/rules that look weak or unused
- One short priority list (max 7 bullets)

Write markdown the trader will open as suggestions.md. No JSON. No chain-of-thought. Start with "# Suggestions". Keep it under 800 words.`;

let inFlight: Promise<boolean> | null = null;

export const runNotebookReview = async (
    username: string,
    config: ProviderConfig | null | undefined,
): Promise<boolean> => {
    if (!config?.apiKey) return false;
    if (inFlight) return inFlight;

    const work = (async (): Promise<boolean> => {
        const index = getMemoryFilesIndex();
        if (!index || index.includes('empty notebook')) return false;
        const raw = await getQuickResponse(
            config,
            `CURRENT NOTEBOOK:\n${index}\n\nWrite suggestions.md for this trader.`,
            [],
            REVIEW_SYSTEM,
        );
        const body = sanitizeAIResponse(raw || '').trim();
        if (!body || body.length < 40) return false;
        const dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const content = body.startsWith('#')
            ? body
            : `# Suggestions\n> Memory model review · ${dateStr}\n\n${body}`;
        const folder = getMemoryFiles().folders.find(f => f.name === 'profile');
        if (!folder) return false;
        const existing = getMemoryFiles().files.find(
            f => f.folderId === folder.id && f.name === SUGGESTIONS_FILE_NAME,
        );
        await withSilentMemoryPersist(async () => {
            if (existing) {
                await updateMemoryFile(existing.id, { content, enabled: false }, username);
            } else {
                const created = await createMemoryFile(folder.id, SUGGESTIONS_FILE_NAME, content, username, true);
                await updateMemoryFile(created.id, { enabled: false }, username);
            }
        });
        return true;
    })();

    inFlight = work.finally(() => { inFlight = null; });
    return inFlight;
};

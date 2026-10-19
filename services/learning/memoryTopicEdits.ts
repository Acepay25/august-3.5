/**
 * memoryTopicEdits — the natural-language edit of a notebook entry (gap 3 of
 * docs/plan/open-items.md).
 *
 * The reference's memory detail carries a "Tell Claude what to change" box:
 * the trader writes an instruction in plain words, a model proposes the edit,
 * and a HUMAN approves it. August's governance for exactly this already
 * exists — `proposeAmendment` (models propose notebook corrections, a human
 * approves in the Queue) — so this module is the missing link, not a new
 * mechanism: ask the memory model to REWRITE the entry under the trader's
 * instruction, then hand the result to the queue as a PENDING amendment.
 *
 * Three rules the queue enforces and this module must not work around:
 *   - auto-managed files (diary/profile/rules) cannot be amended — they are
 *     harness-owned, so the box refuses them rather than proposing a change
 *     the inbox will only reject;
 *   - a proposed file identical to the current one is rejected by the queue,
 *     so a no-op model reply is reported as "no change needed" here instead
 *     of a confusing validation error;
 *   - nothing touches the notebook on proposal. The amendment lands PENDING
 *     and waits for the human in Learn → Queue.
 */

import { getQuickResponse } from '../providers/GenericAnalysisService';
import type { ProviderConfig } from '../../types/provider';
import type { MemoryFile } from '../../types';
import { getMemoryFiles } from './MemoryFilesService';
import { proposeAmendment, type MemoryAmendment } from './memoryAmendments';

const EDIT_SYSTEM = `You edit the trader's notebook entry. You are given the CURRENT FILE and an instruction from the trader in plain words.

Return the COMPLETE rewritten file, changed ONLY as the instruction asks. Keep the file's structure, headings and writing style. Add nothing the instruction did not ask for — no preamble, no commentary, no summary of what you did.

Reply with the file content only, inside one fenced block:
\`\`\`markdown
<the rewritten file>
\`\`\``;

/** Pull the file body out of the fenced reply. A model that answers with prose
 *  instead of a fence has not proposed an edit, and must not be smuggled into
 *  the queue as one — the raw text is the honest fallback, trimmed. */
export const extractProposedContent = (reply: string): string => {
    const fenced = /```(?:markdown|md)?\s*\n([\s\S]*?)```/i.exec(reply);
    if (fenced) return fenced[1].trim();
    return (reply ?? '').trim();
};

export interface TopicEditOutcome {
    ok: boolean;
    /** The queued amendment, when the edit was proposed. */
    amendment?: MemoryAmendment;
    /** Why nothing was queued — shown to the trader verbatim. */
    reason?: string;
}

export const proposeTopicEdit = async (
    file: MemoryFile,
    instruction: string,
    config: ProviderConfig | null | undefined,
): Promise<TopicEditOutcome> => {
    const ask = (instruction ?? '').trim();
    if (!ask) return { ok: false, reason: 'Write what should change first.' };
    if (file.autoManaged) {
        return {
            ok: false,
            reason: 'This entry is maintained by the harness (diary, profile or rules) and cannot be queued for an edit.',
        };
    }
    if (!config?.apiKey) {
        return { ok: false, reason: 'No memory model is configured — pick one in Settings → AI setup to propose an edit.' };
    }

    let reply: string;
    try {
        reply = await getQuickResponse(
            config,
            `CURRENT FILE (${file.name}):\n\n${file.content}\n\nTRADER'S INSTRUCTION:\n${ask}`,
            [],
            EDIT_SYSTEM,
        );
    } catch (err) {
        return { ok: false, reason: `The memory model could not be reached: ${err instanceof Error ? err.message : String(err)}` };
    }

    const proposed = extractProposedContent(reply);
    if (!proposed) return { ok: false, reason: 'The memory model returned nothing — nothing was queued.' };
    if (proposed === file.content.trim()) {
        return { ok: false, reason: 'No change needed — the entry already reads that way.' };
    }

    try {
        const amendment = proposeAmendment(
            file.id,
            'edit',
            proposed,
            `trader asked: ${ask}`,
            'trader:direct',
            id => {
                const current = getMemoryFiles().files.find(f => f.id === id) ?? null;
                return current;
            },
        );
        return { ok: true, amendment };
    } catch (err) {
        // The queue's own validation refused it (identical content, oversized,
        // missing target). Its message is written for a human to read.
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
};

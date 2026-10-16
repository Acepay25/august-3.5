/**
 * memoryTopics — the topic index over the trader notebook (gap 2 of
 * docs/plans/ui-ux-target-plan-2026-10-11.md).
 *
 * The reference reads memory as CONTENT: named topics, each with a one-line
 * summary and an "Updated" stamp, into a detail view. August stores memory as
 * FILES in folders, so its memory surface made the user browse storage and
 * read raw markdown to find out what the app believed. This module derives
 * the topic view from the notebook that already exists — no second store, no
 * mirror to drift: every row IS a notebook file, read live on each mount.
 *
 * What counts as a topic:
 *   - a file the TRADER owns (`autoManaged` is the harness's own diary,
 *     profile and rules — those have their own surfaces and regenerate, so
 *     listing them here would promise a Delete that does not stick);
 *   - not a skill (the `skills` folder is the SkillsCatalog's subject — one
 *     record, one surface);
 *   - with content (an empty template is not a belief).
 *
 * Summary rule: the first line of prose, headings skipped. One derivation in
 * one module so the index row and the detail panel can never describe the
 * same file two different ways.
 */

import type { MemoryFile } from '../../types';

export interface MemoryTopic {
    /** The notebook file — identity, not a copy: every action targets it. */
    file: MemoryFile;
    /** One line of prose: what this entry says, not what it is called. */
    summary: string;
    /** The folder name this entry lives in, for grouping. */
    folderName: string;
}

/** First line of actual prose, with markdown furniture skipped. An entry
 *  whose content is all headings has no summary, and says so honestly. */
export const topicSummaryOf = (content: string): string =>
    topicParts(content).summary;

/** The entry split at its first line of prose: the summary IS that line — the
 *  WHOLE line, because a truncated summary would drop its tail from the
 *  details block and no view of the entry would ever show it — and the details
 *  are everything after it, so the detail view can print Summary and Details
 *  without printing the same sentence twice. Truncation for a list row is a
 *  DISPLAY decision and belongs to the row (`clampLine`), not to the
 *  derivation. */
export const topicParts = (content: string): { summary: string; details: string } => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i].trim();
        if (!raw) continue;
        if (raw.startsWith('#') || raw.startsWith('>') || raw.startsWith('---')) continue;
        const text = raw
            .replace(/^[-*+]\s+/, '')                  // list bullets
            .replace(/^\*\*(.+?)\*\*:?/, '$1')         // bold lead-ins
            .replace(/[*_`]/g, '')                     // inline marks
            .trim();
        if (!text) continue;
        return {
            summary: text,
            details: lines.slice(i + 1).join('\n').trim(),
        };
    }
    return { summary: 'No summary yet — this entry has only headings.', details: lines.join('\n').trim() };
};

/** The list row's one-liner: the summary clamped for DISPLAY, with the
 *  ellipsis saying the entry holds more (its detail view shows all of it). */
export const clampLine = (text: string, max = 140): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

const isSkillFile = (file: MemoryFile, folderNamesById: Map<string, string>): boolean =>
    folderNamesById.get(file.folderId) === 'skills';

/**
 * The index. Pure: takes a notebook store's shape, returns rows newest-first.
 * Kept a parameter (not a direct store read) so the derivation is testable
 * without the notebook, and so both the card and the panel derive from the
 * same function on the same input.
 */
export const memoryTopicsFromStore = (
    files: MemoryFile[],
    folders: Array<{ id: string; name: string }>,
): MemoryTopic[] => {
    const folderNamesById = new Map(folders.map(f => [f.id, f.name]));
    return files
        .filter(file => !file.autoManaged && !isSkillFile(file, folderNamesById))
        .filter(file => file.content.trim().length > 0)
        .map(file => ({
            file,
            // The ROW's summary is clamped for display; the panel reads the
            // same entry through `topicParts` and shows the whole line.
            summary: clampLine(topicSummaryOf(file.content)),
            folderName: folderNamesById.get(file.folderId) ?? 'notebook',
        }))
        .sort((a, b) => (b.file.updatedAt ?? 0) - (a.file.updatedAt ?? 0));
};

/** The elapsed word alone, for list rows: `now`, `45m ago`, `6h ago`, `8d
 *  ago`. The ONE duration formatter for this surface — the card's stamp and
 *  the detail's parenthetical must never disagree about how stale an entry
 *  is. */
export const relativeElapsed = (at: number | undefined | null, now = Date.now()): string => {
    if (!at) return '';
    const mins = Math.round((now - at) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
};

/** The "Last updated" line the detail view leads with. Absolute date plus the
 *  elapsed word, because "Updated 3d" answers "how stale" and the date
 *  answers "when exactly" — the two questions are not the same one. */
export const topicUpdatedLine = (file: MemoryFile, now = Date.now()): string => {
    const at = file.updatedAt ?? 0;
    if (!at) return 'Last updated unknown';
    const date = new Date(at).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
    });
    return `Last updated ${date} (${relativeElapsed(at, now)})`;
};

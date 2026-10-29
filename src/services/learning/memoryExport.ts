/**
 * memoryExport — the Markdown export behind Settings → Memory's "Export memory".
 *
 * Claude downloads memory as a zip of Markdown files. August has no zip writer,
 * so this emits ONE Markdown document with the same information: each entry's
 * label, when it was last written, its summary, its details and its provenance.
 * The grouping is the surface's own (You / Topics / Areas), so the file reads
 * like the page it came from.
 *
 * Pure: it takes the entries and returns bytes. The caller owns the download.
 */

import type { ProfileMemoryEntry } from './profileMemory';
import { memoryEntryLabel } from './memoryTopics';
import { memorySectionOf, orderMemorySections } from './memorySections';
import { phtDayKey } from '../../utils/timezone';

const updatedIso = (entry: ProfileMemoryEntry): string => {
    const at = Date.parse(entry.updatedAt);
    return Number.isFinite(at) ? new Date(at).toISOString() : 'unknown';
};

export const memoryExportFilename = (now: number = Date.now()): string =>
    `august-memory-${phtDayKey(now)}.md`;

export const memoryExportMarkdown = (
    entries: readonly ProfileMemoryEntry[],
    now: number = Date.now(),
): string => {
    const groups = new Map<string, ProfileMemoryEntry[]>();
    for (const entry of entries) {
        const label = memorySectionOf(entry);
        const list = groups.get(label);
        if (list) list.push(entry); else groups.set(label, [entry]);
    }
    const newestFirst = (a: ProfileMemoryEntry, b: ProfileMemoryEntry): number =>
        (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    for (const list of groups.values()) list.sort(newestFirst);

    const lines: string[] = [
        '# August memory',
        '',
        `Exported ${new Date(now).toISOString()} · ${entries.length} ${entries.length === 1 ? 'memory' : 'memories'}`,
        '',
        'This file is the assistant memory shown in Settings → Memory, grouped by category. The trader notebook is a separate store and exports from Settings → Data.',
    ];
    let wrote = 0;
    for (const section of orderMemorySections([...groups.keys()])) {
        const rows = groups.get(section) ?? [];
        if (rows.length === 0) continue;
        wrote += 1;
        lines.push('', `## ${section}`, '');
        for (const entry of rows) {
            const provenance = [
                memorySectionOf(entry),
                entry.tag ?? 'stated',
                entry.sensitive ? 'sensitive' : '',
                entry.source === 'auto' ? 'auto' : '',
            ].filter(Boolean).join(' · ');
            lines.push(`### ${memoryEntryLabel(entry.slug)}`);
            lines.push('');
            lines.push(`_Updated ${updatedIso(entry)} · ${provenance}_`);
            lines.push('');
            lines.push(`**Summary:** ${entry.description.trim()}`);
            lines.push('');
            lines.push(entry.body.trim());
            lines.push('');
        }
    }
    if (wrote === 0) lines.push('', 'No memories yet.');
    return `${lines.join('\n').trimEnd()}\n`;
};

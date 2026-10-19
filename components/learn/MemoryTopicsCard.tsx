import React, { useEffect, useMemo, useState } from 'react';
import { NotebookPen } from '../shared/Icons';
import { getMemoryFiles, subscribeMemoryFilesChanged } from '../../services/learning/MemoryFilesService';
import { memoryTopicsFromStore, relativeElapsed, type MemoryTopic } from '../../services/learning/memoryTopics';

/**
 * MemoryTopicsCard — the notebook read as CONTENT (gap 2 of
 * docs/plan/open-items.md).
 *
 * The reference's Settings → Memory opens on a list of named topics, each
 * with a one-line summary and an "Updated" stamp. August's memory tab opened
 * on the raw file manager, so finding out what the app believed meant reading
 * folders and markdown. This card is the index: every row IS a notebook file
 * (no copy, no second store — read live through the store subscription), and
 * pressing one opens the entry's detail in the right panel.
 *
 * What is deliberately NOT here: skills (the SkillsCatalog owns those rows)
 * and harness-maintained files (diary/profile/rules — they regenerate, and a
 * Delete that does not stick is a lie the surface must not tell). Those stay
 * browsable in the file manager below.
 */

interface MemoryTopicsCardProps {
    onOpenTopic: (fileId: string) => void;
}

const MemoryTopicsCard: React.FC<MemoryTopicsCardProps> = ({ onOpenTopic }) => {
    const [version, setVersion] = useState(0);
    useEffect(() => subscribeMemoryFilesChanged(() => setVersion(v => v + 1)), []);

    const topics = useMemo<MemoryTopic[]>(() => {
        void version;
        const store = getMemoryFiles();
        return memoryTopicsFromStore(store.files, store.folders);
    }, [version]);

    return (
        <section className="rounded-control border border-zinc-800/80 bg-zinc-900/60" data-testid="memory-topics">
            <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
                <div className="min-w-0 flex items-center gap-2">
                    <NotebookPen className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                    <h3 className="truncate text-ui-sm font-semibold text-zinc-100" title="Memory topics">Memory topics</h3>
                </div>
                <span className="shrink-0 text-ui-2xs text-zinc-600" data-testid="memory-topics-count">
                    {topics.length} {topics.length === 1 ? 'entry' : 'entries'}
                </span>
            </div>

            {topics.length === 0 ? (
                <p className="px-4 py-4 text-ui-dense text-zinc-500" data-testid="memory-topics-empty">
                    Nothing here yet. Entries you write — and the corrections you approve —
                    show up here as topics. The harness keeps its own diary, profile and rules
                    in the file manager below.
                </p>
            ) : (
                <ul className="divide-y divide-white/5" data-testid="memory-topics-list">
                    {topics.map(t => (
                        <li key={t.file.id}>
                            <button
                                type="button"
                                onClick={() => onOpenTopic(t.file.id)}
                                aria-label={`Read ${t.file.name}`}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline gap-2">
                                        <span className="truncate text-ui-dense font-semibold text-zinc-100" title={t.file.name}>
                                            {t.file.name.replace(/\.md$/i, '')}
                                        </span>
                                        <span className="shrink-0 text-ui-2xs text-zinc-600">{t.folderName}</span>
                                    </span>
                                    <span className="block truncate text-ui-dense text-zinc-500" title={t.summary}>
                                        {t.summary}
                                    </span>
                                </span>
                                <span className="shrink-0 font-mono text-ui-2xs tabular-nums text-zinc-600" title="Last updated">
                                    {relativeElapsed(t.file.updatedAt)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default React.memo(MemoryTopicsCard);

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PROMPT_REGISTRY, PromptRegistryEntry } from '../../constants/promptRegistry';
import {
    initPromptOverrides,
    getPromptOverrides,
    savePromptOverride,
    resetPromptOverride,
    resetAllPromptOverrides,
} from '../../services/infrastructure/PromptOverrideService';
import { useToastActions } from '../shared/Toast';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import MarkdownRenderer from '../shared/MarkdownRenderer';
import { SearchIcon, LoadingIcon, CodeIcon, ChevronLeftIcon } from '../shared/Icons';

interface PromptManagerProps {
    /** Active user — overrides are stored per-user. */
    username?: string;
}

/**
 * Prompt categories — derived from the id prefix, so the sidebar groups
 * prompts the way the Trader Notebook groups md files into folders.
 */
const GROUP_ORDER = ['analysis', 'debate', 'postmortem', 'strategy', 'notebook'];
const GROUP_LABELS: Record<string, string> = {
    analysis: 'Analysis',
    debate: 'Debate',
    postmortem: 'Post-mortem',
    strategy: 'Strategy',
    notebook: 'Notebook',
};

const groupKeyOf = (id: string): string => id.split('.')[0] || 'other';
const groupLabel = (key: string): string => GROUP_LABELS[key] ?? 'Other';

/**
 * Settings → Prompts: browse every prompt the app sends to models, see where
 * it is used, and edit it. Mirrors the Personal edge (Trader Notebook) layout:
 * categories on the left, the prompt list on the right, and clicking a prompt
 * opens its rendered markdown (Write switches to the raw editor).
 * Edits are stored per-user in Preferences and applied at call time
 * (getPrompt), so they take effect on the very next analysis — no restart.
 */
const PromptManager: React.FC<PromptManagerProps> = ({ username }) => {
    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroupKey, setSelectedGroupKey] = useState<string>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<string>('');
    const [isDirty, setIsDirty] = useState(false);
    const [isPreview, setIsPreview] = useState(false);
    const [overrides, setOverrides] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const activeUser = username || 'default';

    // Refresh the sync cache on mount / user switch, then snapshot the map.
    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        initPromptOverrides(activeUser).then(() => {
            if (cancelled) return;
            setOverrides(getPromptOverrides());
            setIsLoading(false);
        });
        return () => { cancelled = true; };
    }, [activeUser]);

    const selectedEntry = useMemo(
        () => PROMPT_REGISTRY.find(e => e.id === selectedId) ?? null,
        [selectedId]
    );
    const isModified = selectedId ? overrides[selectedId] !== undefined : false;
    const modifiedCount = Object.keys(overrides).length;

    // Categories in display order (known groups first, unknown sorted).
    const allGroups = useMemo(() => {
        const byKey = new Map<string, PromptRegistryEntry[]>();
        for (const entry of PROMPT_REGISTRY) {
            const key = groupKeyOf(entry.id);
            const list = byKey.get(key) ?? [];
            list.push(entry);
            byKey.set(key, list);
        }
        const known = GROUP_ORDER
            .filter(key => byKey.has(key))
            .map(key => ({ key, label: groupLabel(key), entries: byKey.get(key)! }));
        const others = [...byKey.keys()]
            .filter(key => !GROUP_ORDER.includes(key))
            .sort()
            .map(key => ({ key, label: groupLabel(key), entries: byKey.get(key)! }));
        return [...known, ...others];
    }, []);

    // Search across name, description, id and usage.
    const searchFiltered = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return null;
        return PROMPT_REGISTRY.filter(entry =>
            entry.name.toLowerCase().includes(q) ||
            entry.description.toLowerCase().includes(q) ||
            entry.id.toLowerCase().includes(q) ||
            entry.usage.some(u => u.toLowerCase().includes(q))
        );
    }, [searchQuery]);

    // Right-list entries: a search query overrides category scoping and
    // returns matches from every category (a "results" view).
    const visibleEntries = useMemo(() => {
        if (searchFiltered) return searchFiltered;
        if (selectedGroupKey === 'all') return PROMPT_REGISTRY;
        return PROMPT_REGISTRY.filter(e => groupKeyOf(e.id) === selectedGroupKey);
    }, [searchFiltered, selectedGroupKey]);

    const listTitle = searchFiltered
        ? `Results (${searchFiltered.length})`
        : selectedGroupKey === 'all'
            ? 'All prompts'
            : groupLabel(selectedGroupKey);

    // Guard unsaved edits when leaving the current prompt.
    const ensureNotDirty = useCallback(async (): Promise<boolean> => {
        if (!isDirty || !selectedEntry) return true;
        const ok = await confirm({
            title: 'Discard unsaved changes?',
            message: `You have unsaved edits to "${selectedEntry.name}". They will be lost if you switch prompts.`,
            confirmLabel: 'Discard',
            destructive: true,
        });
        return ok;
    }, [isDirty, selectedEntry, confirm]);

    const openEntry = useCallback(async (entry: PromptRegistryEntry) => {
        if (selectedId === entry.id) return;
        if (!(await ensureNotDirty())) return;
        setSelectedId(entry.id);
        setDraft(overrides[entry.id] ?? entry.fallback);
        setIsDirty(false);
        // Opening a prompt shows its rendered markdown (like opening an md
        // file); the Write button switches to the raw editor.
        setIsPreview(true);
    }, [selectedId, overrides, ensureNotDirty]);

    const goBackToList = useCallback(async () => {
        if (!(await ensureNotDirty())) return;
        setSelectedId(null);
    }, [ensureNotDirty]);

    const selectCategory = useCallback(async (key: string) => {
        if (!(await ensureNotDirty())) return;
        setSelectedGroupKey(key);
        setSelectedId(null);
        setSearchQuery('');
    }, [ensureNotDirty]);

    const handleSave = useCallback(async () => {
        if (!selectedEntry) return;
        setIsSaving(true);
        try {
            await savePromptOverride(selectedEntry.id, draft, activeUser);
            setOverrides(getPromptOverrides());
            setIsDirty(false);
            // Show the saved result rendered, like re-opening the md file.
            setIsPreview(true);
            toast.success('Prompt updated', `"${selectedEntry.name}" now applies to new analyses.`);
        } catch (e) {
            console.error('[PromptManager] Save failed:', e);
            toast.error('Could not save', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsSaving(false);
        }
    }, [selectedEntry, draft, activeUser, toast]);

    const handleResetOne = useCallback(async () => {
        if (!selectedEntry) return;
        await resetPromptOverride(selectedEntry.id, activeUser);
        setOverrides(getPromptOverrides());
        setDraft(selectedEntry.fallback);
        setIsDirty(false);
        toast.success('Prompt reset', `"${selectedEntry.name}" back to the built-in default.`);
    }, [selectedEntry, activeUser, toast]);

    const handleResetAll = useCallback(async () => {
        const ok = await confirm({
            title: 'Reset all prompts?',
            message: `This restores all ${PROMPT_REGISTRY.length} prompts to their built-in defaults. Your edits are lost.`,
            confirmLabel: 'Reset all',
            destructive: true,
        });
        if (!ok) return;
        await resetAllPromptOverrides(activeUser);
        setOverrides({});
        if (selectedEntry) setDraft(selectedEntry.fallback);
        setIsDirty(false);
        toast.success('Prompts reset', 'All prompts are back to their built-in defaults.');
    }, [activeUser, selectedEntry, confirm, toast]);

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Header — what this is + reset-all */}
            <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-zinc-800 shrink-0">
                <div>
                    <h4 className="text-sm font-bold text-white">Prompts</h4>
                    <p className="text-xs text-zinc-500 mt-0.5">
                        Every prompt the app sends to your AI models. Edit one and it applies to the next analysis instantly.
                    </p>
                </div>
                {modifiedCount > 0 && (
                    <button
                        type="button"
                        onClick={handleResetAll}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                        Reset all ({modifiedCount})
                    </button>
                )}
            </div>

            {/* Body — category sidebar + prompt list / viewer */}
            <div className="flex-1 min-h-0 flex gap-3 pt-3">
                {/* Categories (like the notebook's folder sidebar) */}
                <div className="w-52 shrink-0 flex flex-col min-h-0 border border-zinc-800/80 rounded-xl bg-zinc-900/60 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-800/80 shrink-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Categories</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                        <button
                            onClick={() => selectCategory('all')}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                selectedGroupKey === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                            }`}
                        >
                            <span>All</span>
                            <span className="text-[9px] font-mono text-zinc-600">{PROMPT_REGISTRY.length}</span>
                        </button>
                        {allGroups.map(group => {
                            const groupModified = group.entries.filter(e => overrides[e.id] !== undefined).length;
                            const isActive = selectedGroupKey === group.key;
                            return (
                                <button
                                    key={group.key}
                                    onClick={() => selectCategory(group.key)}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                        isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                                    }`}
                                >
                                    <span className="truncate">{group.label}</span>
                                    <span className={`text-[9px] font-mono shrink-0 ml-1 ${groupModified > 0 ? 'text-cyan-500' : 'text-zinc-600'}`}>
                                        {group.entries.length}{groupModified > 0 ? ` · ${groupModified} mod` : ''}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Right pane — prompt list, or the opened prompt's markdown */}
                <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-3">
                    {selectedEntry ? (
                        <>
                            {/* Prompt header — back, name, id, actions */}
                            <div className="shrink-0 flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl border border-zinc-800/80 bg-zinc-900/60">
                                <button
                                    onClick={goBackToList}
                                    className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[10px] font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors shrink-0"
                                    title="Back to the prompt list"
                                >
                                    <ChevronLeftIcon className="w-3.5 h-3.5" /> List
                                </button>
                                <span className="text-xs font-bold text-white truncate max-w-[200px]">{selectedEntry.name}</span>
                                <code className="text-[9px] font-mono text-zinc-600 shrink-0">id: {selectedEntry.id}</code>
                                {isModified && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0" title="Your edited version is live">Modified</span>
                                )}
                                <span className="text-[9px] font-mono text-zinc-600 shrink-0">{draft.length.toLocaleString()} chars</span>
                                <div className="ml-auto flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => setIsPreview(v => !v)}
                                        className="px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                    >
                                        {isPreview ? 'Write' : 'Preview'}
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={!isDirty || isSaving}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                                    >
                                        {isSaving ? 'Saving…' : 'Save'}
                                    </button>
                                    {isModified && (
                                        <button
                                            onClick={handleResetOne}
                                            className="px-2.5 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Usage chips */}
                            <div className="shrink-0 flex flex-wrap gap-1">
                                {selectedEntry.usage.map(u => (
                                    <span key={u} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-white/5 text-zinc-500 text-[9px]">
                                        {u}
                                    </span>
                                ))}
                            </div>

                            {/* Description */}
                            <p className="shrink-0 text-[11px] text-zinc-500 leading-relaxed -mt-2">
                                {selectedEntry.description}
                            </p>

                            {/* Editor / preview */}
                            <div className="flex-1 min-h-0 rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden flex flex-col">
                                {isPreview ? (
                                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                                        <MarkdownRenderer content={draft || '(empty prompt)'} />
                                    </div>
                                ) : (
                                    <textarea
                                        value={draft}
                                        onChange={e => { setDraft(e.target.value); setIsDirty(true); }}
                                        spellCheck={false}
                                        className="flex-1 w-full resize-none bg-transparent p-4 text-[12px] leading-relaxed text-zinc-200 font-mono focus:outline-none custom-scrollbar"
                                        placeholder="(empty override — the built-in default is used)"
                                        aria-label={`Edit ${selectedEntry.name}`}
                                    />
                                )}
                            </div>

                            <p className="shrink-0 text-[10px] text-zinc-600">
                                {isModified
                                    ? 'Your edited version is live. Saving an empty editor removes the override.'
                                    : 'No override yet — the built-in default above is what models currently see.'}
                            </p>
                        </>
                    ) : (
                        <div className="flex-1 min-h-0 border border-zinc-800/80 rounded-xl bg-zinc-900/60 overflow-hidden flex flex-col">
                            {/* List header — category title + search */}
                            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800/80 shrink-0">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{listTitle}</span>
                                <div className="relative w-48">
                                    <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                                    <input
                                        type="search"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search prompts…"
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/40 transition-colors"
                                        aria-label="Search prompts"
                                    />
                                </div>
                            </div>

                            {/* Prompt rows */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                                {isLoading ? (
                                    <div className="flex justify-center py-10"><LoadingIcon className="w-5 h-5 text-zinc-500" /></div>
                                ) : visibleEntries.length === 0 ? (
                                    <p className="text-[11px] text-zinc-600 text-center py-10">
                                        {searchQuery ? `No prompts match "${searchQuery}".` : 'No prompts in this category.'}
                                    </p>
                                ) : searchFiltered ? (
                                    visibleEntries.map(entry => (
                                        <PromptRow key={entry.id} entry={entry} isModified={overrides[entry.id] !== undefined} onOpen={openEntry} />
                                    ))
                                ) : (
                                    // Category views (incl. All) render group separators so
                                    // orientation survives long lists.
                                    allGroups
                                        .filter(g => selectedGroupKey === 'all' || g.key === selectedGroupKey)
                                        .map(group => (
                                            <div key={group.key}>
                                                {selectedGroupKey === 'all' && (
                                                    <div className="flex items-center justify-between px-2.5 py-1">
                                                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{group.label}</span>
                                                        <span className="text-[9px] font-mono text-zinc-600">{group.entries.length}</span>
                                                    </div>
                                                )}
                                                <div className="space-y-0.5">
                                                    {group.entries.map(entry => (
                                                        <PromptRow key={entry.id} entry={entry} isModified={overrides[entry.id] !== undefined} onOpen={openEntry} />
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

/** One row in the prompt list — name, id, modified dot. */
const PromptRow: React.FC<{
    entry: PromptRegistryEntry;
    isModified: boolean;
    onOpen: (entry: PromptRegistryEntry) => void;
}> = ({ entry, isModified, onOpen }) => (
    <button
        onClick={() => onOpen(entry)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-zinc-900"
    >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isModified ? 'bg-cyan-400' : 'bg-zinc-700'}`} title={isModified ? 'Modified — custom version is live' : 'Built-in default'} />
        <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-semibold text-zinc-200 truncate">{entry.name}</span>
            <span className="block text-[9px] font-mono text-zinc-600 truncate">{entry.id}</span>
        </span>
    </button>
);

export default React.memo(PromptManager);

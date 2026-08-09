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
import { ChevronDownIcon, LoadingIcon } from '../shared/Icons';

interface PromptManagerProps {
    /** Active user — overrides are stored per-user. */
    username?: string;
}

/**
 * Settings → Prompts: browse every prompt the app sends to models, see where
 * it is used, and edit it. Edits are stored per-user in Preferences and
 * applied at call time (getPrompt), so they take effect on the very next
 * analysis — no restart needed.
 */
const PromptManager: React.FC<PromptManagerProps> = ({ username }) => {
    const toast = useToastActions();
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<string>('');
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

    const filtered = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return PROMPT_REGISTRY;
        return PROMPT_REGISTRY.filter(entry =>
            entry.name.toLowerCase().includes(q) ||
            entry.description.toLowerCase().includes(q) ||
            entry.id.toLowerCase().includes(q) ||
            entry.usage.some(u => u.toLowerCase().includes(q))
        );
    }, [searchQuery]);

    const modifiedCount = Object.keys(overrides).length;

    const openEditor = useCallback((entry: PromptRegistryEntry) => {
        setExpandedId(entry.id);
        setDraft(overrides[entry.id] ?? entry.fallback);
    }, [overrides]);

    const handleSave = useCallback(async (entry: PromptRegistryEntry) => {
        setIsSaving(true);
        try {
            await savePromptOverride(entry.id, draft, activeUser);
            setOverrides(getPromptOverrides());
            toast.success('Prompt updated', `"${entry.name}" now applies to new analyses.`);
        } catch (e) {
            console.error('[PromptManager] Save failed:', e);
            toast.error('Could not save', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsSaving(false);
        }
    }, [draft, activeUser, toast]);

    const handleResetOne = useCallback(async (entry: PromptRegistryEntry) => {
        await resetPromptOverride(entry.id, activeUser);
        setOverrides(getPromptOverrides());
        setDraft(entry.fallback);
        toast.success('Prompt reset', `"${entry.name}" back to the built-in default.`);
    }, [activeUser, toast]);

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
        setDraft('');
        setExpandedId(null);
        toast.success('Prompts reset', 'All prompts are back to their built-in defaults.');
    }, [activeUser, confirm, toast]);

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* Header + search */}
            <div className="px-6 py-4 border-b border-zinc-800/80 shrink-0 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">Prompts</h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
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
                <div className="relative">
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search prompts by name, id, or where they're used…"
                        className="w-full bg-zinc-950 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/40 transition-colors"
                        aria-label="Search prompts"
                    />
                </div>
            </div>

            {/* Prompt list */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-2.5">
                {isLoading ? (
                    <div className="flex justify-center py-10"><LoadingIcon className="w-6 h-6 text-zinc-500" /></div>
                ) : filtered.length === 0 ? (
                    <p className="text-xs text-zinc-600 text-center py-10">No prompts match "{searchQuery}".</p>
                ) : filtered.map(entry => {
                    const isExpanded = expandedId === entry.id;
                    const isModified = overrides[entry.id] !== undefined;
                    return (
                        <div key={entry.id} className={`rounded-xl border transition-colors ${isExpanded ? 'border-cyan-500/30 bg-zinc-900' : 'border-white/5 bg-zinc-900/60 hover:border-white/10'}`}>
                            <button
                                type="button"
                                onClick={() => isExpanded ? setExpandedId(null) : openEditor(entry)}
                                aria-expanded={isExpanded}
                                className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 group"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-bold text-zinc-200 group-hover:text-white transition-colors">{entry.name}</span>
                                        {isModified && (
                                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-[9px] font-bold uppercase tracking-widest">
                                                Modified
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{entry.description}</p>
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {entry.usage.map(u => (
                                            <span key={u} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-white/5 text-zinc-500 text-[9px]">
                                                {u}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <ChevronDownIcon className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4 pt-0">
                                    <div className="mb-2 flex items-center justify-between">
                                        <code className="text-[10px] font-mono text-zinc-600">id: {entry.id}</code>
                                        <span className="text-[10px] text-zinc-600 font-mono">{draft.length.toLocaleString()} chars</span>
                                    </div>
                                    <textarea
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        spellCheck={false}
                                        className="w-full h-64 resize-y bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 transition-colors whitespace-pre"
                                        placeholder="(empty override — the built-in default is used)"
                                        aria-label={`Edit ${entry.name}`}
                                    />
                                    <div className="flex items-center justify-between mt-2.5 gap-2">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSave(entry)}
                                                disabled={isSaving}
                                                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                                            >
                                                {isSaving ? 'Saving…' : 'Save'}
                                            </button>
                                            {isModified && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleResetOne(entry)}
                                                    className="px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                                >
                                                    Reset to default
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setExpandedId(null)}
                                            className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                                        >
                                            Close
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-zinc-600 mt-2">
                                        {isModified
                                            ? 'Your edited version is live. Saving an empty editor removes the override.'
                                            : 'No override yet — the built-in default below is what models currently see.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

export default React.memo(PromptManager);

/**
 * ModelChip — the composer's model control: a quiet pill that names the current
 * model and opens a searchable, provider-grouped, star-able menu.
 *
 * This is the Chart AI dock's picker, lifted out of `panels/ChatComposer` so the
 * Chat surface gets the SAME control rather than a plainer second one. Two chips
 * that look similar and do different things is the shape of defect this repo
 * keeps being asked to remove; the menu's contract (ready providers only,
 * grouped, searchable, scrolling not overflowing, starred first) is now owned
 * once.
 *
 * The star list persists raw in localStorage under `august_starred_models_v1` —
 * a tiny per-browser preference, not user data — so starring in the dock also
 * sorts the chat's list.
 */
import React, { useState } from 'react';
import { Check, ChevronDown, StarIcon } from './Icons';
import type { ProviderConfig } from '../../types/provider';
import { formatModelDisplayName, isFreeModelId, isProviderReady, readStarredModels, writeStarredModels } from '../../utils/providerUtils';

export interface ModelChipProps {
    providers: ProviderConfig[];
    /** `"<providerId>::<modelId>"`, the same encoding the dock writes. */
    value: string;
    onChange: (value: string) => void;
    onRefreshModels?: () => void | Promise<void>;
    /** Why the chip warns: a stale or unusable pick. It surfaces in the chip's
     *  `title` only — the amber banner under the composer is a separate
     *  component (`ModelFallbackBanner`), not this control. */
    issue?: string | null;
    /** What to name the current pick when nothing in the ready list matches it. */
    fallbackLabel?: string;
}

const ModelChip: React.FC<ModelChipProps> = ({
    providers, value, onChange, onRefreshModels, issue, fallbackLabel,
}) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [starred, setStarred] = useState<string[]>(readStarredModels);
    const toggleStar = (v: string): void => {
        setStarred(prev => {
            const next = prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v];
            writeStarredModels(next);
            return next;
        });
    };
    const readyProviders = providers.filter(isProviderReady);
    const q = query.trim().toLowerCase();
    const sections = readyProviders
        .map(p => ({
            provider: p,
            models: p.models
                .filter(m => !q || m.toLowerCase().includes(q))
                .map(m => ({ value: `${p.id}::${m}`, label: formatModelDisplayName(m), free: isFreeModelId(m) }))
                .sort((a, b) => Number(starred.includes(b.value)) - Number(starred.includes(a.value))),
        }))
        .filter(s => s.models.length > 0);
    const readyModelCount = readyProviders.reduce((n, p) => n + p.models.length, 0);
    const selectedLabel = readyProviders
        .flatMap(p => p.models.map(m => ({ v: `${p.id}::${m}`, label: `${p.name} · ${formatModelDisplayName(m)}` })))
        .find(o => o.v === value)?.label
        ?? fallbackLabel ?? 'Select model';
    const close = (): void => { setOpen(false); setQuery(''); };

    return (
        <div className="relative">
            <button type="button"
                onClick={() => setOpen(v => !v)}
                aria-label={`Model: ${selectedLabel}`}
                aria-expanded={open} aria-haspopup="menu"
                title={issue ? 'Model fallback active — re-pick a model' : 'Model'}
                data-testid="composer-model-chip"
                className="flex max-w-[13rem] items-center gap-1.5 rounded-full border border-white/[0.08] bg-zinc-900/60 px-2.5 py-1 text-ui-dense text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-200">
                <span className="min-w-0 truncate" title={selectedLabel}>{selectedLabel}</span>
                <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-[var(--ease-snappy)] ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <>
                    {/* The invisible-backdrop close the attach menu already uses:
                        a popover you can leave only by picking an item is a trap. */}
                    <div className="fixed inset-0 z-20" aria-hidden onClick={close} />
                    <div
                        className="absolute bottom-8 right-0 z-30 w-64 rounded-bubble border border-white/10 bg-zinc-900 shadow-xl"
                        data-testid="composer-model-menu"
                        role="menu"
                        aria-label="Model"
                        onKeyDown={(e) => {
                            // Contain Escape: unhandled, it bubbles to the
                            // app-level shortcut that CANCELS a running analysis
                            // while merely closing this menu.
                            e.stopPropagation();
                            if (e.key === 'Escape') close();
                        }}
                    >
                        {readyModelCount > 7 && (
                            <div className="p-2 pb-1">
                                <input
                                    value={query}
                                    onChange={ev => setQuery(ev.target.value)}
                                    onKeyDown={e => {
                                        // stopPropagation keeps composer/app
                                        // shortcuts from firing while typing;
                                        // Escape must still close — handled HERE,
                                        // or the input swallows it and the open
                                        // menu blocks the dock.
                                        e.stopPropagation();
                                        if (e.key === 'Escape') close();
                                    }}
                                    placeholder="Search models…"
                                    aria-label="Search models"
                                    className="w-full rounded-control border border-white/10 bg-zinc-800/60 px-2 py-1 text-ui-dense text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                                />
                            </div>
                        )}
                        <div className="custom-scrollbar max-h-[min(45vh,20rem)] overflow-y-auto px-1 pb-1">
                            {sections.map(section => (
                                <div key={section.provider.id}>
                                    <p className="sticky top-0 z-10 bg-zinc-900 px-2 pb-1 pt-2 text-ui-2xs uppercase tracking-widest text-zinc-600">{section.provider.name}</p>
                                    {section.models.map(o => (
                                        <div key={o.value} className={`flex items-center gap-1 rounded-control pr-1.5 transition-colors hover:bg-white/[0.06] ${o.value === value ? 'bg-white/[0.04]' : ''}`}>
                                            <button type="button"
                                                onClick={() => toggleStar(o.value)}
                                                aria-label={starred.includes(o.value) ? `Unstar ${o.label}` : `Star ${o.label}`}
                                                aria-pressed={starred.includes(o.value)}
                                                title={starred.includes(o.value) ? 'Unstar' : 'Star'}
                                                className={`shrink-0 rounded-full p-1 transition-colors hover:text-amber-300 ${starred.includes(o.value) ? 'text-amber-300' : 'text-zinc-600'}`}>
                                                <StarIcon className="h-3 w-3" fill={starred.includes(o.value) ? 'currentColor' : 'none'} aria-hidden="true" />
                                            </button>
                                            <button type="button"
                                                role="menuitemradio"
                                                aria-checked={o.value === value}
                                                onClick={() => { onChange(o.value); close(); }}
                                                title={o.label}
                                                className="flex min-w-0 flex-1 items-center gap-2 rounded-control py-1.5 pr-1 text-left text-ui-dense transition-colors hover:bg-white/[0.04]">
                                                <Check className={`h-3 w-3 shrink-0 ${o.value === value ? 'text-emerald-400' : 'opacity-0'}`} aria-hidden="true" />
                                                <span className="min-w-0 truncate" title={o.label}>{o.label}</span>
                                            </button>
                                            {o.free && (
                                                <span className="shrink-0 rounded-full border border-emerald-500/30 px-1.5 py-px text-ui-2xs uppercase tracking-wider text-emerald-400">free</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ))}
                            {sections.length === 0 && (
                                <p className="px-2 py-3 text-ui-dense text-zinc-600">No models match “{query}”.</p>
                            )}
                            {onRefreshModels && (
                                <button type="button" role="menuitem"
                                    onClick={() => { void onRefreshModels(); close(); }}
                                    className="mt-1 block w-full rounded-control px-2 py-1.5 text-left text-ui-dense text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                                    Refresh model list
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default React.memo(ModelChip);

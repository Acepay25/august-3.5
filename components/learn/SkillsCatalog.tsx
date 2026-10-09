import React, { useEffect, useMemo, useState } from 'react';
import { Check, Lightbulb, Plus, RefreshCw, Search, Settings } from '../shared/Icons';
import {
    listSkills,
    skillEnabledFlag,
    type SkillMeta,
} from '../../services/learning/SkillMemoryService';

/**
 * SkillsCatalog — the reference Customize → Skills screen, on August's own data.
 *
 * WHAT THIS IS NOT: a second place to approve a draft. The skill-draft path is
 * the Coach inbox (`probe-skill-approval.cjs` drives it byte-for-byte), and a
 * sixth approval surface is the exact information-architecture defect the
 * 2026-10-07 audit named. This is a BROWSER: it lists the roster, filters it,
 * and routes elsewhere for anything that changes a belief.
 *
 * Every field rendered here is real, none invented:
 *   name        ← the file slug
 *   description ← `SkillMeta.description`
 *   checkmark   ← `skillEnabledFlag(meta)` — the ONE place `enabled` is derived.
 *                 Suspension is `enabled:false` + `meta.suspendedAt`, NOT a
 *                 fourth `SkillStatus`, so this must never be derived a second
 *                 way or an unrelated attribution write silently un-suspends.
 *   tabs        ← `family` (falling back to `kind`), a real partition of the
 *                 roster. A tab with zero skills is not drawn at all — the
 *                 decorative-group defect this screen exists to avoid.
 */

/** A roster row, flattened for rendering. */
interface CatalogSkill {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    status: SkillMeta['status'];
    wins: number;
    losses: number;
    family: string;
}

/** Family → collection tab label. `kind` is the fallback partition so a roster
 *  with no families at all still gets one honest, non-empty group rather than an
 *  empty tab strip. */
const collectionOf = (meta: SkillMeta): string => meta.family?.trim() || (meta.kind === 'avoid' ? 'Avoid' : 'Repeat');

/** A deterministic tint per collection, from the theme's own ramp. The reference
 *  gives each skill a distinct vivid gradient; August has no per-skill colour
 *  data and inventing six gradients would be decoration with no meaning. The
 *  tile carries an icon on a neutral surface instead. */
const tileClass = (enabled: boolean, kind: SkillMeta['kind']): string => {
    const base = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border';
    if (!enabled) return `${base} border-zinc-800 bg-zinc-900 text-zinc-600`;
    return kind === 'avoid'
        ? `${base} border-rose-500/30 bg-rose-500/10 text-rose-300`
        : `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-300`;
};

export interface SkillsCatalogProps {
    /** Refresh — the gear routes to Settings → Skills. */
    onOpenSettings?: () => void;
    /** Add — opens the real skill-draft path in the Coach inbox. */
    onAddSkill?: () => void;
}

const SkillsCatalog: React.FC<SkillsCatalogProps> = ({ onOpenSettings, onAddSkill }) => {
    const [skills, setSkills] = useState<CatalogSkill[] | null>(null);
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState<string>('all');

    const reload = (): void => {
        try {
            setSkills(listSkills().map(({ file, meta }) => ({
                id: file.id,
                name: file.name,
                description: meta.description ?? '',
                enabled: skillEnabledFlag(meta),
                status: meta.status,
                wins: meta.wins,
                losses: meta.losses,
                family: collectionOf(meta),
            })));
        } catch {
            // A store read failure is not a reason to draw an empty grid that
            // reads as "you have no skills" — leave it null so the empty state
            // says it could not load instead.
            setSkills(null);
        }
    };

    useEffect(reload, []);

    /** Collections that actually hold skills. An empty tab is never drawn. */
    const collections = useMemo(() => {
        const counts = new Map<string, number>();
        for (const s of skills ?? []) counts.set(s.family, (counts.get(s.family) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
    }, [skills]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (skills ?? []).filter(s => {
            if (collection !== 'all' && s.family !== collection) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [skills, query, collection]);

    // The active collection must survive a reload that drops it: pinning a tab
    // whose skills were all retired would render an empty grid that looks broken.
    const activeCollection = collections.some(c => c.label === collection) || collection === 'all'
        ? collection
        : 'all';

    return (
        <section
            className="rounded-control border border-zinc-800/80 bg-zinc-900 p-3"
            data-testid="skills-catalog"
            aria-label="Skill catalog"
        >
            {/* Title block + the reference's top row: search, refresh, gear, Add. */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="font-serif text-ui-xl text-zinc-100">Skills</h3>
                    <p className="mt-0.5 text-ui-dense text-zinc-500">
                        What the desk has learned to do, and what it has learned to avoid.
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="flex h-8 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5">
                        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search skills"
                            aria-label="Search skills"
                            className="w-40 bg-transparent text-ui-dense text-zinc-200 outline-none placeholder:text-zinc-600"
                        />
                    </div>
                    <button type="button" onClick={reload} aria-label="Refresh the skill list" title="Refresh"
                        className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {onOpenSettings && (
                        <button type="button" onClick={onOpenSettings} aria-label="Skill settings" title="Skill settings"
                            className="flex h-8 w-8 hit-target items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                    )}
                    {onAddSkill && (
                        <button type="button" onClick={onAddSkill}
                            className="flex h-8 items-center gap-1 rounded-full bg-zinc-100 px-3 text-ui-dense font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-100">
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            Add
                        </button>
                    )}
                </div>
            </div>

            {/* Segmented collection tabs — a real partition, so no empty groups. */}
            {collections.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Skill collections">
                    <button type="button" role="tab" aria-selected={activeCollection === 'all'}
                        onClick={() => setCollection('all')}
                        className={`rounded-full px-3 py-1 text-ui-dense font-medium transition-colors ${
                            activeCollection === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}>
                        All {(skills ?? []).length}
                    </button>
                    {collections.map(c => (
                        <button key={c.label} type="button" role="tab" aria-selected={activeCollection === c.label}
                            onClick={() => setCollection(c.label)}
                            className={`rounded-full px-3 py-1 text-ui-dense font-medium transition-colors ${
                                activeCollection === c.label ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                            }`}>
                            {c.label} {c.n}
                        </button>
                    ))}
                </div>
            )}

            {/* Section label on a hairline rule that runs to the right edge. */}
            <div className="mt-4 border-t border-zinc-700 pt-2">
                <h4 className="text-ui-dense font-medium text-zinc-200">
                    {activeCollection === 'all' ? 'Installed' : activeCollection}
                </h4>
            </div>

            {skills === null ? (
                <p className="py-6 text-center text-ui-dense text-zinc-500" data-testid="skills-catalog-error">
                    The skill library could not be read.
                </p>
            ) : shown.length === 0 ? (
                <p className="py-6 text-center text-ui-dense text-zinc-600" data-testid="skills-catalog-empty">
                    {query.trim() ? `No skill matches “${query.trim()}”.` : 'No skills yet.'}
                </p>
            ) : (
                <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="skills-catalog-grid">
                    {shown.map(s => (
                        <li key={s.id} className="flex items-center gap-3 py-1.5" data-testid="skills-catalog-card">
                            <span className={tileClass(s.enabled, s.status === 'retired' ? 'avoid' : 'repeat')} aria-hidden="true">
                                <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-ui-dense font-semibold text-zinc-100" title={s.name}>
                                    {s.name}
                                </span>
                                <span className="block truncate text-ui-dense text-zinc-500" title={s.description || undefined}>
                                    {s.description || (s.status === 'retired' ? 'Retired' : 'No description')}
                                </span>
                            </span>
                            {s.enabled ? (
                                <Check className="h-4 w-4 shrink-0 text-zinc-400" aria-label="Enabled" />
                            ) : (
                                <span className="shrink-0 text-ui-2xs text-zinc-600" title="Not injected — disabled or suspended">
                                    off
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default React.memo(SkillsCatalog);

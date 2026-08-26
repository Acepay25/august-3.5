import React, { useState, useEffect } from 'react';
import { setSkillStatus, parseSkillMarkdown } from '../../services/learning/SkillMemoryService';
import { getMemoryFiles, subscribeMemoryFilesChanged } from '../../services/learning/MemoryFilesService';
import type { SkillMeta } from '../../services/learning/SkillMemoryService';
import MarkdownContent from '../shared/MarkdownContent';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { ChevronLeftIcon } from '../shared/Icons';
import { PinIcon, MessageSquarePlus } from 'lucide-react';

/**
 * ROUND-39 UI: "Try in chat" — drops the skill's /slug into the composer.
 * ChatInput listens for this event and prepends the marker; App closes the
 * settings surface so the user lands back on the chat with the text ready.
 */
export const trySkillInChat = (slug: string): void => {
    window.dispatchEvent(new CustomEvent('august:try-skill', { detail: { slug } }));
};

/**
 * SkillsGrid (ROUND-33) — every skill as a card in a responsive grid,
 * modeled on Claude desktop's plugin gallery: rounded monogram tile, name,
 * one-line description, status badges, hover action icons. Clicking a card
 * opens the skill detail (meta panel + full instructions), same pattern as
 * the reference gallery. Monochrome zinc; confirmed/retired carry meaning
 * through the existing badge vocabulary.
 */

interface SkillCardData {
    fileId: string;
    name: string;
    meta: SkillMeta | null;
    body: string;
}

/** Two-letter monogram for the card tile ("Avoid BTC…" → "AB"). */
const monogramOf = (name: string): string => {
    const cleaned = name.replace(/^(avoid|repeat)[-_ ]?/i, '');
    const words = cleaned.split(/[-_\s]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return cleaned.slice(0, 2).toUpperCase() || 'SK';
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
    candidate: { label: 'CANDIDATE', className: 'bg-zinc-800 text-zinc-400' },
    confirmed: { label: 'CONFIRMED', className: 'bg-emerald-950/60 text-emerald-400' },
    retired: { label: 'RETIRED', className: 'bg-zinc-900 text-zinc-600 line-through' },
};

const KIND_BADGE: Record<string, { label: string; className: string }> = {
    avoid: { label: 'AVOID', className: 'bg-rose-950/50 text-rose-400/90' },
    repeat: { label: 'REPEAT', className: 'bg-zinc-800 text-zinc-300' },
};

/** First prose line of the skill body, used as the card/detail description. */
const descriptionOf = (body: string): string =>
    body
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0 && !l.startsWith('#')) ?? '';

const SkillsCard: React.FC<{
    skill: SkillCardData;
    pinned: boolean;
    onTogglePin: () => void;
    onToggleRetire: () => void;
    onOpen: () => void;
}> = ({ skill, pinned, onTogglePin, onToggleRetire, onOpen }) => {
    const retired = skill.meta?.status === 'retired';
    const statusBadge = STATUS_BADGE[skill.meta?.status ?? 'candidate'] ?? STATUS_BADGE.candidate;
    const kindBadge = KIND_BADGE[skill.meta?.kind ?? 'avoid'] ?? KIND_BADGE.avoid;
    const wins = Math.round(skill.meta?.wins ?? 0);
    const losses = Math.round(skill.meta?.losses ?? 0);
    const sample = wins + losses;
    const description = descriptionOf(skill.body);

    return (
        <div
            data-skill-card
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
            className={`group relative flex cursor-pointer flex-col gap-2 rounded-2xl border border-transparent bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700/60 focus-visible:border-zinc-600 focus-visible:outline-none ${
                retired ? 'opacity-55' : ''
            }`}
        >
            <div className="flex items-center gap-3">
                <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-[11px] font-bold tracking-wider text-zinc-300"
                >
                    {monogramOf(skill.name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-100" title={skill.name}>
                    {skill.name}
                </span>
            </div>

            <p className="line-clamp-2 min-h-[2em] text-[11px] leading-relaxed text-zinc-500">
                {description || 'No body text.'}
            </p>

            <div className="mt-auto flex items-center gap-1.5 pt-1">
                <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${statusBadge.className}`}>
                    {statusBadge.label}
                </span>
                {!retired && (
                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${kindBadge.className}`}>
                        {kindBadge.label}
                    </span>
                )}
                {sample > 0 && (
                    <span className="ml-auto font-mono text-[9px] text-zinc-600" title={`${wins}W / ${losses}L`}>
                        {wins}W·{losses}L
                    </span>
                )}
            </div>

            {/* Hover actions — try-in-chat + pin + retire/restore, right-aligned
                like the reference's kebab row. The toggle mirrors the reference
                card's inline On/Off switch. */}
            <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {!retired && (
                    <button
                        type="button"
                        title="Try in chat"
                        aria-label={`Try ${skill.name} in chat`}
                        onClick={e => { e.stopPropagation(); trySkillInChat(skill.name); }}
                        className="rounded-md p-1 text-zinc-600 hover:text-zinc-200"
                    >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                    </button>
                )}
                <button
                    type="button"
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    onClick={e => { e.stopPropagation(); onTogglePin(); }}
                    className={`rounded-md p-1 ${pinned ? 'text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                    <PinIcon className="h-3.5 w-3.5" />
                </button>
                <div onClick={e => e.stopPropagation()}>
                    <ToggleSwitch checked={!retired} onChange={onToggleRetire} label={`Toggle ${skill.name} active`} />
                </div>
            </div>
        </div>
    );
};

const MetaField: React.FC<{ label: string; value: string; wide?: boolean }> = ({ label, value, wide }) => (
    <div className={wide ? 'col-span-2' : ''}>
        <p className="text-[10px] uppercase tracking-widest text-zinc-600">{label}</p>
        <p className="mt-0.5 text-xs font-medium text-zinc-300">{value}</p>
    </div>
);

/** Detail pane for one skill — meta panel + full instructions, like the
 *  reference gallery's skill page. */
const SkillDetail: React.FC<{
    skill: SkillCardData;
    onBack: () => void;
    onToggleRetire: () => void;
}> = ({ skill, onBack, onToggleRetire }) => {
    const meta = skill.meta;
    const retired = meta?.status === 'retired';
    const wins = Math.round(meta?.wins ?? 0);
    const losses = Math.round(meta?.losses ?? 0);
    const refined = Boolean(meta?.previousVersion && meta?.refinedAt);

    return (
        <div className="flex h-full min-h-0 flex-col animate-fade-in">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-1.5 self-start pb-5 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
                <ChevronLeftIcon className="h-4 w-4" /> Skills
            </button>

            <div className="flex items-start justify-between gap-4 pb-5">
                <div className="min-w-0">
                    <h3 className="truncate text-xl font-bold tracking-tight text-zinc-100">{skill.name}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                        {descriptionOf(skill.body) || 'No description.'}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 pt-1">
                    <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                        {retired ? 'Retired' : 'Active'}
                    </span>
                    <ToggleSwitch checked={!retired} onChange={onToggleRetire} label={`Toggle ${skill.name} active`} />
                </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <MetaField label="Status" value={meta?.status ?? 'candidate'} />
                <MetaField label="Kind" value={meta?.kind ?? '—'} />
                <MetaField label="Setup" value={[meta?.coin, meta?.direction].filter(Boolean).join(' ') || '—'} />
                <MetaField label="Evidence" value={`${wins}W / ${losses}L`} />
                <MetaField label="Trigger" value={meta?.ifCondition || '—'} wide />
            </div>

            {refined && meta?.previousVersion && (
                <div className="mt-4 shrink-0 space-y-1 rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-mono text-[11px] leading-5">
                    <p className="text-zinc-500">
                        Refined {new Date(meta.refinedAt!).toLocaleString()} after {meta.consecutiveLosses === 0 ? 'consecutive losses' : `${meta.consecutiveLosses} consecutive losses`}
                    </p>
                    {meta.previousVersion.ifCondition !== meta.ifCondition && (
                        <div>
                            <p className="text-zinc-600 line-through">IF {meta.previousVersion.ifCondition || '—'}</p>
                            <p className="text-zinc-200">IF {meta.ifCondition || '—'}</p>
                        </div>
                    )}
                    {meta.previousVersion.thenAction !== meta.thenAction && (
                        <div>
                            <p className="text-zinc-600 line-through">THEN {meta.previousVersion.thenAction || '—'}</p>
                            <p className="text-zinc-200">THEN {meta.thenAction || '—'}</p>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                <div className="shrink-0 border-b border-zinc-800 px-4 py-3 text-xs font-bold text-zinc-300">
                    Instructions
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
                    <MarkdownContent content={skill.body || '(empty skill)'} className="text-[13px] leading-6" />
                </div>
            </div>
        </div>
    );
};

const SkillsGrid: React.FC = () => {
    const [skills, setSkills] = useState<SkillCardData[]>([]);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

    const refresh = (): void => {
        const files = getMemoryFiles().files.filter(f =>
            f.name.toLowerCase().endsWith('.md')
            && f.content.includes('---')
            && parseSkillMarkdown(f.content) !== null,
        );
        setSkills(files.map(f => ({
            fileId: f.id,
            name: f.name.replace(/\.md$/i, ''),
            meta: parseSkillMarkdown(f.content),
            body: f.content.split(/^---\s*$/m).slice(2).join('---').trim(),
        })));
    };

    useEffect(() => {
        refresh();
        return subscribeMemoryFilesChanged(refresh);
    }, []);

    const visible = skills
        .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => {
            // Pinned float to the top; retired sink to the bottom; then by
            // evidence sample desc.
            const pa = pinnedIds.has(a.fileId) ? 0 : 1;
            const pb = pinnedIds.has(b.fileId) ? 0 : 1;
            if (pa !== pb) return pa - pb;
            const ra = a.meta?.status === 'retired' ? 1 : 0;
            const rb = b.meta?.status === 'retired' ? 1 : 0;
            if (ra !== rb) return ra - rb;
            const sa = (a.meta?.wins ?? 0) + (a.meta?.losses ?? 0);
            const sb = (b.meta?.wins ?? 0) + (b.meta?.losses ?? 0);
            return sb - sa;
        });

    const selected = selectedId ? skills.find(s => s.fileId === selectedId) ?? null : null;

    const toggleRetire = (s: SkillCardData): void => {
        const next = s.meta?.status === 'retired' ? 'candidate' : 'retired';
        void setSkillStatus(s.fileId, next).then(refresh);
    };

    const togglePin = (fileId: string): void => {
        setPinnedIds(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) next.delete(fileId);
            else next.add(fileId);
            return next;
        });
    };

    if (selected) {
        return (
            <SkillDetail
                skill={selected}
                onBack={() => setSelectedId(null)}
                onToggleRetire={() => toggleRetire(selected)}
            />
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col animate-fade-in">
            <div className="shrink-0 pb-4">
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search skills…"
                    className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
                />
            </div>
            {visible.length === 0 ? (
                <p className="py-10 text-center text-xs text-zinc-600">
                    {skills.length === 0 ? 'No skills yet — they form automatically from your post-mortems.' : 'No skills match that search.'}
                </p>
            ) : (
                <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto custom-scrollbar pb-6 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map(s => (
                        <SkillsCard
                            key={s.fileId}
                            skill={s}
                            pinned={pinnedIds.has(s.fileId)}
                            onTogglePin={() => togglePin(s.fileId)}
                            onToggleRetire={() => toggleRetire(s)}
                            onOpen={() => setSelectedId(s.fileId)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default SkillsGrid;

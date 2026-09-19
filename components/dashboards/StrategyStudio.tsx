/**
 * StrategyStudio — the single home for the harness's strategy library (seeded
 * playbooks, learned skills, imported .md). It merges the old Settings → Skills
 * grid's management (pin, retire, import, the learning-queue proposals, and the
 * full detail pane with prove-on-history + manual A/B eval) with the Studio's
 * read-only analytics (family + regime edge, attribution lift). It is still a
 * PRESENTATION layer over data that already exists — nothing here recomputes or
 * mutates the learning loop; management writes go through the same
 * SkillMemoryService / MemoryFilesService the pipeline reads.
 *   - listSkills()             → every skills/*.md (seed prior + learned)
 *   - computeAllSkillLifts()   → per-skill attribution lift (post − pre WR)
 *   - familyRegimeEdge()       → the family × regime win-rate matrix cell
 *   - classifyStrategyFamily() → the controlled family a skill trades
 *
 * Theme (AGENTS.md): zinc surfaces throughout; semantic color is limited to
 * the emerald/rose/amber edge verdicts and the candidate/confirmed/retired
 * badges, which is what the global dark theme already means by those hues.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoggedTrade } from '../../types';
import { listSkills, titleFromMeta, type SkillMeta } from '../../services/learning/SkillMemoryService';
import { computeAllSkillLifts, type SkillLiftResult } from '../../services/learning/MemoryProvenanceService';
import { familyRegimeEdge, matrixSummaryBlock, hydrateStrategyRegimeMatrix, getStrategyRegimeMatrixSnapshot, MATRIX_REGIMES, MATRIX_MIN_SAMPLES, type MatrixCell, type StrategyRegimeMatrix } from '../../services/learning/strategyRegimeMatrix';
import { classifyStrategyFamily } from '../../utils/strategyFamily';
import { normalizeStrategyFamily, STRATEGY_FAMILIES, type StrategyFamily } from '../../types/strategy';
import { getActiveUsername } from '../../utils/activeUser';
import { importSkillFiles, readSkillFiles } from '../../services/learning/SkillImportService';
import { subscribeMemoryFilesChanged } from '../../services/learning/MemoryFilesService';
import { consumePendingSkillOpen } from '../chat/skillDeepLink';
import { useToastActions } from '../shared/Toast';
import type { ProviderConfig } from '../../types/provider';
import SkillDetail, {
    type SkillCardData, monogramOf, descriptionOf, STATUS_BADGE, KIND_BADGE,
    trySkillInChat, toggleSkillRetire, PIN_STORAGE_KEY,
} from '../skills/SkillDetail';
import LearningQueuePanel from '../skills/LearningQueuePanel';
import { Grid3x3, Pin, Upload } from 'lucide-react';

interface StrategyStudioProps {
    trades: LoggedTrade[];
    username?: string;
    /** Current market regime (from hybrid) — drives the family-edge tilt. */
    currentRegime?: string;
    /** Seat used by the manual A/B eval (the same one Settings → Memory uses). */
    memoryConfig?: ProviderConfig | null;
    onClose?: () => void;
}

/** A skill's controlled family: canonical when stored, else a keyword
 *  classification of its pattern family + body (the same derivation the
 *  schema boundary applies, so the Studio and retrieval never disagree). */
const skillFamily = (meta: SkillMeta): StrategyFamily | undefined =>
    normalizeStrategyFamily(meta.strategyFamily, classifyStrategyFamily)
    ?? classifyStrategyFamily(`${meta.family ?? ''} ${meta.body ?? ''}`);

const edgeTone = (edge: { winRate: number; samples: number } | null): string => {
    if (!edge) return 'text-zinc-500';
    if (edge.samples < 8) return 'text-zinc-500';   // thin — not trustworthy
    if (edge.winRate >= 0.6) return 'text-emerald-400';
    if (edge.winRate <= 0.4) return 'text-rose-400';
    return 'text-zinc-300';
};

/** Raw markdown body with the frontmatter fence stripped (the detail pane's
 *  Instructions section renders this). */
const bodyOf = (content: string): string => content.split(/^---\s*$/m).slice(2).join('---').trim();

/** How full a heatmap cell is: hue from the edge, alpha from the edge AND the
 *  evidence weight, so a 9-trade 78% stays visibly fainter than a 60-trade
 *  78%. Both hues come from the theme tokens, never a literal hex. */
const cellTint = (cell: MatrixCell): React.CSSProperties => {
    const n = cell.w + cell.l;
    if (n === 0) return {};
    const edge = cell.w / n - 0.5;
    const hue = edge >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)';
    const strength = Math.min(0.34, Math.abs(edge) * 0.8 + 0.05);
    const weight = 0.35 + 0.65 * Math.min(1, n / 20);
    return { background: `color-mix(in srgb, ${hue} ${Math.round(strength * weight * 100)}%, transparent)` };
};

/** Family × regime win-rate heatmap. The matrix already drives retrieval
 *  ranking and the moderator's prompt; this is the same data made scannable,
 *  so the trader can see WHICH playbook the tape currently favors without
 *  reading a paragraph. The live regime's column is outlined for that reason. */
export const RegimeMatrixStrip: React.FC<{
    matrix: StrategyRegimeMatrix;
    currentRegime?: string;
}> = ({ matrix, currentRegime }) => {
    const rows = useMemo(() => {
        const out: Array<{ family: StrategyFamily; cells: Array<MatrixCell | null>; samples: number }> = [];
        for (const family of STRATEGY_FAMILIES) {
            const byRegime = matrix[family];
            if (!byRegime) continue;
            const cells = MATRIX_REGIMES.map(r => byRegime[r] ?? null);
            const samples = cells.reduce((n, c) => n + (c ? c.w + c.l : 0), 0);
            if (samples > 0) out.push({ family, cells, samples });
        }
        return out.sort((a, b) => b.samples - a.samples);
    }, [matrix]);
    if (rows.length === 0) return null;
    return (
        <div className="border-b border-white/5 px-5 py-2.5" data-testid="regime-matrix">
            <div className="mb-1.5 flex items-center gap-1.5">
                <Grid3x3 className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden="true" />
                <span className="ui-kicker">Family edge by regime</span>
                <span className="text-[10px] text-zinc-600">· tint = win rate, opacity = evidence</span>
            </div>
            <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `minmax(96px, 1.6fr) repeat(${MATRIX_REGIMES.length}, minmax(0, 1fr))` }}
            >
                <span aria-hidden="true" />
                {MATRIX_REGIMES.map(r => (
                    <span
                        key={r}
                        className={`rounded-control px-1 pb-0.5 text-center text-[9px] font-bold uppercase tracking-wider ${
                            r === currentRegime ? 'text-cyan-400' : 'text-zinc-600'
                        }`}
                    >
                        {r}
                    </span>
                ))}
                {rows.map(row => (
                    <React.Fragment key={row.family}>
                        <span className="self-center truncate text-[11px] text-zinc-400">
                            {row.family.replace(/_/g, ' ')}
                        </span>
                        {row.cells.map((cell, i) => {
                            const regime = MATRIX_REGIMES[i];
                            const n = cell ? cell.w + cell.l : 0;
                            const thin = n > 0 && n < MATRIX_MIN_SAMPLES;
                            const isLive = regime === currentRegime;
                            return (
                                <span
                                    key={regime}
                                    title={cell
                                        ? `${row.family} · ${regime}: ${cell.w}W/${cell.l}L (${Math.round((cell.w / n) * 100)}%)${thin ? ' — thin sample' : ''}`
                                        : `${row.family} · ${regime}: no settled trades`}
                                    className={`rounded-control px-1 py-1 text-center font-mono text-[11px] tabular-nums ring-1 ring-inset transition-colors ${
                                        cell
                                            ? cell.w / n >= 0.5 ? 'text-emerald-400' : 'text-rose-400'
                                            : 'text-zinc-700'
                                    } ${isLive ? 'ring-cyan-500/30' : cell ? (thin ? 'ring-white/[0.04]' : 'ring-white/[0.08]') : 'ring-transparent'}`}
                                    style={cell ? cellTint(cell) : undefined}
                                >
                                    {cell ? `${Math.round((cell.w / n) * 100)}%` : '·'}
                                </span>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

const readPins = (): Set<string> => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PIN_STORAGE_KEY) : null;
        return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
        return new Set<string>();
    }
};

const StrategyStudio: React.FC<StrategyStudioProps> = ({ trades, username, currentRegime, memoryConfig, onClose }) => {
    const toast = useToastActions();
    React.useEffect(() => {
        const user = username || getActiveUsername();
        void hydrateStrategyRegimeMatrix(user);
    }, [username]);

    const [query, setQuery] = useState('');
    const [familyFilter, setFamilyFilter] = useState<StrategyFamily | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<SkillMeta['status'] | 'all'>('all');
    const [isImporting, setIsImporting] = useState(false);
    const [skills, setSkills] = useState<SkillCardData[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pinnedIds, setPinnedIds] = useState<Set<string>>(readPins);
    const skillsRef = useRef<SkillCardData[]>([]);
    skillsRef.current = skills;

    const refresh = useCallback((): void => {
        setSkills(listSkills().map(({ file, meta }) => ({
            fileId: file.id,
            name: file.name.replace(/\.md$/i, ''),
            meta,
            body: bodyOf(file.content),
        })));
    }, []);

    // Live: the notebook (and thus skills/) can change from a post-mortem, a
    // supervisor approval, or an import elsewhere — resync the library.
    useEffect(() => {
        refresh();
        return subscribeMemoryFilesChanged(refresh);
    }, [refresh]);

    useEffect(() => {
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(Array.from(pinnedIds)));
        } catch { /* quota errors never break the library */ }
    }, [pinnedIds]);

    // Deep link from a skill-citation chip in the transcript: open that skill.
    // The chip fires the event and mounts the surface on the same tick, so also
    // consume the pending slug once the list exists.
    useEffect(() => {
        const openBySlug = (slug: string): void => {
            const base = slug.replace(/\.md$/i, '');
            const hit = skillsRef.current.find(s => s.name === base);
            if (hit) setSelectedId(hit.fileId);
        };
        const pending = consumePendingSkillOpen();
        if (pending && skills.length > 0) openBySlug(pending);
        const onOpen = (e: Event): void => {
            const detail = (e as CustomEvent<{ slug?: string }>).detail;
            if (detail?.slug) openBySlug(detail.slug);
        };
        window.addEventListener('august:open-skill', onOpen);
        return () => window.removeEventListener('august:open-skill', onOpen);
    }, [skills.length]);

    const lifts = useMemo<SkillLiftResult[]>(() => computeAllSkillLifts(trades), [trades]);
    const liftByName = useMemo(() => {
        const m = new Map<string, SkillLiftResult>();
        for (const l of lifts) m.set(l.name, l);
        return m;
    }, [lifts]);
    // Reads the service's module cache; `lifts` re-keys it so the strip
    // refreshes whenever settled trades change (hydration is async elsewhere).
    const regimeMatrix = useMemo<StrategyRegimeMatrix>(
        () => getStrategyRegimeMatrixSnapshot(),
        [lifts, currentRegime],
    );
    const matrixLine = useMemo(() => matrixSummaryBlock(currentRegime, 400), [currentRegime]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return skills
            .filter(s => {
                const meta = s.meta;
                if (!meta) return false;
                if (statusFilter !== 'all' && meta.status !== statusFilter) return false;
                if (familyFilter !== 'all' && skillFamily(meta) !== familyFilter) return false;
                if (!q) return true;
                const hay = `${s.name} ${meta.description ?? ''} ${meta.coin ?? ''} ${meta.family ?? ''}`.toLowerCase();
                return hay.includes(q);
            })
            .sort((a, b) => {
                const pa = pinnedIds.has(a.fileId) ? 0 : 1;
                const pb = pinnedIds.has(b.fileId) ? 0 : 1;
                if (pa !== pb) return pa - pb;
                // Confirmed first, then most evidence, then newest; retired sinks.
                const rank = (m: SkillMeta): number => (m.status === 'confirmed' ? 2 : m.status === 'candidate' ? 1 : 0);
                const ra = a.meta?.status === 'retired' ? 1 : 0;
                const rb = b.meta?.status === 'retired' ? 1 : 0;
                if (ra !== rb) return ra - rb;
                return rank(b.meta!) - rank(a.meta!)
                    || (b.meta!.wins + b.meta!.losses) - (a.meta!.wins + a.meta!.losses);
            });
    }, [skills, query, statusFilter, familyFilter, pinnedIds]);

    const selected = selectedId ? skills.find(s => s.fileId === selectedId) ?? null : null;

    const toggleRetire = (s: SkillCardData): void => {
        void toggleSkillRetire(s).then(refresh);
    };
    const togglePin = (fileId: string): void => {
        setPinnedIds(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) next.delete(fileId);
            else next.add(fileId);
            return next;
        });
    };

    const onImportFiles = async (picked: FileList | null): Promise<void> => {
        if (!picked || picked.length === 0 || isImporting) return;
        setIsImporting(true);
        try {
            const read = await readSkillFiles(picked);
            const files = read.filter(f => f.content !== undefined) as Array<{ name: string; content: string }>;
            const readErrors = read.filter(f => f.error !== undefined) as Array<{ name: string; error: string }>;
            const result = await importSkillFiles(files);
            if (result.imported.length > 0) {
                toast.success('Skills imported', `${result.imported.length} file${result.imported.length === 1 ? '' : 's'} added — the models can use them in debates now.`);
            }
            for (const fail of result.failed) toast.error(`Import failed: ${fail.name}`, fail.reason);
            for (const fail of readErrors) toast.error(`Import failed: ${fail.name}`, fail.error);
            if (result.skipped.length > 0) {
                toast.info('Duplicates skipped', `${result.skipped.length} file${result.skipped.length === 1 ? '' : 's'} already learned (same trigger).`);
            }
        } catch (err) {
            toast.error('Import failed', err instanceof Error ? err.message : 'Could not read the files.');
        } finally {
            setIsImporting(false);
            refresh();
        }
    };

    if (selected) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-zinc-950 px-5 py-4 text-zinc-100">
                <div className="min-h-0 flex-1">
                    <SkillDetail
                        skill={selected}
                        backLabel="Library"
                        onBack={() => setSelectedId(null)}
                        onToggleRetire={() => toggleRetire(selected)}
                        memoryConfig={memoryConfig}
                        loggedTrades={trades}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
            <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
                <div>
                    <h2 className="font-serif text-[17px] tracking-tight text-zinc-100">Strategy Studio</h2>
                    <p className="text-[11px] text-zinc-500">{skills.length} playbooks · browse, filter, prove, and try them in chat</p>
                </div>
                {onClose && (
                    <button type="button" onClick={onClose} className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700">
                        Back to Chat
                    </button>
                )}
            </div>

            {/* Toolbar: search + filters + import. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-5 py-2.5">
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search playbooks, coins, families…"
                    className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none"
                />
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as SkillMeta['status'] | 'all')}
                    className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-[11px] uppercase tracking-wide text-zinc-300 focus:outline-none"
                >
                    <option value="all">Any status</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="candidate">Candidate</option>
                    <option value="retired">Retired</option>
                </select>
                <select
                    value={familyFilter}
                    onChange={e => setFamilyFilter(e.target.value as StrategyFamily | 'all')}
                    className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-[11px] uppercase tracking-wide text-zinc-300 focus:outline-none"
                >
                    <option value="all">Any family</option>
                    {STRATEGY_FAMILIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                </select>
                <label
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                    title="Import skill .md files — they must carry valid skill frontmatter"
                >
                    {isImporting
                        ? 'Importing…'
                        : <><Upload className="h-3 w-3" aria-hidden="true" />Import</>}
                    <input
                        type="file"
                        accept=".md,text/markdown,text/plain"
                        multiple
                        data-testid="skills-import-input"
                        className="hidden"
                        onChange={e => { const picked = e.target.files; e.target.value = ''; void onImportFiles(picked); }}
                    />
                </label>
            </div>

            {/* Regime×family matrix. The heatmap is the primary read once any
                family has evidence; the moderator's prose block covers the same
                tally, so it only stands in while the matrix is still empty. */}
            <RegimeMatrixStrip matrix={regimeMatrix} currentRegime={currentRegime} />
            {matrixLine && Object.keys(regimeMatrix).length === 0 && (
                <div className="border-b border-white/5 px-5 py-2 text-[11px] leading-5 text-zinc-500">
                    {matrixLine}
                </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
                {/* The proposals side of the learning loop — "the gate
                    proposes, the inbox disposes." Self-hides when empty. */}
                <LearningQueuePanel />
                {rows.length === 0 ? (
                    <p className="text-xs italic text-zinc-600">
                        {skills.length === 0
                            ? 'No playbooks yet — they form automatically from your post-mortems, or import skill .md files above.'
                            : 'No playbooks match — clear the filters, or close trades with post-mortems to grow skill memory.'}
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {rows.map(s => {
                            const meta = s.meta!;
                            const fam = skillFamily(meta);
                            const edge = fam ? familyRegimeEdge(fam, currentRegime) : null;
                            const slug = s.name;
                            const lift = liftByName.get(`${slug}.md`) ?? liftByName.get(slug);
                            const retired = meta.status === 'retired';
                            const statusBadge = STATUS_BADGE[meta.status] ?? STATUS_BADGE.candidate;
                            const kindBadge = KIND_BADGE[meta.kind ?? 'avoid'] ?? KIND_BADGE.avoid;
                            const sample = Math.round(meta.wins + meta.losses);
                            const pinned = pinnedIds.has(s.fileId);
                            return (
                                <div
                                    key={s.fileId}
                                    data-skill-card
                                    onClick={() => setSelectedId(s.fileId)}
                                    className={`group flex cursor-pointer flex-col rounded-xl border border-white/10 bg-zinc-900/60 p-3 transition-colors hover:border-zinc-600/70 ${retired ? 'opacity-55' : ''}`}
                                >
                                    <div className="mb-1.5 flex items-start gap-2">
                                        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-[10px] font-bold tracking-wider text-zinc-300">
                                            {monogramOf(s.name)}
                                        </span>
                                        <h3 className="min-w-0 flex-1 truncate pt-1 text-[13px] font-semibold text-zinc-100" title={titleFromMeta(meta)}>
                                            {titleFromMeta(meta)}
                                        </h3>
                                        <span className={` shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusBadge.className}`}>
                                            {meta.status}
                                        </span>
                                    </div>
                                    <p className="mb-2 line-clamp-2 min-h-[2.4em] text-[11px] leading-4 text-zinc-500">
                                        {meta.description || descriptionOf(s.body) || slug}
                                    </p>
                                    <div className="mb-2 flex flex-wrap gap-1">
                                        <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{kindBadge.label}</span>
                                        {meta.coin && <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{meta.coin}</span>}
                                        {meta.direction && <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{meta.direction}</span>}
                                        {fam && <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{fam.replace(/_/g, ' ')}</span>}
                                    </div>
                                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-2">
                                        <span data-testid={`studio-wl-${slug}`} className="text-[11px] font-semibold tabular-nums text-zinc-300" title={`${meta.wins}W / ${meta.losses}L`}>
                                            {Math.round(meta.wins)}W {Math.round(meta.losses)}L
                                            <span className="ml-1 text-[10px] font-normal text-zinc-600">n={sample}</span>
                                        </span>
                                        <span className={`text-[11px] tabular-nums ${edgeTone(edge)}`} title={edge ? `${currentRegime ?? 'regime'} family edge ${Math.round(edge.winRate * 100)}% over ${edge.samples}` : 'no regime evidence'}>
                                            {edge && edge.samples >= 8 ? `edge ${Math.round(edge.winRate * 100)}%` : '—'}
                                        </span>
                                        {lift?.lift !== null && lift?.lift !== undefined && (
                                            <span className="text-[11px] tabular-nums text-zinc-400" title={`Attribution lift (post − pre win rate): ${lift.verdict}`}>
                                                lift {lift.lift >= 0 ? '+' : ''}{Math.round(lift.lift)}pt
                                            </span>
                                        )}
                                    </div>
                                    {/* Management row: try / pin / retire / open. */}
                                    <div className="mt-2 flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={e => { e.stopPropagation(); trySkillInChat(slug); onClose?.(); }}
                                            className="flex-1 rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                                        >
                                            Try in chat
                                        </button>
                                        <button
                                            type="button"
                                            title={pinned ? 'Unpin' : 'Pin to top'}
                                            aria-label={pinned ? `Unpin ${s.name}` : `Pin ${s.name} to top`}
                                            onClick={e => { e.stopPropagation(); togglePin(s.fileId); }}
                                            className={`rounded-lg border px-2 py-1.5 ${pinned ? 'border-white/20 bg-zinc-700 text-zinc-100' : 'border-white/10 bg-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                                        >
                                            <Pin className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            title={retired ? 'Restore' : 'Retire'}
                                            aria-label={retired ? `Restore ${s.name}` : `Retire ${s.name}`}
                                            onClick={e => { e.stopPropagation(); toggleRetire(s); }}
                                            className="rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-zinc-500 hover:text-zinc-200"
                                        >
                                            {retired ? '↺' : '⏻'}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Open ${s.name}`}
                                            title="Open details"
                                            onClick={e => { e.stopPropagation(); setSelectedId(s.fileId); }}
                                            className="rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-zinc-500 hover:text-zinc-200"
                                        >
                                            →
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(StrategyStudio);

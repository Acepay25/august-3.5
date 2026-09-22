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
 *
 * WS-5.1: the library is a FILTERABLE TABLE, not a tile grid. Skill rows are
 * tabular data (status, W/L, verdict, origin, dates), and the doctrine is
 * explicit — "tables over tiles where data is tabular". One row per playbook,
 * disclosure in the detail pane; below md/lg/xl the least important columns
 * drop out, and the frame scrolls as the last resort so the page never breaks.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoggedTrade } from '../../types';
import { listSkills, titleFromMeta, skillExpectancyR, EXPECTANCY_MIN_R_SAMPLE, type SkillMeta } from '../../services/learning/SkillMemoryService';
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
    type SkillCardData, descriptionOf, STATUS_BADGE, KIND_BADGE,
    trySkillInChat, toggleSkillRetire, deleteSkillFile, PIN_STORAGE_KEY,
} from '../skills/SkillDetail';
import StatusPill, { type PillTone } from '../ui/StatusPill';
import { ChevronRight, Grid3x3, Pin, PowerOff, RotateCcw, Trash2, Upload } from 'lucide-react';

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

/** The status column's tone. Confirmed is the only earned green — candidate
 *  and retired are both "not in play yet", which is the neutral chip, with
 *  retired struck through (the same reading STATUS_BADGE gives the detail
 *  pane; the pill itself is the shared component, not a hand-rolled triple). */
const statusTone = (status: SkillMeta['status']): PillTone =>
    (status === 'confirmed' ? 'up' : 'neutral');

/** The latest automated A/B verdict, in the theme's one meaning per hue:
 *  helps = gain, hurts = loss, mixed = caution, inconclusive = no read. */
const VERDICT_TONE: Record<NonNullable<SkillMeta['evalVerdict']>, PillTone> = {
    helps: 'up',
    hurts: 'down',
    mixed: 'warn',
    inconclusive: 'neutral',
};

/** Short, sortable-looking date for the evidence columns. The full ISO
 *  timestamp rides in the cell's title, so nothing is lost to the abbreviation. */
const fmtDay = (iso: string | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Shared cell chrome: one line of data, hairline-separated, no card inside. */
const TH = 'whitespace-nowrap px-3 py-2 text-left text-ui-xs font-bold uppercase tracking-wider text-zinc-600';
const TD = 'whitespace-nowrap px-3 py-2 align-middle';
const ACTION_BTN = 'inline-flex shrink-0 items-center justify-center gap-1 rounded-control border border-transparent px-1.5 py-1 text-[11px] transition-colors duration-[120ms] ease-[var(--ease-snappy)] hover:bg-white/[0.06] focus:outline-none';

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
                <span className="text-ui-xs text-zinc-600">· tint = win rate, opacity = evidence</span>
            </div>
            <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `minmax(96px, 1.6fr) repeat(${MATRIX_REGIMES.length}, minmax(0, 1fr))` }}
            >
                <span aria-hidden="true" />
                {MATRIX_REGIMES.map(r => (
                    <span
                        key={r}
                        className={`rounded-control px-1 pb-0.5 text-center text-ui-2xs font-bold uppercase tracking-wider ${
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
    /** The ONE row whose delete button is armed (WS-5.1). Row-level delete is
     *  a two-step, exactly like the detail pane's own: the first click arms
     *  that row, the second click on the same row erases the file. */
    const [armedDelete, setArmedDelete] = useState<string | null>(null);
    const skillsRef = useRef<SkillCardData[]>([]);
    skillsRef.current = skills;

    const refresh = useCallback((): void => {
        // Any list change drops a pending row delete: the row the operator
        // armed may literally not be the row in front of them now.
        setArmedDelete(null);
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
    // WS-2.3: the supervisor approves, the human can still erase. Back out of
    // the detail pane first — the file it described no longer exists.
    const removeSkill = (s: SkillCardData): void => {
        void deleteSkillFile(s).then(() => { setSelectedId(null); refresh(); });
    };
    /** Row-level delete: one click arms the row, the second click on THAT row
     *  deletes. Never a single-click erase, and arming a row does not arm any
     *  other — the detail pane's two-step (`SkillDetail`'s own Delete) keeps
     *  the same contract. */
    const requestRowDelete = (s: SkillCardData): void => {
        if (armedDelete === s.fileId) {
            setArmedDelete(null);
            removeSkill(s);
            return;
        }
        setArmedDelete(s.fileId);
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
                        onDelete={() => removeSkill(selected)}
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
                    <p className="text-[11px] text-zinc-500">
                        {rows.length === skills.length
                            ? `${skills.length} playbooks`
                            : `${rows.length} of ${skills.length} playbooks`}
                        {' · '}browse, filter, prove, and try them in chat
                    </p>
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
                {rows.length === 0 ? (
                    <p className="text-xs italic text-zinc-600">
                        {skills.length === 0
                            ? 'No playbooks yet — they form automatically from your post-mortems, or import skill .md files above.'
                            : 'No playbooks match — clear the filters, or close trades with post-mortems to grow skill memory.'}
                    </p>
                ) : (
                    /* WS-5.1: the library is a TABLE. Nine data columns + one
                       action column, one row per playbook. Mobile degrades by
                       DROPPING the least important columns (md/lg/xl) rather
                       than shrinking the reads that matter; the frame's own
                       overflow-x is the last-resort guard, so a narrow viewport
                       scrolls the table inside its border instead of breaking
                       the page. Every deeper read lives in the detail pane, not
                       in a stacked card — only the skill's claim rides under its
                       name, because a slug without its claim is not readable. */
                    <div className="overflow-x-auto custom-scrollbar rounded-control border border-zinc-800/80">
                        <table className="w-full border-collapse text-left text-[11px]" data-testid="strategy-studio-skills">
                            <thead>
                                <tr className="border-b border-zinc-800/80 bg-zinc-900">
                                    <th className={TH}>Skill</th>
                                    <th className={TH}>Status</th>
                                    <th className={`${TH} hidden md:table-cell`}>Kind</th>
                                    <th className={`${TH} hidden lg:table-cell`}>Setup</th>
                                    <th className={`${TH} text-right`}>W/L</th>
                                    <th className={`${TH} hidden md:table-cell`}>A/B verdict</th>
                                    <th className={`${TH} hidden xl:table-cell text-right`}>Expectancy</th>
                                    <th className={`${TH} hidden xl:table-cell`}>Origin</th>
                                    <th className={`${TH} hidden lg:table-cell`}>Last eval</th>
                                    <th className={`${TH} text-right`}>
                                        <span className="sr-only">Row actions</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
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
                                    const armed = armedDelete === s.fileId;
                                    const title = titleFromMeta(meta);
                                    const claim = meta.description || descriptionOf(s.body) || slug;
                                    const winRate = sample > 0 ? meta.wins / sample : 0;
                                    const expectancy = skillExpectancyR(meta);
                                    // The per-row regime edge and attribution lift
                                    // stay as hover reads, not columns: the family ×
                                    // regime heatmap above owns the edge number and
                                    // the Health tab owns the lift, so repeating them
                                    // per row is the duplication the doctrine is
                                    // explicit about ("one home per concern").
                                    const edgeTitle = edge && edge.samples >= 8
                                        ? `${fam?.replace(/_/g, ' ') ?? 'family'} · ${currentRegime ?? 'regime'} edge ${Math.round(edge.winRate * 100)}% over ${edge.samples}`
                                        : `${fam?.replace(/_/g, ' ') ?? 'family'} · no regime evidence`;
                                    const verdictTitle = [
                                        meta.evalVerdict ? `A/B verdict: ${meta.evalVerdict}` : 'never evaluated',
                                        meta.evalDetail ? `${meta.evalDetail} flips aligned` : '',
                                        lift?.lift !== null && lift?.lift !== undefined
                                            ? `attribution lift ${lift.lift >= 0 ? '+' : ''}${Math.round(lift.lift)}pt`
                                            : '',
                                    ].filter(Boolean).join(' · ');
                                    return (
                                        <tr
                                            key={s.fileId}
                                            data-skill-row
                                            data-testid={`skill-row-${slug}`}
                                            onClick={() => setSelectedId(s.fileId)}
                                            onKeyDown={e => {
                                                // Only the row itself — Enter on a
                                                // focused action button belongs to
                                                // that button, not to "open".
                                                if (e.key === 'Enter' && e.target === e.currentTarget) setSelectedId(s.fileId);
                                            }}
                                            tabIndex={0}
                                            className={`cursor-pointer border-b border-zinc-800/80 transition-[background-color,opacity] duration-[120ms] ease-[var(--ease-snappy)] last:border-b-0 hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.06] ${retired ? 'opacity-60 hover:opacity-100' : ''}`}
                                        >
                                            {/* Name + the claim it makes. */}
                                            <td className={`${TD} max-w-[260px]`}>
                                                <div className="truncate text-[12px] font-semibold text-zinc-100" title={title}>{title}</div>
                                                <div className="truncate text-ui-xs text-zinc-500">{claim}</div>
                                            </td>
                                            <td className={TD}>
                                                <StatusPill kicker tone={statusTone(meta.status)} className={retired ? 'line-through' : ''}>
                                                    {statusBadge.label}
                                                </StatusPill>
                                            </td>
                                            <td className={`${TD} hidden md:table-cell`}>
                                                <StatusPill kicker tone={meta.kind === 'avoid' ? 'down' : 'neutral'}>
                                                    {kindBadge.label}
                                                </StatusPill>
                                            </td>
                                            {/* Setup: what the playbook trades, and
                                                the family it belongs to tinted by the
                                                current regime's edge. */}
                                            <td className={`${TD} hidden lg:table-cell text-zinc-500`}>
                                                <span className="font-mono text-zinc-300">{meta.coin ?? '—'}</span>
                                                {meta.direction && <span> {meta.direction}</span>}
                                                {meta.timeframe && <span className="text-zinc-600"> · {meta.timeframe}</span>}
                                                {fam && (
                                                    <span className={edgeTone(edge)} title={edgeTitle}>{` · ${fam.replace(/_/g, ' ')}`}</span>
                                                )}
                                            </td>
                                            <td className={`${TD} text-right`}>
                                                <span
                                                    data-testid={`studio-wl-${slug}`}
                                                    title={`${meta.wins}W / ${meta.losses}L`}
                                                    className={`font-mono text-[11px] tabular-nums ${sample === 0 ? 'text-zinc-600' : winRate >= 0.6 ? 'text-emerald-400' : winRate <= 0.4 ? 'text-rose-400' : 'text-zinc-300'}`}
                                                >
                                                    {Math.round(meta.wins)}W {Math.round(meta.losses)}L
                                                    <span className="ml-1 text-zinc-600">n={sample}</span>
                                                </span>
                                            </td>
                                            <td className={`${TD} hidden md:table-cell`}>
                                                {meta.evalVerdict ? (
                                                    <StatusPill tone={VERDICT_TONE[meta.evalVerdict]} title={verdictTitle}>
                                                        {meta.evalVerdict}
                                                    </StatusPill>
                                                ) : (
                                                    <span className="font-mono text-zinc-700" title="never evaluated">—</span>
                                                )}
                                            </td>
                                            {/* Expectancy, or the honest "not yet
                                                measured" sample count — never 0R. */}
                                            <td className={`${TD} hidden xl:table-cell text-right`}>
                                                <span
                                                    className={`font-mono text-[11px] tabular-nums ${expectancy === undefined ? 'text-zinc-600' : expectancy > 0 ? 'text-emerald-400' : expectancy < 0 ? 'text-rose-400' : 'text-zinc-300'}`}
                                                    title={expectancy === undefined
                                                        ? `unmeasured — ${meta.rSampled ?? 0}/${EXPECTANCY_MIN_R_SAMPLE} counted outcomes carry realized R`
                                                        : 'average realized R per measured outcome'}
                                                >
                                                    {expectancy === undefined
                                                        ? `${meta.rSampled ?? 0}/${EXPECTANCY_MIN_R_SAMPLE} R`
                                                        : `${expectancy > 0 ? '+' : ''}${expectancy}R`}
                                                </span>
                                            </td>
                                            <td className={`${TD} hidden xl:table-cell text-zinc-500`}>
                                                <span>{meta.source ?? '—'}</span>
                                                {meta.originBotName && (
                                                    <span className="text-zinc-600">{` · from @${meta.originBotName}`}</span>
                                                )}
                                            </td>
                                            <td
                                                className={`${TD} hidden lg:table-cell font-mono text-[11px] tabular-nums`}
                                                title={`last A/B eval: ${meta.lastEvalAt ?? 'never'} · last content write: ${meta.modifiedAt ?? 'unknown'}`}
                                            >
                                                <span className={meta.lastEvalAt ? 'text-zinc-400' : 'text-zinc-600'}>
                                                    {fmtDay(meta.lastEvalAt ?? meta.modifiedAt)}
                                                </span>
                                            </td>
                                            {/* Management: try / pin / retire-or-restore /
                                                open / delete. Each stops the row click so
                                                a button never doubles as "open". */}
                                            <td className={`${TD} text-right`}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        title="Try in chat"
                                                        aria-label="Try in chat"
                                                        data-testid={`studio-try-${slug}`}
                                                        onClick={e => { e.stopPropagation(); trySkillInChat(slug); onClose?.(); }}
                                                        className={`${ACTION_BTN} border-zinc-700 bg-zinc-800 font-medium text-zinc-200 hover:bg-zinc-700`}
                                                    >
                                                        Try
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={pinned ? 'Unpin' : 'Pin to top'}
                                                        aria-label={pinned ? `Unpin ${s.name}` : `Pin ${s.name} to top`}
                                                        aria-pressed={pinned}
                                                        data-testid={`studio-pin-${slug}`}
                                                        onClick={e => { e.stopPropagation(); togglePin(s.fileId); }}
                                                        className={`${ACTION_BTN} ${pinned ? 'border-zinc-600 bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
                                                    >
                                                        <Pin className="h-3.5 w-3.5" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={retired ? 'Restore' : 'Retire'}
                                                        aria-label={retired ? `Restore ${s.name}` : `Retire ${s.name}`}
                                                        data-testid={`studio-retire-${slug}`}
                                                        onClick={e => { e.stopPropagation(); toggleRetire(s); }}
                                                        className={`${ACTION_BTN} text-zinc-500 hover:text-zinc-200`}
                                                    >
                                                        {retired
                                                            ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                                            : <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={`Open ${s.name}`}
                                                        title="Open details"
                                                        data-testid={`studio-open-${slug}`}
                                                        onClick={e => { e.stopPropagation(); setSelectedId(s.fileId); }}
                                                        className={`${ACTION_BTN} hidden md:inline-flex text-zinc-500 hover:text-zinc-200`}
                                                    >
                                                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={armed ? `Confirm delete ${s.name}` : `Delete ${s.name}`}
                                                        aria-pressed={armed}
                                                        title={armed ? 'Click again to delete for good' : 'Delete this playbook (two clicks)'}
                                                        data-testid={`studio-delete-${slug}`}
                                                        onClick={e => { e.stopPropagation(); requestRowDelete(s); }}
                                                        onBlur={() => setArmedDelete(null)}
                                                        className={`${ACTION_BTN} font-semibold ${armed
                                                            ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                                                            : 'text-zinc-500 hover:border-rose-500/40 hover:text-rose-300'}`}
                                                    >
                                                        {armed
                                                            ? <span className="text-ui-xs uppercase tracking-wider">Confirm</span>
                                                            : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(StrategyStudio);

/**
 * StrategyStudio — a browse + annotate surface for the harness's strategy
 * library (seeded playbooks, learned skills, uploaded frameworks). It is a
 * PRESENTATION layer over data that already exists:
 *   - listSkills()             → every skills/*.md (seed prior + learned)
 *   - computeAllSkillLifts()   → per-skill attribution lift (post − pre WR)
 *   - familyRegimeEdge()       → the family × regime win-rate matrix cell
 *   - classifyStrategyFamily() → the controlled family a skill trades
 *
 * Nothing here recomputes or mutates the learning loop — it reads it. "Try
 * in chat" reuses the existing august:try-skill event so a card drops its
 * slug into the composer exactly like the Settings skills grid.
 *
 * Monochrome theme (AGENTS.md): zinc surfaces throughout; the only semantic
 * color is the status-surface family used for edge verdicts and the
 * candidate/confirmed/retired badges, matching the rest of the app.
 */

import React, { useMemo, useState } from 'react';
import { LoggedTrade } from '../../types';
import { listSkills, titleFromMeta, type SkillMeta } from '../../services/learning/SkillMemoryService';
import { computeAllSkillLifts, type SkillLiftResult } from '../../services/learning/MemoryProvenanceService';
import { familyRegimeEdge, matrixSummaryBlock, hydrateStrategyRegimeMatrix } from '../../services/learning/strategyRegimeMatrix';
import { classifyStrategyFamily } from '../../utils/strategyFamily';
import { normalizeStrategyFamily, STRATEGY_FAMILIES, type StrategyFamily } from '../../types/strategy';
import { getActiveUsername } from '../../utils/activeUser';

/** "Try in chat" — the same august:try-skill contract SkillsGrid uses.
 *  Dispatched inline (not imported from the settings sibling) so a dashboard
 *  never depends on a settings component; ChatInput owns the listener. */
const trySkillInChat = (slug: string): void => {
    window.dispatchEvent(new CustomEvent('august:try-skill', { detail: { slug } }));
};

interface StrategyStudioProps {
    trades: LoggedTrade[];
    username?: string;
    /** Current market regime (from hybrid) — drives the family-edge tilt. */
    currentRegime?: string;
    onClose?: () => void;
}

const STATUS_BADGE: Record<SkillMeta['status'], string> = {
    candidate: 'border-white/15 bg-zinc-800 text-zinc-300',
    confirmed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    retired: 'border-white/10 bg-zinc-900 text-zinc-600',
};

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

const StrategyStudio: React.FC<StrategyStudioProps> = ({ trades, username, currentRegime, onClose }) => {
    React.useEffect(() => {
        const user = username || getActiveUsername();
        void hydrateStrategyRegimeMatrix(user);
    }, [username]);

    const [query, setQuery] = useState('');
    const [familyFilter, setFamilyFilter] = useState<StrategyFamily | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<SkillMeta['status'] | 'all'>('all');

    const skills = useMemo(() => listSkills(), []);
    const lifts = useMemo<SkillLiftResult[]>(
        () => computeAllSkillLifts(trades),
        [trades],
    );
    const liftByName = useMemo(() => {
        const m = new Map<string, SkillLiftResult>();
        for (const l of lifts) m.set(l.name, l);
        return m;
    }, [lifts]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return skills
            .filter(({ file, meta }) => {
                if (statusFilter !== 'all' && meta.status !== statusFilter) return false;
                if (familyFilter !== 'all' && skillFamily(meta) !== familyFilter) return false;
                if (!q) return true;
                const hay = `${titleFromMeta(meta)} ${meta.description ?? ''} ${meta.coin ?? ''} ${meta.family ?? ''} ${file.name}`.toLowerCase();
                return hay.includes(q);
            })
            .sort((a, b) => {
                // Confirmed first, then most evidence, then newest.
                const rank = (m: SkillMeta): number => (m.status === 'confirmed' ? 2 : m.status === 'candidate' ? 1 : 0);
                return rank(b.meta) - rank(a.meta)
                    || (b.meta.wins + b.meta.losses) - (a.meta.wins + a.meta.losses);
            });
    }, [skills, query, statusFilter, familyFilter]);

    const matrixLine = useMemo(() => matrixSummaryBlock(currentRegime, 400), [currentRegime]);

    return (
        <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
            <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
                <div>
                    <h2 className="text-sm font-semibold tracking-wide">Strategy Studio</h2>
                    <p className="text-[11px] text-zinc-500">{skills.length} playbooks · browse, filter, and try them in chat</p>
                </div>
                {onClose && (
                    <button type="button" onClick={onClose} className="rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700">
                        Back to Chat
                    </button>
                )}
            </div>

            {/* Filters */}
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
            </div>

            {/* Regime×family matrix — a quiet context strip, not a table of
                every cell (the moderator gets the same block). */}
            {matrixLine && (
                <div className="border-b border-white/5 px-5 py-2 text-[11px] leading-5 text-zinc-500">
                    {matrixLine}
                </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
                {rows.length === 0 ? (
                    <p className="text-xs italic text-zinc-600">No playbooks match — close trades with post-mortems to grow skill memory, or clear the filters.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {rows.map(({ file, meta }) => {
                            const fam = skillFamily(meta);
                            const edge = fam ? familyRegimeEdge(fam, currentRegime) : null;
                            const slug = file.name.replace(/\.md$/i, '');
                            const lift = liftByName.get(file.name) ?? liftByName.get(slug);
                            const sample = Math.round(meta.wins + meta.losses);
                            return (
                                <div key={file.id} className="flex flex-col rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                                    <div className="mb-1.5 flex items-start justify-between gap-2">
                                        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100" title={titleFromMeta(meta)}>
                                            {titleFromMeta(meta)}
                                        </h3>
                                        <span className={`status-surface shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_BADGE[meta.status]}`}>
                                            {meta.status}
                                        </span>
                                    </div>
                                    <p className="mb-2 line-clamp-2 min-h-[2.4em] text-[11px] leading-4 text-zinc-500">
                                        {meta.description || `${meta.ifCondition ? `IF ${meta.ifCondition}` : ''}${meta.thenAction ? ` THEN ${meta.thenAction}` : ''}` || slug}
                                    </p>
                                    <div className="mb-2 flex flex-wrap gap-1">
                                        <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400">{meta.kind}</span>
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
                                            <span
                                                className="text-[11px] tabular-nums text-zinc-400"
                                                title={`Attribution lift (post − pre win rate): ${lift.verdict}`}
                                            >
                                                lift {lift.lift >= 0 ? '+' : ''}{Math.round(lift.lift)}pt
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { trySkillInChat(slug); onClose?.(); }}
                                        className="mt-2 rounded-lg border border-white/10 bg-zinc-800 px-2 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                                    >
                                        Try in chat
                                    </button>
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

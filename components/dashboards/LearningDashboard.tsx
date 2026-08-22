
import React, { useMemo, useState, useEffect } from 'react';
import { BrainCircuit, ChevronDownIcon } from 'lucide-react';
import { LoggedTrade, MemoryFile, MemoryFolder, TradeOutcome } from '../../types';
import { computeLearningProfile, PersonalizedLearningProfile } from '../../services/learning/SelfLearningService';
import { initMemoryFiles, getMemoryFiles, computeTopLessons, TopLesson } from '../../services/learning/MemoryFilesService';
import { summarizeSimilarSetups, COLD_START_MIN } from '../../services/learning/SetupMemoryService';
import { computeEvidenceQualityStats } from '../../utils/analysisQuality';
import { summarizePromptVersions, summarizePromptLanes } from '../../utils/promptVersionStats';
import { listSkills, reviewSkillEffectiveness } from '../../services/learning/SkillMemoryService';
import { computeAllSkillLifts } from '../../services/learning/MemoryProvenanceService';
import { getCalibrationSummaries } from '../../services/backtesting/ModelPerformanceService';
import { buildMemoryGraph } from '../../services/learning/MemoryGraph';
import { EmptyState } from '../ui/EmptyState';

interface LearningDashboardProps {
    trades: LoggedTrade[];
    /** Active user — loads the right Trader Notebook files. */
    username?: string;
}

// Stat card component
const StatCard: React.FC<{
    title: string;
    items: { name: string; value: string; subtext?: string; color?: string }[];
    emptyText?: string;
}> = ({ title, items, emptyText = 'Not enough data' }) => (
    <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
        <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">{title}</h4>
        {items.length > 0 ? (
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-zinc-300 truncate pr-2">{item.name}</span>
                        <div className="text-right">
                            <span className={`text-sm font-bold ${item.color || 'text-white'}`}>{item.value}</span>
                            {item.subtext && <span className="text-[10px] text-zinc-500 ml-1">{item.subtext}</span>}
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-xs text-zinc-600 italic">{emptyText}</p>
        )}
    </div>
);

// Progress bar for calibration
const CalibrationBar: React.FC<{ label: string; actual: number; expected: number; count: number }> = ({
    label, actual, expected, count
}) => {
    const diff = actual - expected;
    const color = diff >= 5 ? 'bg-emerald-500' : diff <= -10 ? 'bg-red-500' : 'bg-yellow-500';
    const status = diff >= 5 ? 'Underconfident' : diff <= -10 ? 'Overconfident' : 'Calibrated';

    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-500">n={count}</span>
            </div>
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={`absolute h-full ${color} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, actual)}%` }}
                />
                {/* Expected marker */}
                <div
                    className="absolute h-full w-0.5 bg-zinc-600"
                    style={{ left: `${expected}%` }}
                />
            </div>
            <div className="flex justify-between text-[10px]">
                <span className={diff >= 5 ? 'text-emerald-400' : diff <= -10 ? 'text-red-400' : 'text-yellow-400'}>
                    {status}
                </span>
                <span className="text-zinc-500">
                    Actual: {actual}% | Expected: ~{expected}%
                </span>
            </div>
        </div>
    );
};

export const LearningDashboard: React.FC<LearningDashboardProps> = ({ trades, username }) => {
    const profile = useMemo(() => computeLearningProfile(trades), [trades]);

    // Trader Notebook — the markdown memory files the harness writes and the
    // model reads (diary entries, recurring mistakes, profile memory, AI notes).
    const [notebook, setNotebook] = useState<{ folders: MemoryFolder[]; files: MemoryFile[] }>({ folders: [], files: [] });
    useEffect(() => {
        let cancelled = false;
        const user = username || localStorage.getItem('last_active_user') || 'default';
        initMemoryFiles(user).then(() => {
            if (cancelled) return;
            const { folders, files } = getMemoryFiles();
            setNotebook({ folders, files });
        });
        return () => { cancelled = true; };
    }, [username]);

    // Outcome-weighted clusters — losses first (fix list), then wins (repeat list).
    const topLessons = useMemo(() => computeTopLessons(trades, 6), [trades]);

    // ─── Harness accuracy (②): the similar-setup pool itself ───────────────
    // Time window on the top metrics so stale early-period data never
    // masquerades as current accuracy.
    const [windowDays, setWindowDays] = useState<0 | 30 | 90>(0);
    const windowedTrades = useMemo(() => {
        if (windowDays === 0) return trades;
        const cutoff = Date.now() - windowDays * 86_400_000;
        return trades.filter(t => new Date(t.timestamp).getTime() >= cutoff);
    }, [trades, windowDays]);

    const isClosed = (t: LoggedTrade) => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS;
    const closedWindowed = useMemo(() => windowedTrades.filter(isClosed), [windowedTrades]);
    const evidenceQuality = useMemo(() => computeEvidenceQualityStats(closedWindowed), [closedWindowed]);
    const promptVersions = useMemo(() => summarizePromptVersions(closedWindowed), [closedWindowed]);
    const promptLanes = useMemo(() => summarizePromptLanes(closedWindowed), [closedWindowed]);
    const notebookSkills = useMemo(() => listSkills(), [notebook]);
    const skillReview = useMemo(() => reviewSkillEffectiveness(), [notebook]);
    const skillLifts = useMemo(() => computeAllSkillLifts(trades), [trades]);
    const calibrationSummaries = useMemo(() => getCalibrationSummaries().filter(c => c.samples > 0), []);

    // Conviction auction history: scan stored debate transcripts for each
    // seat's sealed CONVICTION lines and average them.
    const convictionSummaries = useMemo(() => {
        const bySeat = new Map<string, { total: number; count: number; last: number }>();
        for (const trade of trades) {
            const turns = trade.debateTurns;
            if (!Array.isArray(turns)) continue;
            const seen = new Set<string>();
            for (const t of turns) {
                if (t.speaker === 'Moderator' || t.speaker === 'System' || seen.has(t.speaker)) continue;
                const m = t.text.match(/CONVICTION:\s*(\d{1,3})/i);
                if (!m) continue;
                seen.add(t.speaker);
                const v = Math.min(100, Math.max(0, parseInt(m[1], 10)));
                const cur = bySeat.get(t.speaker) ?? { total: 0, count: 0, last: v };
                cur.total += v;
                cur.count += 1;
                cur.last = v;
                bySeat.set(t.speaker, cur);
            }
        }
        return [...bySeat.entries()].map(([name, s]) => ({
            name,
            avgConviction: s.total / Math.max(s.count, 1),
            debateCount: s.count,
            lastValue: s.last,
        })).sort((a, b) => b.avgConviction - a.avgConviction);
    }, [trades]);

    // Memory Graph — build the typed memory graph and offer All / Used / Learned views.
    const [graphTab, setGraphTab] = useState<'all' | 'used' | 'learned'>('all');
    const memoryGraph = useMemo(() => buildMemoryGraph(undefined, closedWindowed), [closedWindowed, notebook]);
    const graphKinds = useMemo(() => {
        const m = new Map<string, number>();
        for (const n of memoryGraph.nodes.values()) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
        return m;
    }, [memoryGraph]);
    const learnedSkills = useMemo(() => notebookSkills.filter(s => s.meta.wins + s.meta.losses > 0 || s.meta.status === 'confirmed'), [notebookSkills]);

    // Pool stats: setups indexed + avg matches per query (sampled for cost)
    // + how many queries hit the cold-start flag.
    const poolStats = useMemo(() => {
        const sample = closedWindowed.slice(-50);
        let matches = 0, queries = 0, coldStarts = 0;
        for (const t of sample) {
            const s = summarizeSimilarSetups(
                { coinName: t.analysis?.coinName, direction: t.analysis?.direction, detectedPatternFamily: t.analysis?.detectedPatternFamily },
                closedWindowed.filter(x => x.id !== t.id),
                t.marketRegime
            );
            if (s) { matches += s.total; queries += 1; if (s.isColdStart) coldStarts += 1; }
        }
        return { indexed: closedWindowed.length, avgMatches: queries ? matches / queries : 0, coldStartQueries: coldStarts, sampled: queries };
    }, [closedWindowed]);

    // Drawdown — explicitly split: current (open) vs historical max.
    const drawdown = useMemo(() => {
        const ordered = [...closedWindowed].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        let equity = 0, peak = 0, open = 0, max = 0;
        for (const t of ordered) {
            equity += typeof t.pnlPercent === 'number' ? t.pnlPercent : (t.outcome === TradeOutcome.WIN ? 2 : -1);
            if (equity > peak) peak = equity;
            open = Math.min(open, equity - peak);
            max = Math.min(max, equity - peak);
        }
        return { open, max };
    }, [closedWindowed]);

    // Per-model × regime leaderboard (win % + n), with a numeric delta over
    // the model's LAST 20 closed trades vs its overall — replaces the vague
    // trend arrow.
    const leaderboard = useMemo(() => {
        const rows: { key: string; byRegime: Record<string, { w: number; l: number }>; total: number; wins: number; last20WinRate: number | null; last20N: number }[] = [];
        const byKey = new Map<string, { byRegime: Record<string, { w: number; l: number }>; total: number; wins: number; recent: LoggedTrade[] }>();
        for (const t of closedWindowed) {
            const used = t.modelsUsed ?? {};
            const entries = Object.entries(used);
            const key = entries.length > 0 ? `${entries[0][0]}::${entries[0][1]}` : 'unknown';
            const c = byKey.get(key) ?? { byRegime: {}, total: 0, wins: 0, recent: [] };
            c.total += 1;
            if (t.outcome === TradeOutcome.WIN) c.wins += 1;
            const regime = t.marketRegime ?? 'unknown';
            c.byRegime[regime] = c.byRegime[regime] ?? { w: 0, l: 0 };
            c.byRegime[regime][t.outcome === TradeOutcome.WIN ? 'w' : 'l'] += 1;
            c.recent.push(t);
            byKey.set(key, c);
        }
        for (const [key, c] of byKey) {
            if (c.total < 3) continue;
            const last20 = c.recent.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).slice(-20);
            const last20Wins = last20.filter(t => t.outcome === TradeOutcome.WIN).length;
            rows.push({
                key,
                byRegime: c.byRegime,
                total: c.total,
                wins: c.wins,
                last20WinRate: last20.length >= 5 ? (last20Wins / last20.length) * 100 : null,
                last20N: last20.length,
            });
        }
        return rows.sort((a, b) => b.total - a.total);
    }, [closedWindowed]);

    const REGIMES = ['trending', 'ranging', 'volatile', 'compression'] as const;

    // ─── View-trades on lessons: fixed filter set for v1 (regime + PnL
    //      threshold — direction/outcome are implied by the cluster). ─────
    const [expandedLesson, setExpandedLesson] = useState<number | null>(null);
    const [lessonRegimeFilter, setLessonRegimeFilter] = useState<string>('all');
    const [lessonPnlThreshold, setLessonPnlThreshold] = useState(false); // ≤ -2% only

    const lessonMatches = (lesson: TopLesson): LoggedTrade[] => {
        const splitAt = lesson.label.lastIndexOf(' ');
        const coin = lesson.label.slice(0, splitAt);
        const direction = lesson.label.slice(splitAt + 1);
        return closedWindowed.filter(t =>
            (t.analysis?.coinName ?? '') === coin
            && (t.analysis?.direction ?? '') === direction
            && (lesson.kind === 'win' ? t.outcome === TradeOutcome.WIN : t.outcome === TradeOutcome.LOSS)
            && (lessonRegimeFilter === 'all' || (t.marketRegime ?? 'unknown') === lessonRegimeFilter)
            && (!lessonPnlThreshold || (typeof t.pnlPercent === 'number' && t.pnlPercent <= -2))
        )
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(-15);
    };

    const notebookSection = (
        <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
            <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">
                📓 Trader Notebook — what the model reads
            </h4>
            {notebook.files.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">
                    No notebook files yet — the harness writes diary entries after every logged trade.
                </p>
            ) : (
                <div className="space-y-2">
                    {notebook.folders.map(folder => {
                        const files = notebook.files.filter(f => f.folderId === folder.id);
                        if (files.length === 0) return null;
                        return (
                            <div key={folder.id}>
                                <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">{folder.name}/</p>
                                <div className="mt-1 space-y-1">
                                    {files.map(f => {
                                        const entries = folder.name === 'trader-diary' ? f.content.split('\n## ').length - 1 : 0;
                                        return (
                                            <div key={f.id} className="flex items-center justify-between rounded-lg bg-zinc-950/60 border border-white/5 px-2.5 py-1.5 text-[11px]">
                                                <span className="text-zinc-300 truncate pr-2 flex items-center gap-1.5">
                                                    {f.name}
                                                    {f.autoManaged && (
                                                        <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">auto</span>
                                                    )}
                                                </span>
                                                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                                                    {entries > 0 ? `${entries} entries` : `${f.content.length.toLocaleString()} chars`}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const lessonsSection = (
        <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
            <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">Top Lessons (outcome-weighted)</h4>
            {topLessons.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">Log at least 2 trades on the same coin + direction to see clusters.</p>
            ) : (
                <div className="space-y-1.5">
                    {topLessons.map((l, i) => {
                        const matches = lessonMatches(l);
                        const isOpen = expandedLesson === i;
                        return (
                            <div key={i} className="rounded-lg border border-white/5 bg-zinc-950/40 px-2.5 py-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-300 truncate pr-2 flex items-center gap-1.5">
                                        <span className={l.kind === 'loss' ? 'text-rose-400' : 'text-emerald-400'}>{l.kind === 'loss' ? '⚠️' : '✅'}</span>
                                        {l.label}
                                        <span className="text-[10px] text-zinc-500">×{l.count}</span>
                                    </span>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {l.avgPnl !== null && (
                                            <span className={`text-xs font-bold ${l.avgPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {l.avgPnl > 0 ? '+' : ''}{l.avgPnl.toFixed(1)}%
                                            </span>
                                        )}
                                        <button
                                            onClick={() => setExpandedLesson(isOpen ? null : i)}
                                            className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-cyan-300 transition-colors flex items-center gap-1"
                                        >
                                            View {matches.length} trades <ChevronDownIcon className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className={`collapsible-content ${isOpen ? 'expanded' : ''}`}>
                                    <div className="mt-2 space-y-1.5">
                                        {/* Fixed filter set (v1): regime + PnL threshold */}
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <button
                                                onClick={() => setLessonRegimeFilter('all')}
                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                                                    lessonRegimeFilter === 'all' ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'
                                                }`}
                                            >
                                                all regimes
                                            </button>
                                            {REGIMES.map(r => (
                                                <button
                                                    key={r}
                                                    onClick={() => setLessonRegimeFilter(prev => prev === r ? 'all' : r)}
                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                                                        lessonRegimeFilter === r ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'
                                                    }`}
                                                >
                                                    {r}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setLessonPnlThreshold(v => !v)}
                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                                                    lessonPnlThreshold ? 'bg-rose-500/20 border-rose-500/30 text-rose-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'
                                                }`}
                                            >
                                                ≤ −2% only
                                            </button>
                                        </div>
                                        {matches.length === 0 ? (
                                            <p className="text-[10px] text-zinc-600 italic">No trades match these filters in the current time window.</p>
                                        ) : (
                                            matches.slice(-8).map(t => (
                                                <div key={t.id} className="flex items-center justify-between rounded bg-zinc-900/60 border border-white/5 px-2 py-1 text-[10px] font-mono">
                                                    <span className="text-zinc-400 truncate pr-2">
                                                        {new Date(t.timestamp).toLocaleDateString()} · {t.analysis?.direction}
                                                        <span className="text-zinc-600"> · {t.marketRegime ?? '?'}</span>
                                                    </span>
                                                    <span className={`shrink-0 font-bold ${t.outcome === TradeOutcome.WIN ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {t.outcome}{typeof t.pnlPercent === 'number' ? ` (${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%)` : ''}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    // ─── Memory Graph panel: All / Used / Learned ───────────────────────
    const KIND_LABELS: Record<string, string> = {
        identity: 'Profile', skill: 'Skill', rule: 'Rule', note: 'Note',
        trade: 'Trade', rootCause: 'Root cause', setup: 'Setup dim',
    };
    const memoryGraphSection = (
        <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">🧠 Memory Graph</h4>
                <div className="flex items-center gap-1">
                    {(['all', 'used', 'learned'] as const).map(t => (
                        <button key={t} onClick={() => setGraphTab(t)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${graphTab === t ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'}`}>
                            {t}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-[10px] text-zinc-600 mb-2 font-mono">
                {memoryGraph.nodes.size} nodes · {memoryGraph.edges.length} edges
                {' · '}{[...graphKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
            {graphTab === 'all' && (
                <div className="space-y-1.5">
                    {[...graphKinds.entries()].map(([kind, count]) => {
                        const samples = [...memoryGraph.nodes.values()].filter(n => n.kind === kind).slice(0, 4);
                        return (
                            <div key={kind} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 flex items-center justify-between gap-2">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold shrink-0">{KIND_LABELS[kind] ?? kind}</span>
                                <span className="text-[10px] text-zinc-600 truncate min-w-0">{samples.map(s => s.label).join(' · ')}</span>
                                <span className="text-[10px] font-mono text-zinc-400 shrink-0">{count}</span>
                            </div>
                        );
                    })}
                </div>
            )}
            {graphTab === 'used' && (
                learnedSkills.length === 0
                    ? <p className="text-xs text-zinc-600 italic">Nothing used yet — skills appear here once injected into an analysis.</p>
                    : <div className="space-y-1.5">
                        {learnedSkills.slice(0, 8).map(s => (
                            <div key={s.file.id} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 text-[11px]">
                                <span className="text-zinc-500 font-mono">{s.meta.kind}</span> <span className="text-zinc-300">{s.file.name.replace(/\.md$/i, '')}</span>
                                <span className="text-zinc-500"> · {s.meta.wins}/{s.meta.losses}</span>
                            </div>
                        ))}
                    </div>
            )}
            {graphTab === 'learned' && (
                notebookSkills.length === 0
                    ? <p className="text-xs text-zinc-600 italic">Nothing learned yet — close trades with post-mortems to grow skill memory.</p>
                    : <div className="space-y-1.5">
                        {notebookSkills.slice(0, 10).map(s => (
                            <div key={s.file.id} className="rounded-lg border border-white/5 bg-zinc-950/50 px-2.5 py-1.5 text-[11px]">
                                <span className="text-zinc-500 font-mono">{s.meta.kind}</span> <span className="text-zinc-300">{s.meta.ifCondition || s.file.name.replace(/\.md$/i, '')}</span>
                                <span className="text-zinc-500"> · {s.meta.wins}/{s.meta.losses} · {s.meta.status}</span>
                            </div>
                        ))}
                    </div>
            )}
        </div>
    );

    // ─── Harness accuracy section (②): pool stats, drawdown, leaderboard ──
    const harnessSection = (
        <div className="space-y-3 sm:space-y-4">
            {/* Time-window control — stale early data must not masquerade as current */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Harness Accuracy — the similar-setup pool</h4>
                <div className="flex items-center gap-1">
                    {([0, 30, 90] as const).map(d => (
                        <button
                            key={d}
                            onClick={() => setWindowDays(d)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
                                windowDays === d ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {d === 0 ? 'all time' : `${d}d`}
                        </button>
                    ))}
                </div>
            </div>

            {/* Pool stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Setups indexed</p>
                    <p className="text-xl font-black text-white">{poolStats.indexed}</p>
                    <p className="text-[9px] text-zinc-600">closed trades in pool</p>
                </div>
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Avg matches / query</p>
                    <p className="text-xl font-black text-white">{poolStats.avgMatches.toFixed(1)}</p>
                    <p className="text-[9px] text-zinc-600">sampled {poolStats.sampled} queries</p>
                </div>
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Cold-start queries</p>
                    <p className={`text-xl font-black ${poolStats.coldStartQueries > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                        {poolStats.sampled > 0 ? `${Math.round((poolStats.coldStartQueries / poolStats.sampled) * 100)}%` : '—'}
                    </p>
                    <p className="text-[9px] text-zinc-600">below {COLD_START_MIN} matches → confidence scaled down</p>
                </div>
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Drawdown</p>
                    <p className="text-xl font-black text-rose-400">{drawdown.open.toFixed(1)}%</p>
                    <p className="text-[9px] text-zinc-600">open · historical max {drawdown.max.toFixed(1)}%</p>
                </div>
            </div>

            <div className="bg-zinc-800 rounded-xl border border-white/5 p-3">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-2">Evidence coverage vs outcome</p>
                <p className="text-[10px] text-zinc-600 mb-2">Recorded trend, not causal proof.</p>
                <div className="grid grid-cols-3 gap-2">
                    {evidenceQuality.map(bucket => (
                        <div key={bucket.coverage} className="rounded-lg border border-white/5 bg-zinc-950/50 p-2">
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">{bucket.coverage}</p>
                            <p className="text-sm font-semibold text-zinc-100">{bucket.winRate !== null ? `${bucket.winRate}% WR` : '—'}</p>
                            <p className="text-[10px] text-zinc-600">n={bucket.n}{bucket.avgProbability !== null ? ` · avg p ${bucket.avgProbability}` : ''}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Per-model × regime leaderboard */}
            <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
                <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 sm:mb-3">Per-model track record by regime</h4>
                {leaderboard.length === 0 ? (
                    <p className="text-xs text-zinc-600 italic">Log ≥3 trades per model to see the leaderboard.</p>
                ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left text-[10px] font-mono">
                            <thead>
                                <tr className="text-zinc-600 border-b border-white/5">
                                    <th className="py-1.5 pr-3 font-bold">Model</th>
                                    {REGIMES.map(r => <th key={r} className="py-1.5 px-2 font-bold">{r}</th>)}
                                    <th className="py-1.5 px-2 font-bold">Overall</th>
                                    <th className="py-1.5 px-2 font-bold">Δ last 20</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leaderboard.map(row => {
                                    const overall = row.total > 0 ? (row.wins / row.total) * 100 : 0;
                                    const delta = row.last20WinRate !== null ? row.last20WinRate - overall : null;
                                    return (
                                        <tr key={row.key} className="border-b border-white/5 last:border-0">
                                            <td className="py-1.5 pr-3 text-zinc-300 truncate max-w-[140px]" title={row.key}>{row.key}</td>
                                            {REGIMES.map(r => {
                                                const s = row.byRegime[r];
                                                if (!s || s.w + s.l === 0) return <td key={r} className="py-1.5 px-2 text-zinc-700">—</td>;
                                                const wr = (s.w / (s.w + s.l)) * 100;
                                                return (
                                                    <td key={r} className={`py-1.5 px-2 ${wr >= 60 ? 'text-emerald-400' : wr >= 45 ? 'text-zinc-300' : 'text-rose-400'}`}>
                                                        {wr.toFixed(0)}% <span className="text-zinc-600">({s.w + s.l})</span>
                                                    </td>
                                                );
                                            })}
                                            <td className="py-1.5 px-2 text-zinc-300">{overall.toFixed(0)}% <span className="text-zinc-600">({row.total})</span></td>
                                            <td className={`py-1.5 px-2 ${delta === null ? 'text-zinc-700' : delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} pts / ${row.last20N}`}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-[9px] text-zinc-600 mt-2 leading-relaxed">
                    Regime classification: ADX thresholds — ADX ≥ 25 trend, &lt; 20 range, ATR-relative volatility; the regime is captured from the hybrid market data at log time.
                </p>
            </div>
        </div>
    );

    const getWinRateColor = (rate: number) => {
        if (rate >= 65) return 'text-emerald-400';
        if (rate >= 50) return 'text-yellow-400';
        return 'text-red-400';
    };

    if (profile.totalAnalyzedTrades < 3) {
        return (
            <div className="space-y-4 p-3 sm:p-4 overflow-y-auto custom-scrollbar">
                {memoryGraphSection}
                {harnessSection}
                {notebookSection}
                {lessonsSection}
                <EmptyState
                    icon={<BrainCircuit className="w-8 h-8" />}
                    title="Building Your Profile"
                    description={`Log at least 3 trades (WIN or LOSS) to start seeing personalized AI learnings. Current: ${profile.totalAnalyzedTrades} / 3 trades.`}
                    className="h-64"
                />
            </div>
        );
    }

    return (
        <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 overflow-y-auto custom-scrollbar">
            {memoryGraphSection}
            {harnessSection}
            {notebookSection}
            {lessonsSection}
            {/* Header */}
            <div className="text-center pb-3 sm:pb-4 border-b border-white/5">
                <h2 className="text-base sm:text-lg font-bold text-cyan-400 mb-1">AI Learning Profile</h2>
                <p className="text-[10px] sm:text-xs text-zinc-500">
                    Based on {profile.totalAnalyzedTrades} analyzed trades
                </p>
            </div>

            {/* Overall Performance */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-gradient-to-br from-cyan-950/50 to-zinc-900 rounded-xl p-3 sm:p-4 border border-cyan-500/20">
                    <p className="text-[9px] sm:text-xs text-cyan-400/70 uppercase tracking-wider mb-1">Win Rate</p>
                    <p className={`text-2xl sm:text-3xl font-black ${getWinRateColor(profile.overallWinRate)}`}>
                        {profile.overallWinRate}%
                    </p>
                </div>
                <div className="bg-gradient-to-br from-purple-950/50 to-zinc-900 rounded-xl p-3 sm:p-4 border border-purple-500/20">
                    <p className="text-[9px] sm:text-xs text-purple-400/70 uppercase tracking-wider mb-1">Trades</p>
                    <p className="text-2xl sm:text-3xl font-black text-white">
                        {profile.totalAnalyzedTrades}
                    </p>
                </div>
            </div>

            {/* Strengths & Weaknesses Grid */}
            <div className="grid grid-cols-1 gap-3 sm:gap-4">
                {/* Best Coins */}
                <StatCard
                    title="Learned Skills"
                    items={notebookSkills.slice(0, 5).map(({ meta, file }) => ({
                        name: `${meta.kind === 'avoid' ? 'Avoid' : 'Repeat'}: ${meta.ifCondition || file.name.replace(/\.md$/i, '')}`.slice(0, 90),
                        value: `${meta.wins}W/${meta.losses}L`,
                        subtext: meta.status,
                        color: meta.status === 'confirmed' ? 'text-emerald-400' : meta.status === 'retired' ? 'text-zinc-600' : 'text-cyan-300',
                    }))}
                    emptyText="No skills learned yet — close trades with post-mortems to grow skill memory"
                />

                <StatCard
                    title="Best Coins"
                    items={profile.bestCoins.slice(0, 4).map(c => ({
                        name: c.coin,
                        value: `${c.winRate}%`,
                        subtext: `(n=${c.count})`,
                        color: getWinRateColor(c.winRate)
                    }))}
                />

                {/* Best Patterns */}
                <StatCard
                    title="Best Patterns"
                    items={profile.bestPatterns.slice(0, 4).map(p => ({
                        name: p.pattern,
                        value: `${p.winRate}%`,
                        subtext: `(n=${p.count})`,
                        color: getWinRateColor(p.winRate)
                    }))}
                />

                {/* Best Directions */}
                <StatCard
                    title="Direction Performance"
                    items={profile.bestDirections.map(d => ({
                        name: d.direction,
                        value: `${d.winRate}%`,
                        subtext: `(n=${d.count})`,
                        color: getWinRateColor(d.winRate)
                    }))}
                />

                {/* Market Regimes */}
                <StatCard
                    title="Regime Performance"
                    items={profile.bestRegimes.map(r => ({
                        name: r.regime,
                        value: `${r.winRate}%`,
                        subtext: `(n=${r.count})`,
                        color: getWinRateColor(r.winRate)
                    }))}
                />

                <StatCard
                    title="Prompt versions"
                    items={promptVersions.slice(0, 5).map(v => ({
                        name: v.version,
                        value: v.winRate !== null ? `${v.winRate}%` : '—',
                        subtext: v.avgDeclared !== null
                            ? `(n=${v.trades} · said ${v.avgDeclared}% vs ${v.avgRealized}%)`
                            : `(n=${v.trades})`,
                        color: v.winRate !== null ? getWinRateColor(v.winRate) : 'text-zinc-500',
                    }))}
                    emptyText="Log closed trades after a run to compare prompt versions"
                />
                <StatCard
                    title="Prompt A/B lanes"
                    items={promptLanes.filter(l => l.trades > 0).map(l => ({
                        name: l.lane,
                        value: l.winRate !== null ? `${l.winRate}%` : '—',
                        subtext: `(n=${l.trades})`,
                        color: l.winRate !== null ? getWinRateColor(l.winRate) : 'text-zinc-500',
                    }))}
                    emptyText="Need closed trades on both live and control lanes"
                />
                <StatCard
                    title="Skills"
                    items={notebookSkills.slice(0, 6).map(({ meta, file }) => {
                        const review = skillReview.find(r => r.fileId === file.id);
                        const lift = skillLifts.find(l => l.fileId === file.id);
                        const liftPct = lift?.lift != null ? Math.round(lift.lift * 100) : null;
                        return {
                            name: file.name.replace(/\.md$/i, ''),
                            value: meta.wins + meta.losses > 0
                                ? `${Math.round((meta.wins / (meta.wins + meta.losses)) * 100)}%`
                                : meta.status,
                            subtext: [
                                review ? review.recommendation.toUpperCase() : meta.kind,
                                `${meta.wins}/${meta.losses}`,
                                meta.evalVerdict ? `eval:${meta.evalVerdict}` : null,
                                liftPct !== null ? `lift ${liftPct > 0 ? '+' : ''}${liftPct}pp` : null,
                            ].filter(Boolean).join(' · '),
                            color: review?.recommendation === 'retire' || review?.recommendation === 'demote' || meta.evalVerdict === 'hurts' || (lift?.verdict === 'negative')
                                ? 'text-red-400'
                                : review?.recommendation === 'promote' || lift?.verdict === 'positive'
                                    ? 'text-emerald-400'
                                    : 'text-white',
                        };
                    })}
                    emptyText="Closed trades with an IF/THEN become skills"
                />
                <StatCard
                    title="Model calibration (Brier)"
                    items={calibrationSummaries.slice(0, 6).map(c => ({
                        name: c.provider,
                        value: c.brierScore !== null ? c.brierScore.toFixed(3) : '—',
                        subtext: `${c.verdict === 'calibrated' ? 'calibrated' : c.verdict.replace('-', ' ')}${c.highGap !== null ? ` · High gap ${c.highGap > 0 ? '+' : ''}${c.highGap}%` : ''} (n=${c.samples})`,
                        color: c.verdict === 'overconfident'
                            ? 'text-red-400'
                            : c.verdict === 'underconfident'
                                ? 'text-yellow-500'
                                : c.verdict === 'calibrated'
                                    ? 'text-emerald-400'
                                    : 'text-zinc-500',
                    }))}
                    emptyText="Close trades to measure whether model confidence means anything — lower Brier = better calibrated (chance ≈ 0.25)"
                />
                <StatCard
                    title="Conviction auction"
                    items={convictionSummaries.slice(0, 6).map(c => ({
                        name: c.name,
                        value: `${c.avgConviction.toFixed(0)}/100`,
                        subtext: `avg sealed conviction · ${c.debateCount} debate${c.debateCount === 1 ? '' : 's'} · last ${c.lastValue}`,
                        color: c.avgConviction >= 70
                            ? 'text-emerald-400'
                            : c.avgConviction >= 45
                                ? 'text-zinc-300'
                                : 'text-yellow-500',
                    }))}
                    emptyText="Run debates to see each seat's average sealed conviction (0-100)"
                />
            </div>

            {/* Setups to Avoid */}
            {profile.worstSetups.length > 0 && (
                <div className="bg-red-950/20 rounded-xl border border-red-500/20 p-3 sm:p-4">
                    <h4 className="text-[10px] sm:text-xs font-bold text-red-400 uppercase tracking-wider mb-2 sm:mb-3 flex items-center gap-2">
                        Setups to Avoid
                    </h4>
                    <div className="space-y-2">
                        {profile.worstSetups.slice(0, 4).map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-zinc-400 truncate pr-2">{s.description}</span>
                                <span className="text-red-400 font-bold whitespace-nowrap">{s.winRate}% WR</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/*Confidence Calibration */}
            {profile.confidenceAccuracy.length > 0 && (
                <div className="bg-zinc-800 rounded-xl border border-white/5 p-3 sm:p-4">
                    <h4 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 sm:mb-4">
                        Confidence Calibration
                    </h4>
                    <div className="space-y-4">
                        {profile.confidenceAccuracy
                            .filter(c => c.count >= 3)
                            .map((c, i) => {
                                const expected = c.level === 'High' ? 70 : c.level === 'Medium' ? 55 : 40;
                                return (
                                    <CalibrationBar
                                        key={i}
                                        label={`${c.level} Confidence`}
                                        actual={c.winRate}
                                        expected={expected}
                                        count={c.count}
                                    />
                                );
                            })}
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-4">
                        * White line = expected win rate for that confidence level
                    </p>
                </div>
            )}

            {/* Last Updated */}
            <p className="text-[10px] text-zinc-600 text-center">
                Last updated: {new Date(profile.lastUpdated).toLocaleString()}
            </p>
        </div>
    );
};

export default LearningDashboard;


import React, { useEffect, useMemo, useState } from 'react';
import { LoggedTrade, MemoryFile } from '../../../types';
import type { PersonalizedLearningProfile } from '../../../services/learning/SelfLearningService';
import type { SkillEffectiveness, SkillMeta } from '../../../services/learning/SkillMemoryService';
import type { SkillLiftResult } from '../../../services/learning/MemoryProvenanceService';
import { summarizePromptVersions, summarizePromptLanes } from '../../../utils/promptVersionStats';
import { getCalibrationSummaries } from '../../../services/backtesting/ModelPerformanceService';
import { getActiveUsername } from '../../../utils/activeUser';
import { StatCard } from './StatCard';
import { getWinRateColor } from './shared';
import type { Notebook } from './shared';

interface TraderProfileCardsProps {
    /** The full log — conviction drift reads debate transcripts from every trade. */
    trades: LoggedTrade[];
    /** Closed trades inside the active time window. */
    closedWindowed: LoggedTrade[];
    /** Identity-only: a notebook refresh re-reads the veto ledger. */
    notebook: Notebook;
    username?: string;
    profile: PersonalizedLearningProfile;
    notebookSkills: Array<{ file: MemoryFile; meta: SkillMeta }>;
    skillReview: SkillEffectiveness[];
    skillLifts: SkillLiftResult[];
}

/** Every card the profile branch shows: skills, tide, prompt versions,
 *  calibration, conviction, vetoes, and this week's belief changes. */
export const TraderProfileCards: React.FC<TraderProfileCardsProps> = ({
    trades, closedWindowed, notebook, username, profile, notebookSkills, skillReview, skillLifts,
}) => {
    // Skill vs tide: the same win-rate question asked the honest way — did the
    // call beat just HOLDING the benchmark (BTC, or the ETH pairs' own ETH)
    // over its window? Trades without a settled alpha are simply not counted.
    const tideStats = useMemo(() => {
        const withAlpha = closedWindowed.filter(t => t.benchmark && Number.isFinite(t.benchmark.alphaPct));
        if (withAlpha.length === 0) return { n: 0, beatPct: null as number | null, avgAlpha: null as number | null };
        const beat = withAlpha.filter(t => (t.benchmark?.alphaPct ?? 0) > 0).length;
        const avg = withAlpha.reduce((s, t) => s + (t.benchmark?.alphaPct ?? 0), 0) / withAlpha.length;
        return { n: withAlpha.length, beatPct: Math.round((beat / withAlpha.length) * 100), avgAlpha: Math.round(avg * 10) / 10 };
    }, [closedWindowed]);

    const promptVersions = useMemo(() => summarizePromptVersions(closedWindowed), [closedWindowed]);
    const promptLanes = useMemo(() => summarizePromptLanes(closedWindowed), [closedWindowed]);

    // Brier summaries are a cheap sync read of a cached store, but the store
    // mutates as trades settle — recompute with the trade log so a refresh
    // actually refreshes (the old [] deps served the first snapshot forever).
    const calibrationSummaries = useMemo(() => getCalibrationSummaries().filter(c => c.samples > 0), [trades]);

    // Veto falsification rollup: per-skill hits/runs/pending
    // from the veto ledger — refreshed with the notebook.
    const [vetoAccuracy, setVetoAccuracy] = useState<Record<string, { hits: number; runs: number; pending: number }>>({});
    useEffect(() => {
        let cancelled = false;
        const user = username || getActiveUsername();
        import('../../../services/ui/VetoLedgerService').then(({ VetoLedgerService }) =>
            VetoLedgerService.getAccuracyBySkill(user).then(acc => {
                if (!cancelled) setVetoAccuracy(acc);
            }));
        return () => { cancelled = true; };
    }, [username, notebook]);

    // Weekly memory-changes digest: aggregate every temporal
    // ledger entry stamped in the last 7 days across all skills. Pure
    // read-side aggregation — the ledgers themselves are already persisted.
    const memoryChanges = useMemo(() => {
        const cutoff = Date.now() - 7 * 86_400_000;
        const out: Array<{ name: string; action: string; why: string; color: string; at: number }> = [];
        for (const { meta, file } of notebookSkills) {
            for (const h of meta.history ?? []) {
                const t = Date.parse(h.validFrom);
                if (!Number.isFinite(t) || t < cutoff) continue;
                const name = file.name.replace(/\.md$/i, '');
                if (h.status === 'confirmed') {
                    out.push({
                        name,
                        action: 'confirmed',
                        why: h.reason || 'evidence crossed the bar',
                        color: 'text-emerald-400',
                        at: t,
                    });
                } else if (h.status === 'candidate') {
                    out.push({
                        name,
                        action: 'demoted',
                        why: h.reason || 'lost authority',
                        color: 'text-yellow-500',
                        at: t,
                    });
                } else if (h.status === 'retired') {
                    out.push({
                        name,
                        action: 'retired',
                        why: h.reason || 'evidence said stop',
                        color: 'text-red-400',
                        at: t,
                    });
                }
            }
        }
        // Newest belief change first — this is a timeline, not an alphabet.
        return out.sort((a, b) => b.at - a.at).slice(0, 12);
    }, [notebookSkills]);

    // Conviction auction history: scan stored debate transcripts for each
    // seat's sealed CONVICTION lines and average them.
    const convictionSummaries = useMemo(() => {
        const bySeat = new Map<string, { total: number; count: number; last: number; deltas: number[] }>();
        for (const trade of trades) {
            const turns = trade.debateTurns;
            if (!Array.isArray(turns)) continue;
            // Collect the seat's FULL ordered trajectory in this debate,
            // not just the first sealed line — the within-debate movement is
            // the persuasion signal.
            const trajBySeat = new Map<string, number[]>();
            for (const t of turns) {
                if (t.speaker === 'Moderator' || t.speaker === 'System') continue;
                const mAll = [...t.text.matchAll(/CONVICTION:\s*(\d{1,3})/gi)];
                if (mAll.length === 0) continue;
                const v = Math.min(100, Math.max(0, parseInt(mAll[mAll.length - 1][1], 10)));
                const arr = trajBySeat.get(t.speaker) ?? [];
                arr.push(v);
                trajBySeat.set(t.speaker, arr);
            }
            for (const [seat, vals] of trajBySeat) {
                if (vals.length === 0) continue;
                const cur = bySeat.get(seat) ?? { total: 0, count: 0, last: vals[vals.length - 1], deltas: [] };
                cur.total += vals[0];
                cur.count += 1;
                cur.last = vals[vals.length - 1];
                if (vals.length >= 2) cur.deltas.push(vals[vals.length - 1] - vals[0]);
                bySeat.set(seat, cur);
            }
        }
        return [...bySeat.entries()].map(([name, s]) => {
            const movedCount = s.deltas.filter(d => d !== 0).length;
            return {
                name,
                avgConviction: s.total / Math.max(s.count, 1),
                debateCount: s.count,
                lastValue: s.last,
                // Mean within-debate drift + how often it moves.
                avgDelta: s.deltas.length > 0 ? s.deltas.reduce((a, b) => a + b, 0) / s.deltas.length : 0,
                moveRate: s.deltas.length > 0 ? movedCount / s.deltas.length : 0,
            };
        }).sort((a, b) => b.avgConviction - a.avgConviction);
    }, [trades]);

    return (
        <div className="grid grid-cols-1 gap-3 sm:gap-4">
            {/* Best Coins */}
            <StatCard
                title="Learned Skills"
                items={notebookSkills.slice(0, 5).map(({ meta, file }) => ({
                    name: `${meta.kind === 'avoid' ? 'Avoid' : 'Repeat'}: ${meta.ifCondition || file.name.replace(/\.md$/i, '')}`.slice(0, 90),
                    value: `${Math.round(meta.wins)}W/${Math.round(meta.losses)}L`,
                    subtext: meta.status,
                    color: meta.status === 'confirmed' ? 'text-emerald-400' : meta.status === 'retired' ? 'text-zinc-600' : 'text-cyan-300',
                }))}
                emptyText="No skills learned yet — close trades with post-mortems to grow skill memory"
            />

            <StatCard
                title="Skill vs tide"
                items={tideStats.n > 0 ? [
                    {
                        name: `Beat holding BTC/ETH (${tideStats.n} settled)`,
                        value: `${tideStats.beatPct}%`,
                        color: getWinRateColor(tideStats.beatPct ?? 0),
                    },
                    {
                        name: 'Average alpha vs hold',
                        value: `${(tideStats.avgAlpha ?? 0) >= 0 ? '+' : ''}${tideStats.avgAlpha}%`,
                        color: (tideStats.avgAlpha ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                    },
                ] : []}
                emptyText="No benchmark-settled trades yet — outcomes verified from this version forward get a skill-vs-tide reading"
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
                            `${Math.round(meta.wins)}/${Math.round(meta.losses)}`,
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
                items={convictionSummaries.slice(0, 6).map(c => {
                    // Show the persuasion signal alongside the level.
                    const drift = c.debateCount > 0 && c.moveRate > 0
                        ? ` · ${c.moveRate >= 0.4 ? 'moves' : 'occasional'} (avg Δ${c.avgDelta > 0 ? '+' : ''}${c.avgDelta.toFixed(0)})`
                        : '';
                    return {
                        name: c.name,
                        value: `${c.avgConviction.toFixed(0)}/100`,
                        subtext: `avg sealed conviction · ${c.debateCount} debate${c.debateCount === 1 ? '' : 's'} · last ${c.lastValue}${drift}`,
                        color: c.avgConviction >= 70
                            ? 'text-emerald-400'
                            : c.avgConviction >= 45
                                ? 'text-zinc-300'
                                : 'text-yellow-500',
                    };
                })}
                emptyText="Run debates to see each seat's average sealed conviction (0-100)"
            />
            <StatCard
                title="Veto accuracy"
                items={Object.entries(vetoAccuracy)
                    .filter(([, a]) => a.hits + a.runs + a.pending > 0)
                    .sort((x, y) => (y[1].hits + y[1].runs) - (x[1].hits + x[1].runs))
                    .slice(0, 6)
                    .map(([name, a]) => {
                        const settled = a.hits + a.runs;
                        return {
                            name: name.replace(/\.md$/i, ''),
                            value: settled > 0 ? `${Math.round((a.hits / settled) * 100)}%` : '…',
                            subtext: `${a.hits} vindicated · ${a.runs} blocked a winner${a.pending ? ` · ${a.pending} watching` : ''}`,
                            color: settled === 0
                                ? 'text-zinc-500'
                                : a.hits / settled >= 0.6
                                    ? 'text-emerald-400'
                                    : a.runs > a.hits
                                        ? 'text-red-400'
                                        : 'text-yellow-500',
                        };
                    })}
                emptyText="Vetoes appear once an avoid skill blocks a setup — price paths grade them afterward"
            />
            <StatCard
                title="Memory changes (7d)"
                items={memoryChanges.length > 0 ? memoryChanges.slice(0, 6).map(c => ({
                    name: c.name,
                    value: c.action,
                    subtext: c.why,
                    color: c.color,
                })) : []}
                emptyText="No belief changes this week — evidence, evals and merges stamp the ledger here"
            />
        </div>
    );
};

export default TraderProfileCards;

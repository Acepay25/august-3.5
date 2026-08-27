import React, { useEffect, useMemo, useState } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
import { listAppliedSkills } from '../../services/learning/SkillMemoryService';
import { initMemoryFiles } from '../../services/learning/MemoryFilesService';
import { signalDirectionLabel } from '../../utils/analysisUtils';

interface DebateSummaryProps {
    debateTurns: DebateTurn[];
    analysis: TradeAnalysis | null;
}

const callFromText = (text: string): 'Long' | 'Short' | 'Neutral' => {
    const upper = text.toUpperCase();
    if (/\b(?:LONG|BULLISH)\b/.test(upper)) return 'Long';
    if (/\b(?:SHORT|BEARISH)\b/.test(upper)) return 'Short';
    return 'Neutral';
};

const CONVICTION_RE = /^\s*CONVICTION:\s*(\d{1,3})\b/im;

/** Each seat's LAST sealed conviction line across the transcript — the
 *  auction the Moderator alone sees at verdict time, made visible. */
const convictionsFromTurns = (debateTurns: DebateTurn[]): Array<{ name: string; value: number }> => {
    const bySeat = new Map<string, number>();
    for (const t of debateTurns) {
        if (t.speaker === 'Moderator' || t.speaker === 'System') continue;
        const m = (t.text || '').match(CONVICTION_RE);
        if (!m) continue;
        bySeat.set(t.speaker, Math.min(100, Math.max(0, parseInt(m[1], 10))));
    }
    return [...bySeat.entries()].map(([name, value]) => ({ name, value }));
};

/**
 * Compact board: each analyst's opening call plus the moderator merge line.
 * Levels stay on the trading signal.
 */
const DebateSummary: React.FC<DebateSummaryProps> = ({ debateTurns, analysis }) => {
    const [notebookReady, setNotebookReady] = useState(false);
    useEffect(() => {
        const user = localStorage.getItem('last_active_user') || 'default';
        void initMemoryFiles(user).then(() => setNotebookReady(true));
    }, []);
    const board = useMemo(() => {
        if (!analysis) return null;
        const analystTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && t.round === 1);
        const rows = analystTurns.map(t => ({
            name: t.speaker,
            call: callFromText(t.text),
        }));
        const uniqueDirections = [...new Set(rows.map(r => r.call))];
        const consensus = analysis.analystConsensus?.entries ?? [];
        const consensusRows = consensus.map(a => ({
            name: a.displayName || a.providerId,
            call: (a.direction === 'Long' || a.direction === 'Short' ? a.direction : 'Neutral') as 'Long' | 'Short' | 'Neutral',
        }));
        const displayRows = consensusRows.length > 0 ? consensusRows : rows;
        const droppedCalls = uniqueDirections.filter(d => d !== analysis.direction);
        const droppedLanes = [...new Set(
            debateTurns
                .filter(t => t.speaker === 'System' && /dropped out/i.test(t.text))
                .map(t => t.text.replace(/\s+dropped out[\s\S]*/i, '').trim())
                .filter(Boolean),
        )];
        return {
            direction: analysis.direction,
            confidence: analysis.confidence,
            grade: analysis.grade,
            rows: displayRows,
            convictions: convictionsFromTurns(debateTurns),
            mergeLine: uniqueDirections.length > 1
                ? `Moderator kept ${analysis.direction}, dropped ${droppedCalls.join(' / ') || 'the rest'}.`
                : `Openings aligned ${analysis.direction}.`,
            rosterNote: droppedLanes.length > 0
                ? `${droppedLanes.join(', ')} left the floor.`
                : '',
            skills: notebookReady ? listAppliedSkills(analysis) : [],
        };
    }, [analysis, debateTurns, notebookReady]);

    if (!board) return null;

    const isNoTrade = board.confidence === 'Avoid' || board.direction === 'Neutral';

    return (
        <div className="status-surface px-4 py-3 sm:px-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Board</span>
                <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    isNoTrade
                        ? 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400'
                        : board.direction === 'Long'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                            : board.direction === 'Short'
                                ? 'border-rose-500/20 bg-rose-500/10 text-rose-400'
                                : 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400'
                }`}>
                    {signalDirectionLabel(board.direction, board.confidence)}
                </span>
                {board.grade && (
                    <span className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        Grade {board.grade}
                    </span>
                )}
                <span className="text-[10px] font-semibold text-zinc-400">{board.confidence}</span>
            </div>
            {board.rows.length > 0 && (
                <table className="w-full table-fixed border-collapse text-xs">
                    <thead>
                        <tr>
                            {board.rows.map(row => (
                                <th key={row.name} className="border border-white/10 bg-zinc-900/50 px-2 py-1.5 text-left text-[11px] font-medium text-zinc-400">
                                    <span className="block truncate" title={row.name}>{row.name}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            {board.rows.map(row => (
                                <td key={row.name} className="border border-white/10 px-2 py-1.5 text-sm font-semibold text-zinc-100">
                                    {row.call}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                {board.mergeLine}
                {board.rosterNote ? ` ${board.rosterNote}` : ''}
            </p>
            {/* Sealed conviction auction — each seat's private 0-100 stake in
                its own stance, unsealed for the trader after the verdict. */}
            {board.convictions.length > 0 && (() => {
                const values = board.convictions.map(c => c.value);
                const spread = Math.max(...values) - Math.min(...values);
                return (
                    <div className="mt-3">
                        <p className="mb-1.5 flex items-baseline gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                            Conviction auction
                            <span
                                className="font-medium normal-case tracking-normal text-zinc-500"
                                title="Spread between the highest and lowest sealed conviction. Tight = the floor genuinely agrees; wide = the verdict sided with a minority."
                            >
                                {spread <= 10
                                    ? `tight spread (${spread}) — the floor genuinely agreed`
                                    : `wide spread (${spread}) — the floor did NOT agree`}
                            </span>
                        </p>
                        <div className="space-y-1">
                            {board.convictions.map(c => (
                                <div key={c.name} className="flex items-center gap-2">
                                    <span className="w-20 shrink-0 truncate text-[11px] text-zinc-400" title={c.name}>{c.name}</span>
                                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                        <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${c.value}%` }} />
                                    </span>
                                    <span className="w-7 shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-300">{c.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}
            {board.skills.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                    {board.skills.map(s => (
                        <li key={`${s.kind}-${s.title}`} className="max-w-full rounded-md border border-white/10 px-2.5 py-1.5">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500">{s.status} {s.kind}</span>
                            {s.hitRate !== null && (
                                <span className="ml-1 tabular-nums text-[10px] text-zinc-500">{s.wins}/{s.wins + s.losses}</span>
                            )}
                            <span className="ml-1.5 text-[12px] text-zinc-100">{s.title}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default DebateSummary;

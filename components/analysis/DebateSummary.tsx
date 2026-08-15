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
            mergeLine: uniqueDirections.length > 1
                ? `Moderator kept ${analysis.direction}, dropped ${droppedCalls.join(' / ') || 'the rest'}.`
                : `Openings aligned ${analysis.direction}.`,
            rosterNote: droppedLanes.length > 0
                ? `Verdict used ${Math.max(1, displayRows.length)} analyst${displayRows.length === 1 ? '' : 's'}; ${droppedLanes.join(', ')} left the floor.`
                : '',
            skills: notebookReady ? listAppliedSkills(analysis) : [],
        };
    }, [analysis, debateTurns, notebookReady]);

    if (!board) return null;

    const isNoTrade = board.confidence === 'Avoid' || board.direction === 'Neutral';

    return (
        <div className="status-surface h-full px-4 py-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Board</div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
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
            <ul className="space-y-1">
                {board.rows.map(row => (
                    <li key={row.name} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="truncate text-zinc-300">{row.name}</span>
                        <span className="shrink-0 text-zinc-500">{row.call}</span>
                    </li>
                ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{board.mergeLine}</p>
            {board.rosterNote && (
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{board.rosterNote}</p>
            )}
            {board.skills.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-white/5 pt-2">
                    {board.skills.map(s => (
                        <li key={`${s.kind}-${s.title}`} className="rounded-lg border border-white/5 bg-zinc-900/40 px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-zinc-600">
                                <span>{s.status} {s.kind}</span>
                                {s.hitRate !== null && <span className="tabular-nums text-zinc-400">{s.wins}/{s.wins + s.losses} · {s.hitRate}%</span>}
                            </div>
                            <div className="mt-0.5 text-[12px] text-zinc-200">{s.title}</div>
                            {s.procedure && (
                                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{s.procedure.slice(0, 120)}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default DebateSummary;

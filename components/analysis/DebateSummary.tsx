import React, { useMemo } from 'react';
import { DebateTurn, TradeAnalysis } from '../../types';
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
        const dropped = uniqueDirections.filter(d => d !== analysis.direction);
        return {
            direction: analysis.direction,
            confidence: analysis.confidence,
            grade: analysis.grade,
            rows: displayRows,
            mergeLine: uniqueDirections.length > 1
                ? `Moderator kept ${analysis.direction}, dropped ${dropped.join(' / ') || 'the rest'}.`
                : `Openings aligned ${analysis.direction}.`,
        };
    }, [analysis, debateTurns]);

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
        </div>
    );
};

export default DebateSummary;

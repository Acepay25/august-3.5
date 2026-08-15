import React, { useEffect, useMemo, useState } from 'react';
import { DebateRunEvent, RunStats } from '../../types';
import { formatChars, summarizeRunUsage } from '../../utils/runUsage';

interface DebateRunLogProps {
    events: DebateRunEvent[];
    runStats?: RunStats;
    defaultOpen?: boolean;
}

const relativeSeconds = (events: DebateRunEvent[], at: string): string => {
    const start = Date.parse(events[0]?.at || '');
    const now = Date.parse(at);
    if (!Number.isFinite(start) || !Number.isFinite(now)) return '';
    const sec = Math.max(0, Math.round((now - start) / 1000));
    return `${sec}s`;
};

const DebateRunLog: React.FC<DebateRunLogProps> = ({ events, runStats, defaultOpen = false }) => {
    const [open, setOpen] = useState(defaultOpen);
    const [isReplaying, setIsReplaying] = useState(false);
    const [index, setIndex] = useState(events.length);
    const usage = runStats ? summarizeRunUsage(runStats) : null;

    useEffect(() => {
        if (!isReplaying) return;
        if (index >= events.length) {
            setIsReplaying(false);
            return;
        }
        const timer = window.setTimeout(() => setIndex(i => i + 1), 700);
        return () => window.clearTimeout(timer);
    }, [isReplaying, index, events.length]);

    const visible = useMemo(
        () => (isReplaying ? events.slice(0, index) : events),
        [events, index, isReplaying],
    );

    if (events.length === 0 && !usage) return null;

    return (
        <div className="border-t border-white/5 px-4 py-3">
            {events.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className="text-[12px] font-medium text-zinc-300"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={open}
                    >
                        {open ? '▾' : '▸'} Trajectory
                    </button>
                    <span className="text-[11px] text-zinc-600">{events.length} events</span>
                    <button
                        type="button"
                        className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-300"
                        onClick={() => {
                            if (isReplaying) {
                                setIsReplaying(false);
                                setIndex(events.length);
                            } else {
                                setOpen(true);
                                setIndex(0);
                                setIsReplaying(true);
                            }
                        }}
                    >
                        {isReplaying ? 'Stop replay' : 'Replay'}
                    </button>
                </div>
            )}
            {open && events.length > 0 && (
                <ol className="mt-2 max-h-48 space-y-0.5 overflow-y-auto custom-scrollbar font-mono text-[11px] leading-5 text-zinc-400">
                    {visible.map((event, i) => (
                        <li key={`${event.at}-${i}`} className="flex gap-2">
                            <span className="w-8 shrink-0 tabular-nums text-zinc-600">{relativeSeconds(events, event.at)}</span>
                            <span className="w-16 shrink-0 text-zinc-500">{event.kind}</span>
                            <span className="min-w-0 truncate">
                                {event.round !== undefined ? `r${event.round} ` : ''}
                                {event.speaker ? `${event.speaker} · ` : ''}
                                {event.detail}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {usage && (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                    <span>{usage.durationSec}s</span>
                    {usage.analystCount > 0 && <span>{usage.analystCount} analysts</span>}
                    {usage.tokensEst > 0 && <span>{usage.tokensExact ? '' : '~'}{formatChars(usage.tokensEst)} tok</span>}
                    {usage.costUsd !== undefined && usage.costUsd > 0 && <span>${usage.costUsd.toFixed(3)}</span>}
                    {usage.charsOut > 0 && <span>{formatChars(usage.charsOut)} chars</span>}
                    {usage.gateCapPct !== undefined && <span>gate {usage.gateCapPct}%</span>}
                    {usage.mcWinRate !== undefined && <span>MC {usage.mcWinRate}%{usage.mcEV !== undefined ? ` ${usage.mcEV > 0 ? '+' : ''}${usage.mcEV}R` : ''}</span>}
                    {usage.similarSetups !== undefined && usage.similarSetups > 0 && (
                        <span>
                            Similar {usage.similarSetups}
                            {usage.similarWinRate !== undefined ? ` · ${usage.similarWinRate.toFixed(0)}% WR` : ''}
                            {usage.similarEV !== undefined ? ` · ${usage.similarEV > 0 ? '+' : ''}${usage.similarEV}R` : ''}
                        </span>
                    )}
                </p>
            )}
        </div>
    );
};

export default React.memo(DebateRunLog);

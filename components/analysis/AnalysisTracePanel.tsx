import React, { useMemo } from 'react';
import { Message } from '../../types';
import { buildAnalysisTrace, formatTraceTime } from '../../utils/analysisTrace';

interface AnalysisTracePanelProps {
    message: Message;
}

const toneClass: Record<'neutral' | 'good' | 'warning' | 'blocked', string> = {
    neutral: 'border-white/10 bg-zinc-900/60',
    good: 'border-emerald-500/20 bg-emerald-500/5',
    warning: 'border-amber-500/20 bg-amber-500/5',
    blocked: 'border-rose-500/20 bg-rose-500/5',
};

const AnalysisTracePanel: React.FC<AnalysisTracePanelProps> = ({ message }) => {
    const events = useMemo(() => buildAnalysisTrace(message), [message]);
    return (
        <details className="mt-3 border-t border-white/5 pt-2">
            <summary className="cursor-pointer list-none text-[10px] font-medium uppercase tracking-widest text-zinc-500 hover:text-zinc-300">
                Analysis trace · {events.length} events
            </summary>
            <div className="mt-3 space-y-2" aria-label="Analysis trace events">
                {events.map(event => (
                    <div key={event.id} className={`rounded-lg border px-3 py-2 ${toneClass[event.tone]}`}>
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-300">{event.label}</span>
                            {formatTraceTime(event.at) && <time className="shrink-0 text-[10px] tabular-nums text-zinc-600">{formatTraceTime(event.at)}</time>}
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-zinc-500">{event.detail}</p>
                    </div>
                ))}
            </div>
        </details>
    );
};

export default React.memo(AnalysisTracePanel);

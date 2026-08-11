import React, { useMemo, useState } from 'react';
import { Message, EnsembleAnalystProgress, DebateTurn } from '../../types';
import { Task, TaskTrigger, TaskContent } from '../ui/task';
import { ChevronDownIcon } from '../shared/Icons';

interface LiveThinkingAccordionProps {
    message: Message;
    modelIdToName: Record<string, string>;
}

const STATUS_STYLE: Record<EnsembleAnalystProgress['status'], { label: string; dot: string; chip: string }> = {
    waiting: { label: 'queued', dot: 'bg-zinc-600', chip: 'text-zinc-500 border-zinc-700 bg-zinc-900' },
    analyzing: { label: 'thinking', dot: 'bg-cyan-400 animate-pulse', chip: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
    complete: { label: 'done', dot: 'bg-emerald-400', chip: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    error: { label: 'unavailable this round', dot: 'bg-rose-400', chip: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
};

/**
 * ⑤ Live thinking line + accordion — the single "what's happening under the
 * hood" surface during a debate. Defaults to one compact line:
 *
 *   ● ● ●  macro & technical thinking · round 2 of 3   [show]
 *   ! risk unavailable this round
 *
 * [show] expands into a per-analyst accordion (reusing the shadcn Task
 * component): avatar dot, name, model, live status (thinking / done /
 * unavailable), and a live-streamed reasoning excerpt per analyst —
 * individually collapsible. A dropped/rate-limited analyst stays VISIBLE as
 * "unavailable this round" instead of silently vanishing.
 */
const LiveThinkingAccordion: React.FC<LiveThinkingAccordionProps> = ({ message, modelIdToName }) => {
    const [expanded, setExpanded] = useState(false);

    const analysts = useMemo(() => message.ensembleProgress?.analysts ?? [], [message.ensembleProgress]);

    // Current round from the turns parsed so far (rounds are derived from
    // moderator turns); 0 = no turns yet.
    const currentRound = useMemo(() => {
        const rounds = (message.debateTurns ?? []).map((t: DebateTurn) => t.round ?? 1);
        return rounds.length > 0 ? Math.max(...rounds) : 0;
    }, [message.debateTurns]);

    const thinkingCount = analysts.filter(a => a.status === 'analyzing').length;
    const unavailable = analysts.filter(a => a.status === 'error');

    if (analysts.length === 0 && !message.isDebating) return null;

    return (
        <div className="mt-3 rounded-xl border border-white/5 bg-zinc-900/60 overflow-hidden">
            {/* Compact line — always visible */}
            <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                {/* Dots: one per analyst, status-colored */}
                <span className="flex items-center gap-1 shrink-0" aria-hidden="true">
                    {analysts.map(a => (
                        <span key={a.key} className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[a.status].dot}`} title={`${a.displayName}: ${STATUS_STYLE[a.status].label}`} />
                    ))}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    {thinkingCount > 0 ? `${thinkingCount} ${thinkingCount === 1 ? 'analyst' : 'analysts'} thinking` : 'team thinking'}
                    {currentRound > 0 ? ` · round ${currentRound} of 3` : ''}
                </span>
                {unavailable.length > 0 && (
                    <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1" title={unavailable.map(a => a.error ?? a.displayName).join(' · ')}>
                        ! {unavailable.map(a => a.displayName.split(' ').pop()).join(', ')} unavailable this round
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    className="ml-auto text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-cyan-300 transition-colors flex items-center gap-1 shrink-0"
                    aria-expanded={expanded}
                >
                    {expanded ? 'Hide' : 'Show'} thinking <ChevronDownIcon className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Per-analyst accordion — only when expanded */}
            {expanded && (
                <div className="px-3 pb-3 space-y-1.5 border-t border-white/5 pt-2">
                    {analysts.map(a => {
                        const style = STATUS_STYLE[a.status];
                        const modelName = modelIdToName[a.modelId ?? ''] ?? a.modelName ?? '';
                        const reasoning = a.thoughtProcess || a.reasoning || '';
                        return (
                            <Task key={a.key} defaultOpen={a.status === 'analyzing' || a.status === 'error'}>
                                <TaskTrigger title="">
                                    <div className="w-full flex items-center gap-2 py-1 text-[10px] font-mono">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                                        <span className="text-zinc-300 font-bold truncate max-w-[110px]">{a.displayName}</span>
                                        {modelName && <span className="text-zinc-600 truncate max-w-[130px]">{modelName}</span>}
                                        <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ${style.chip}`}>{style.label}</span>
                                    </div>
                                </TaskTrigger>
                                <TaskContent>
                                    {a.status === 'error' ? (
                                        <p className="text-[10px] text-rose-300/90 leading-relaxed">
                                            {a.error ?? 'Dropped this round (provider error) — the ensemble continues with the remaining analysts.'}
                                        </p>
                                    ) : reasoning ? (
                                        <p className="text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-44 overflow-y-auto custom-scrollbar">{reasoning}</p>
                                    ) : (
                                        <p className="text-[10px] text-zinc-600 italic">
                                            {a.status === 'complete' ? 'No reasoning captured.' : 'Thinking…'}
                                        </p>
                                    )}
                                </TaskContent>
                            </Task>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default React.memo(LiveThinkingAccordion);

import React, { useEffect, useRef, useState } from 'react';
import { EnsembleProgress } from '../../types';
import { BotIcon, ChevronDownIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface EnsembleProgressChatProps {
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
}

const ACCENTS = [
    { color: '#8aabd8', border: 'rgba(138, 171, 216, 0.32)', surface: 'rgba(33, 47, 67, 0.28)' },
    { color: '#34d399', border: 'rgba(52, 211, 153, 0.32)', surface: 'rgba(6, 78, 59, 0.24)' },
    { color: '#fb7185', border: 'rgba(251, 113, 133, 0.32)', surface: 'rgba(127, 29, 29, 0.24)' },
];

const AnalystAvatar: React.FC<{ name: string; color: string }> = ({ name, color }) => (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-zinc-800 text-xs font-semibold text-zinc-100" style={{ borderColor: color }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
);

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({ progress, modelIdToName = {}, isLive = false }) => {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isLive && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [progress, isLive]);

    return (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
            <div ref={scrollRef} className="max-h-[560px] space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar">
                {progress.moderator.status === 'waiting' && progress.moderator.waitingFor?.map((name) => (
                    <div key={`waiting-${name}`} className="flex items-start justify-end gap-2.5">
                        <div className="max-w-[88%] rounded-2xl border border-cyan-400/15 bg-cyan-500/5 px-3.5 py-3">
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-300">
                                <span>Moderator</span>
                                <span className="text-[10px] font-normal text-zinc-600">Master Strategist</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" /></span>
                                Waiting for {name}
                            </div>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                    </div>
                ))}

                {progress.moderator.status === 'error' && (
                    <div className="flex items-start justify-end gap-2.5">
                        <div className="max-w-[88%] rounded-2xl border border-rose-400/20 bg-rose-500/5 px-3.5 py-3">
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-rose-300"><span>Moderator</span><span className="text-[10px] font-normal text-zinc-600">Ensemble status</span></div>
                            <div className="text-xs text-zinc-500">{progress.moderator.error || 'The ensemble could not continue.'}</div>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-300"><BotIcon /></div>
                    </div>
                )}

                {progress.moderator.status === 'reviewing' && (
                    <div className="flex items-start justify-end gap-2.5">
                        <div className="max-w-[88%] rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3.5 py-3">
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-300"><span>Moderator</span><span className="text-[10px] font-normal text-zinc-600">Master Strategist</span></div>
                            <div className="flex items-center gap-2 text-xs text-zinc-400"><span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" /></span>Reviewing all analyst outputs</div>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                    </div>
                )}

                {progress.analysts.map((analyst, index) => {
                    const accent = ACCENTS[index % ACCENTS.length];
                    const expanded = expandedKey === analyst.key;
                    const modelName = modelIdToName[analyst.modelId] ?? analyst.modelName;
                    const statusText = analyst.status === 'waiting' ? 'Waiting to start' : analyst.status === 'analyzing' ? 'Analyzing' : analyst.status === 'error' ? 'Unavailable' : 'Complete';
                    return (
                        <div key={analyst.key} className="flex items-start gap-2.5">
                            <AnalystAvatar name={analyst.displayName} color={accent.color} />
                            <div className="min-w-0 flex-1 rounded-2xl border bg-zinc-800/60 px-3.5 py-3" style={{ borderColor: accent.border, backgroundColor: analyst.status === 'complete' ? accent.surface : undefined }}>
                                <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => analyst.status === 'complete' && setExpandedKey(expanded ? null : analyst.key)} disabled={analyst.status !== 'complete'} aria-expanded={expanded}>
                                    <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-zinc-200">{analyst.displayName}</div><div className="truncate text-[10px] text-zinc-600">{modelName}</div></div>
                                    <span className="shrink-0 text-[10px] font-medium" style={{ color: accent.color }}>{statusText}</span>
                                    {analyst.status === 'complete' && <ChevronDownIcon className={`h-4 w-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                                </button>
                                {analyst.status === 'analyzing' && <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" /></span>Generating final output</div>}
                                {analyst.status === 'error' && <div className="mt-2 text-xs text-zinc-500">{analyst.error || 'This analyst was unavailable.'}</div>}
                                {expanded && <div className="mt-3 border-t border-white/5 pt-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Final output</div><MarkdownContent content={analyst.finalOutput || 'No final output returned.'} className="text-sm leading-relaxed text-zinc-300" />{analyst.reasoning && <details className="mt-3 rounded-lg border border-white/5 bg-black/20"><summary className="cursor-pointer px-2.5 py-2 text-[10px] uppercase tracking-widest text-zinc-500">Reasoning</summary><div className="border-t border-white/5 px-2.5 py-2"><MarkdownContent content={analyst.reasoning} className="text-xs text-zinc-500" /></div></details>}</div>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(EnsembleProgressChat);

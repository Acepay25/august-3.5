import React, { useEffect, useRef, useState } from 'react';
import { EnsembleAnalystProgress, EnsembleProgress } from '../../types';
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

const AnalystAvatar: React.FC<{ name: string; color: string; active?: boolean; small?: boolean }> = ({ name, color, active = false, small = false }) => (
    <div
        className={`${small ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-xs'} flex shrink-0 items-center justify-center rounded-full border bg-zinc-800 font-semibold text-zinc-100 transition-all ${active ? 'scale-110 shadow-[0_0_12px_-2px_currentColor]' : ''}`}
        style={{ borderColor: color, color }}
        title={name}
    >
        {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
);

const TypingDots: React.FC = () => (
    <span className="flex gap-1" aria-hidden="true">
        <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.2s]" />
        <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.1s]" />
        <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
    </span>
);

const getAnalystDetails = (analyst: EnsembleAnalystProgress): string | undefined => (
    analyst.reasoning || analyst.thoughtProcess || analyst.finalOutput
);

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({ progress, modelIdToName = {}, isLive = false }) => {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [isLiveExpanded, setIsLiveExpanded] = useState(false);
    const [typingIndex, setTypingIndex] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const activeAnalysts = progress.analysts.filter(analyst => analyst.status === 'analyzing');
    const waitingAnalysts = progress.analysts.filter(analyst => analyst.status === 'waiting');
    const typingAnalysts = activeAnalysts.length > 0 ? activeAnalysts : waitingAnalysts;
    const allAnalystsFinished = progress.analysts.length > 0 && progress.analysts.every(analyst => analyst.status === 'complete' || analyst.status === 'error');
    const hasFinalOutput = progress.analysts.some(analyst => Boolean(analyst.finalOutput));
    const showAnalystCards = !isLive || isLiveExpanded;

    useEffect(() => {
        if (isLive && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [progress, isLive]);

    useEffect(() => {
        if (!isLive || typingAnalysts.length < 2) {
            setTypingIndex(0);
            return undefined;
        }
        const timer = window.setInterval(() => {
            setTypingIndex(previous => (previous + 1) % typingAnalysts.length);
        }, 1100);
        return () => window.clearInterval(timer);
    }, [isLive, typingAnalysts.length, typingAnalysts.map(analyst => analyst.key).join('|')]);

    const activeTypingAnalyst = typingAnalysts[typingIndex % Math.max(typingAnalysts.length, 1)];
    const typingLabel = activeAnalysts.length > 0
        ? `${activeTypingAnalyst?.displayName || 'Analysts'} ${activeAnalysts.length > 1 ? 'are typing' : 'is typing'}`
        : waitingAnalysts.length > 0
            ? `Waiting for ${waitingAnalysts.length} analyst${waitingAnalysts.length === 1 ? '' : 's'}`
            : 'Preparing analyst outputs';

    const renderAnalystCard = (analyst: EnsembleAnalystProgress, index: number): React.ReactNode => {
        const accent = ACCENTS[index % ACCENTS.length];
        const expanded = expandedKey === analyst.key;
        const modelName = modelIdToName[analyst.modelId] ?? analyst.modelName;
        const details = getAnalystDetails(analyst);
        const canExpand = Boolean(details) || analyst.status === 'complete';
        const statusText = analyst.status === 'waiting'
            ? 'Waiting'
            : analyst.status === 'analyzing'
                ? 'Thinking'
                : analyst.status === 'error'
                    ? 'Unavailable'
                    : 'Complete';

        return (
            <div key={analyst.key} className="flex items-start gap-2.5">
                <AnalystAvatar name={analyst.displayName} color={accent.color} active={analyst.status === 'analyzing'} />
                <div className="min-w-0 flex-1 rounded-2xl border bg-zinc-800/60 px-3.5 py-3" style={{ borderColor: accent.border, backgroundColor: analyst.status === 'complete' ? accent.surface : undefined }}>
                    <button
                        type="button"
                        className={`flex w-full items-center gap-2 text-left ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
                        onClick={() => canExpand && setExpandedKey(expanded ? null : analyst.key)}
                        disabled={!canExpand}
                        aria-expanded={canExpand ? expanded : undefined}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-zinc-200">{analyst.displayName}</div>
                            <div className="truncate text-[10px] text-zinc-600">{modelName}</div>
                        </div>
                        <span className="shrink-0 text-[10px] font-medium" style={{ color: accent.color }}>{statusText}</span>
                        {canExpand && <ChevronDownIcon className={`h-4 w-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                    </button>

                    {analyst.status === 'analyzing' && <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500"><TypingDots />Generating final output</div>}
                    {analyst.status === 'waiting' && <div className="mt-2 text-xs text-zinc-600">Waiting to start</div>}
                    {analyst.status === 'error' && <div className="mt-2 text-xs text-zinc-500">{analyst.error || 'This analyst was unavailable.'}</div>}

                    {expanded && (
                        <div className="mt-3 border-t border-white/5 pt-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                {analyst.status === 'complete' ? 'Final output' : 'Thinking'}
                            </div>
                            {details ? (
                                <MarkdownContent content={details} className="text-sm leading-relaxed text-zinc-300" />
                            ) : (
                                <div className="text-xs italic text-zinc-600">This model has not shared reasoning yet.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
            <div ref={scrollRef} className="max-h-[560px] space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar">
                {progress.moderator.status === 'waiting' && (
                    <div className="flex items-start justify-end gap-2.5">
                        <div className="max-w-[88%] rounded-2xl border border-cyan-400/15 bg-cyan-500/5 px-3.5 py-3">
                            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-300"><span>Moderator</span><span className="text-[10px] font-normal text-zinc-600">Master Strategist</span></div>
                            <div className="flex items-center gap-2 text-xs text-zinc-500"><TypingDots />{progress.moderator.waitingFor?.length ? `Waiting for ${progress.moderator.waitingFor.length} analyst${progress.moderator.waitingFor.length === 1 ? '' : 's'}` : 'Waiting for analyst outputs'}</div>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                    </div>
                )}

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
                            <div className="flex items-center gap-2 text-xs text-zinc-400"><TypingDots />Reviewing all analyst outputs</div>
                        </div>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                    </div>
                )}

                {isLive && !allAnalystsFinished && (
                    <button
                        type="button"
                        onClick={() => setIsLiveExpanded(previous => !previous)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-3.5 py-3 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10"
                        aria-expanded={isLiveExpanded}
                    >
                        <div className="flex -space-x-2">
                            {progress.analysts.map((analyst, index) => (
                                <AnalystAvatar key={analyst.key} name={analyst.displayName} color={ACCENTS[index % ACCENTS.length].color} active={analyst.key === activeTypingAnalyst?.key} small />
                            ))}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300"><TypingDots />{typingLabel}</div>
                            <div className="mt-0.5 text-[10px] text-zinc-600">Click to view each analyst’s thinking</div>
                        </div>
                        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${isLiveExpanded ? 'rotate-180' : ''}`} />
                    </button>
                )}

                {showAnalystCards && progress.analysts.map(renderAnalystCard)}

                {isLive && isLiveExpanded && !allAnalystsFinished && hasFinalOutput && (
                    <div className="text-center text-[10px] text-zinc-600">Analysts are still finishing their outputs.</div>
                )}
            </div>
        </div>
    );
};

export default React.memo(EnsembleProgressChat);

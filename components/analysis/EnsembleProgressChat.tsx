import React, { useEffect, useRef, useState } from 'react';
import { EnsembleAnalystProgress, EnsembleProgress } from '../../types';
import { BotIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface EnsembleProgressChatProps {
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
    /** Live runs render their analyst list in the floating activity card. */
    hideSubagents?: boolean;
    /** Re-run affordance for failed analysts — wired by the host app (the
     *  pipeline has no per-analyst re-dispatch; the host re-runs the analysis
     *  with the same prompt context). */
    onRetryAnalyst?: (analystKey: string) => void;
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

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'Waiting',
    analyzing: 'Thinking',
    error: 'Unavailable',
    complete: 'Complete',
};

/**
 * Harness-style analyst card (Codex / Claude Code): the model's chain of
 * thought lives in a collapsible "Thinking" block, and the final output is
 * always rendered below it. While the analyst is streaming, both the card and
 * the Thinking block auto-expand so the live trace is visible; once complete,
 * the Thinking block collapses back to a one-click toggle.
 */
const AnalystRow: React.FC<{
    analyst: EnsembleAnalystProgress;
    modelName: string;
    accent: (typeof ACCENTS)[number];
    onRetryAnalyst?: (analystKey: string) => void;
}> = ({ analyst, modelName, accent, onRetryAnalyst }) => {
    const [open, setOpen] = useState(false);
    const [thinkingOpen, setThinkingOpen] = useState(false);
    // A manual toggle wins over streaming auto-expand: once the user collapses
    // the card or the Thinking block mid-stream, it stays collapsed.
    const userInteractedRef = useRef(false);

    const thinkingContent = analyst.reasoning || analyst.thoughtProcess || '';
    const isStreamingThinking = analyst.status === 'analyzing' && thinkingContent.length > 0;
    const expanded = open || (isStreamingThinking && !userInteractedRef.current);
    const showThinkingBlock = isStreamingThinking || thinkingContent.length > 0;

    return (
        <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: accent.border, backgroundColor: analyst.status === 'complete' ? accent.surface : undefined }}
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => { setOpen(o => !o); userInteractedRef.current = true; }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${analyst.displayName} analysis`}
                >
                    <AnalystAvatar name={analyst.displayName} color={accent.color} active={analyst.status === 'analyzing'} small />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-zinc-200">{analyst.displayName}</div>
                        <div className="truncate text-[10px] text-zinc-600">{modelName}</div>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium" style={{ color: accent.color }}>{STATUS_TEXT[analyst.status]}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-zinc-500">{expanded ? 'Hide' : 'View'}</span>
                    <span className={`shrink-0 text-[10px] text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
                </button>
                {analyst.status === 'error' && onRetryAnalyst && (
                    <button
                        type="button"
                        onClick={() => onRetryAnalyst(analyst.key)}
                        className="mr-2 shrink-0 rounded-lg border border-white/10 px-2 py-2 text-[9px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                        title="Re-run the analysis with this analyst included"
                    >
                        ↺
                    </button>
                )}
            </div>
            {expanded && (
                <div className="space-y-3 border-t border-white/5 px-2.5 pb-3 pt-2">
                    {showThinkingBlock && (
                        <details
                            className="rounded-lg border border-white/10 bg-black/20 group"
                            open={thinkingOpen || (isStreamingThinking && !userInteractedRef.current)}
                            onToggle={(e) => setThinkingOpen((e.target as HTMLDetailsElement).open)}
                        >
                            <summary
                                onClick={() => { userInteractedRef.current = true; }}
                                className="cursor-pointer list-none px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-400 group-open:text-zinc-200"
                            >
                                {isStreamingThinking ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400"></span>
                                        Thinking<span className="normal-case tracking-normal text-zinc-600">…</span>
                                    </span>
                                ) : (
                                    <>Thinking <span className="normal-case tracking-normal text-zinc-600">(expand)</span></>
                                )}
                            </summary>
                            <div className="border-t border-white/5 px-3 py-2">
                                <MarkdownContent content={thinkingContent} className="text-zinc-500" />
                            </div>
                        </details>
                    )}
                    {analyst.status === 'complete' && (
                        <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Final output</div>
                            {analyst.finalOutput ? (
                                <MarkdownContent content={analyst.finalOutput} className="text-sm leading-6 text-zinc-200" />
                            ) : (
                                <p className="text-xs italic text-zinc-600">No final output was captured for this analyst.</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const AnalystSubagents: React.FC<{
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
    onRetryAnalyst?: (analystKey: string) => void;
}> = ({ progress, modelIdToName = {}, isLive = false, onRetryAnalyst }) => {
    const activeAnalysts = progress.analysts.filter(analyst => analyst.status === 'analyzing');
    const waitingAnalysts = progress.analysts.filter(analyst => analyst.status === 'waiting');
    const typingLabel = activeAnalysts.length > 0
        ? `${activeAnalysts.length > 1 ? 'Analysts are' : activeAnalysts[0]?.displayName || 'Analyst is'} typing`
        : waitingAnalysts.length > 0
            ? `Waiting for ${waitingAnalysts.length} analyst${waitingAnalysts.length === 1 ? '' : 's'}`
            : 'Preparing analyst outputs';

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                <span>Subagents</span>
                <span className="text-zinc-700">{progress.analysts.length}</span>
                {isLive && <><span className="h-1 w-1 rounded-full bg-cyan-400" aria-hidden="true" /><span className="normal-case tracking-normal text-cyan-300/80">{typingLabel}</span></>}
            </div>
            {progress.analysts.map((analyst, index) => (
                <AnalystRow
                    key={analyst.key}
                    analyst={analyst}
                    modelName={modelIdToName[analyst.modelId] ?? analyst.modelName}
                    accent={ACCENTS[index % ACCENTS.length]}
                    onRetryAnalyst={onRetryAnalyst}
                />
            ))}
            <div className="px-1 text-[10px] text-zinc-600">Click an analyst to expand their thinking and final output.</div>
        </div>
    );
};

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({ progress, modelIdToName = {}, isLive = false, hideSubagents = false }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isLive && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [progress, isLive]);

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

                {!hideSubagents && progress.analysts.length > 0 && (
                    <AnalystSubagents progress={progress} modelIdToName={modelIdToName} isLive={isLive} />
                )}
            </div>
        </div>
    );
};

export default React.memo(EnsembleProgressChat);

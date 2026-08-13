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

const AnalystAvatar: React.FC<{ name: string; active?: boolean; small?: boolean }> = ({ name, active = false, small = false }) => (
    <div
        className={`${small ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-xs'} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 font-semibold text-zinc-200 ${active ? 'ring-1 ring-cyan-400/40' : ''}`}
        title={name}
    >
        {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
);

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'queued',
    analyzing: 'thinking',
    error: 'unavailable',
    complete: 'done',
};

const STATUS_CHIP: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'text-zinc-500 border-white/10 bg-zinc-900',
    analyzing: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
    error: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
    complete: 'text-zinc-300 border-white/10 bg-zinc-800',
};

/**
 * Zinc run-log row: avatar, name, model, status. Thinking stays collapsed
 * until the user opens it; the row still expands while a live stream is
 * in progress so the Thinking toggle is visible.
 */
const AnalystRow: React.FC<{
    analyst: EnsembleAnalystProgress;
    modelName: string;
    onRetryAnalyst?: (analystKey: string) => void;
}> = ({ analyst, modelName, onRetryAnalyst }) => {
    const [open, setOpen] = useState(false);
    const [thinkingOpen, setThinkingOpen] = useState(false);
    const userInteractedRef = useRef(false);

    const thinkingContent = analyst.reasoning || analyst.thoughtProcess || '';
    const isStreamingThinking = analyst.status === 'analyzing' && thinkingContent.length > 0;
    const expanded = open || (isStreamingThinking && !userInteractedRef.current);
    const showThinkingBlock = isStreamingThinking || thinkingContent.length > 0;

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => { setOpen(o => !o); userInteractedRef.current = true; }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${analyst.displayName} analysis`}
                >
                    <AnalystAvatar name={analyst.displayName} active={analyst.status === 'analyzing'} small />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-200">{analyst.displayName}</div>
                        <div className="truncate text-[11px] text-zinc-600">{modelName}</div>
                    </div>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] ${STATUS_CHIP[analyst.status]}`}>
                        {STATUS_TEXT[analyst.status]}
                    </span>
                </button>
                {analyst.status === 'error' && onRetryAnalyst && (
                    <button
                        type="button"
                        onClick={() => onRetryAnalyst(analyst.key)}
                        className="mr-2 shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
                        title="Re-run the analysis with this analyst included"
                    >
                        Retry
                    </button>
                )}
            </div>
            {expanded && (
                <div className="space-y-3 border-t border-white/5 px-2.5 pb-3 pt-2">
                    {showThinkingBlock && (
                        <details
                            className="group rounded-lg border border-white/10 bg-black/20"
                            open={thinkingOpen}
                            onToggle={(e) => setThinkingOpen((e.target as HTMLDetailsElement).open)}
                        >
                            <summary
                                onClick={() => { userInteractedRef.current = true; }}
                                className="cursor-pointer list-none px-3 py-2 text-[11px] text-zinc-500 group-open:text-zinc-300"
                            >
                                {isStreamingThinking ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400"></span>
                                        Thinking…
                                    </span>
                                ) : (
                                    <>Thinking</>
                                )}
                            </summary>
                            <div className="border-t border-white/5 px-3 py-2">
                                <MarkdownContent content={thinkingContent} className="text-zinc-500" />
                            </div>
                        </details>
                    )}
                    {analyst.status === 'complete' && (
                        <div>
                            <div className="mb-1 text-[11px] text-zinc-500">Final output</div>
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
        ? `${activeAnalysts.length > 1 ? 'Analysts are' : activeAnalysts[0]?.displayName || 'Analyst is'} thinking`
        : waitingAnalysts.length > 0
            ? `Waiting for ${waitingAnalysts.length} analyst${waitingAnalysts.length === 1 ? '' : 's'}`
            : 'Preparing analyst outputs';

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-400">Analysts</span>
                <span className="text-zinc-600">{progress.analysts.length}</span>
                {isLive && (
                    <>
                        <span className="h-1 w-1 rounded-full bg-cyan-400" aria-hidden="true" />
                        <span className="text-zinc-400">{typingLabel}</span>
                    </>
                )}
            </div>
            {progress.analysts.map((analyst) => (
                <AnalystRow
                    key={analyst.key}
                    analyst={analyst}
                    modelName={modelIdToName[analyst.modelId] ?? analyst.modelName}
                    onRetryAnalyst={onRetryAnalyst}
                />
            ))}
        </div>
    );
};

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({ progress, modelIdToName = {}, isLive = false, hideSubagents = false, onRetryAnalyst }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);
    const touchYRef = useRef<number | null>(null);

    useEffect(() => {
        const element = scrollRef.current;
        if (isLive && element && !userScrolledUpRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [progress, isLive]);

    const lockIfScrollingUp = (deltaY: number): void => {
        if (deltaY < 0) {
            userScrolledUpRef.current = true;
            return;
        }
        const element = scrollRef.current;
        if (element && element.scrollHeight - element.scrollTop - element.clientHeight <= 80) {
            userScrolledUpRef.current = false;
        }
    };

    return (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
            <div
                ref={scrollRef}
                onScroll={() => {
                    const element = scrollRef.current;
                    if (!element) return;
                    userScrolledUpRef.current = element.scrollHeight - element.scrollTop - element.clientHeight > 80;
                }}
                onWheel={(event) => lockIfScrollingUp(event.deltaY)}
                onTouchStart={(event) => { touchYRef.current = event.touches[0]?.clientY ?? null; }}
                onTouchMove={(event) => {
                    const currentY = event.touches[0]?.clientY;
                    if (touchYRef.current == null || currentY == null) return;
                    lockIfScrollingUp(touchYRef.current - currentY);
                    touchYRef.current = currentY;
                }}
                className="custom-scrollbar max-h-[560px] space-y-3 overflow-y-auto px-3 py-4"
            >
                {progress.moderator.status === 'waiting' && (
                    <div className="flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                        <div className="max-w-[88%] rounded-2xl border border-white/10 bg-zinc-900/60 px-3.5 py-3">
                            <div className="mb-1 text-xs font-medium text-zinc-200">Strategist</div>
                            <div className="text-xs text-zinc-500">
                                {progress.moderator.waitingFor?.length
                                    ? `Waiting for ${progress.moderator.waitingFor.length} analyst${progress.moderator.waitingFor.length === 1 ? '' : 's'}`
                                    : 'Waiting for analyst outputs'}
                            </div>
                        </div>
                    </div>
                )}

                {progress.moderator.status === 'error' && (
                    <div className="status-surface flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rose-400/20 bg-rose-500/10 text-rose-300"><BotIcon /></div>
                        <div className="max-w-[88%] rounded-2xl border border-rose-400/20 bg-rose-500/5 px-3.5 py-3">
                            <div className="mb-1 text-xs font-medium text-rose-300">Strategist</div>
                            <div className="text-xs text-zinc-500">{progress.moderator.error || 'The ensemble could not continue.'}</div>
                        </div>
                    </div>
                )}

                {progress.moderator.status === 'reviewing' && (
                    <div className="flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-500/10 text-cyan-300"><BotIcon /></div>
                        <div className="max-w-[88%] rounded-2xl border border-white/10 bg-zinc-900/60 px-3.5 py-3">
                            <div className="mb-1 text-xs font-medium text-zinc-200">Strategist</div>
                            <div className="text-xs text-zinc-500">Reviewing all analyst outputs</div>
                        </div>
                    </div>
                )}

                {!hideSubagents && progress.analysts.length > 0 && (
                    <AnalystSubagents progress={progress} modelIdToName={modelIdToName} isLive={isLive} onRetryAnalyst={onRetryAnalyst} />
                )}
            </div>
        </div>
    );
};

export default React.memo(EnsembleProgressChat);

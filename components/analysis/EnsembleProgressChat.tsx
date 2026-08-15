import React, { useMemo, useState } from 'react';
import { DebateTurn, EnsembleAnalystProgress, EnsembleProgress } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import { formatModelDisplayName, formatSeatLabel } from '../../utils/providerUtils';
import { buildAnalystGantt, lastThoughtSnippet } from '../../utils/runGantt';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';

interface EnsembleProgressChatProps {
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
    hideSubagents?: boolean;
    compact?: boolean;
    onRetryAnalyst?: (analystKey: string) => void;
    debateTurns?: DebateTurn[];
    activeDebateSpeakers?: Record<string, number>;
    reasoningProcesses?: Record<string, string>;
}

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'Waiting',
    analyzing: 'thinking',
    error: 'unavailable',
    complete: 'Completed',
};

const PHASES = ['Openings', 'Rebuttals', 'Verdict'] as const;

const laneStatusText = (analyst: EnsembleAnalystProgress, answering: boolean): string => {
    if (analyst.status === 'analyzing') return answering ? 'answering' : 'thinking';
    return STATUS_TEXT[analyst.status];
};

const splitAddresses = (text: string, names: string[]): Array<{ target?: string; text: string }> => {
    const labels = [...new Set(names.map(n => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (labels.length < 2) return [{ text }];
    const escaped = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?:^|\\n)\\s*[*_~]*(${escaped.join('|')})[*_~]*\\s*:\\s*`, 'g');
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) return [{ text }];
    return matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
        return { target: match[1].trim(), text: text.slice(start, end).trim() };
    }).filter(s => s.text);
};

const matchesSpeaker = (speaker: string, analyst: EnsembleAnalystProgress): boolean => {
    const needle = speaker.trim().toLowerCase();
    const aliases = [
        analyst.displayName,
        formatSeatLabel(analyst.displayName),
        analyst.providerName,
        analyst.displayName.split(/[&/]/)[0],
    ].map(name => name.trim().toLowerCase()).filter(Boolean);
    return aliases.some(name => needle === name || needle.startsWith(`${name} `));
};

interface SeatBlock {
    id: string;
    replyTo?: string;
    text: string;
    live?: boolean;
}

const FadeStream: React.FC<{ text: string; live?: boolean; className?: string }> = ({ text, live, className }) => (
    <div className={live ? 'stream-fade' : undefined}>
        <MarkdownContent content={text} className={className} />
    </div>
);

const ReplyBlock: React.FC<{ block: SeatBlock }> = ({ block }) => (
    <div className="mx-2 rounded-lg border border-white/10 bg-zinc-950/50 px-3 py-2">
        {block.replyTo && (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                reply to {block.replyTo}
            </p>
        )}
        <FadeStream text={block.text} live={block.live} className="text-sm leading-6 text-zinc-200" />
    </div>
);

const SeatChat: React.FC<{
    title: string;
    modelName: string;
    status: string;
    live: boolean;
    thinking: string;
    blocks: SeatBlock[];
    defaultOpen: boolean;
    expandLabel: string;
    onRetry?: () => void;
    error?: string;
}> = ({ title, modelName, status, live, thinking, blocks, defaultOpen, expandLabel, onRetry, error }) => {
    const [open, setOpen] = useState(defaultOpen);
    const snippet = lastThoughtSnippet(blocks[blocks.length - 1]?.text || thinking, 72);

    return (
        <div className="border-t border-white/5">
            <div className="flex items-start gap-1">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left hover:bg-zinc-800/30"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${expandLabel}`}
                >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        live ? 'animate-pulse bg-zinc-200' :
                        status === 'unavailable' ? 'bg-zinc-600' :
                        status === 'Completed' ? 'bg-zinc-400' : 'bg-zinc-700'
                    }`} />
                    <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                            <span className="min-w-0 truncate text-[13px] text-zinc-200">{title}</span>
                            {modelName && (
                                <span className="ml-auto hidden min-w-0 truncate text-[11px] text-zinc-600 sm:inline">{modelName}</span>
                            )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                            {status}{!open && snippet ? ` · ${snippet}` : ''}
                        </span>
                    </span>
                </button>
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="mr-2 mt-2 shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                        Retry
                    </button>
                )}
            </div>

            {open && (
                <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/70">
                    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="min-w-0 flex-1 truncate text-left text-[13px] text-zinc-200 hover:text-zinc-50"
                            aria-label={`Collapse ${expandLabel}`}
                        >
                            {title}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200"
                            aria-label={`Close ${expandLabel}`}
                        >
                            Close
                        </button>
                    </div>
                    {thinking && (
                        <details className="border-b border-white/5 px-3 py-2">
                            <summary className="cursor-pointer list-none text-[11px] uppercase tracking-widest text-zinc-500">
                                Thinking
                            </summary>
                            <div className="custom-scrollbar mt-2 max-h-40 overflow-y-auto pr-1">
                                <FadeStream text={thinking} live={live} className="text-zinc-500" />
                            </div>
                        </details>
                    )}
                    <div className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto py-2">
                        {blocks.map(block => <ReplyBlock key={block.id} block={block} />)}
                        {error && <p className="px-3 py-2 text-[11px] text-zinc-500">{error}</p>}
                        {blocks.length === 0 && !thinking && !error && (
                            <p className="px-3 py-2 text-xs italic text-zinc-600">Waiting for this seat.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({
    progress,
    modelIdToName = {},
    isLive = false,
    hideSubagents = false,
    compact = false,
    onRetryAnalyst,
    debateTurns = [],
    activeDebateSpeakers = {},
    reasoningProcesses = {},
}) => {
    const lanes = useMemo(() => buildAnalystGantt(progress), [progress]);
    const analystNames = progress.analysts.map(a => a.displayName);
    const modLive = Boolean(activeDebateSpeakers['Moderator']) || progress.moderator.status === 'reviewing';
    const anyAnalystLive = progress.analysts.some(a => a.status === 'analyzing') || Object.keys(activeDebateSpeakers).some(k => k !== 'Moderator');
    const openingsDone = debateTurns.some(t => t.round === 1);
    const rebuttalStarted = debateTurns.some(t => (t.round ?? 0) >= 2);
    const verdictLive = modLive && rebuttalStarted && !anyAnalystLive;
    const phase = verdictLive || progress.moderator.status === 'reviewing' && openingsDone
        ? (rebuttalStarted ? 'Verdict' : 'Openings')
        : rebuttalStarted
            ? 'Rebuttals'
            : 'Openings';

    const { moderatorBlocks, moderatorThinking } = useMemo(() => {
        const turns = debateTurns.filter(t => t.speaker === 'Moderator');
        const lastId = turns[turns.length - 1] ? `${turns.length - 1}` : '';
        const leaked: string[] = [];
        const blocks = turns.flatMap((turn, index) => {
            const live = modLive && String(index) === lastId;
            const split = splitThinkingFromOutput(turn.reasoning || '', turn.text || '');
            if (split.thinking) leaked.push(split.thinking);
            const parts = splitAddresses(split.output, analystNames);
            if (!split.output) return [];
            if (parts.length === 0) return [{ id: `mod-${index}`, text: split.output, live }];
            return parts.map((part, partIndex) => ({
                id: `mod-${index}-${partIndex}`,
                replyTo: part.target,
                text: part.text,
                live,
            }));
        });
        const streamed = (reasoningProcesses.moderator || '').trim();
        return {
            moderatorBlocks: blocks,
            moderatorThinking: [...new Set([streamed, ...leaked].filter(Boolean))].join('\n\n'),
        };
    }, [analystNames, debateTurns, modLive, reasoningProcesses.moderator]);

    const [floorOpen, setFloorOpen] = useState(true);

    if (hideSubagents || progress.analysts.length === 0) return null;

    return (
        <div className={`ui-panel ${compact ? 'mt-0 mb-4' : 'mt-4'}`} aria-label="Floor">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 px-3 py-2 text-[11px] text-zinc-500">
                <button
                    type="button"
                    onClick={() => setFloorOpen(o => !o)}
                    className="font-medium text-zinc-300 hover:text-zinc-100"
                    aria-expanded={floorOpen}
                >
                    {isLive ? 'Floor' : 'Seats'}
                </button>
                {PHASES.map((p, i) => (
                    <React.Fragment key={p}>
                        {i > 0 && <span className="text-zinc-700">·</span>}
                        <span className={p === phase ? 'text-zinc-200' : 'text-zinc-600'}>
                            {p} {p === 'Openings' && openingsDone ? '●' : p === phase ? '●' : '○'}
                        </span>
                    </React.Fragment>
                ))}
                {isLive && (
                    <span className="ml-auto text-zinc-600">{progress.analysts.length} seats</span>
                )}
            </div>

            {floorOpen && (
                <div>
                    <SeatChat
                        title="Moderator"
                        modelName="Floor"
                        status={verdictLive ? 'verdict' : modLive ? 'asking' : moderatorBlocks.length > 0 ? 'posed' : 'Waiting'}
                        live={modLive}
                        thinking={moderatorThinking}
                        blocks={moderatorBlocks}
                        defaultOpen={modLive || moderatorBlocks.length > 0}
                        expandLabel="Moderator analysis"
                    />
                    {progress.analysts.map((analyst) => {
                        const answering = Boolean(activeDebateSpeakers[analyst.displayName] || activeDebateSpeakers[analyst.providerName]);
                        const live = analyst.status === 'analyzing';
                        const speakerTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && matchesSpeaker(t.speaker, analyst));
                        const lastTurn = speakerTurns[speakerTurns.length - 1];
                        const openingRaw = analyst.finalOutput && analyst.finalOutput !== lastTurn?.text ? analyst.finalOutput : '';
                        const openingSplit = splitThinkingFromOutput(
                            [analyst.reasoning, analyst.thoughtProcess].filter(Boolean).join('\n\n'),
                            openingRaw,
                        );
                        const turnSplits = speakerTurns.map((turn, index) => {
                            const split = splitThinkingFromOutput(turn.reasoning || '', turn.text || '');
                            return {
                                id: `${analyst.key}-${index}`,
                                replyTo: turn.round && turn.round > 1 ? 'Moderator' : undefined,
                                text: split.output,
                                thinking: split.thinking,
                                live: live && answering && index === speakerTurns.length - 1,
                            };
                        });
                        const thinking = [openingSplit.thinking, ...turnSplits.map(t => t.thinking)]
                            .filter(Boolean)
                            .filter((text, index, all) => all.indexOf(text) === index)
                            .join('\n\n');
                        const blocks: SeatBlock[] = [
                            ...(openingSplit.output ? [{ id: `${analyst.key}-open`, text: openingSplit.output }] : []),
                            ...turnSplits.map(({ thinking: _t, ...block }) => block),
                        ];
                        const title = formatSeatLabel(analyst.displayName);
                        const prettyModel = formatModelDisplayName(analyst.modelId || analyst.modelName);
                        return (
                            <SeatChat
                                key={analyst.key}
                                title={title}
                                modelName={prettyModel && title.includes(prettyModel) ? analyst.providerName : prettyModel}
                                status={laneStatusText(analyst, answering && live)}
                                live={live}
                                thinking={thinking}
                                blocks={blocks}
                                defaultOpen={live || analyst.status === 'complete'}
                                expandLabel={`${title} analysis`}
                                onRetry={analyst.status === 'error' && onRetryAnalyst ? () => onRetryAnalyst(analyst.key) : undefined}
                                error={analyst.error}
                            />
                        );
                    })}
                    <span className="sr-only">{lanes.length} timeline lanes</span>
                </div>
            )}
        </div>
    );
};

export const AnalystSubagents = EnsembleProgressChat;

export default React.memo(EnsembleProgressChat);

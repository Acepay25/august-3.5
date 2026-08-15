import React, { useMemo, useState } from 'react';
import { DebateTurn, EnsembleAnalystProgress, EnsembleProgress } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import { buildAnalystGantt, lastThoughtSnippet } from '../../utils/runGantt';

interface EnsembleProgressChatProps {
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
    hideSubagents?: boolean;
    compact?: boolean;
    onRetryAnalyst?: (analystKey: string) => void;
    debateTurns?: DebateTurn[];
    activeDebateSpeakers?: Record<string, number>;
}

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'waiting',
    analyzing: 'thinking',
    error: 'unavailable',
    complete: 'done',
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

const LiveLane: React.FC<{
    analyst: EnsembleAnalystProgress;
    modelName: string;
    answering: boolean;
    fill: number;
    onRetryAnalyst?: (analystKey: string) => void;
}> = ({ analyst, modelName, answering, fill, onRetryAnalyst }) => {
    const [open, setOpen] = useState(false);
    const thinkingContent = analyst.reasoning || analyst.thoughtProcess || '';
    const snippet = analyst.status === 'analyzing'
        ? lastThoughtSnippet(thinkingContent, 88)
        : analyst.status === 'complete'
            ? lastThoughtSnippet(analyst.finalOutput || thinkingContent, 88)
            : analyst.error || '';
    const live = analyst.status === 'analyzing';

    return (
        <div className="border-t border-white/5 first:border-t-0">
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800/40"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${analyst.displayName} analysis`}
                >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        live ? 'animate-pulse bg-zinc-200' :
                        analyst.status === 'complete' ? 'bg-zinc-400' :
                        analyst.status === 'error' ? 'bg-zinc-600' : 'bg-zinc-700'
                    }`} />
                    <span className="w-[7.5rem] shrink-0 truncate text-[13px] text-zinc-200">{analyst.displayName}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">{modelName}</span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-zinc-500">{laneStatusText(analyst, answering)}</span>
                    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-800 sm:w-32">
                        <div
                            className={`h-full rounded-full ${analyst.status === 'error' ? 'bg-zinc-600' : live ? 'bg-zinc-300' : 'bg-zinc-500'}`}
                            style={{ width: `${fill}%` }}
                        />
                    </div>
                </button>
                {analyst.status === 'error' && onRetryAnalyst && (
                    <button
                        type="button"
                        onClick={() => onRetryAnalyst(analyst.key)}
                        className="mr-2 shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                        Retry
                    </button>
                )}
            </div>
            {snippet && !open && (
                <p className="truncate px-3 pb-1.5 pl-7 text-[11px] text-zinc-500">{snippet}</p>
            )}
            {open && (
                <div className="space-y-2 border-t border-white/5 px-3 pb-2 pt-2">
                    {thinkingContent && thinkingContent.trim() !== (analyst.finalOutput || '').trim() && (
                        <details className="group">
                            <summary className="cursor-pointer list-none text-[11px] text-zinc-500 group-open:text-zinc-300">Thinking</summary>
                            <div className="pt-1">
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
                    {analyst.status === 'error' && analyst.error && (
                        <p className="text-[11px] text-zinc-500">{analyst.error}</p>
                    )}
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
}) => {
    const lanes = useMemo(() => buildAnalystGantt(progress), [progress]);
    const analystNames = progress.analysts.map(a => a.displayName);
    const lastModTurn = [...debateTurns].reverse().find(t => t.speaker === 'Moderator');
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
    const addresses = lastModTurn ? splitAddresses(lastModTurn.text, analystNames) : [];
    const posedLine = addresses.length > 0
        ? addresses.map(a => a.target ? `${a.target}: ${lastThoughtSnippet(a.text, 40)}` : lastThoughtSnippet(a.text, 48)).join('    ')
        : lastThoughtSnippet(lastModTurn?.text, 88);

    if (hideSubagents || progress.analysts.length === 0) return null;

    return (
        <div className={`ui-panel ${compact ? 'mt-0 mb-4' : 'mt-4'}`} aria-label="Floor">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 px-3 py-2 text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-300">{isLive ? 'Floor' : 'Seats'}</span>
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

            {(modLive || lastModTurn || progress.moderator) && (
                <div className="border-b border-white/5 px-3 py-2">
                    <div className="flex items-center gap-2 text-[12px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${modLive ? 'animate-pulse bg-zinc-200' : 'bg-zinc-500'}`} />
                        <span className="font-medium uppercase tracking-wider text-[10px] text-zinc-400">Moderator</span>
                        <span className="text-[11px] text-zinc-500">
                            {verdictLive ? 'verdict' : modLive ? 'asking' : 'posed'}
                        </span>
                    </div>
                    {modLive && addresses.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 pl-4 text-[12px] text-zinc-300">
                            {addresses.map((a, i) => (
                                <li key={`${a.target || i}`}>
                                    {a.target ? <span className="text-zinc-500">→ {a.target} </span> : null}
                                    {lastThoughtSnippet(a.text, 96)}
                                </li>
                            ))}
                        </ul>
                    ) : posedLine ? (
                        <p className="mt-1 truncate pl-4 text-[12px] text-zinc-400">{posedLine}</p>
                    ) : null}
                </div>
            )}

            {progress.analysts.map((analyst) => {
                const lane = lanes.find(l => l.id === analyst.key);
                const answering = Boolean(activeDebateSpeakers[analyst.displayName] || activeDebateSpeakers[analyst.providerName]);
                return (
                    <LiveLane
                        key={analyst.key}
                        analyst={analyst}
                        modelName={modelIdToName[analyst.modelId] ?? analyst.modelName}
                        answering={answering && analyst.status === 'analyzing'}
                        fill={lane?.fill ?? 6}
                        onRetryAnalyst={onRetryAnalyst}
                    />
                );
            })}
        </div>
    );
};

export const AnalystSubagents = EnsembleProgressChat;

export default React.memo(EnsembleProgressChat);

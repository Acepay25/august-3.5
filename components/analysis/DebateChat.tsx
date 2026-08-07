import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn, AnalystLensConfig, TradeAnalysis } from '../../types';
import { BotIcon, ChevronDownIcon } from '../shared/Icons';
import { getRoleDisplayForProvider } from '../../services/ui/AnalystLensService';
import DebateSummary from './DebateSummary';

interface DebateChatProps {
    debateTurns: DebateTurn[];
    modelsUsed?: Record<string, string>;
    reasoningProcesses?: Record<string, string>;
    thoughtProcesses?: Record<string, string>;
    modelIdToName?: Record<string, string>;
    providerNameToId?: Record<string, string>;
    lensConfig?: AnalystLensConfig;
    isDebating?: boolean;
    activeDebateSpeakers?: Record<string, number>;
    /** Final trade plan — renders the pinned consensus strip on completed debates. */
    analysis?: TradeAnalysis | null;
}

const cleanSpeakerPrefix = (text: string, speaker: string): string => text
    .replace(new RegExp(`^\\s*(?:\\*\\*)?${speaker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\*\\*)?:\\s*`, 'i'), '')
    .trim();

const SpeakerAvatar: React.FC<{ speaker: string; moderator?: boolean; small?: boolean }> = ({ speaker, moderator = false, small = false }) => {
    if (moderator) {
        return (
            <div className={`${small ? 'h-6 w-6' : 'h-8 w-8'} flex shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300`}>
                <BotIcon />
            </div>
        );
    }

    return (
        <div className={`${small ? 'h-6 w-6 text-[9px]' : 'h-8 w-8 text-xs'} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-700 font-semibold text-zinc-100`}>
            {speaker.trim().charAt(0).toUpperCase() || '?'}
        </div>
    );
};

const getRoundLabel = (round: number, isVerdictRound = false, speaker?: string): string => {
    if (isVerdictRound) return `Round ${round} · Final Verdict`;
    if (round === 1) return 'Round 1 · Openings';
    if (round === 2 || round === 3) return `Round ${round} · Rebuttals`;
    // Clarification rounds: moderator asks questions, analysts answer
    if (speaker === 'Moderator') return `Round ${round} · Clarification Questions`;
    return `Round ${round} · Analyst Responses`;
};

/** Human phase name for the thinking indicator (instead of a raw round number). */
const getPhaseLabel = (round: number, isVerdictRound: boolean): string => {
    if (isVerdictRound) return 'Verdict';
    if (round === 1) return 'Openings';
    if (round === 2 || round === 3) return 'Rebuttals';
    return 'Clarification';
};

interface ModeratorSegment {
    target?: string;
    text: string;
}

/**
 * Clarification prompts can contain one labelled question for each analyst in
 * a single moderator stream. Split those labelled sections for display so the
 * transcript reads like a one-to-one Messenger exchange. Unlabelled verdict
 * prose stays as one Moderator message.
 */
const splitModeratorTurn = (
    text: string,
    analystNames: string[],
    modelNames: string[],
): ModeratorSegment[] => {
    const labels = [...new Set([...analystNames, ...modelNames].map(label => label.trim()).filter(Boolean))]
        .sort((a, b) => b.length - a.length);
    if (labels.length < 2) return [{ text }];

    const escapedLabels = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const labelPattern = new RegExp(`(?:^|\\n)\\s*[*_~]*(${escapedLabels.join('|')})[*_~]*\\s*:\\s*`, 'g');
    const matches = [...text.matchAll(labelPattern)];
    if (matches.length < 2) return [{ text }];

    return matches.map((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
        return { target: match[1].trim(), text: text.slice(start, end).trim() };
    }).filter(segment => Boolean(segment.text));
};

const DebateChat: React.FC<DebateChatProps> = ({
    debateTurns,
    modelsUsed = {},
    reasoningProcesses = {},
    thoughtProcesses = {},
    modelIdToName = {},
    providerNameToId = {},
    lensConfig,
    isDebating = false,
    activeDebateSpeakers = {},
    analysis = null,
}) => {
    const [isThinkingOpen, setIsThinkingOpen] = useState(false);
    const [expandedSpeaker, setExpandedSpeaker] = useState<string | null>(null);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayIndex, setReplayIndex] = useState(0);
    const [replaySpeed, setReplaySpeed] = useState(1);
    const scrollRef = useRef<HTMLDivElement>(null);
    const thinkingControlRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);

    // Keep the currently streaming turn visible. The typing bubble is an
    // additional activity indicator, not a replacement for the analyst's
    // partial reply.
    const visibleTurns = useMemo(() => debateTurns, [debateTurns]);
    // Computed from ALL turns (not just visible ones) so a completed
    // clarification-question round is never mistaken for the verdict while
    // the verdict round is still streaming.
    const latestModeratorRound = useMemo(() => Math.max(0, ...debateTurns.filter(turn => turn.speaker === 'Moderator').map(turn => turn.round ?? 0)), [debateTurns]);
    const activeSpeakers = useMemo(() => Object.entries(activeDebateSpeakers), [activeDebateSpeakers]);
    const analystNames = useMemo(() => [...new Set(debateTurns.filter(turn => turn.speaker !== 'Moderator').map(turn => turn.speaker))], [debateTurns]);
    const modelNames = useMemo(() => Object.entries(modelsUsed).map(([key, modelId]) => modelIdToName[modelId] ?? modelId ?? key), [modelIdToName, modelsUsed]);

    // Auto-scroll only while the reader is at the live bottom — scrolling up
    // (e.g. to re-read a rebuttal) must not yank them back down every chunk.
    useEffect(() => {
        const element = scrollRef.current;
        if (element && !userScrolledUpRef.current) element.scrollTop = element.scrollHeight;
    }, [visibleTurns, activeDebateSpeakers]);

    // Replay: reveal turns one-by-one on a timer. Auto-reset when a new
    // transcript arrives (new debate run) or the chat becomes live again.
    // Reset replay only when the transcript CONTENT changes (a new debate) —
    // array identity changes on every background message rebuild (autopilot,
    // runStats), which used to kill an in-progress replay mid-way.
    const turnsFingerprint = useMemo(
        () => visibleTurns.map(t => `${t.speaker}:${t.round ?? ''}:${t.text.length}`).join('|'),
        [visibleTurns],
    );
    useEffect(() => {
        setReplayIndex(0);
        setIsReplaying(false);
        setReplaySpeed(1);
    }, [turnsFingerprint, isDebating]);

    useEffect(() => {
        if (!isReplaying) return;
        if (replayIndex >= debateTurns.length) {
            setIsReplaying(false);
            return;
        }
        const delay = Math.round(1100 / replaySpeed);
        const timer = setTimeout(() => setReplayIndex(i => i + 1), delay);
        return () => clearTimeout(timer);
    }, [isReplaying, replayIndex, debateTurns.length, replaySpeed]);

    // Compute round boundaries for jump-to-round
    const roundStartIndices = useMemo(() => {
        const map = new Map<number, number>();
        debateTurns.forEach((turn, index) => {
            if (typeof turn.round === 'number' && !map.has(turn.round)) {
                map.set(turn.round, index);
            }
        });
        return map;
    }, [debateTurns]);

    const availableRounds = useMemo(() => [...roundStartIndices.keys()].sort((a, b) => a - b), [roundStartIndices]);

    const jumpToLatest = () => {
        userScrolledUpRef.current = false;
        setIsScrolledUp(false);
        const element = scrollRef.current;
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    };

    const copyTranscript = () => {
        const text = debateTurns
            .map(t => `**${t.speaker}**${t.round ? ` (Round ${t.round})` : ''}:\n${t.text}`)
            .join('\n\n');
        navigator.clipboard.writeText(text).catch(() => {});
    };

    useEffect(() => {
        if (!isThinkingOpen) return undefined;
        const handleBodyPointerDown = (event: PointerEvent): void => {
            if (!thinkingControlRef.current?.contains(event.target as Node)) {
                setIsThinkingOpen(false);
                setExpandedSpeaker(null);
            }
        };
        document.addEventListener('pointerdown', handleBodyPointerDown);
        return () => document.removeEventListener('pointerdown', handleBodyPointerDown);
    }, [isThinkingOpen]);

    const getProviderId = (speaker: string): string | undefined => providerNameToId[speaker];
    const getModelKey = (speaker: string): string | undefined => {
        const providerId = getProviderId(speaker);
        if (!providerId) return undefined;
        // Producers write bare provider-id keys today; the `providerId:model`
        // composite form is tolerated for historical rows only.
        return Object.keys(modelsUsed).find(key => key === providerId || key.startsWith(`${providerId}:`));
    };
    const getModelName = (speaker: string): string => {
        const modelKey = getModelKey(speaker);
        const modelId = modelKey ? modelsUsed[modelKey] : undefined;
        return modelId ? (modelIdToName[modelId] ?? modelId) : '';
    };
    const getDisplayName = (speaker: string): string => {
        if (speaker === 'Moderator') return 'Master Strategist';
        if (lensConfig?.enabled) {
            const providerId = getProviderId(speaker);
            if (providerId) {
                const modelKey = getModelKey(speaker);
                const modelId = modelKey ? modelsUsed[modelKey] : undefined;
                const role = getRoleDisplayForProvider(`${providerId}::${modelId ?? ''}`, lensConfig.assignments);
                if (role.shortName && role.shortName !== 'General') return role.shortName;
            }
        }
        return speaker;
    };
    const getReasoning = (speaker: string): string => {
        // The moderator's streamed chain-of-thought is stored under the
        // lowercase 'moderator' key (the pipeline keys it that way) — the old
        // lookup only checked 'Moderator' and always fell through to
        // "Reasoning is not available yet." for the moderator.
        if (speaker === 'Moderator') {
            return reasoningProcesses.moderator || thoughtProcesses.moderator || '';
        }
        const providerId = getProviderId(speaker);
        return reasoningProcesses[speaker] || thoughtProcesses[speaker] || (providerId ? reasoningProcesses[providerId] || thoughtProcesses[providerId] : '') || '';
    };

    if (!debateTurns.length && !isDebating) {
        // Completed debate with no parsed transcript (e.g. an accuracy-mode
        // stream that yielded zero turns): keep the verdict consensus visible
        // instead of silently dropping the whole card.
        if (!analysis) return null;
        return (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-zinc-900/80 px-3 py-2 text-[10px]">
                    <span className="font-black uppercase tracking-widest text-cyan-300">Consensus</span>
                    <span className={`font-bold ${analysis.direction === 'Long' ? 'text-emerald-400' : analysis.direction === 'Short' ? 'text-rose-400' : 'text-zinc-400'}`}>{analysis.direction}</span>
                    <span className="text-zinc-500">Entry</span><span className="font-mono text-zinc-200">{analysis.entryPoints?.[0]?.price || '—'}</span>
                    <span className="text-zinc-500">SL</span><span className="font-mono text-zinc-200">{analysis.stopLoss || '—'}</span>
                    <span className="text-zinc-500">TP</span><span className="font-mono text-zinc-200">{analysis.takeProfit?.[0]?.price || '—'}</span>
                    <span className="text-zinc-500">Confidence</span><span className="font-mono text-zinc-200">{analysis.confidence}</span>
                </div>
                <div className="px-3 py-4 text-center text-[11px] text-zinc-600">
                    The debate transcript is unavailable for this analysis.
                </div>
            </div>
        );
    }

    // Replay slices the transcript once (P7: the old code re-sliced inside the
    // per-turn map — O(n²) array copies on every replay tick).
    const displayedTurns = isReplaying ? visibleTurns.slice(0, replayIndex) : visibleTurns;

    return (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
            {/* Pinned consensus strip + copy affordance on completed debates */}
            {analysis && !isDebating && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-zinc-900/80 px-3 py-2 text-[10px]">
                    <span className="font-black uppercase tracking-widest text-cyan-300">Consensus</span>
                    <span className={`font-bold ${analysis.direction === 'Long' ? 'text-emerald-400' : analysis.direction === 'Short' ? 'text-rose-400' : 'text-zinc-400'}`}>{analysis.direction}</span>
                    <span className="text-zinc-500">Entry</span><span className="font-mono text-zinc-200">{analysis.entryPoints?.[0]?.price || '—'}</span>
                    <span className="text-zinc-500">SL</span><span className="font-mono text-zinc-200">{analysis.stopLoss || '—'}</span>
                    <span className="text-zinc-500">TP</span><span className="font-mono text-zinc-200">{analysis.takeProfit?.[0]?.price || '—'}</span>
                    <span className="text-zinc-500">Confidence</span><span className="font-mono text-zinc-200">{analysis.confidence}</span>
                    <button
                        type="button"
                        onClick={copyTranscript}
                        className="rounded-md border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                        title="Copy the full debate transcript"
                    >
                        Copy transcript
                    </button>
                    {!isReplaying ? (
                        <button
                            type="button"
                            onClick={() => { setIsReplaying(true); setReplayIndex(0); }}
                            className="rounded-md border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                            title="Replay the debate turn by turn"
                        >
                            ▶ Replay
                        </button>
                    ) : (
                        <span className="ml-auto flex items-center gap-1.5">
                            <button type="button" onClick={() => setIsReplaying(p => !p)} className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[9px] uppercase tracking-wider text-cyan-300">
                                {replayIndex >= debateTurns.length ? '↺ Restart' : '⏸ Pause'}
                            </button>
                            <button type="button" onClick={() => setReplayIndex(i => Math.min(debateTurns.length, i + 1))} className="rounded-md border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-400">⏭ Step</button>
                            {/* Speed controls */}
                            <span className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
                                {[0.5, 1, 2].map(speed => (
                                    <button
                                        key={speed}
                                        type="button"
                                        onClick={() => setReplaySpeed(speed)}
                                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${replaySpeed === speed ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {speed}x
                                    </button>
                                ))}
                            </span>
                            {/* Jump to round */}
                            {availableRounds.length > 1 && (
                                <span className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
                                    {availableRounds.map(round => {
                                        const startIdx = roundStartIndices.get(round) ?? 0;
                                        const currentRound = debateTurns[replayIndex]?.round;
                                        return (
                                            <button
                                                key={round}
                                                type="button"
                                                onClick={() => setReplayIndex(startIdx)}
                                                className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${currentRound === round ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                title={`Jump to round ${round}`}
                                            >
                                                R{round}
                                            </button>
                                        );
                                    })}
                                </span>
                            )}
                            <button type="button" onClick={() => setIsReplaying(false)} className="rounded-md border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-500">Exit</button>
                        </span>
                    )}
                </div>
            )}
            <div
                ref={scrollRef}
                onScroll={() => {
                    const el = scrollRef.current;
                    if (!el) return;
                    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
                    userScrolledUpRef.current = away;
                    setIsScrolledUp(away);
                }}
                className="relative max-h-[520px] space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar"
            >
                {!isDebating && analysis && debateTurns.length > 0 && (
                    <DebateSummary debateTurns={debateTurns} analysis={analysis} />
                )}
                {displayedTurns.map((turn, index) => {
                    // 'System' turns carry drop-out / time-budget notices from
                    // the debate engine — render centered, not as an analyst bubble.
                    if (turn.speaker === 'System') {
                        return (
                            <div key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`} className="flex justify-center px-2">
                                <div className="rounded-lg border border-white/10 bg-zinc-800/80 px-3 py-1.5 text-center text-[11px] italic leading-relaxed text-zinc-500">
                                    {turn.text}
                                </div>
                            </div>
                        );
                    }
                    const previousRound = displayedTurns[index - 1]?.round;
                    const hasRoundSeparator = typeof turn.round === 'number' && turn.round !== previousRound;
                    const isVerdictRound = turn.speaker === 'Moderator' && turn.round === latestModeratorRound;
                    const isVerdict = isVerdictRound && !isDebating;
                    const displayName = getDisplayName(turn.speaker);
                    const modelName = getModelName(turn.speaker);
                    const segments = turn.speaker === 'Moderator'
                        ? splitModeratorTurn(turn.text, analystNames, modelNames)
                        : [{ text: turn.text }];
                    return (
                        <React.Fragment key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`}>
                            {hasRoundSeparator && (
                                <div className="flex items-center gap-2 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
                                    <span className="h-px flex-1 bg-white/5" />
                                    <span>{getRoundLabel(turn.round!, isVerdictRound, turn.speaker)}</span>
                                    <span className="h-px flex-1 bg-white/5" />
                                </div>
                            )}
                            {segments.map((segment, segmentIndex) => (
                                <div key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}-${segmentIndex}`} className={`flex items-start gap-2.5 ${turn.speaker === 'Moderator' ? 'justify-end' : ''}`}>
                                    {turn.speaker !== 'Moderator' && <SpeakerAvatar speaker={turn.speaker} />}
                                    <div className={`min-w-0 max-w-[92%] rounded-2xl border px-3.5 py-3 ${isVerdict ? 'border-cyan-400/25 bg-cyan-500/10' : 'border-white/5 bg-zinc-800/60'}`}>
                                        <div className="mb-1.5 flex items-center gap-2">
                                            {turn.speaker === 'Moderator' && <SpeakerAvatar speaker="Moderator" moderator small />}
                                            <div className="min-w-0">
                                                <div className={`text-xs font-semibold ${isVerdict ? 'text-cyan-300' : 'text-zinc-200'}`}>{displayName}</div>
                                                {turn.createdAt && <div className="text-[9px] text-zinc-600">{new Date(turn.createdAt).toLocaleTimeString()}</div>}
                                                {segment.target ? <div className="truncate text-[10px] text-cyan-400/70">To {segment.target}</div> : modelName && <div className="truncate text-[10px] text-zinc-600">{modelName}</div>}
                                            </div>
                                            {isVerdict && <span className="ml-auto rounded border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-cyan-300">DECISION</span>}
                                        </div>
                                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{turn.speaker === 'Moderator' ? segment.text : cleanSpeakerPrefix(segment.text, turn.speaker)}</div>
                                    </div>
                                    {turn.speaker === 'Moderator' && <SpeakerAvatar speaker="Moderator" moderator />}
                                </div>
                            ))}
                        </React.Fragment>
                    );
                })}

                {isDebating && activeSpeakers.length > 0 && (
                    <div ref={thinkingControlRef} className="relative flex items-end gap-2 pt-2">
                        <div className="flex -space-x-2 pl-1">
                            {activeSpeakers.map(([speaker]) => <SpeakerAvatar key={speaker} speaker={speaker} moderator={speaker === 'Moderator'} small />)}
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsThinkingOpen(previous => !previous)}
                            className="group flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-zinc-800 px-3 py-2 text-left shadow-lg transition-colors hover:border-cyan-400/30 hover:bg-zinc-700"
                            aria-expanded={isThinkingOpen}
                            aria-label="Show analysts who are thinking"
                        >
                            <span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" /></span>
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 group-hover:text-cyan-300">Thinking</span>
                            <ChevronDownIcon className={`h-3 w-3 text-zinc-500 transition-transform ${isThinkingOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isThinkingOpen && activeSpeakers.length > 0 && (
                            <div className="absolute bottom-full z-20 mb-2 w-64 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-xl">
                                {activeSpeakers.map(([speaker, round]) => {
                                    const reasoning = getReasoning(speaker);
                                    const selected = expandedSpeaker === speaker;
                                    return (
                                        <div key={speaker} className="rounded-lg p-2 hover:bg-zinc-800">
                                            <button type="button" onClick={() => setExpandedSpeaker(selected ? null : speaker)} className="flex w-full items-center gap-2 text-left">
                                                <SpeakerAvatar speaker={speaker} moderator={speaker === 'Moderator'} small />
                                                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{getDisplayName(speaker)}</span>
                                                <span className="text-[9px] text-zinc-600">{getPhaseLabel(round, speaker === 'Moderator' && round === latestModeratorRound)}</span>
                                            </button>
                                            {selected && <div className="mt-2 max-h-32 overflow-y-auto border-t border-white/5 pt-2 text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap">{reasoning || 'Reasoning is not available yet.'}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Jump-to-latest affordance when the reader scrolled up */}
                {isScrolledUp && (
                    <div className="sticky bottom-2 z-10 flex justify-center">
                        <button
                            type="button"
                            onClick={jumpToLatest}
                            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-800/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300 shadow-lg transition-colors hover:border-cyan-400/30 hover:bg-zinc-700"
                        >
                            ↓ Latest
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(DebateChat);

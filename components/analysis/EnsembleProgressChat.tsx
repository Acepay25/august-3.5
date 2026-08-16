import React, { useEffect, useMemo, useState } from 'react';
import { DebateTurn, EnsembleAnalystProgress, EnsembleProgress, RunStats } from '../../types';
import ReasoningRow from '../shared/ReasoningRow';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import { formatModelDisplayName, formatSeatLabel } from '../../utils/providerUtils';
import { buildAnalystGantt, lastThoughtSnippet } from '../../utils/runGantt';
import { splitThinkingFromOutput, looksLikePublicAnswer, looksLikeScratchpad, looksLikeTradeOutput } from '../../utils/thinkingSplit';
import { DebateBotAvatar } from './DebateBotAvatar';
import { DebateStage, DebateStageActor } from './DebateStage';

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
    runStats?: RunStats;
}

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'Waiting',
    analyzing: 'thinking',
    error: 'unavailable',
    complete: 'Completed',
};

const PHASES = ['Openings', 'Rebuttals', 'Verdict'] as const;

const laneStatusText = (analyst: EnsembleAnalystProgress, answering: boolean): string => {
    if (answering) return 'speaking';
    if (analyst.status === 'analyzing') return 'thinking';
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
    round?: number;
    thinking?: string;
}

interface SeatView {
    id: string;
    title: string;
    modelName: string;
    status: string;
    live: boolean;
    speaking?: boolean;
    thinking: string;
    blocks: SeatBlock[];
    usage?: string;
    retryKey?: string;
    error?: string;
    toneKey: string;
}

const roundLabel = (round: number): string => {
    if (round <= 1) return 'Openings';
    if (round === 2 || round === 3) return 'Rebuttals';
    return `Round ${round}`;
};

const FadeStream: React.FC<{ text: string; live?: boolean; className?: string }> = ({ text, live, className }) => (
    <div className={live ? 'stream-fade' : undefined}>
        <StreamingMarkdown text={text} live={live} className={className} />
    </div>
);

const ReplyBlock: React.FC<{ block: SeatBlock; fallbackThinking?: string }> = ({ block, fallbackThinking }) => {
    // block.text is already the split public output (the seats memo peeled
    // it once) — re-running visibleReplyFromThinking here used to blank
    // replies that echo their scratchpad.
    const text = (block.text || '').trim();
    const thinking = block.thinking || fallbackThinking || '';
    const hideLiveScratch = Boolean(
        block.live
        && looksLikeScratchpad(text)
        && !looksLikePublicAnswer(text)
        && !looksLikeTradeOutput(text),
    );
    if (!text || hideLiveScratch) {
        if (block.live) {
            return (
                <p className="px-3 py-1 text-xs italic text-zinc-600">Writing</p>
            );
        }
        if (!thinking) return null;
        return (
            <p className="px-3 py-1 text-xs italic text-zinc-600">No public answer — the model only returned a scratchpad.</p>
        );
    }
    return (
        <div className="debate-speech mx-2 rounded-lg border border-white/10 bg-zinc-950/50 px-3 py-2">
            {block.replyTo && (
                <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    reply to {block.replyTo}
                </p>
            )}
            {!block.live && (
                <p className="mb-1 text-[11px] text-zinc-500">Final output</p>
            )}
            <FadeStream text={text} live={block.live} className="text-sm leading-6 text-zinc-200" />
        </div>
    );
};

const ThinkingDetails: React.FC<{ text: string; live?: boolean }> = ({ text, live }) => {
    if (!text) return null;
    return (
        <div className="border-b border-white/5 px-3 py-2">
            <ReasoningRow thinking={text} running={Boolean(live)} defaultOpen={Boolean(live)} />
        </div>
    );
};

const SeatTranscript: React.FC<{
    title: string;
    live: boolean;
    thinking: string;
    blocks: SeatBlock[];
    error?: string;
}> = ({ title, live, thinking, blocks, error }) => {
    const rounds = useMemo(() => {
        const order: number[] = [];
        const grouped = new Map<number, SeatBlock[]>();
        blocks.forEach(block => {
            const round = block.round && block.round > 0 ? block.round : 1;
            if (!grouped.has(round)) {
                order.push(round);
                grouped.set(round, []);
            }
            grouped.get(round)!.push(block);
        });
        return order.map((round, index) => {
            const roundBlocks = grouped.get(round) ?? [];
            const roundThinking = [...new Set(roundBlocks.map(b => b.thinking).filter(Boolean))].join('\n\n');
            return {
                round,
                label: title === 'Moderator' && index === order.length - 1 && round >= 4 ? 'Verdict' : roundLabel(round),
                blocks: roundBlocks,
                thinking: roundThinking,
                live: roundBlocks.some(block => block.live),
            };
        });
    }, [blocks, title]);
    const currentRound = rounds[rounds.length - 1];
    const pastRounds = rounds.slice(0, -1);
    const leftoverThinking = thinking && !rounds.some(group => group.thinking && (group.thinking.includes(thinking) || thinking.includes(group.thinking)))
        ? thinking
        : '';

    return (
        <div className="debate-seat-modal-chat custom-scrollbar">
            {leftoverThinking && <ThinkingDetails text={leftoverThinking} live={live} />}
            <div className="flex flex-col gap-2 py-1">
                {currentRound && (
                    <div>
                        {rounds.length > 1 && (
                            <p className="px-3 pb-1 text-[11px] uppercase tracking-widest text-zinc-500">
                                {currentRound.label}{currentRound.live ? ' · live' : ''}
                            </p>
                        )}
                        <ThinkingDetails text={currentRound.thinking} live={currentRound.live || live} />
                        <div className="flex flex-col gap-2">
                            {currentRound.blocks.map(block => (
                                <ReplyBlock
                                    key={block.id}
                                    block={block}
                                    fallbackThinking={currentRound.thinking || leftoverThinking}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {pastRounds.map(group => (
                    <details key={group.round} className="mx-2 rounded-lg border border-white/10 bg-zinc-950/30 px-3 py-2">
                        <summary className="cursor-pointer list-none text-[11px] uppercase tracking-widest text-zinc-500">
                            {group.label}
                            {group.blocks[0]?.text ? ` · ${lastThoughtSnippet(group.blocks[0].text, 48)}` : ''}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                            <ThinkingDetails text={group.thinking} />
                            {group.blocks.map(block => (
                                <ReplyBlock key={block.id} block={block} fallbackThinking={group.thinking} />
                            ))}
                        </div>
                    </details>
                ))}
                {error && <p className="px-3 py-2 text-[11px] text-zinc-500">{error}</p>}
                {blocks.every(b => !b.text.trim()) && thinking && live && (
                    <p className="px-3 py-1 text-xs italic text-zinc-600">Writing</p>
                )}
                {blocks.length === 0 && !thinking && !error && (
                    <p className="px-3 py-2 text-xs italic text-zinc-600">Waiting for this seat.</p>
                )}
            </div>
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
    runStats,
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
        const blocks: SeatBlock[] = turns.flatMap((turn, index): SeatBlock[] => {
            const live = modLive && String(index) === lastId;
            const split = splitThinkingFromOutput(turn.reasoning || '', turn.text || '');
            if (split.thinking) leaked.push(split.thinking);
            const parts = splitAddresses(split.output, analystNames);
            if (!split.output && !split.thinking) return [];
            const round = turn.round && turn.round > 0 ? turn.round : index + 1;
            if (!split.output) {
                return [{ id: `mod-${index}`, replyTo: undefined, text: '', live, round, thinking: split.thinking }];
            }
            if (parts.length === 0) {
                return [{ id: `mod-${index}`, replyTo: undefined, text: split.output, live, round, thinking: split.thinking }];
            }
            return parts.map((part, partIndex) => ({
                id: `mod-${index}-${partIndex}`,
                replyTo: part.target,
                text: part.text,
                live,
                round,
                thinking: partIndex === 0 ? split.thinking : undefined,
            }));
        });
        const streamed = (reasoningProcesses.moderator || reasoningProcesses.Moderator || '').trim();
        if (streamed && blocks.length > 0) {
            const last = blocks[blocks.length - 1];
            if (!last.thinking?.includes(streamed)) {
                last.thinking = [streamed, last.thinking].filter(Boolean).join('\n\n');
            }
        }
        return {
            moderatorBlocks: blocks,
            moderatorThinking: [...new Set([streamed, ...leaked].filter(Boolean))].join('\n\n'),
        };
    }, [analystNames, debateTurns, modLive, reasoningProcesses.Moderator, reasoningProcesses.moderator]);

    const [floorOpen, setFloorOpen] = useState(true);
    const [openSeatId, setOpenSeatId] = useState<string | null>(null);
    const liveAnalyst = progress.analysts.find(a =>
        a.status === 'analyzing' || Boolean(activeDebateSpeakers[a.displayName] || activeDebateSpeakers[a.providerName])
    );
    // "Speaking" requires actual speech: an analyst whose chain-of-thought is
    // still streaming (no output yet) is THINKING on the stage, not speaking.
    const liveAnalystSpeech = liveAnalyst
        ? (() => {
            const turns = debateTurns.filter(t => t.speaker !== 'Moderator' && matchesSpeaker(t.speaker, liveAnalyst));
            return turns[turns.length - 1]?.text?.trim() || '';
        })()
        : '';
    const liveAnalystSpeaking = Boolean(
        liveAnalyst
        && (activeDebateSpeakers[liveAnalyst.displayName] || activeDebateSpeakers[liveAnalyst.providerName])
        && liveAnalystSpeech,
    );
    // Entering the verdict round means the moderator is active, not that it
    // has emitted public speech yet. Keep it in THINKING until visible text
    // exists, just like the analyst seats.
    const modSpeaking = modLive && moderatorBlocks.some(b => b.live && Boolean(b.text.trim()));
    const modThinking = modLive && (Boolean(moderatorThinking.trim()) || !modSpeaking);
    const turnCaption = !isLive
        ? ''
        : verdictLive
            ? (modSpeaking ? 'Moderator is delivering the verdict' : 'Moderator is thinking about the verdict')
            : modLive
                ? (modSpeaking ? 'Moderator is speaking' : 'Moderator is thinking')
                : liveAnalystSpeaking && liveAnalyst
                    ? `${formatSeatLabel(liveAnalyst.displayName)} is speaking`
                    : liveAnalyst
                        ? `${formatSeatLabel(liveAnalyst.displayName)} is thinking`
                        : 'Waiting for the next turn';
    const stageActors = useMemo((): DebateStageActor[] => [
        {
            id: 'moderator',
            name: 'Moderator',
            toneKey: 'moderator',
            live: modLive,
            thinking: modThinking,
            speaking: modSpeaking,
            thought: moderatorThinking || (modLive && !modSpeaking ? 'Thinking' : ''),
            speech: [...moderatorBlocks].reverse().find(b => b.text.trim())?.text,
            replyTo: [...moderatorBlocks].reverse().find(b => b.live && b.replyTo)?.replyTo
                || [...moderatorBlocks].reverse().find(b => b.replyTo)?.replyTo,
            replies: moderatorBlocks
                .filter(block => block.replyTo && block.text.trim() && (!modLive || block.live))
                .map(block => ({ id: block.id, target: block.replyTo || '', text: block.text })),
        },
        ...progress.analysts.map((analyst): DebateStageActor => {
            const answering = Boolean(activeDebateSpeakers[analyst.displayName] || activeDebateSpeakers[analyst.providerName]);
            const live = analyst.status === 'analyzing' || answering;
            const speakerTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && matchesSpeaker(t.speaker, analyst));
            const lastTurn = speakerTurns[speakerTurns.length - 1];
            // finalOutput is raw provider prose — peel think tags so the
            // balloon/packet snippet never shows scratchpad markup.
            const replyText = lastTurn?.text
                || (analyst.finalOutput ? splitThinkingFromOutput('', analyst.finalOutput).output : '');
            // The bot SPEAKS only once it has output to say; while its CoT
            // streams (analysis/openings, or a rebuttal's pre-text phase) it
            // stays in the THINKING state — thought bubble + orbit animation.
            const hasSpeech = Boolean(replyText.trim());
            const speaking = answering && live && hasSpeech;
            return {
                id: analyst.key,
                name: formatSeatLabel(analyst.displayName),
                toneKey: analyst.modelId || analyst.modelName || analyst.displayName,
                live,
                thinking: live && !speaking,
                speaking,
                // Reasoning arrives keyed several ways (analyst key, display
                // name, provider name) depending on the phase — check all of
                // them so the stage thought bubble streams live during
                // rebuttals/clarifications, not only the analysis phase.
                thought: [
                    analyst.reasoning,
                    analyst.thoughtProcess,
                    reasoningProcesses[analyst.key],
                    reasoningProcesses[analyst.displayName],
                    reasoningProcesses[analyst.providerName],
                ].filter(Boolean).join('\n\n'),
                speech: replyText || undefined,
                replyTo: speakerTurns.some(t => (t.round ?? 0) > 1) ? 'Moderator' : undefined,
                replies: speakerTurns.some(t => (t.round ?? 0) > 1) && replyText
                    ? [{
                        id: `${analyst.key}-${lastTurn?.round ?? 'last'}`,
                        target: 'Moderator',
                        text: replyText,
                    }]
                    : undefined,
            };
        }),
    ], [
        activeDebateSpeakers,
        debateTurns,
        modLive,
        modThinking,
        modSpeaking,
        moderatorBlocks,
        moderatorThinking,
        progress.analysts,
        reasoningProcesses,
    ]);

    const seats = useMemo((): SeatView[] => {
        const moderatorTokens = (runStats?.promptTokens ?? 0) + (runStats?.completionTokens ?? 0);
        const moderator: SeatView = {
            id: 'moderator',
            title: 'Moderator',
            modelName: 'Floor',
            status: verdictLive ? 'verdict' : modLive ? 'asking' : moderatorBlocks.length > 0 ? 'posed' : 'Waiting',
            live: modLive,
            speaking: modSpeaking,
            thinking: moderatorThinking || (modLive && !modSpeaking ? 'Thinking' : ''),
            blocks: moderatorBlocks,
            usage: moderatorTokens > 0 ? `${moderatorTokens.toLocaleString()} tok` : undefined,
            toneKey: 'moderator',
        };
        const analysts: SeatView[] = progress.analysts.map((analyst): SeatView => {
            const answering = Boolean(activeDebateSpeakers[analyst.displayName] || activeDebateSpeakers[analyst.providerName]);
            const live = analyst.status === 'analyzing' || answering;
            const speakerTurns = debateTurns.filter(t => t.speaker !== 'Moderator' && matchesSpeaker(t.speaker, analyst));
            const lastTurn = speakerTurns[speakerTurns.length - 1];
            const openingRaw = analyst.finalOutput && analyst.finalOutput !== lastTurn?.text ? analyst.finalOutput : '';
            // Same speaking gate as the stage: no output text yet → still
            // "thinking" in the seat header, even while the turn streams.
            const hasSpeech = Boolean((lastTurn?.text || openingRaw || '').trim());
            const streamedCot = [
                analyst.reasoning,
                analyst.thoughtProcess,
                reasoningProcesses[analyst.key],
                reasoningProcesses[analyst.displayName],
                reasoningProcesses[analyst.providerName],
            ].filter(Boolean).join('\n\n');
            const openingSplit = splitThinkingFromOutput(streamedCot, openingRaw);
            const turnSplits = speakerTurns.map((turn, index) => {
                const streamed = turn.reasoning
                    || (index === 0 || index === speakerTurns.length - 1 ? streamedCot : '');
                const split = splitThinkingFromOutput(streamed, turn.text || '');
                return {
                    id: `${analyst.key}-${index}`,
                    replyTo: turn.round && turn.round > 1 ? 'Moderator' : undefined,
                    text: split.output,
                    thinking: split.thinking,
                    live: live && answering && index === speakerTurns.length - 1,
                    round: turn.round && turn.round > 0 ? turn.round : index + 1,
                };
            });
            const blocks: SeatBlock[] = [
                ...(openingSplit.output ? [{
                    id: `${analyst.key}-open`,
                    text: openingSplit.output,
                    round: 1,
                    thinking: openingSplit.thinking,
                    live: live && speakerTurns.length === 0,
                }] : []),
                ...turnSplits,
            ];
            const onBlocks = blocks.map(b => b.thinking).filter(Boolean).join('\n\n');
            const thinking = onBlocks
                ? ''
                : (openingSplit.thinking || streamedCot || (live && !hasSpeech ? 'Thinking' : ''));
            const title = formatSeatLabel(analyst.displayName);
            const prettyModel = formatModelDisplayName(analyst.modelId || analyst.modelName);
            const ledger = runStats?.analysts?.find(a =>
                a.providerId === analyst.providerId || a.modelId === analyst.modelId || a.displayName === analyst.displayName
            );
            const tokens = ledger
                ? (ledger.promptTokens ?? 0) + (ledger.completionTokens ?? 0) || Math.round((ledger.charsOut ?? 0) / 4)
                : 0;
            return {
                id: analyst.key,
                title,
                modelName: prettyModel && title.includes(prettyModel) ? analyst.providerName : prettyModel,
                status: laneStatusText(analyst, answering && live && hasSpeech),
                live,
                speaking: answering && live && hasSpeech,
                thinking,
                blocks,
                usage: tokens > 0 ? `${tokens.toLocaleString()} tok` : undefined,
                retryKey: analyst.status === 'error' ? analyst.key : undefined,
                error: analyst.error,
                toneKey: analyst.modelId || analyst.modelName || analyst.displayName,
            };
        });
        return [moderator, ...analysts];
    }, [
        activeDebateSpeakers,
        debateTurns,
        modLive,
        modSpeaking,
        moderatorBlocks,
        moderatorThinking,
        progress.analysts,
        reasoningProcesses,
        runStats,
        verdictLive,
    ]);

    const openSeat = seats.find(seat => seat.id === openSeatId) ?? null;

    useEffect(() => {
        if (!openSeatId) return;
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpenSeatId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openSeatId]);

    if (hideSubagents || progress.analysts.length === 0) return null;

    return (
        <div className={`ui-panel relative ${compact ? 'mt-0 mb-4' : 'mt-4'}`} aria-label="Floor">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 px-3 py-2 text-[11px] text-zinc-500">
                <button
                    type="button"
                    onClick={() => {
                        setFloorOpen(open => {
                            if (open) setOpenSeatId(null);
                            return !open;
                        });
                    }}
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
                <div className="debate-floor-body">
                    <DebateStage actors={stageActors} caption={turnCaption} onOpenActor={setOpenSeatId} />
                    {openSeat && (
                        <div
                            className="debate-seat-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-label={`${openSeat.title} analysis`}
                        >
                            <div
                                className="debate-seat-modal-head"
                                onClick={() => setOpenSeatId(null)}
                            >
                                <button
                                    type="button"
                                    className="debate-seat-modal-collapse"
                                    onClick={() => setOpenSeatId(null)}
                                    aria-label={`Collapse ${openSeat.title} analysis`}
                                >
                                    <DebateBotAvatar
                                        name={openSeat.title}
                                        toneKey={openSeat.toneKey}
                                        live={openSeat.live}
                                        thinking={openSeat.live && !openSeat.speaking}
                                        speaking={openSeat.speaking}
                                        size={36}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] text-zinc-200">{openSeat.title}</p>
                                        <p className="truncate text-[11px] text-zinc-500">
                                            {[openSeat.modelName, openSeat.status, openSeat.usage].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                </button>
                                {openSeat.retryKey && onRetryAnalyst && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onRetryAnalyst(openSeat.retryKey!);
                                        }}
                                        className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                                    >
                                        Retry
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setOpenSeatId(null)}
                                    className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200"
                                    aria-label={`Close ${openSeat.title} analysis`}
                                >
                                    Close
                                </button>
                            </div>
                            <SeatTranscript
                                title={openSeat.title}
                                live={openSeat.live}
                                thinking={openSeat.thinking}
                                blocks={openSeat.blocks}
                                error={openSeat.error}
                            />
                        </div>
                    )}
                    <span className="sr-only">{lanes.length} timeline lanes</span>
                </div>
            )}
        </div>
    );
};

export const AnalystSubagents = EnsembleProgressChat;

export default React.memo(EnsembleProgressChat);

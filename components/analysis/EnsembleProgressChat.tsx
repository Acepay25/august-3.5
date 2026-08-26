import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn, EnsembleAnalystProgress, EnsembleProgress, RunStats } from '../../types';
import ReasoningRow from '../shared/ReasoningRow';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import { formatModelDisplayName, formatSeatLabel } from '../../utils/providerUtils';
import { buildAnalystGantt, lastThoughtSnippet } from '../../utils/runGantt';
import { computeFloorLean } from '../../utils/floorLean';
import { splitThinkingFromOutput, looksLikePublicAnswer, looksLikeScratchpad, looksLikeTradeOutput } from '../../utils/thinkingSplit';
import { loadPerformanceData } from '../../services/backtesting/ModelPerformanceService';
import { DebateBotAvatar } from './DebateBotAvatar';

interface EnsembleProgressChatProps {
    progress: EnsembleProgress;
    modelIdToName?: Record<string, string>;
    isLive?: boolean;
    hideSubagents?: boolean;
    compact?: boolean;
    onRetryAnalyst?: (analystKey: string) => void;
    /** U3: queue a mid-debate note addressed to ONE seat only. */
    onSteerSeat?: (seatName: string, note: string) => void;
    /** U3: bench one seat — they leave at the next round boundary. */
    onStopSeat?: (seatName: string) => void;
    debateTurns?: DebateTurn[];
    activeDebateSpeakers?: Record<string, number>;
    liveToolEvents?: Record<string, string>;
    reasoningProcesses?: Record<string, string>;
    runStats?: RunStats;
    /** The user prompt that started this debate — shown as the "You" bubble. */
    userPrompt?: { text: string; createdAt?: string } | null;
    /** Threaded follow-up (reuses the follow-up-ticket pipeline). */
    onReplyInThread?: (text: string) => void;
}

const STATUS_TEXT: Record<EnsembleAnalystProgress['status'], string> = {
    waiting: 'Waiting',
    analyzing: 'thinking',
    error: 'unavailable',
    complete: 'Completed',
};

const PHASES = ['Openings', 'Rebuttals', 'Verdict'] as const;

/**
 * Debate-flow upgrade badges (devil's advocate / evidence round / sealed
 * conviction). Derived from turn text — no schema change needed.
 */
const DEVIL_BADGE = 'Devil’s advocate';
const EVIDENCE_BADGE = 'Evidence round';

const extractConviction = (text: string): number | null => {
    const m = text.match(/CONVICTION:\s*(\d{1,3})/i);
    if (!m) return null;
    return Math.min(100, Math.max(0, parseInt(m[1], 10)));
};

const isDevilTurn = (text: string): boolean =>
    /contra position|strongest honest case against/i.test(text);

const isEvidenceTurn = (text: string): boolean =>
    /evidence round|concrete data point already on the table/i.test(text);

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
    createdAt?: string;
    metrics?: { ttftMs?: number; tokensPerSec?: number };
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
    trackRecord?: string;
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

/** Compact relative timestamp for thread rows ("just now", "24 sec ago", …). */
export const relativeTurnTime = (iso?: string): string => {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs} sec ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.round(hours / 24)} d ago`;
};

const ReplyBlock: React.FC<{ block: SeatBlock; fallbackThinking?: string }> = React.memo(({ block, fallbackThinking }) => {
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
            return <p className="px-3 py-1 text-xs italic text-zinc-600">thinking…</p>;
        }
        if (!thinking) return null;
        return <p className="px-3 py-1 text-xs italic text-zinc-600">No public answer — the model only returned a scratchpad.</p>;
    }
    return (
        <div className="debate-speech mx-2 rounded-lg border border-white/[0.05] px-3 py-2">
            {block.replyTo && (
                <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">reply to {block.replyTo}</p>
            )}
            {!block.live && <p className="mb-1 text-[11px] text-zinc-500">Final output</p>}
            <FadeStream text={text} live={block.live} className="text-[14px] leading-6 text-zinc-300" />
            {!block.live && block.metrics && (block.metrics.ttftMs !== undefined || block.metrics.tokensPerSec !== undefined) && (
                <p className="mt-1.5 text-[10px] tabular-nums text-zinc-600">
                    {block.metrics.ttftMs !== undefined && `first token ${(block.metrics.ttftMs / 1000).toFixed(1)}s`}
                    {block.metrics.ttftMs !== undefined && block.metrics.tokensPerSec !== undefined && ' · '}
                    {block.metrics.tokensPerSec !== undefined && `${block.metrics.tokensPerSec} tok/s`}
                </p>
            )}
        </div>
    );
});
ReplyBlock.displayName = 'ReplyBlock';

const ThinkingDetails: React.FC<{ text: string; live?: boolean; tokens?: number }> = ({ text, live, tokens }) => {
    if (!text) return null;
    return (
        <div className="border-b border-white/5 px-3 py-2">
            <ReasoningRow thinking={text} running={Boolean(live)} defaultOpen={false} tokens={tokens} />
        </div>
    );
};

const SeatTranscript: React.FC<{
    title: string;
    live: boolean;
    thinking: string;
    blocks: SeatBlock[];
    error?: string;
    tokens?: number;
}> = React.memo(({ title, live, thinking, blocks, error, tokens }) => {
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
        ? thinking : '';

    const passed = live && currentRound && currentRound.blocks.length === 0 && (currentRound.round ?? 0) > 1;

    return (
        <div className="debate-seat-modal-chat custom-scrollbar">
            {leftoverThinking && <ThinkingDetails text={leftoverThinking} live={live} tokens={tokens} />}
            <div className="flex flex-col gap-2 py-1">
                {currentRound && (
                    <div>
                        {rounds.length > 1 && (
                            <p className="px-3 pb-1 text-[11px] uppercase tracking-widest text-zinc-500">
                                {currentRound.label}{currentRound.live ? ' · live' : ''}
                            </p>
                        )}
                        <ThinkingDetails text={currentRound.thinking} live={currentRound.live || live} tokens={tokens} />
                        <div className="flex flex-col gap-2">
                            {passed ? (
                                <p className="px-3 py-1 text-xs italic text-zinc-600">(passed)</p>
                            ) : (
                                currentRound.blocks.map(block => (
                                    <ReplyBlock key={block.id} block={block} fallbackThinking={currentRound.thinking || leftoverThinking} />
                                ))
                            )}
                        </div>
                    </div>
                )}
                {pastRounds.map(group => (
                    <details key={group.round} className="mx-2 rounded-lg border border-white/10 bg-zinc-950/30 px-3 py-2">
                        <summary className="cursor-pointer list-none text-[11px] uppercase tracking-widest text-zinc-500">
                            {group.label}{group.blocks[0]?.text ? ` · ${lastThoughtSnippet(group.blocks[0].text, 48)}` : group.live ? ' · (passed)' : ''}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                            <ThinkingDetails text={group.thinking} tokens={tokens} />
                            {group.blocks.length === 0 ? (
                                <p className="px-3 py-1 text-xs italic text-zinc-600">(passed)</p>
                            ) : (
                                group.blocks.map(block => <ReplyBlock key={block.id} block={block} fallbackThinking={group.thinking} />)
                            )}
                        </div>
                    </details>
                ))}
                {error && <p className="px-3 py-2 text-[11px] text-zinc-500">{error}</p>}
                {blocks.every(b => !b.text.trim()) && thinking && live && !passed && (
                    <p className="px-3 py-1 text-xs italic text-zinc-600">thinking…</p>
                )}
                {blocks.length === 0 && !thinking && !error && !passed && (
                    <p className="px-3 py-2 text-xs italic text-zinc-600">Waiting for this seat.</p>
                )}
            </div>
        </div>
    );
});
SeatTranscript.displayName = 'SeatTranscript';

// ─── Group-chat thread view ────────────────────────────────────────────────
// One chronological thread that reads like a group chat: avatar + name +
// relative time per turn, plain bodies, and an italic "{name} is thinking…"
// tail while a seat generates. Clicking a row opens that seat's full
// transcript modal (per-seat lanes stay available via the Seats toggle).

interface ThreadViewProps {
    turns: DebateTurn[];
    analysts: EnsembleAnalystProgress[];
    activeDebateSpeakers: Record<string, number>;
    reasoningProcesses: Record<string, string>;
    isLive: boolean;
    onOpenSeat: (seatId: string) => void;
    /** The user prompt that started this debate — rendered as the "You" bubble. */
    userPrompt?: { text: string; createdAt?: string } | null;
    /** Send a threaded follow-up (reuses the follow-up-ticket pipeline). */
    onReply?: (text: string) => void;
}

const speakerToneKey = (speaker: string, analysts: EnsembleAnalystProgress[]): string => {
    if (speaker === 'Moderator') return 'moderator';
    const analyst = analysts.find(a => matchesSpeaker(speaker, a));
    return analyst?.modelId || analyst?.modelName || speaker;
};

const ThreadTurnRow: React.FC<{
    turn: DebateTurn;
    showPhase: boolean;
    analysts: EnsembleAnalystProgress[];
    activeDebateSpeakers: Record<string, number>;
    streamedModeratorCoT: string;
    isLive: boolean;
    onOpenSeat: (seatId: string) => void;
    /** Pre-fill the reply composer addressed to this speaker. */
    onAsk?: (speaker: string) => void;
    /** Case-insensitive needle from the thread search box (empty = off). */
    searchQuery?: string;
}> = React.memo(({
    turn,
    showPhase,
    analysts,
    activeDebateSpeakers,
    streamedModeratorCoT,
    isLive,
    onOpenSeat,
    onAsk,
    searchQuery = '',
}) => {
    const hasText = Boolean(turn.text.trim());
    const rowLive = isLive && (
        activeDebateSpeakers[turn.speaker] === turn.round
        || (turn.speaker === 'Moderator' && !hasText && Boolean(streamedModeratorCoT))
    );
    const rawReasoning = turn.reasoning
        || (rowLive && turn.speaker === 'Moderator' ? streamedModeratorCoT : '');
    const split = splitThinkingFromOutput(rawReasoning, turn.text || '');
    const displayName = formatSeatLabel(turn.speaker);
    const toneKey = speakerToneKey(turn.speaker, analysts);
    const time = relativeTurnTime(turn.createdAt);

    if (turn.speaker === 'System') {
        return (
            <div className="px-3 py-2 text-center text-[11px] italic leading-relaxed text-zinc-600">
                {turn.text}
            </div>
        );
    }

    const openSeat = (): void => {
        if (turn.speaker === 'Moderator') {
            onOpenSeat('moderator');
            return;
        }
        const analyst = analysts.find(a => matchesSpeaker(turn.speaker, a));
        if (analyst) onOpenSeat(analyst.key);
    };

    const isYou = displayName.toLowerCase() === 'you';
    // Search highlight: needle matches the speaker name or the body text.
    const searchMatches = Boolean(searchQuery.trim()) && (
        displayName.toLowerCase().includes(searchQuery.trim().toLowerCase())
        || turn.text.toLowerCase().includes(searchQuery.trim().toLowerCase())
    );
    // Addressing chip: rebuttals open with the targeted analyst's name —
    // surface it as an "@Name" mention instead of a subtitle line.
    const mentionTarget = (() => {
        if (turn.speaker === 'Moderator' && hasText) {
            const labels = analysts.map(a => a.displayName).filter(Boolean).sort((a, b) => b.length - a.length);
            for (const label of labels) {
                if (new RegExp(`^\\s*[*_~]*${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[*_~]*\\s*[:—-]`, 'i').test(turn.text)) return label;
            }
        }
        return undefined;
    })();
    return (
        <>
            {showPhase && (
                <div className="mt-4 flex items-center gap-2 px-3 pb-1" aria-hidden="true">
                    <span className="h-px flex-1 bg-white/[0.05]" />
                    <span className="text-[10px] text-zinc-600">{roundLabel(turn.round ?? 1)}</span>
                    <span className="h-px flex-1 bg-white/[0.05]" />
                </div>
            )}
            <div
                className={`group relative px-3 py-2 ${rowLive ? 'debate-seat-live' : ''} ${isYou ? 'mx-2 rounded-lg bg-zinc-800/60' : ''} ${searchMatches ? 'ring-1 ring-inset ring-white/20' : ''}`}
            >
                {onAsk && !isYou && (
                    <button
                        type="button"
                        aria-label={`Ask ${displayName} a follow-up`}
                        title={`Ask ${displayName} about this turn`}
                        onClick={e => {
                            e.stopPropagation();
                            onAsk(turn.speaker);
                        }}
                        className="absolute right-2 top-1.5 hidden rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-100 group-hover:block"
                    >
                        Ask
                    </button>
                )}
                <div
                    className="flex cursor-pointer items-center gap-2"
                    role="button"
                    aria-label={`Open ${displayName} analysis`}
                    title={`Open ${displayName} full transcript`}
                    onClick={openSeat}
                >
                    <DebateBotAvatar
                        name={displayName}
                        toneKey={toneKey}
                        size={28}
                        square
                        live={rowLive}
                        thinking={rowLive && !hasText}
                        speaking={rowLive && hasText}
                    />
                    <span className={`text-[13px] font-medium ${isYou ? 'text-zinc-100' : 'text-zinc-300'}`}>{displayName}</span>
                    {mentionTarget && (
                        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium text-zinc-400">@{formatSeatLabel(mentionTarget)}</span>
                    )}
                    {!rowLive && isDevilTurn(split.output) && (
                        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{DEVIL_BADGE}</span>
                    )}
                    {!rowLive && isEvidenceTurn(split.output) && (
                        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{EVIDENCE_BADGE}</span>
                    )}
                    {!rowLive && extractConviction(split.output) !== null && (
                        <span
                            className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-200"
                            title="Sealed conviction — visible to the Moderator only during the debate"
                        >
                            Conviction {extractConviction(split.output)}/100
                        </span>
                    )}
                    <span className="text-[11px] tabular-nums text-zinc-500">
                        {rowLive && !hasText ? 'typing…' : time}
                    </span>
                </div>
                <div className="ml-[36px] mt-1 min-w-0">
                    {split.thinking && (
                        <ReasoningRow
                            thinking={split.thinking}
                            running={rowLive && !hasText}
                            defaultOpen={false}
                        />
                    )}
                    {hasText ? (
                        <FadeStream text={split.output} live={rowLive} className="text-[14px] leading-6 text-zinc-300" />
                    ) : split.thinking ? null : (
                        <p className="py-0.5 text-xs italic text-zinc-500">
                            {rowLive ? `${displayName} is thinking…` : 'No public answer.'}
                        </p>
                    )}
                </div>
            </div>
        </>
    );
}, (a, b) => (
    a.turn.speaker === b.turn.speaker
    && a.turn.round === b.turn.round
    && a.turn.text === b.turn.text
    && (a.turn.reasoning || '') === (b.turn.reasoning || '')
    && a.showPhase === b.showPhase
    && a.isLive === b.isLive
    && a.onAsk === b.onAsk
    && a.searchQuery === b.searchQuery
));
ThreadTurnRow.displayName = 'ThreadTurnRow';

const ThreadView: React.FC<ThreadViewProps> = ({
    turns,
    analysts,
    activeDebateSpeakers,
    reasoningProcesses,
    isLive,
    onOpenSeat,
    userPrompt,
    onReply,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(true);
    const [replyOpen, setReplyOpen] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const signature = useMemo(
        () => turns.map(t => `${t.speaker}:${t.round ?? ''}:${t.text.length}`).join('|'),
        [turns],
    );
    const streamedModeratorCoT = (reasoningProcesses.moderator || reasoningProcesses.Moderator || '').trim();
    const matchCount = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return 0;
        return turns.filter(t =>
            t.speaker !== 'System' && (
                formatSeatLabel(t.speaker).toLowerCase().includes(q)
                || t.text.toLowerCase().includes(q)
            ),
        ).length;
    }, [turns, searchQuery]);

    useEffect(() => {
        const el = scrollRef.current;
        if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
    }, [signature]);

    let previousRound: number | undefined;

    const submitReply = (): void => {
        const text = replyText.trim();
        if (!text || !onReply) return;
        onReply(text);
        setReplyText('');
        setReplyOpen(false);
    };

    // "Ask" on a thread row: open the composer pre-addressed to the speaker.
    const askSpeaker = (speaker: string): void => {
        if (!onReply) return;
        setReplyText(`@${formatSeatLabel(speaker)} `);
        setReplyOpen(true);
    };

    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-zinc-500">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600"><path d="M6 9l6 6 6-6" /></svg>
                Collapse thread
                {/* Avatar stack + bot count, reference-style header cluster. */}
                <span className="ml-auto flex items-center -space-x-1.5" aria-hidden="true">
                    {analysts.slice(0, 4).map(a => (
                        <DebateBotAvatar key={a.key} name={a.displayName} toneKey={a.modelId || a.modelName} size={18} square />
                    ))}
                </span>
                <span className="text-[11px]">{analysts.length} bots</span>
                <button
                    type="button"
                    onClick={() => {
                        setSearchOpen(open => !open);
                        if (searchOpen) setSearchQuery('');
                    }}
                    aria-label="Search thread"
                    title="Search thread"
                    className={`rounded p-0.5 transition-colors ${searchOpen ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                </button>
            </div>
            {searchOpen && (
                <div className="flex items-center gap-2 px-3 pb-1.5">
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') { setSearchQuery(''); setSearchOpen(false); }
                        }}
                        placeholder="Search this debate…"
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                    />
                    {searchQuery.trim() && (
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
                        </span>
                    )}
                </div>
            )}
            <div
                ref={scrollRef}
                className="debate-chat-thread custom-scrollbar ml-3 max-h-[520px] overflow-y-auto border-l border-white/[0.06] py-1 pl-1"
                onScroll={() => {
                    const el = scrollRef.current;
                    if (!el) return;
                    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
            >
            {userPrompt && Boolean(userPrompt.text.trim()) && (
                <div className="mx-2 mb-2 rounded-lg bg-zinc-800/60 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-zinc-100">You</span>
                        <span className="text-[11px] tabular-nums text-zinc-500">{relativeTurnTime(userPrompt.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-6 text-zinc-300">{userPrompt.text}</p>
                </div>
            )}
            {turns.map((turn, index) => {
                const showPhase = typeof turn.round === 'number'
                    && turn.speaker !== 'System'
                    && turn.round !== previousRound
                    && (previousRound === undefined || turn.round > previousRound);
                if (turn.speaker !== 'System' && typeof turn.round === 'number') previousRound = turn.round;
                return (
                    <ThreadTurnRow
                        key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`}
                        turn={turn}
                        showPhase={showPhase}
                        analysts={analysts}
                        activeDebateSpeakers={activeDebateSpeakers}
                        streamedModeratorCoT={streamedModeratorCoT}
                        isLive={isLive}
                        onOpenSeat={onOpenSeat}
                        onAsk={onReply ? askSpeaker : undefined}
                        searchQuery={searchQuery}
                    />
                );
            })}
            {(() => {
                // Tail indicator — every seat currently generating without a
                // visible streaming row gets an italic "{name} is thinking…".
                const names: string[] = [];
                for (const [name, round] of Object.entries(activeDebateSpeakers)) {
                    const settled = turns.some(t => t.speaker === name && t.round === round && Boolean(t.text.trim()));
                    if (!settled) names.push(name);
                }
                const anyAnalystTurns = turns.some(t => t.speaker !== 'Moderator' && t.speaker !== 'System');
                if (!anyAnalystTurns) {
                    for (const a of analysts) {
                        if (a.status === 'analyzing' && !names.includes(a.displayName)) names.push(a.displayName);
                    }
                }
                if (names.length === 0) return null;
                return (
                    <div className="px-3 pb-1 pt-2">
                        {names.map(name => (
                            <p key={name} className="py-0.5 text-xs italic text-zinc-500">
                                {formatSeatLabel(name)} is thinking…
                            </p>
                        ))}
                    </div>
                );
            })()}
            </div>
            <div className="px-3 py-2">
                {replyOpen && onReply ? (
                    <div className="flex items-center gap-1.5">
                        <input
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') submitReply();
                                if (e.key === 'Escape') setReplyOpen(false);
                            }}
                            placeholder="Reply in thread… (@name to direct)"
                            autoFocus
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={submitReply}
                            disabled={!replyText.trim()}
                            className="rounded-lg border border-white/10 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors enabled:hover:border-white/25 disabled:text-zinc-600"
                        >
                            Reply
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setReplyOpen(true)}
                        className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                        Reply in thread
                    </button>
                )}
            </div>
        </div>
    );
};

const EnsembleProgressChat: React.FC<EnsembleProgressChatProps> = ({
    progress,
    modelIdToName: _modelIdToName = {},
    isLive = false,
    hideSubagents = false,
    compact = false,
    onRetryAnalyst,
    onSteerSeat,
    onStopSeat,
    debateTurns = [],
    activeDebateSpeakers = {},
    liveToolEvents = {},
    reasoningProcesses = {},
    runStats,
    userPrompt,
    onReplyInThread,
}) => {
    const lanes = useMemo(() => buildAnalystGantt(progress), [progress]);
    const analystNames = progress.analysts.map(a => a.displayName);
    const modLive = Boolean(activeDebateSpeakers['Moderator']) || progress.moderator.status === 'reviewing';
    const anyAnalystLive = progress.analysts.some(a => a.status === 'analyzing') || Object.keys(activeDebateSpeakers).some(k => k !== 'Moderator');
    const openingsDone = debateTurns.some(t => t.round === 1);
    const rebuttalStarted = debateTurns.some(t => (t.round ?? 0) >= 2);
    const verdictLive = modLive && rebuttalStarted && !anyAnalystLive;
    const floorLean = useMemo(() => computeFloorLean(debateTurns), [debateTurns]);
    const phase = verdictLive || progress.moderator.status === 'reviewing' && openingsDone
        ? (rebuttalStarted ? 'Verdict' : 'Openings')
        : rebuttalStarted ? 'Rebuttals' : 'Openings';
    const maxRound = debateTurns.reduce((m, t) => Math.max(m, t.round ?? 0), 0);

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
                return [{ id: `mod-${index}`, replyTo: undefined, text: '', live, round, thinking: split.thinking, createdAt: turn.createdAt, metrics: turn.metrics }];
            }
            if (parts.length === 0) {
                return [{ id: `mod-${index}`, replyTo: undefined, text: split.output, live, round, thinking: split.thinking, createdAt: turn.createdAt, metrics: turn.metrics }];
            }
            return parts.map((part, partIndex) => ({
                id: `mod-${index}-${partIndex}`,
                replyTo: part.target,
                text: part.text,
                live,
                round,
                thinking: partIndex === 0 ? split.thinking : undefined,
                createdAt: partIndex === 0 ? turn.createdAt : undefined,
                metrics: partIndex === 0 ? turn.metrics : undefined,
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
    // Debate rendering: chronological group-chat thread by default (like the
    // Odin/Moses reference) once a debate has turns. Before any turn lands
    // (openings streaming) keep the classic per-seat lanes so `Analyst A`
    // roster tests and the live openings view stay meaningful.
    const [view, setView] = useState<'thread' | 'seats'>('thread');
    const effectiveView: 'thread' | 'seats' = debateTurns.length > 0 ? view : 'seats';
    const [query, setQuery] = useState('');

    const perfCacheRef = useRef<{ at: number; data: ReturnType<typeof loadPerformanceData> } | null>(null);
    const getPerfData = (): ReturnType<typeof loadPerformanceData> => {
        const now = Date.now();
        if (perfCacheRef.current && now - perfCacheRef.current.at < 5000) return perfCacheRef.current.data;
        const data = loadPerformanceData();
        perfCacheRef.current = { at: now, data };
        return data;
    };

    const seats = useMemo((): SeatView[] => {
        const perfData = getPerfData();
        const moderatorTokens = (runStats?.promptTokens ?? 0) + (runStats?.completionTokens ?? 0);
        const moderator: SeatView = {
            id: 'moderator',
            title: 'Moderator',
            modelName: 'Floor',
            status: verdictLive ? 'verdict' : modLive ? 'asking' : moderatorBlocks.length > 0 ? 'posed' : 'Waiting',
            live: modLive,
            speaking: moderatorBlocks.some(b => b.live && Boolean(b.text.trim())),
            thinking: moderatorThinking || (modLive ? 'Thinking' : ''),
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
                const streamed = turn.reasoning || (index === 0 || index === speakerTurns.length - 1 ? streamedCot : '');
                const split = splitThinkingFromOutput(streamed, turn.text || '');
                return {
                    id: `${analyst.key}-${index}`,
                    replyTo: turn.round && turn.round > 1 ? 'Moderator' : undefined,
                    text: split.output,
                    thinking: split.thinking,
                    live: live && answering && index === speakerTurns.length - 1,
                    round: turn.round && turn.round > 0 ? turn.round : index + 1,
                    createdAt: turn.createdAt,
                    metrics: turn.metrics,
                };
            });
            const blocks: SeatBlock[] = [
                ...(openingSplit.output ? [{
                    id: `${analyst.key}-open`,
                    text: openingSplit.output,
                    round: 1,
                    thinking: openingSplit.thinking,
                    live: live && speakerTurns.length === 0,
                    createdAt: lastTurn?.createdAt,
                }] : []),
                ...turnSplits,
            ];
            const onBlocks = blocks.map(b => b.thinking).filter(Boolean).join('\n\n');
            const thinking = onBlocks ? '' : (openingSplit.thinking || streamedCot || (live && !hasSpeech ? 'Thinking' : ''));
            const title = formatSeatLabel(analyst.displayName);
            const prettyModel = formatModelDisplayName(analyst.modelId || analyst.modelName);
            const ledger = runStats?.analysts?.find(a =>
                a.providerId === analyst.providerId || a.modelId === analyst.modelId || a.displayName === analyst.displayName
            );
            const tokens = ledger
                ? (ledger.promptTokens ?? 0) + (ledger.completionTokens ?? 0) || Math.round((ledger.charsOut ?? 0) / 4)
                : 0;
            const perf = perfData[analyst.providerId] || perfData[analyst.providerName];
            const trackRecord = perf && typeof perf.overallStats?.winRate === 'number' && (perf.overallStats.total ?? 0) >= 3
                ? `${perf.overallStats.winRate.toFixed(0)}% wr` : undefined;
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
                trackRecord,
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
        moderatorBlocks,
        moderatorThinking,
        progress.analysts,
        reasoningProcesses,
        runStats,
        verdictLive,
    ]);

    const filteredSeats = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return seats;
        return seats.filter(s => `${s.title} ${s.modelName} ${s.status}`.toLowerCase().includes(q));
    }, [seats, query]);

    const openSeat = seats.find(seat => seat.id === openSeatId) ?? null;
    const totalTokens = (runStats?.promptTokens ?? 0) + (runStats?.completionTokens ?? 0);
    // Live estimate while the debate streams: settled analyst output chars / 4
    // (the same heuristic the run summary uses). runStats only lands at the end.
    const liveTokenEstimate = useMemo(
        () => progress.analysts.reduce((sum, a) => sum + Math.round(((a.finalOutput?.length ?? 0) + (a.thoughtProcess?.length ?? 0)) / 4), 0),
        [progress.analysts],
    );
    const shownTokens = totalTokens > 0 ? totalTokens : liveTokenEstimate;
    const analystSeats = seats.filter(seat => seat.id !== 'moderator');
    const respondingCount = analystSeats.filter(seat => seat.live).length;
    const activeNow = useMemo(() => {
        const entries = Object.entries(activeDebateSpeakers);
        if (entries.length === 0) return [];
        return entries
            .filter(([, ts]) => Date.now() - ts < 90_000)
            .map(([name]) => name);
    }, [activeDebateSpeakers]);

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
        <div className={`relative ${compact ? 'mt-0 mb-2' : 'mt-6 border-t border-white/[0.06] pt-0'}`} aria-label="Floor">
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
                    {isLive ? 'Floor' : 'Bots'}
                </button>
                {PHASES.map((p, i) => (
                    <React.Fragment key={p}>
                        {i > 0 && <span className="text-zinc-700">·</span>}
                        <span className={p === phase ? 'text-zinc-200' : 'text-zinc-600'}>
                            {p} {p === 'Openings' && openingsDone ? '●' : p === phase ? '●' : '○'}
                        </span>
                    </React.Fragment>
                ))}
                {rebuttalStarted && maxRound >= 2 && (
                    <span className="text-zinc-500">Round {Math.min(maxRound, 3)}/3</span>
                )}
                {isLive && floorLean.lean && (
                    <span className="floor-lean" title={`Floor lean: ${floorLean.long} long · ${floorLean.short} short${floorLean.neutral ? ` · ${floorLean.neutral} neutral` : ''}`}>
                        <span className="floor-lean-label">lean</span>
                        <span className="floor-lean-bar" aria-hidden="true">
                            <span className="floor-lean-fill floor-lean-fill-long" style={{ width: `${(floorLean.long / Math.max(1, floorLean.declared)) * 100}%` }} />
                            <span className="floor-lean-fill floor-lean-fill-short" style={{ width: `${(floorLean.short / Math.max(1, floorLean.declared)) * 100}%` }} />
                        </span>
                        <span className="floor-lean-value">{floorLean.lean}</span>
                    </span>
                )}
                <span className="ml-auto flex items-center gap-x-2">
                    {debateTurns.length > 0 && (
                        <span className="flex items-center rounded-md border border-white/10 p-0.5 text-[10px]">
                            {(['thread', 'seats'] as const).map(v => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setView(v)}
                                    aria-pressed={effectiveView === v}
                                    className={`rounded px-1.5 py-0.5 capitalize transition-colors ${
                                        effectiveView === v
                                            ? 'bg-zinc-800 text-zinc-200'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    {v}
                                </button>
                            ))}
                        </span>
                    )}
                    {isLive && respondingCount > 0 && (
                        <span className="text-zinc-500">{respondingCount}/{analystSeats.length} responding</span>
                    )}
                    {isLive && (
                        <span
                            className="text-zinc-600"
                            title={totalTokens > 0
                                ? `${progress.analysts.length} seats · ${(runStats?.promptTokens ?? 0).toLocaleString()} prompt + ${(runStats?.completionTokens ?? 0).toLocaleString()} completion`
                                : `${progress.analysts.length} seats · live estimate from streamed output`}
                        >
                            {progress.analysts.length} seats{shownTokens > 0 ? ` · ~${shownTokens.toLocaleString()} tok${totalTokens > 0 ? '' : ' (est.)'}` : ''}
                        </span>
                    )}
                </span>
            </div>

            {isLive && activeNow.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">Active now</span>
                    {activeNow.map(name => (
                        <span key={name} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            {formatSeatLabel(name)}
                        </span>
                    ))}
                </div>
            )}

            {floorOpen && (
                <div className="debate-floor-body border-t border-white/[0.06]">
                    {effectiveView === 'thread' ? (
                        <ThreadView
                            turns={debateTurns}
                            analysts={progress.analysts}
                            activeDebateSpeakers={activeDebateSpeakers}
                            reasoningProcesses={reasoningProcesses}
                            isLive={isLive}
                            onOpenSeat={setOpenSeatId}
                            userPrompt={userPrompt}
                            onReply={onReplyInThread}
                        />
                    ) : (
                        <>
                            <div className="flex items-center gap-2 px-1 py-2">
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Filter bots"
                                    className="w-36 rounded-md bg-zinc-900/60 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-0"
                                />
                                <span className="ml-auto text-[11px] text-zinc-600">{filteredSeats.length} bots</span>
                            </div>
                            <div className="divide-y divide-white/[0.06]">
                                {filteredSeats.map(seat => (
                                    <div key={seat.id} className="py-1">
                                <div className="debate-thread-seat-head cursor-pointer" role="button" aria-label={`Open ${seat.title} analysis`} onClick={() => setOpenSeatId(seat.id)}>
                                    <span className="debate-thread-seat-name flex items-center gap-2">
                                        <DebateBotAvatar name={seat.title} toneKey={seat.toneKey} live={seat.live} thinking={seat.live && !seat.speaking} speaking={seat.speaking} size={28} />
                                        {seat.title}
                                    </span>
                                    <span className="debate-thread-seat-meta">
                                        {[seat.modelName, seat.trackRecord, seat.status, seat.usage].filter(Boolean).join(' · ')}
                                    </span>
                                    {/* U3 per-seat controls: steer / stop this seat only. */}
                                    {isLive && (onSteerSeat || onStopSeat) && (
                                        <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/seat:opacity-100 focus-within:opacity-100" onClick={e => e.stopPropagation()}>
                                            {onSteerSeat && (
                                                <button
                                                    type="button"
                                                    title={`Steer ${seat.title}: queue a note only they see`}
                                                    onClick={() => {
                                                        const note = window.prompt(`Steer ${seat.title}`, '');
                                                        if (note?.trim()) onSteerSeat(seat.title, note.trim());
                                                    }}
                                                    className="rounded-md p-1 text-zinc-600 hover:text-zinc-200"
                                                >
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                                </button>
                                            )}
                                            {onStopSeat && seat.live && (
                                                <button
                                                    type="button"
                                                    title={`Stop ${seat.title}: they leave the debate at the next round`}
                                                    onClick={() => onStopSeat(seat.title)}
                                                    className="rounded-md p-1 text-zinc-600 hover:text-rose-400"
                                                >
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                                                </button>
                                            )}
                                        </span>
                                    )}
                                </div>
                                        <SeatTranscript title={seat.title} live={seat.live} thinking={seat.thinking} blocks={seat.blocks} error={seat.error} tokens={seat.usage ? parseInt(seat.usage.replace(/[^0-9]/g, '')) || undefined : undefined} />
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {openSeat && (
                        <div className="debate-seat-modal" role="dialog" aria-modal="true" aria-label={`${openSeat.title} analysis`}>
                            <div className="debate-seat-modal-head" onClick={() => setOpenSeatId(null)}>
                                <button type="button" className="debate-seat-modal-collapse" onClick={() => setOpenSeatId(null)} aria-label={`Collapse ${openSeat.title} analysis`}>
                                    <DebateBotAvatar name={openSeat.title} toneKey={openSeat.toneKey} live={openSeat.live} thinking={openSeat.live && !openSeat.speaking} speaking={openSeat.speaking} size={36} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] text-zinc-200">{openSeat.title}</p>
                                        <p className="truncate text-[11px] text-zinc-500">{[openSeat.modelName, openSeat.status, openSeat.usage].filter(Boolean).join(' · ')}</p>
                                    </div>
                                </button>
                                {openSeat.retryKey && onRetryAnalyst && (
                                    <button
                                        type="button"
                                        onClick={event => {
                                            event.stopPropagation();
                                            onRetryAnalyst(openSeat.retryKey!);
                                        }}
                                        className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                                    >
                                        Retry
                                    </button>
                                )}
                                <button type="button" onClick={() => setOpenSeatId(null)} className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200" aria-label={`Close ${openSeat.title} analysis`}>Close</button>
                            </div>
                            <SeatTranscript title={openSeat.title} live={openSeat.live} thinking={openSeat.thinking} blocks={openSeat.blocks} error={openSeat.error} tokens={openSeat.usage ? parseInt(openSeat.usage.replace(/[^0-9]/g, '')) || undefined : undefined} />
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

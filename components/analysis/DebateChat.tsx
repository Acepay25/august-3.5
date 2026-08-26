import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn, AnalystLensConfig, TradeAnalysis, ReplacementOffer } from '../../types';
import { ChevronDownIcon, KebabMenuIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import ReasoningRow from '../shared/ReasoningRow';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import { getRoleDisplayForProvider } from '../../services/ui/AnalystLensService';
import { buildTranscriptMarkdown, buildTranscriptJson, buildTranscriptFilename, downloadTextFile } from '../../utils/transcriptExport';
import DebateSummary from './DebateSummary';
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';

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
    /** Owning message id — routes the replacement choice back to the run. */
    messageId?: string;
    /** Mid-debate replacement offer: an analyst dropped and the debate is
     *  waiting for the user to pick a fresh provider (or skip). */
    replacementOffer?: ReplacementOffer;
    /** Pick a replacement candidate (providerId) or pass null to continue without. */
    onReplacementChoice?: (messageId: string, providerId: string | null) => void;
    /** Copy this debate into a new session up to `round`. */
    onForkDebate?: (messageId: string, round: number) => void;
}

const cleanSpeakerPrefix = (text: string, speaker: string): string => {
    const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text
        .replace(/^\s*(?:\*{0,2})\s*\{\{\s*NAME\s*\}\}\s*:?\s*(?:\*{0,2})\s*/i, '')
        .replace(new RegExp(`^\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?:\\s*`, 'i'), '')
        .replace(/^\s*\*+\s*/, '')
        .trim();
};

const PHASES = ['Openings', 'Rebuttals', 'Clarification', 'Verdict'] as const;

const getPhaseHeading = (round: number, isVerdictRound = false): (typeof PHASES)[number] => {
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
 * a single moderator stream. Split those labelled sections so each question
 * sits under its own name row. Unlabelled verdict prose stays as one block.
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

/**
 * Per-turn thinking as the shared collapsible reasoning row. While the turn
 * streams it is EXPANDED so the thinking is visibly generated in real time
 * (DeepSeek-style); when the stream settles the row collapses to its
 * one-line summary automatically.
 */
const TurnThinking: React.FC<{ content: string; streaming?: boolean }> = ({ content, streaming = false }) => (
    <ReasoningRow thinking={content} running={streaming} defaultOpen={false} />
);

const SpeakerAvatar: React.FC<{ name: string; live?: boolean }> = ({ name, live = false }) => (
    <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-zinc-800 text-[10px] font-semibold text-zinc-200 ${live ? 'border-zinc-400 ring-1 ring-zinc-400/30' : 'border-white/10'}`}
        aria-hidden="true"
    >
        {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
);

/**
 * Live turns render progressive markdown with a frozen head (no O(n²)
 * re-parse, no end-of-stream jump — the tail is the only block that grows).
 * Finished turns render the full markdown in one pass.
 */
const StreamedTurnBody: React.FC<{ text: string; live: boolean }> = ({ text, live }) => {
    const shown = useSmoothStreamText(text, live);
    if (!shown.trim() && live) {
        return (
            <p className="text-sm italic text-zinc-500">
                Writing
                <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-zinc-300 align-middle" aria-hidden="true" />
            </p>
        );
    }
    if (live) {
        return (
            <div className="text-sm leading-6 text-zinc-200">
                <StreamingMarkdown text={shown} live className="text-sm leading-6 text-zinc-200" />
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-300 align-middle" aria-hidden="true" />
            </div>
        );
    }
    return <MarkdownContent content={shown} className="text-sm leading-6 text-zinc-200" />;
};

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

interface DebateTurnRowProps {
    turn: DebateTurn;
    showPhase: boolean;
    phase: string;
    firstRow: boolean;
    displayName: string;
    modelName: string;
    analystNames: string[];
    modelNames: string[];
    isVerdict: boolean;
    streaming: boolean;
    storedReasoning: string;
    onPhaseAnchor: (el: HTMLDivElement | null) => void;
}

/**
 * One debate turn row. Memoized by VALUE (text/reasoning/state) because the
 * pipeline rebuilds every turn object on each streamed delta — identity
 * memoization would be useless. Settled turns never change content, so a
 * live delta only re-renders the one row that is actually streaming.
 */
const DebateTurnRow = React.memo(function DebateTurnRow({
    turn,
    showPhase,
    phase,
    firstRow,
    displayName,
    modelName,
    analystNames,
    modelNames,
    isVerdict,
    streaming,
    storedReasoning,
    onPhaseAnchor,
}: DebateTurnRowProps) {
    const segments = turn.speaker === 'Moderator'
        ? splitModeratorTurn(turn.text, analystNames, modelNames)
        : [{ text: turn.text }];
    return (
        <React.Fragment>
            {showPhase && (
                <div
                    ref={onPhaseAnchor}
                    className={`text-[10px] font-semibold uppercase tracking-widest text-zinc-600 ${firstRow ? 'mb-3' : 'mb-3 mt-6'}`}
                >
                    {phase}
                </div>
            )}
            {segments.map((segment, segmentIndex) => {
                const rawBody = turn.speaker === 'Moderator'
                    ? segment.text.replace(/^\s*\*{0,2}\s*moderator\s+verdict\*{0,2}\s*[:—-]?\s*/i, '')
                    : cleanSpeakerPrefix(segment.text, turn.speaker);
                // One display-level split only: the pipeline
                // already peeled thinking/output when it stored
                // the turn. A second `visibleReplyFromThinking`
                // pass used to drop reply paragraphs that echo
                // the scratchpad, blanking real final outputs.
                const peeled = splitThinkingFromOutput(
                    segmentIndex === 0 ? storedReasoning : '',
                    rawBody,
                );
                const body = peeled.output;
                const turnReasoning = segmentIndex === 0 ? peeled.thinking : '';
                return (
                    <div
                        key={`${turn.speaker}-${turn.round ?? 'legacy'}-${segmentIndex}`}
                        className={`space-y-3 rounded-xl px-2 py-3 transition-colors ${
                            streaming
                                ? 'border border-white/15 bg-zinc-900'
                                : segmentIndex === 0 && !showPhase
                                    ? 'border-t border-white/5'
                                    : ''
                        }`}
                    >
                        <div className="mb-3 flex min-w-0 items-center gap-2">
                            <SpeakerAvatar name={displayName} live={streaming} />
                            <div className="min-w-0 flex-1">
                                <div className={`truncate text-xs font-medium ${isVerdict ? 'text-zinc-100' : 'text-zinc-300'}`}>
                                    {displayName}
                                </div>
                                <div className="truncate text-[11px] text-zinc-600">
                                    {segment.target ? `→ ${segment.target}` : modelName || (typeof turn.round === 'number' ? `Turn · ${phase || `R${turn.round}`}` : '')}
                                </div>
                            </div>
                            {streaming ? (
                                <span className="shrink-0 rounded-md border border-white/15 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200">
                                    Speaking
                                </span>
                            ) : (body.trim() || turnReasoning) ? (
                                <span className="shrink-0 text-[10px] text-zinc-600">Done</span>
                            ) : null}
                        </div>
                        {(isDevilTurn(body) || isEvidenceTurn(body) || extractConviction(body) !== null) && !streaming && (
                            <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                {isDevilTurn(body) && (
                                    <span className="rounded-md border border-white/15 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                                        {DEVIL_BADGE}
                                    </span>
                                )}
                                {isEvidenceTurn(body) && (
                                    <span className="rounded-md border border-white/15 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                                        {EVIDENCE_BADGE}
                                    </span>
                                )}
                                {extractConviction(body) !== null && (
                                    <span
                                        className="rounded-md border border-white/15 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-200"
                                        title="Sealed conviction — visible to the Moderator only during the debate"
                                    >
                                        Conviction {extractConviction(body)}/100
                                    </span>
                                )}
                            </div>
                        )}
                        {segmentIndex === 0 && turnReasoning && (
                            <TurnThinking content={turnReasoning} streaming={streaming} />
                        )}
                        <div className="min-w-0">
                            {body.trim() && !streaming && (
                                <div className="mb-1 text-[11px] text-zinc-500">Final output</div>
                            )}
                            {!body.trim() && !streaming && turnReasoning ? (
                                <p className="text-xs italic text-zinc-600">No public answer — the model only returned a scratchpad.</p>
                            ) : (
                                <StreamedTurnBody text={body} live={streaming} />
                            )}
                        </div>
                    </div>
                );
            })}
        </React.Fragment>
    );
}, (a, b) => (
    a.turn.speaker === b.turn.speaker
    && a.turn.round === b.turn.round
    && a.turn.text === b.turn.text
    && (a.turn.reasoning || '') === (b.turn.reasoning || '')
    && a.showPhase === b.showPhase
    && a.phase === b.phase
    && a.firstRow === b.firstRow
    && a.displayName === b.displayName
    && a.modelName === b.modelName
    && a.isVerdict === b.isVerdict
    && a.streaming === b.streaming
    && a.storedReasoning === b.storedReasoning
));

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
    messageId,
    replacementOffer,
    onReplacementChoice,
    onForkDebate,
}) => {
    // Open by default so a finished debate's thinking + final outputs stay
    // visible in the chat area (the header toggle still collapses them).
    const [showTranscript, setShowTranscript] = useState(true);
    const [briefingTab, setBriefingTab] = useState<(typeof PHASES)[number] | 'All'>('All');
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayIndex, setReplayIndex] = useState(0);
    const [replaySpeed, setReplaySpeed] = useState(1);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const [pendingPhaseJump, setPendingPhaseJump] = useState<(typeof PHASES)[number] | null>(null);
    const exportMenuRef = useRef<HTMLSpanElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const phaseAnchorRefs = useRef<Partial<Record<(typeof PHASES)[number], HTMLDivElement | null>>>({});
    const userScrolledUpRef = useRef(false);
    const touchYRef = useRef<number | null>(null);

    // Keep the currently streaming turn visible. The typing bubble is an
    // additional activity indicator, not a replacement for the analyst's
    // partial reply.
    const visibleTurns = useMemo(() => debateTurns, [debateTurns]);
    // Computed from ALL turns (not just visible ones) so a completed
    // clarification-question round is never mistaken for the verdict while
    // the verdict round is still streaming.
    const latestModeratorRound = useMemo(() => Math.max(0, ...debateTurns.filter(turn => turn.speaker === 'Moderator').map(turn => turn.round ?? 0)), [debateTurns]);
    const analystNames = useMemo(() => [...new Set(debateTurns.filter(turn => turn.speaker !== 'Moderator').map(turn => turn.speaker))], [debateTurns]);
    const modelNames = useMemo(() => Object.entries(modelsUsed).map(([key, modelId]) => modelIdToName[modelId] ?? modelId ?? key), [modelIdToName, modelsUsed]);

    // Auto-scroll only while the reader is at the live bottom. Wheel/touch-up
    // locks immediately so a stream chunk cannot reset scrollTop before onScroll.
    const lockIfScrollingUp = (deltaY: number): void => {
        if (deltaY < 0) {
            userScrolledUpRef.current = true;
            setIsScrolledUp(true);
            return;
        }
        const element = scrollRef.current;
        if (element && element.scrollHeight - element.scrollTop - element.clientHeight <= 80) {
            userScrolledUpRef.current = false;
            setIsScrolledUp(false);
        }
    };

    // Follow the live bottom only when the tail actually changed. A signature
    // of the transcript's last turn + active speakers avoids re-pinning on
    // unrelated re-renders (runStats/autopilot rebuilds), and rAF coalesces a
    // burst of deltas into one scroll per frame. Wheel/touch-up still locks.
    const followSignature = useMemo(() => {
        const last = visibleTurns[visibleTurns.length - 1];
        const tail = last ? `${last.speaker}:${last.round ?? ''}:${last.text.length}` : '';
        const speakers = Object.entries(activeDebateSpeakers).map(([s, r]) => `${s}:${r}`).join('|');
        return `${visibleTurns.length}:${tail}:${speakers}`;
    }, [visibleTurns, activeDebateSpeakers]);

    useEffect(() => {
        const element = scrollRef.current;
        if (!element || userScrolledUpRef.current) return;
        const pin = (): void => {
            if (!userScrolledUpRef.current) element.scrollTop = element.scrollHeight;
        };
        if (typeof requestAnimationFrame === 'function') {
            const frame = requestAnimationFrame(pin);
            return () => cancelAnimationFrame(frame);
        }
        const timer = window.setTimeout(pin, 0);
        return () => window.clearTimeout(timer);
    }, [followSignature]);

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

    const jumpToPhase = (phase: (typeof PHASES)[number] | 'All'): void => {
        setShowTranscript(true);
        setBriefingTab(phase);
        if (phase === 'All') {
            setPendingPhaseJump(null);
            return;
        }
        setPendingPhaseJump(phase);
        userScrolledUpRef.current = true;
        setIsScrolledUp(true);
    };

    const copyTranscript = () => {
        const text = debateTurns
            .map(t => `**${t.speaker}**${t.round ? ` (Round ${t.round})` : ''}:\n${t.text}`)
            .join('\n\n');
        navigator.clipboard.writeText(text).catch(() => {});
    };

    const exportTranscript = (format: 'md' | 'json') => {
        const content = format === 'md'
            ? buildTranscriptMarkdown(debateTurns, analysis)
            : buildTranscriptJson(debateTurns, analysis);
        downloadTextFile(
            buildTranscriptFilename(analysis, format),
            content,
            format === 'md' ? 'text/markdown' : 'application/json'
        );
        setIsExportOpen(false);
    };

    // Close the export menu on outside click.
    useEffect(() => {
        if (!isExportOpen) return undefined;
        const handlePointerDown = (event: PointerEvent): void => {
            if (!exportMenuRef.current?.contains(event.target as Node)) setIsExportOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isExportOpen]);

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
        if (speaker === 'Moderator') return 'Strategist';
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

    const reachedPhases = useMemo(() => {
        const phases = new Set<(typeof PHASES)[number]>();
        debateTurns.forEach(turn => {
            if (typeof turn.round !== 'number') return;
            const isVerdictRound = turn.speaker === 'Moderator' && turn.round === latestModeratorRound;
            phases.add(getPhaseHeading(turn.round, isVerdictRound));
        });
        return phases;
    }, [debateTurns, latestModeratorRound]);

    const transcriptOpen = isDebating || isReplaying || showTranscript || !analysis;

    useEffect(() => {
        if (!pendingPhaseJump) return;
        const el = phaseAnchorRefs.current[pendingPhaseJump];
        if (!el) return;
        if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setPendingPhaseJump(null);
    }, [pendingPhaseJump, debateTurns, transcriptOpen]);

    if (!debateTurns.length && !isDebating) {
        // Completed debate with no parsed transcript (e.g. an accuracy-mode
        // stream that yielded zero turns): keep the verdict consensus visible
        // instead of silently dropping the whole card.
        if (!analysis) return null;
        return (
            <div className="mt-4 ui-panel">
                <DebateSummary debateTurns={[]} analysis={analysis} />
                <div className="px-3 py-4 text-center text-[11px] text-zinc-600">
                    The debate transcript is unavailable for this analysis.
                </div>
            </div>
        );
    }

    // Replay slices the transcript once (P7: the old code re-sliced inside the
    // per-turn map — O(n²) array copies on every replay tick).
    const displayedTurns = useMemo(() => {
        const base = isReplaying ? visibleTurns.slice(0, replayIndex) : [...visibleTurns];
        if (!isDebating || isReplaying) return base;
        const extra: DebateTurn[] = [];
        const liveModeratorReasoning = getReasoning('Moderator').trim();
        const hasModeratorReasoningTurn = base.some(turn =>
            turn.speaker === 'Moderator' && (Boolean(turn.reasoning?.trim()) || Boolean(turn.text.trim()))
        );
        // Accuracy/autoplay can receive moderator reasoning before its
        // transcript parser sees the first public speaker line. Add a
        // temporary thinking-only row so the main transcript matches the
        // Floor and seat modal during that gap.
        if (liveModeratorReasoning && !hasModeratorReasoningTurn) {
            extra.push({
                speaker: 'Moderator',
                round: Math.max(1, latestModeratorRound),
                text: '',
                reasoning: liveModeratorReasoning,
                createdAt: new Date().toISOString(),
            });
        }
        for (const [speaker, round] of Object.entries(activeDebateSpeakers)) {
            const exists = base.some(turn => turn.speaker === speaker && turn.round === round);
            if (!exists) {
                extra.push({
                    speaker: speaker as DebateTurn['speaker'],
                    round,
                    text: '',
                    createdAt: new Date().toISOString(),
                });
            }
        }
        if (extra.length === 0) return base;
        return [...base, ...extra].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    }, [visibleTurns, isReplaying, replayIndex, isDebating, activeDebateSpeakers, latestModeratorRound, reasoningProcesses.moderator, reasoningProcesses.Moderator]);
    const isComplete = Boolean(analysis && !isDebating && debateTurns.length > 0);

    useEffect(() => {
        if (isComplete) setBriefingTab(prev => (prev === 'All' ? 'Openings' : prev));
        else if (isDebating) setBriefingTab('All');
    }, [isComplete, isDebating]);

    const filteredTurns = useMemo(() => {
        if (briefingTab === 'All' || isReplaying) return displayedTurns;
        return displayedTurns.filter(turn => {
            if (typeof turn.round !== 'number') return briefingTab === 'Openings';
            const isVerdictRound = turn.speaker === 'Moderator' && turn.round === latestModeratorRound;
            return getPhaseHeading(turn.round, isVerdictRound) === briefingTab;
        });
    }, [displayedTurns, briefingTab, isReplaying, latestModeratorRound]);

    const startReplay = () => {
        setShowTranscript(true);
        setIsReplaying(true);
        setReplayIndex(0);
        setIsExportOpen(false);
    };

    return (
        <div className="mt-4 ui-panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-zinc-900/80 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                    {([...PHASES, 'All'] as const).map((phase, index) => (
                        <React.Fragment key={phase}>
                            {index > 0 && <span className="text-zinc-700">·</span>}
                            <button
                                type="button"
                                onClick={() => jumpToPhase(phase)}
                                disabled={phase !== 'All' && !reachedPhases.has(phase)}
                                className={`rounded px-1 py-0.5 transition-colors ${
                                    phase === briefingTab
                                        ? 'font-medium text-zinc-200'
                                        : phase === 'All' || reachedPhases.has(phase)
                                            ? 'text-zinc-500 hover:text-zinc-200'
                                            : 'cursor-default text-zinc-700'
                                }`}
                            >
                                {phase}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
                {isComplete && (
                    <button
                        type="button"
                        onClick={() => setShowTranscript(open => !open)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        aria-expanded={transcriptOpen}
                    >
                        {transcriptOpen ? 'Hide debate' : `Show debate (${debateTurns.length} turns)`}
                        <ChevronDownIcon className={`h-3 w-3 transition-transform ${transcriptOpen ? 'rotate-180' : ''}`} />
                    </button>
                )}
                {debateTurns.length > 0 && (
                    <span className="relative" ref={exportMenuRef}>
                        <button
                            type="button"
                            onClick={() => setIsExportOpen(o => !o)}
                            aria-expanded={isExportOpen}
                            aria-label="Debate actions"
                            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        >
                            <KebabMenuIcon className="h-4 w-4" />
                        </button>
                        {isExportOpen && (
                            <span className="absolute right-0 top-full z-10 mt-1 flex min-w-[9rem] flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl">
                                <button type="button" onClick={() => { copyTranscript(); setIsExportOpen(false); }} className="px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800">
                                    Copy
                                </button>
                                <button type="button" onClick={() => exportTranscript('md')} className="px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800">
                                    Markdown
                                </button>
                                <button type="button" onClick={() => exportTranscript('json')} className="px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800">
                                    JSON
                                </button>
                                {isComplete && (
                                    <button type="button" onClick={startReplay} className="px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800">
                                        Replay
                                    </button>
                                )}
                                {onForkDebate && messageId && !isDebating && availableRounds.map(round => (
                                    <button
                                        key={`fork-${round}`}
                                        type="button"
                                        onClick={() => { onForkDebate(messageId, round); setIsExportOpen(false); }}
                                        className="px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800"
                                    >
                                        Fork round {round}
                                    </button>
                                ))}
                            </span>
                        )}
                    </span>
                )}
            </div>

            {isReplaying && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
                    <button type="button" onClick={() => setIsReplaying(p => !p)} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300">
                        {replayIndex >= debateTurns.length ? 'Restart' : 'Pause'}
                    </button>
                    <button type="button" onClick={() => setReplayIndex(i => Math.min(debateTurns.length, i + 1))} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400">Step</button>
                    <span className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
                        {[0.5, 1, 2].map(speed => (
                            <button
                                key={speed}
                                type="button"
                                onClick={() => setReplaySpeed(speed)}
                                className={`rounded px-1.5 py-0.5 text-[11px] ${replaySpeed === speed ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {speed}x
                            </button>
                        ))}
                    </span>
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
                                        className={`rounded px-1.5 py-0.5 text-[11px] ${currentRound === round ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        title={`Jump to round ${round}`}
                                    >
                                        R{round}
                                    </button>
                                );
                            })}
                        </span>
                    )}
                    <button type="button" onClick={() => setIsReplaying(false)} className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300">Exit</button>
                </div>
            )}

            {replacementOffer && onReplacementChoice && messageId && (
                <div className="status-surface border-b border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="text-[11px] font-medium text-amber-300">
                            {replacementOffer.droppedName} dropped out (round {replacementOffer.round})
                        </span>
                        <span className="text-[11px] text-zinc-400">Pick a replacement analyst to continue:</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {replacementOffer.candidates.map(candidate => {
                            const chosen = replacementOffer.chosenProviderId === candidate.providerId;
                            const disabled = Boolean(replacementOffer.chosenProviderId);
                            return (
                                <button
                                    key={candidate.providerId}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onReplacementChoice(messageId, candidate.providerId)}
                                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                        chosen
                                            ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
                                            : disabled
                                                ? 'border-white/5 bg-zinc-800/40 text-zinc-600'
                                                : 'border-white/10 bg-zinc-800 text-zinc-200 hover:border-amber-400/40 hover:text-amber-200'
                                    }`}
                                >
                                    {chosen ? 'Analyzing…' : `${candidate.displayName} · ${candidate.modelId}`}
                                </button>
                            );
                        })}
                        {!replacementOffer.chosenProviderId && (
                            <button
                                type="button"
                                onClick={() => onReplacementChoice(messageId, null)}
                                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200"
                            >
                                Continue without
                            </button>
                        )}
                    </div>
                </div>
            )}

            {transcriptOpen && (
            <div
                ref={scrollRef}
                onScroll={() => {
                    const el = scrollRef.current;
                    if (!el) return;
                    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
                    userScrolledUpRef.current = away;
                    setIsScrolledUp(away);
                }}
                onWheel={(event) => lockIfScrollingUp(event.deltaY)}
                onTouchStart={(event) => { touchYRef.current = event.touches[0]?.clientY ?? null; }}
                onTouchMove={(event) => {
                    const currentY = event.touches[0]?.clientY;
                    if (touchYRef.current == null || currentY == null) return;
                    lockIfScrollingUp(touchYRef.current - currentY);
                    touchYRef.current = currentY;
                }}
                className="relative max-h-[360px] overflow-y-auto px-4 py-3 custom-scrollbar"
            >
                {filteredTurns.map((turn, index) => {
                    if (turn.speaker === 'System') {
                        return (
                            <div key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`} className="py-2 text-center text-[11px] italic leading-relaxed text-zinc-600">
                                {turn.text}
                            </div>
                        );
                    }
                    const previous = filteredTurns[index - 1];
                    const isVerdictRound = turn.speaker === 'Moderator' && turn.round === latestModeratorRound;
                    const isVerdict = isVerdictRound && !isDebating;
                    const phase = typeof turn.round === 'number' ? getPhaseHeading(turn.round, isVerdictRound) : '';
                    const previousPhase = previous && typeof previous.round === 'number'
                        ? getPhaseHeading(previous.round, previous.speaker === 'Moderator' && previous.round === latestModeratorRound)
                        : '';
                    const showPhase = Boolean(phase) && phase !== previousPhase;
                    const priorFromSpeaker = filteredTurns.slice(0, index).some(item => item.speaker === turn.speaker);
                    const storedReasoning = (turn.reasoning || (!priorFromSpeaker ? getReasoning(turn.speaker) : '') || '').trim();
                    const isThisTurnStreaming = isDebating && (
                        activeDebateSpeakers[turn.speaker] === turn.round
                        || (turn.speaker === 'Moderator' && !turn.text.trim() && Boolean(storedReasoning))
                    );
                    return (
                        <DebateTurnRow
                            key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`}
                            turn={turn}
                            showPhase={showPhase}
                            phase={phase}
                            firstRow={index === 0}
                            displayName={getDisplayName(turn.speaker)}
                            modelName={getModelName(turn.speaker)}
                            analystNames={analystNames}
                            modelNames={modelNames}
                            isVerdict={isVerdict}
                            streaming={isThisTurnStreaming}
                            storedReasoning={storedReasoning}
                            onPhaseAnchor={el => { phaseAnchorRefs.current[phase as (typeof PHASES)[number]] = el; }}
                        />
                    );
                })}

                {isScrolledUp && (
                    <div className="sticky bottom-2 z-10 flex justify-center">
                        <button
                            type="button"
                            onClick={jumpToLatest}
                            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-800/95 px-3 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-zinc-700"
                        >
                            Latest
                        </button>
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

export default React.memo(DebateChat);

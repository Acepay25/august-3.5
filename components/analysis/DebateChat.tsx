import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn, AnalystLensConfig } from '../../types';
import { BotIcon, ChevronDownIcon } from '../shared/Icons';
import { getRoleDisplayForProvider } from '../../services/ui/AnalystLensService';

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

const getRoundLabel = (round: number, isVerdictRound = false): string => {
    if (isVerdictRound) return `Round ${round} · Final Verdict`;
    if (round === 1) return 'Round 1 · Openings';
    if (round === 2 || round === 3) return `Round ${round} · Rebuttals`;
    return `Round ${round} · Clarification`;
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
}) => {
    const [isThinkingOpen, setIsThinkingOpen] = useState(false);
    const [expandedSpeaker, setExpandedSpeaker] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const visibleTurns = useMemo(() => debateTurns.filter(turn => activeDebateSpeakers[turn.speaker] !== turn.round), [debateTurns, activeDebateSpeakers]);
    // Computed from ALL turns (not just visible ones) so a completed
    // clarification-question round is never mistaken for the verdict while
    // the verdict round is still streaming.
    const latestModeratorRound = useMemo(() => Math.max(0, ...debateTurns.filter(turn => turn.speaker === 'Moderator').map(turn => turn.round ?? 0)), [debateTurns]);
    const activeSpeakers = useMemo(() => Object.entries(activeDebateSpeakers), [activeDebateSpeakers]);

    useEffect(() => {
        const element = scrollRef.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, [visibleTurns, activeDebateSpeakers, isThinkingOpen, expandedSpeaker]);

    const getProviderId = (speaker: string): string | undefined => providerNameToId[speaker];
    const getModelKey = (speaker: string): string | undefined => {
        const providerId = getProviderId(speaker);
        if (!providerId) return undefined;
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
        const providerId = getProviderId(speaker);
        return reasoningProcesses[speaker] || thoughtProcesses[speaker] || (providerId ? reasoningProcesses[providerId] || thoughtProcesses[providerId] : '') || '';
    };

    if (!debateTurns.length && !isDebating) return null;

    return (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
            <div ref={scrollRef} className="max-h-[520px] space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar">
                {visibleTurns.map((turn, index) => {
                    const previousRound = visibleTurns[index - 1]?.round;
                    const hasRoundSeparator = typeof turn.round === 'number' && turn.round !== previousRound;
                    const isVerdictRound = turn.speaker === 'Moderator' && turn.round === latestModeratorRound;
                    const isVerdict = isVerdictRound && !isDebating;
                    const displayName = getDisplayName(turn.speaker);
                    const modelName = getModelName(turn.speaker);
                    return (
                        <React.Fragment key={`${turn.speaker}-${turn.round ?? 'legacy'}-${index}`}>
                            {hasRoundSeparator && (
                                <div className="flex items-center gap-2 py-1 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
                                    <span className="h-px flex-1 bg-white/5" />
                                    <span>{getRoundLabel(turn.round!, isVerdictRound)}</span>
                                    <span className="h-px flex-1 bg-white/5" />
                                </div>
                            )}
                            <div className={`flex items-start gap-2.5 ${turn.speaker === 'Moderator' ? 'justify-end' : ''}`}>
                                {turn.speaker !== 'Moderator' && <SpeakerAvatar speaker={turn.speaker} />}
                                <div className={`min-w-0 max-w-[92%] rounded-2xl border px-3.5 py-3 ${isVerdict ? 'border-cyan-400/25 bg-cyan-500/10' : 'border-white/5 bg-zinc-800/60'}`}>
                                    <div className="mb-1.5 flex items-center gap-2">
                                        {turn.speaker === 'Moderator' && <SpeakerAvatar speaker="Moderator" moderator small />}
                                        <div className="min-w-0">
                                            <div className={`text-xs font-semibold ${isVerdict ? 'text-cyan-300' : 'text-zinc-200'}`}>{displayName}</div>
                                            {modelName && <div className="truncate text-[10px] text-zinc-600">{modelName}</div>}
                                        </div>
                                        {isVerdict && <span className="ml-auto rounded border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-cyan-300">DECISION</span>}
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{cleanSpeakerPrefix(turn.text, turn.speaker)}</div>
                                </div>
                                {turn.speaker === 'Moderator' && <SpeakerAvatar speaker="Moderator" moderator />}
                            </div>
                        </React.Fragment>
                    );
                })}

                {isDebating && activeSpeakers.length > 0 && (
                    <div className="relative flex items-end gap-2 pt-2">
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
                                                <span className="text-[9px] text-zinc-600">R{round}</span>
                                            </button>
                                            {selected && <div className="mt-2 max-h-32 overflow-y-auto border-t border-white/5 pt-2 text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap">{reasoning || 'Reasoning is not available yet.'}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(DebateChat);

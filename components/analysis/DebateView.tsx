
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DebateTurn, AnalystLensConfig, AnalystRole } from '../../types';
import { BotIcon, ChevronDownIcon } from '../shared/Icons';
import { ANALYST_ROLE_DEFINITIONS, getRoleForProvider } from '../../services/ui/AnalystLensService';

interface DebateViewProps {
    debateTurns: DebateTurn[];
    /** provider id → model id, from the message that produced this debate. */
    modelsUsed?: Record<string, string>;
    reasoningProcesses?: Record<string, string>;
    thoughtProcesses?: Record<string, string>;
    /** model id → display label (built dynamically from provider configs). */
    modelIdToName?: Record<string, string>;
    /** provider display name → provider id (speaker names map to config ids). */
    providerNameToId?: Record<string, string>;

    lensConfig?: AnalystLensConfig;  // Optional lens configuration
    isDebating?: boolean;  // Whether the debate is still live (gates the "Syncing Protocol..." indicator)
}

// Neutral avatar — no provider brand hints; initials derive from the
// speaker name so user-configured providers render fine.
const SpeakerAvatar: React.FC<{ speaker: DebateTurn['speaker'], modelName?: string }> = ({ speaker, modelName }) => {
    if (speaker === 'Moderator') {
        return (
            <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center shadow-lg border border-cyan-400/30 z-10" title="Master Strategist">
                <BotIcon />
            </div>
        );
    }

    const bgColor = 'bg-zinc-600';
    const borderColor = 'border-zinc-500';
    const initials = speaker.trim().charAt(0).toUpperCase() || '?';

    return (
        <div className={`flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full ${bgColor} flex items-center justify-center font-bold text-white text-[10px] sm:text-xs border ${borderColor} shadow-md`} title={`${speaker}${modelName ? ` (${modelName})` : ''}`}>
            {initials}
        </div>
    );
};

const RoundHeader: React.FC<{ title: string, isOpen: boolean, onToggle: () => void }> = ({ title, isOpen, onToggle }) => (
    <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border-y border-white/5 transition-colors group sticky top-0 z-10"
    >
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300">{title}</span>
        <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 text-zinc-600 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
    </button>
);

const DebateView: React.FC<DebateViewProps> = ({ debateTurns, modelsUsed, reasoningProcesses = {}, thoughtProcesses = {}, modelIdToName, providerNameToId, lensConfig, isDebating }) => {
    const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
    const lastRoundCountRef = useRef(0);

    // Helper to get role emoji for a speaker
    const getRoleEmoji = (speaker: string): string | null => {
        if (!lensConfig?.enabled) return null;

        // Map the speaker display name to its provider id (dynamic configs)
        const provider = providerNameToId?.[speaker];
        if (!provider) return null;

        const role = getRoleForProvider(provider, lensConfig.assignments);
        if (role === AnalystRole.UNASSIGNED) return null;

        return ANALYST_ROLE_DEFINITIONS[role].emoji;
    };

    // Group turns into rounds logic - Memoized to prevent re-calculation on every render
    const rounds = useMemo(() => {
        if (!debateTurns || debateTurns.length === 0) return [];

        const newRounds: { moderator?: DebateTurn, analysts: DebateTurn[] }[] = [];
        let currentRound: { moderator?: DebateTurn, analysts: DebateTurn[] } | null = null;

        debateTurns.forEach((turn) => {
            if (turn.speaker === 'Moderator') {
                if (currentRound) {
                    newRounds.push(currentRound);
                }
                currentRound = { moderator: turn, analysts: [] };
            } else {
                if (!currentRound) {
                    currentRound = { analysts: [] };
                }
                currentRound.analysts.push(turn);
            }
        });

        if (currentRound) {
            newRounds.push(currentRound);
        }

        return newRounds;
    }, [debateTurns]);

    // Effect to auto-expand new rounds only when the count increases
    useEffect(() => {
        // Reset ref if rounds decreased (e.g., conversation reset)
        if (rounds.length < lastRoundCountRef.current) {
            lastRoundCountRef.current = 0;
        }

        if (rounds.length > lastRoundCountRef.current) {
            // A new round has been added
            setExpandedRounds(prev => ({ ...prev, [rounds.length - 1]: true }));
            lastRoundCountRef.current = rounds.length;
        } else if (rounds.length === 1 && lastRoundCountRef.current === 0) {
            // Initial load
            setExpandedRounds({ 0: true });
            lastRoundCountRef.current = 1;
        }
    }, [rounds.length]);

    const toggleRound = (index: number) => {
        setExpandedRounds(prev => ({ ...prev, [index]: !prev[index] }));
    };

    const getSpeakerModelName = (speaker: string): string => {
        const providerId = providerNameToId?.[speaker];
        if (!providerId) return '';
        const modelId = modelsUsed?.[providerId];
        if (!modelId) return '';
        return modelIdToName?.[modelId] ?? modelId;
    };

    const getSpeakerThinking = (speaker: string): string => {
        if (speaker === 'Moderator') return reasoningProcesses.moderator || thoughtProcesses.moderator || '';
        return reasoningProcesses[speaker] || thoughtProcesses[speaker] || '';
    };

    return (
        <div className="mt-4 bg-zinc-950 rounded-xl border border-white/10 overflow-hidden shadow-inner flex flex-col">
            <div className="bg-gradient-to-r from-zinc-900 to-black px-3 py-2 sm:px-4 sm:py-3 border-b border-white/10 flex justify-between items-center">
                <h3 className="text-xs sm:text-sm font-bold text-cyan-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                    Ensemble Consensus
                </h3>
                <span className="text-[10px] font-mono text-zinc-500">{rounds.length} Round{rounds.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="max-h-[450px] overflow-y-auto custom-scrollbar">
                {rounds.map((round, roundIndex) => {
                    const isFinalRound = roundIndex === rounds.length - 1;
                    const isVerdict = round.moderator?.text?.toLowerCase().includes('verdict') || false;
                    const roundTitle = isVerdict ? 'Final Verdict' : `Round ${roundIndex + 1}`;

                    return (
                        <div key={`round-${roundIndex}`} className="animate-fade-in">
                            {/* Round Header / Collapsible Toggle */}
                            {roundIndex > 0 && <RoundHeader title={roundTitle} isOpen={!!expandedRounds[roundIndex]} onToggle={() => toggleRound(roundIndex)} />}

                            <div className={`${expandedRounds[roundIndex] || roundIndex === 0 ? 'block' : 'hidden'}`}>
                                <div className="p-3 sm:p-4 space-y-4 sm:space-y-6">
                                    {/* Moderator Message */}
                                    {round.moderator && (
                                        <div className={`relative ${isVerdict ? 'bg-gradient-to-b from-cyan-950/40 to-zinc-900/40 border-cyan-500/30' : 'bg-zinc-800 border-white/5'} border rounded-xl sm:rounded-2xl p-3 sm:p-4 ml-6 sm:ml-8`}>
                                            <div className="absolute -left-9 sm:-left-12 top-0">
                                                <SpeakerAvatar speaker="Moderator" />
                                            </div>
                                            <div className="mb-2 flex items-baseline justify-between">
                                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-cyan-400">Master Strategist</span>
                                                {isVerdict && <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/20">DECISION</span>}
                                            </div>
                                            {isDebating || getSpeakerThinking('Moderator') ? (
                                                <details className="mb-3 rounded-lg border border-cyan-500/15 bg-black/20">
                                                    <summary className="cursor-pointer list-none px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300/70">Moderator is thinking <span className="normal-case tracking-normal text-zinc-600">(expand)</span></summary>
                                                    <div className="border-t border-white/5 px-2.5 py-2 text-xs leading-relaxed text-zinc-400 whitespace-pre-wrap">{getSpeakerThinking('Moderator') || 'Waiting for moderator reasoning content…'}</div>
                                                </details>
                                            ) : null}
                                            <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{round.moderator.text}</p>
                                        </div>
                                    )}

                                    {/* Analyst Responses (Grid Layout) */}
                                    {round.analysts.length > 0 && (
                                        <div className="grid grid-cols-1 gap-3 pl-3 border-l border-white/5 ml-3 py-1">
                                            {round.analysts.map((turn, tIndex) => (
                                                <div key={`turn-${roundIndex}-${tIndex}`} className="flex items-start gap-2 sm:gap-3 opacity-0 animate-fade-in" style={{ animationDelay: `${tIndex * 50}ms`, animationFillMode: 'forwards' }}>
                                                    <SpeakerAvatar speaker={turn.speaker} modelName={getSpeakerModelName(turn.speaker)} />
                                                    <div className={`flex-1 p-2.5 sm:p-3 rounded-lg sm:rounded-xl rounded-tl-none border text-xs sm:text-sm leading-relaxed shadow-sm relative group
                                                        ${turn.speaker === 'Gemini' ? 'bg-blue-950/20 border-blue-500/20 text-blue-100/90' :
                                                            turn.speaker.includes('DeepSeek') ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-100/90' :
                                                                turn.speaker === 'Zhipu' ? 'bg-orange-950/20 border-orange-500/20 text-orange-100/90' :
                                                                    turn.speaker === 'Groq' ? 'bg-yellow-950/20 border-yellow-500/20 text-yellow-100/90' :
                                                                        turn.speaker === 'Groq (Alt)' ? 'bg-lime-950/20 border-lime-500/20 text-lime-100/90' :
                                                                            turn.speaker === 'Groq (Alt 2)' ? 'bg-rose-950/20 border-rose-500/20 text-rose-100/90' :
                                                                                turn.speaker === 'OpenRouter' ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-100/90' :
                                                                                    (turn.speaker.includes('Claude') || turn.speaker.includes('Anthropic')) ? 'bg-purple-950/20 border-purple-500/20 text-purple-100/90' :
                                                                                        (turn.speaker.includes('GPT') || turn.speaker.includes('OpenAI')) ? 'bg-violet-950/20 border-violet-500/20 text-violet-100/90' :
                                                                                            (turn.speaker.includes('Grok') || turn.speaker.includes('xAI')) ? 'bg-zinc-800 border-white/10 text-zinc-300' :
                                                                                                'bg-zinc-800 border-white/5 text-zinc-300'}`}>
                                                        <div className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] uppercase font-bold tracking-widest text-white/30 flex items-center gap-1">
                                                            {getRoleEmoji(turn.speaker) && <span className="text-[10px]">{getRoleEmoji(turn.speaker)}</span>}
                                                    {turn.speaker}
                                                        </div>
                                                        <details className="mb-2 rounded border border-white/10 bg-black/15">
                                                            <summary className="cursor-pointer list-none px-2 py-1.5 text-[10px] uppercase tracking-wider text-zinc-400">{turn.speaker} is thinking <span className="normal-case tracking-normal text-zinc-600">(expand)</span></summary>
                                                            <div className="border-t border-white/5 px-2 py-2 text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap">{getSpeakerThinking(turn.speaker) || 'This analyst did not return separate reasoning content.'}</div>
                                                        </details>
                                                        {turn.text}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Live Thinking Indicator — only shown while debate is actively streaming */}
                {rounds.length > 0 && isDebating && (
                    <div className="px-4 py-3 flex items-center gap-2 opacity-40">
                        <div className="flex space-x-1">
                            <div className="w-1 h-1 bg-cyan-500 rounded-full animate-bounce delay-0"></div>
                            <div className="w-1 h-1 bg-cyan-500 rounded-full animate-bounce delay-150"></div>
                            <div className="w-1 h-1 bg-cyan-500 rounded-full animate-bounce delay-300"></div>
                        </div>
                        <span className="text-[10px] font-mono text-cyan-500/70 uppercase tracking-widest">Syncing Protocol...</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(DebateView);

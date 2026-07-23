
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DebateTurn, AnalystLensConfig, AnalystRole, AIProvider } from '../types';
import { BotIcon, ChevronDownIcon } from './Icons';
import { ANALYST_ROLE_DEFINITIONS, getRoleForProvider } from '../services/AnalystLensService';

interface DebateViewProps {
    debateTurns: DebateTurn[];
    geminiModelName: string;
    deepseekModelName: string;
    zhipuModelName: string;
    groqModelName?: string;
    groqNewModelName?: string;
    groqAlt2ModelName?: string;
    openrouterModelName?: string;

    lensConfig?: AnalystLensConfig;  // Optional lens configuration
    isDebating?: boolean;  // Whether the debate is still live (gates the "Syncing Protocol..." indicator)
}

// Map speaker names to AIProvider enum for role lookup
const speakerToProvider: Record<string, AIProvider> = {
    'Gemini': AIProvider.GEMINI,
    'DeepSeek': AIProvider.DEEPSEEK,
    'Zhipu': AIProvider.ZHIPU,
    'Groq': AIProvider.GROQ,
    'Groq (Alt)': AIProvider.GROQ_NEW,
    'Groq (Alt 2)': AIProvider.GROQ_ALT2,
    'OpenRouter': AIProvider.OPENROUTER,
    'OpenAI': AIProvider.OPENAI,
    'Grok': AIProvider.GROK,
};

const SpeakerAvatar: React.FC<{ speaker: DebateTurn['speaker'], modelName?: string }> = ({ speaker, modelName }) => {
    let bgColor = 'bg-zinc-600';
    let initials = '?';
    let borderColor = 'border-zinc-500';

    if (speaker === 'Gemini') {
        bgColor = 'bg-blue-600';
        borderColor = 'border-blue-400';
        initials = 'G';
    } else if (speaker.includes('DeepSeek')) {
        bgColor = 'bg-emerald-600';
        borderColor = 'border-emerald-400';
        initials = 'D';
    } else if (speaker === 'Zhipu') {
        bgColor = 'bg-orange-600';
        borderColor = 'border-orange-400';
        initials = 'Z';
    } else if (speaker === 'Groq') {
        bgColor = 'bg-yellow-600';
        borderColor = 'border-yellow-400';
        initials = 'G';
    } else if (speaker === 'Groq (Alt)') {
        bgColor = 'bg-lime-600';
        borderColor = 'border-lime-400';
        initials = 'GA';
    } else if (speaker === 'Groq (Alt 2)') {
        bgColor = 'bg-rose-600';
        borderColor = 'border-rose-400';
        initials = 'G2';
    } else if (speaker === 'OpenRouter') {
        bgColor = 'bg-green-600';
        borderColor = 'border-green-400';
        initials = 'OR';
    } else if (speaker.includes('Claude') || speaker.includes('Anthropic')) {
        bgColor = 'bg-purple-600';
        borderColor = 'border-purple-400';
        initials = 'C';
    } else if (speaker.includes('GPT') || speaker.includes('OpenAI')) {
        bgColor = 'bg-violet-600';
        borderColor = 'border-violet-400';
        initials = 'O';
    } else if (speaker.includes('Grok') || speaker.includes('xAI')) {
        bgColor = 'bg-zinc-600'; // Or specific Grok color
        borderColor = 'border-white/40';
        initials = 'X';
    } else if (speaker === 'Moderator') {
        return (
            <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center shadow-lg border border-cyan-400/30 z-10" title="Master Strategist">
                <BotIcon />
            </div>
        )
    }

    return (
        <div className={`flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full ${bgColor} flex items-center justify-center font-bold text-white text-[10px] sm:text-xs border ${borderColor} shadow-md`} title={`${speaker} (${modelName})`}>
            {initials}
        </div>
    );
};

const RoundHeader: React.FC<{ title: string, isOpen: boolean, onToggle: () => void }> = ({ title, isOpen, onToggle }) => (
    <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 border-y border-white/5 transition-colors group sticky top-0 z-10 backdrop-blur-sm"
    >
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300">{title}</span>
        <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 text-zinc-600 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
    </button>
);

const DebateView: React.FC<DebateViewProps> = ({ debateTurns, geminiModelName, deepseekModelName, zhipuModelName, groqModelName, groqNewModelName, groqAlt2ModelName, openrouterModelName, lensConfig, isDebating }) => {
    const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
    const lastRoundCountRef = useRef(0);

    // Helper to get role emoji for a speaker
    const getRoleEmoji = (speaker: string): string | null => {
        if (!lensConfig?.enabled) return null;

        // Find provider for this speaker
        const provider = speakerToProvider[speaker] ||
            (speaker.includes('DeepSeek') ? AIProvider.DEEPSEEK :
                speaker.includes('Grok') ? AIProvider.GROK : null);

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

    const getSpeakerModelName = (speaker: string) => {
        if (speaker === 'Gemini') return geminiModelName;
        if (speaker.includes('DeepSeek')) return deepseekModelName || '';
        if (speaker === 'Zhipu') return zhipuModelName;
        if (speaker === 'Groq') return groqModelName;
        if (speaker === 'Groq (Alt)') return groqNewModelName;
        if (speaker === 'Groq (Alt 2)') return groqAlt2ModelName;
        if (speaker === 'OpenRouter') return openrouterModelName;

        return '';
    };

    return (
        <div className="mt-4 bg-zinc-950/50 rounded-xl border border-white/10 overflow-hidden shadow-inner flex flex-col">
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
                                        <div className={`relative ${isVerdict ? 'bg-gradient-to-b from-cyan-950/40 to-zinc-900/40 border-cyan-500/30' : 'bg-zinc-900/50 border-white/5'} border rounded-xl sm:rounded-2xl p-3 sm:p-4 ml-6 sm:ml-8`}>
                                            <div className="absolute -left-9 sm:-left-12 top-0">
                                                <SpeakerAvatar speaker="Moderator" />
                                            </div>
                                            <div className="mb-2 flex items-baseline justify-between">
                                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-cyan-400">Master Strategist</span>
                                                {isVerdict && <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/20">DECISION</span>}
                                            </div>
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
                                                                                turn.speaker === 'OpenRouter' ? 'bg-green-950/20 border-green-500/20 text-green-100/90' :
                                                                                    (turn.speaker.includes('Claude') || turn.speaker.includes('Anthropic')) ? 'bg-purple-950/20 border-purple-500/20 text-purple-100/90' :
                                                                                        (turn.speaker.includes('GPT') || turn.speaker.includes('OpenAI')) ? 'bg-violet-950/20 border-violet-500/20 text-violet-100/90' :
                                                                                            (turn.speaker.includes('Grok') || turn.speaker.includes('xAI')) ? 'bg-zinc-900/50 border-white/10 text-zinc-300' :
                                                                                                'bg-zinc-800/50 border-white/5 text-zinc-300'}`}>
                                                        <div className="absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] uppercase font-bold tracking-widest text-white/30 flex items-center gap-1">
                                                            {getRoleEmoji(turn.speaker) && <span className="text-[10px]">{getRoleEmoji(turn.speaker)}</span>}
                                                            {turn.speaker}
                                                        </div>
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

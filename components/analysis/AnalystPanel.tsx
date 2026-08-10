import React, { useState, useMemo, useCallback } from 'react';
import { Message, DebateSpeaker, EnsembleProgress, DebateTurn } from '../../types';
import { TradeAnalysis, AnalystConsensusEntry } from '../../types/analysis';
import { getRoleDisplayForProvider } from '../../services/ui/AnalystLensService';
import { CloseIcon, ChevronDownIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import { AnalystLensConfig } from '../../types';

interface AnalystPanelProps {
    message: Message;
    activeTab: string;
    modelIdToName: Record<string, string>;
    providerNameToId: Record<string, string>;
    lensConfig: AnalystLensConfig | null;
    onClose: () => void;
    onSelectTab: (tab: string) => void;
}

const ACCENT_COLORS = ['#8aabd8', '#34d399', '#fb7185'];

const speakerColor = (speaker: DebateSpeaker): string => {
    switch (speaker) {
        case 'Analyst 1': return ACCENT_COLORS[0];
        case 'Analyst 2': return ACCENT_COLORS[1];
        case 'Analyst 3': return ACCENT_COLORS[2];
        default: return '#a1a1aa'; // moderator
    }
};

/**
 * Right-side slide-in panel showing per-analyst detail (tabs) and debate
 * section. Follows the same positioning pattern as AdvancedAnalyticsSidePanel.
 */
const AnalystPanel: React.FC<AnalystPanelProps> = ({
    message,
    activeTab,
    modelIdToName,
    lensConfig,
    onClose,
    onSelectTab,
}) => {
    const [debateExpanded, setDebateExpanded] = useState(true);
    const analysis = message.analysis;

    // Build analyst data from message fields
    const analysts = useMemo(() => {
        const map = new Map<string, { providerId: string; displayName: string; modelName: string; emoji?: string; roleColor?: string; reasoning: string; finalOutput: string; consensus?: AnalystConsensusEntry }>();

        // From thoughtProcesses / reasoningProcesses
        const thinkingEntries = Object.entries({
            ...(message.thoughtProcesses ?? {}),
            ...(message.reasoningProcesses ?? {}),
        }).filter(([, text]) => Boolean(text));

        for (const [key, text] of thinkingEntries) {
            const roleDisplay = lensConfig ? getRoleDisplayForProvider(key, lensConfig.assignments) : null;
            const modelId = message.modelsUsed?.[key];
            const modelName = modelIdToName[modelId ?? ''] ?? modelId ?? '';
            const idx = map.size;
            map.set(key, {
                providerId: key,
                displayName: roleDisplay?.name ?? modelIdToName[key] ?? key,
                modelName,
                emoji: roleDisplay?.emoji,
                roleColor: undefined,
                reasoning: text,
                finalOutput: '',
                consensus: analysis?.analystConsensus?.entries.find(e => e.providerId === key),
            });
        }

        // Supplement from ensembleProgress if available
        const ep = message.ensembleProgress;
        if (ep) {
            for (const ap of ep.analysts) {
                const existing = map.get(ap.providerId);
                if (existing) {
                    if (ap.finalOutput) existing.finalOutput = ap.finalOutput;
                } else if (ap.thoughtProcess || ap.reasoning || ap.finalOutput) {
                    const roleDisplay = lensConfig ? getRoleDisplayForProvider(ap.providerId, lensConfig.assignments) : null;
                    map.set(ap.providerId, {
                        providerId: ap.providerId,
                        displayName: roleDisplay?.name ?? ap.displayName,
                        modelName: ap.modelName,
                        emoji: roleDisplay?.emoji,
                        reasoning: ap.reasoning || ap.thoughtProcess || '',
                        finalOutput: ap.finalOutput || '',
                        consensus: analysis?.analystConsensus?.entries.find(e => e.providerId === ap.providerId),
                    });
                }
            }
        }

        return Array.from(map.values());
    }, [message.thoughtProcesses, message.reasoningProcesses, message.modelsUsed, message.ensembleProgress, modelIdToName, lensConfig, analysis]);

    // Resolve active tab
    const currentTab = useMemo(() => {
        if (analysts.some(a => a.providerId === activeTab)) return activeTab;
        return analysts[0]?.providerId ?? '';
    }, [activeTab, analysts]);

    const currentAnalyst = analysts.find(a => a.providerId === currentTab);
    const debateTurns = message.debateTurns ?? [];

    // Assign accent colors
    const accentMap = useMemo(() => {
        const m = new Map<string, string>();
        analysts.forEach((a, i) => m.set(a.providerId, ACCENT_COLORS[i % ACCENT_COLORS.length]));
        return m;
    }, [analysts]);

    const handleTabClick = useCallback((id: string) => onSelectTab(id), [onSelectTab]);

    return (
        <>
            {/* Mobile backdrop */}
            <div className="fixed inset-0 bg-black/60 z-20 md:hidden" onClick={onClose} />

            <div className="fixed right-0 top-0 h-full w-80 sm:w-[380px] lg:w-[420px] transform transition-transform duration-300 ease-out z-30 flex flex-col border-l border-white/10 bg-zinc-950 shadow-2xl translate-x-0">
                {/* Header */}
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span className="text-xs font-bold text-zinc-200">Analyst Panel</span>
                        <span className="text-[9px] text-zinc-500">({analysts.length} analyst{analysts.length !== 1 ? 's' : ''})</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-white/10 transition-colors text-zinc-500 hover:text-zinc-200"
                        aria-label="Close analyst panel"
                    >
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Analyst tabs */}
                <div className="px-3 py-2 border-b border-white/5 flex gap-1.5 overflow-x-auto shrink-0 custom-scrollbar">
                    {analysts.map(a => (
                        <button
                            key={a.providerId}
                            type="button"
                            onClick={() => handleTabClick(a.providerId)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                                currentTab === a.providerId
                                    ? 'bg-zinc-800 text-zinc-100 border border-white/10'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accentMap.get(a.providerId) }} />
                            {a.displayName.split(' ').pop() ?? a.displayName}
                        </button>
                    ))}
                    {debateTurns.length > 0 && (
                        <button
                            type="button"
                            onClick={() => { setDebateExpanded(e => !e); onSelectTab('__debate__'); }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                                currentTab === '__debate__'
                                    ? 'bg-zinc-800 text-zinc-100 border border-white/10'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent'
                            }`}
                        >
                            Debate ({debateTurns.length})
                        </button>
                    )}
                </div>

                {/* Content area */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
                    {currentTab === '__debate__' ? (
                        /* ── Debate section ── */
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Debate ({debateTurns.length} turns)</p>
                            {debateTurns.map((turn, i) => (
                                <div key={i} className="rounded-xl border border-white/5 bg-zinc-900/60 p-3 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: speakerColor(turn.speaker) }} />
                                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: speakerColor(turn.speaker) }}>
                                            {turn.speaker}{turn.round ? ` · Round ${turn.round}` : ''}
                                        </span>
                                    </div>
                                    <MarkdownContent content={turn.text} className="text-[11px] text-zinc-400 leading-relaxed" />
                                    {turn.reasoning && (
                                        <details className="text-[10px] text-zinc-600">
                                            <summary className="cursor-pointer hover:text-zinc-400 transition-colors">Reasoning</summary>
                                            <MarkdownContent content={turn.reasoning} className="mt-1 text-[10px] text-zinc-600 leading-relaxed" />
                                        </details>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : currentAnalyst ? (
                        /* ── Analyst detail ── */
                        <div className="space-y-4">
                            {/* Analyst header */}
                            <div className="flex items-center gap-3">
                                <span
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black"
                                    style={{ background: `${accentMap.get(currentAnalyst.providerId)}20`, color: accentMap.get(currentAnalyst.providerId) }}
                                >
                                    {currentAnalyst.displayName.charAt(0)}
                                </span>
                                <div>
                                    <p className="text-sm font-bold text-zinc-100">{currentAnalyst.displayName}</p>
                                    <p className="text-[10px] text-zinc-500">{currentAnalyst.modelName || currentAnalyst.providerId}</p>
                                </div>
                            </div>

                            {/* Reasoning */}
                            {currentAnalyst.reasoning && (
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Reasoning</p>
                                    <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                        <MarkdownContent content={currentAnalyst.reasoning} className="text-[11px] text-zinc-400 leading-relaxed" />
                                    </div>
                                </div>
                            )}

                            {/* Final output */}
                            {currentAnalyst.finalOutput && (
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Final Output</p>
                                    <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                        <MarkdownContent content={currentAnalyst.finalOutput} className="text-[11px] text-zinc-300 leading-relaxed" />
                                    </div>
                                </div>
                            )}

                            {/* Structured consensus data */}
                            {currentAnalyst.consensus && (
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Structured Call</p>
                                    <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
                                        <div>
                                            <span className="text-zinc-500">Direction</span>
                                            <p className={`font-bold ${currentAnalyst.consensus.direction === 'Long' ? 'text-emerald-400' : currentAnalyst.consensus.direction === 'Short' ? 'text-rose-400' : 'text-zinc-300'}`}>
                                                {currentAnalyst.consensus.direction || '—'}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-zinc-500">Confidence</span>
                                            <p className="text-zinc-200 font-bold">{currentAnalyst.consensus.confidence || '—'}</p>
                                        </div>
                                        <div>
                                            <span className="text-zinc-500">Entry</span>
                                            <p className="text-zinc-200 font-bold">{currentAnalyst.consensus.entry || '—'}</p>
                                        </div>
                                        <div>
                                            <span className="text-zinc-500">Stop Loss</span>
                                            <p className="text-rose-300/90 font-bold">{currentAnalyst.consensus.stopLoss || '—'}</p>
                                        </div>
                                        <div>
                                            <span className="text-zinc-500">Take Profit</span>
                                            <p className="text-emerald-300/90 font-bold">{currentAnalyst.consensus.takeProfit || '—'}</p>
                                        </div>
                                        {typeof currentAnalyst.consensus.probability === 'number' && (
                                            <div>
                                                <span className="text-zinc-500">Probability</span>
                                                <p className="text-cyan-300 font-bold">{Math.round(currentAnalyst.consensus.probability)}%</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* No data */}
                            {!currentAnalyst.reasoning && !currentAnalyst.finalOutput && !currentAnalyst.consensus && (
                                <p className="text-xs text-zinc-600 italic">No reasoning or output was captured for this analyst.</p>
                            )}
                        </div>
                    ) : (
                        <p className="text-xs text-zinc-600 italic text-center py-10">No analyst data available.</p>
                    )}
                </div>
            </div>
        </>
    );
};

export default React.memo(AnalystPanel);

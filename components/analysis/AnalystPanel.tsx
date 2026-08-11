import React, { useState, useMemo, useCallback } from 'react';
import { Message, DebateSpeaker, EnsembleProgress, DebateTurn } from '../../types';
import { TradeAnalysis, AnalystConsensusEntry } from '../../types/analysis';
import { getRoleDisplayForProvider } from '../../services/ui/AnalystLensService';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
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

const directionArrow = (d?: string): string => (d === 'Long' ? '▲' : d === 'Short' ? '▼' : '—');
const directionTone = (d?: string): string => (d === 'Long' ? 'text-emerald-400' : d === 'Short' ? 'text-rose-400' : 'text-zinc-500');

const speakerColor = (speaker: string): string => {
    const s = String(speaker).toLowerCase();
    if (s.includes('moderator') || s.includes('master strategist')) return '#a1a1aa';
    // Deterministic color from the speaker name so real debates (which emit
    // provider/role names, not "Analyst 1/2/3") keep per-speaker colors.
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return ACCENT_COLORS[hash % ACCENT_COLORS.length];
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

        // Match a consensus entry by its unique thoughtsKey first, then by
        // the config id (entries built before thoughtsKey existed).
        const findConsensus = (key: string): AnalystConsensusEntry | undefined =>
            analysis?.analystConsensus?.entries.find(e => e.thoughtsKey === key || e.providerId === key);

        // From thoughtProcesses / reasoningProcesses (keyed by thoughtsKey
        // — provider::model — after the pipeline key-normalization fix).
        const thinkingEntries = Object.entries({
            ...(message.thoughtProcesses ?? {}),
            ...(message.reasoningProcesses ?? {}),
        }).filter(([, text]) => Boolean(text));

        for (const [key, text] of thinkingEntries) {
            const roleDisplay = lensConfig ? getRoleDisplayForProvider(key, lensConfig.assignments) : null;
            const modelId = message.modelsUsed?.[key];
            const modelName = modelIdToName[modelId ?? ''] ?? modelId ?? '';
            map.set(key, {
                providerId: key,
                displayName: roleDisplay?.name ?? modelIdToName[key] ?? key,
                modelName,
                emoji: roleDisplay?.emoji,
                roleColor: undefined,
                reasoning: text,
                finalOutput: '',
                consensus: findConsensus(key),
            });
        }

        // Supplement from ensembleProgress if available. Progress entries are
        // keyed by config id — normalize to the same thoughtsKey shape
        // (provider::model) so they MERGE with the thinking entries instead
        // of spawning duplicate tabs.
        const ep = message.ensembleProgress;
        if (ep) {
            for (const ap of ep.analysts) {
                const thoughtsKey = ap.providerId && ap.modelId ? `${ap.providerId}::${ap.modelId}` : ap.providerId;
                const existing = map.get(thoughtsKey) ?? (ap.providerId ? map.get(ap.providerId) : undefined);
                if (existing) {
                    if (ap.finalOutput) existing.finalOutput = ap.finalOutput;
                } else if (ap.thoughtProcess || ap.reasoning || ap.finalOutput) {
                    const roleDisplay = lensConfig ? getRoleDisplayForProvider(thoughtsKey, lensConfig.assignments) : null;
                    map.set(thoughtsKey, {
                        providerId: ap.providerId,
                        displayName: roleDisplay?.name ?? ap.displayName,
                        modelName: ap.modelName,
                        emoji: roleDisplay?.emoji,
                        reasoning: ap.reasoning || ap.thoughtProcess || '',
                        finalOutput: ap.finalOutput || '',
                        consensus: findConsensus(thoughtsKey),
                    });
                }
            }
        }

        return Array.from(map.values());
    }, [message.thoughtProcesses, message.reasoningProcesses, message.modelsUsed, message.ensembleProgress, modelIdToName, lensConfig, analysis]);

    // Per-provider win rate from the user's own calibration (this model's
    // actual track record — routing + trust signal).
    const providerWinRates = useMemo(() => {
        const byProvider = GlobalLearningService.getCalibration()?.granular?.byProvider;
        if (!byProvider) return {} as Record<string, { winRate: number; total: number }>;
        const out: Record<string, { winRate: number; total: number }> = {};
        for (const [pid, stats] of Object.entries(byProvider)) {
            if (stats.total >= 3) {
                out[pid] = { winRate: Math.round((stats.wins / stats.total) * 100), total: stats.total };
            }
        }
        return out;
    }, []);

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

            <div className="fixed right-0 top-0 h-full w-80 sm:w-[380px] lg:w-[420px] z-30 flex flex-col border-l border-white/10 bg-zinc-950 shadow-2xl panel-slide-in">
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

                {/* Team verdicts — every analyst's call vs the final verdict,
                    visible on every tab. */}
                {(() => {
                    const entries = analysis?.analystConsensus?.entries ?? [];
                    if (entries.length === 0) return null;
                    const finalDir = analysis?.direction ?? 'Neutral';
                    return (
                        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto shrink-0 custom-scrollbar">
                            {entries.map((e, i) => {
                                const agrees = e.direction === finalDir;
                                const short = (e.displayName || e.thoughtsKey || e.providerId || '?').split(' ').pop();
                                return (
                                    <span key={i} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-white/5 text-[10px] font-mono">
                                        <span className="text-zinc-400 truncate max-w-[80px]">{short}</span>
                                        <span className={directionTone(e.direction)}>{directionArrow(e.direction)}</span>
                                        {typeof e.probability === 'number'
                                            ? <span className="text-zinc-300">{Math.round(e.probability)}%</span>
                                            : e.confidence ? <span className="text-zinc-300">{e.confidence}</span> : null}
                                        <span className={agrees ? 'text-emerald-400' : 'text-rose-400'} title={agrees ? 'Agrees with the final verdict' : 'Dissents from the final verdict'}>
                                            {agrees ? '✓' : '✗'}
                                        </span>
                                    </span>
                                );
                            })}
                        </div>
                    );
                })()}

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
                    <button
                        type="button"
                        onClick={() => onSelectTab('__memory__')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                            currentTab === '__memory__'
                                ? 'bg-zinc-800 text-zinc-100 border border-white/10'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent'
                        }`}
                    >
                        Memory
                    </button>
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
                    {currentTab === '__memory__' ? (
                        /* ── Harness Memory — what the harness has learned ── */
                        (() => {
                            const cal = GlobalLearningService.getCalibration();
                            const levels = (['High', 'Medium', 'Low', 'Avoid'] as const).map(l => ({
                                level: l,
                                stats: cal?.[l.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid'],
                            }));
                            const totalTrades = levels.reduce((s, l) => s + (l.stats?.total ?? 0), 0);
                            const totalWins = levels.reduce((s, l) => s + (l.stats?.wins ?? 0), 0);
                            return (
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Harness Memory — shared by all analysts + moderator</p>
                                        <p className="text-[10px] text-zinc-600 leading-relaxed">
                                            The learning context below (profile, mistakes, rules, insights, recent decisions)
                                            is injected into every analyst prompt and the moderator&apos;s verdict.
                                        </p>
                                    </div>
                                    {totalTrades > 0 && (
                                        <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Overall accuracy</p>
                                            <p className="text-lg font-mono font-black text-zinc-100">
                                                {Math.round((totalWins / totalTrades) * 100)}%<span className="text-xs text-zinc-500 font-normal ml-1.5">win rate · {totalTrades} trades</span>
                                            </p>
                                            <div className="mt-2 space-y-1">
                                                {levels.map(l => l.stats && l.stats.total > 0 ? (
                                                    <div key={l.level} className="flex items-center justify-between text-[10px] font-mono">
                                                        <span className="text-zinc-400">{l.level}</span>
                                                        <span className="text-zinc-300">{Math.round((l.stats.wins / l.stats.total) * 100)}% · n={l.stats.total}</span>
                                                    </div>
                                                ) : null)}
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Per-model track record (this is what routing uses)</p>
                                        <div className="space-y-1.5">
                                            {Object.entries(providerWinRates).map(([pid, stats]) => (
                                                <div key={pid} className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-900/40 px-2.5 py-1.5 text-[10px] font-mono">
                                                    <span className="text-zinc-400 truncate max-w-[60%]">{pid}</span>
                                                    <span className={`font-bold ${stats.winRate >= 55 ? 'text-emerald-300' : stats.winRate >= 40 ? 'text-zinc-300' : 'text-rose-300'}`}>
                                                        {stats.winRate}% · n={stats.total}
                                                    </span>
                                                </div>
                                            ))}
                                            {Object.keys(providerWinRates).length === 0 && (
                                                <p className="text-[10px] text-zinc-600 italic">No per-model stats yet — log a few trades and the harness starts scoring each analyst.</p>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-zinc-600 leading-relaxed">
                                        Every outcome updates this memory (per-analyst credit assignment, thinking corpus,
                                        learning rules, pattern memory). The next run reasons with it.
                                    </p>
                                </div>
                            );
                        })()
                    ) : currentTab === '__debate__' ? (
                        /* ── Debate section ── */
                        <div className="space-y-3">
                            {/* Verdict summary — pinned so the result is visible
                                without scrolling through every turn. */}
                            {analysis && (
                                <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Verdict</p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`font-black text-sm uppercase ${directionTone(analysis.direction)}`}>{analysis.direction ?? 'Neutral'}</span>
                                        {analysis.confidence && <span className="text-xs text-zinc-300">{analysis.confidence}</span>}
                                        {typeof analysis.probability === 'number' && (
                                            <span className="text-[10px] font-mono text-zinc-500">({Math.round(analysis.probability)}%)</span>
                                        )}
                                    </div>
                                    {(() => {
                                        const entries = analysis.analystConsensus?.entries ?? [];
                                        if (entries.length === 0) return null;
                                        const agreeing = entries.filter(e => e.direction === analysis.direction).length;
                                        const div = analysis.analystConsensus?.divergence;
                                        return (
                                            <p className="mt-1.5 text-[10px] text-zinc-500">
                                                <span className={agreeing === entries.length ? 'text-emerald-400' : agreeing >= entries.length / 2 ? 'text-amber-300' : 'text-rose-400'}>
                                                    {agreeing}/{entries.length} analysts agree
                                                </span>
                                                {div && div.score > 0 ? ` · divergence ${div.score}/100 (${div.divergenceType})` : ''}
                                            </p>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Round timeline — who spoke in which round, at a glance.
                                Rounds are labeled: R1 thesis → R2 rebuttal →
                                R3 clarification → verdict (the clarification
                                step has been missing from every debate mockup —
                                it is part of the standard flow). */}
                            {(() => {
                                const rounds = new Map<number, DebateTurn[]>();
                                for (const turn of debateTurns) {
                                    const r = turn.round ?? 1;
                                    rounds.set(r, [...(rounds.get(r) ?? []), turn]);
                                }
                                const roundKeys = [...rounds.keys()];
                                if (roundKeys.length <= 1) return null;
                                const roundLabel = (r: number): string =>
                                    r === 1 ? 'thesis' : r === 2 ? 'rebuttal' : r === 3 ? 'clarification' : `round ${r}`;
                                return (
                                    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Round timeline</p>
                                        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                                            {roundKeys.map((r, i) => (
                                                <React.Fragment key={r}>
                                                    <div className="shrink-0 flex flex-col items-center gap-1 px-1">
                                                        <span className="text-[9px] font-mono text-zinc-500" title={`${roundLabel(r)} round`}>
                                                            R{r} {roundLabel(r)}
                                                        </span>
                                                        <div className="flex gap-0.5">
                                                            {rounds.get(r)!.map((t, j) => (
                                                                <span key={j} className="w-1.5 h-1.5 rounded-full" style={{ background: speakerColor(t.speaker) }} title={t.speaker} />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {i < roundKeys.length - 1 && <span className="text-zinc-700 text-[10px]">→</span>}
                                                </React.Fragment>
                                            ))}
                                            <span className="text-zinc-700 text-[10px]">→</span>
                                            <div className="shrink-0 flex flex-col items-center gap-1 px-1">
                                                <span className="text-[9px] font-mono text-zinc-500">verdict</span>
                                                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

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
                                    <p className="text-[10px] text-zinc-500 flex items-center gap-2">
                                        {currentAnalyst.modelName || currentAnalyst.providerId}
                                        {(() => {
                                            const pid = currentAnalyst.providerId.split('::')[0];
                                            const stats = providerWinRates[pid];
                                            if (!stats) return null;
                                            return (
                                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${stats.winRate >= 55 ? 'bg-emerald-500/10 text-emerald-300' : stats.winRate >= 40 ? 'bg-zinc-800 text-zinc-400' : 'bg-rose-500/10 text-rose-300'}`}
                                                    title={`This model's own track record (${stats.total} trades)`}>
                                                    WR {stats.winRate}% · n={stats.total}
                                                </span>
                                            );
                                        })()}
                                    </p>
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

import React, { useState } from 'react';
import { AutomationRun } from '../../types/automation';
import { ChevronDownIcon, LoadingIcon } from '../shared/Icons';

/**
 * One scheduled run in the automation's card feed — the same shape as a
 * chat analysis card (direction, coin, probability, entry/SL/TP), with the
 * reasoning + debate turns + analysis JSON expandable underneath.
 */
const AutomationRunCard: React.FC<{
    run: AutomationRun;
    modelIdToName: Record<string, string>;
}> = ({ run, modelIdToName }) => {
    const [showReasoning, setShowReasoning] = useState(false);
    const [showDebate, setShowDebate] = useState(false);
    const [showJson, setShowJson] = useState(false);

    const analysis = run.message?.analysis;
    const time = new Date(run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const statusBadge = run.status === 'complete' ? (
        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Complete</span>
    ) : run.status === 'running' ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <LoadingIcon className="w-2.5 h-2.5 animate-spin" /> Running
        </span>
    ) : run.status === 'error' ? (
        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-rose-500/10 text-rose-400 border border-rose-500/20">Failed</span>
    ) : (
        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">Skipped</span>
    );

    const direction = analysis?.direction || 'Neutral';
    const directionColor = direction === 'Long' ? 'text-emerald-400' : direction === 'Short' ? 'text-rose-400' : 'text-zinc-400';

    return (
        <div className="rounded-xl border border-white/5 bg-zinc-900/80 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                    {statusBadge}
                    <span className={`font-black text-sm tracking-wider uppercase ${directionColor}`}>{direction}</span>
                    {analysis?.coinName && <span className="font-mono text-xs font-bold text-zinc-300">{analysis.coinName}</span>}
                    {analysis?.confidence && (
                        <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{(analysis.confidence as string).toUpperCase()}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {typeof analysis?.probability === 'number' && (
                        <span className="text-[11px] font-mono font-bold text-cyan-300">{Math.round(analysis.probability)}%</span>
                    )}
                    <span className="text-[10px] font-mono text-zinc-500">{time}</span>
                </div>
            </div>

            {run.status === 'error' && run.error && (
                <div className="px-4 py-2.5 bg-rose-500/5 border-b border-rose-500/15 text-xs text-rose-300/90 leading-relaxed">
                    {run.error}
                </div>
            )}

            {/* Prompt + levels */}
            <div className="px-4 py-3 space-y-2">
                {run.userMessage?.text && (
                    <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2" title={run.userMessage.text}>
                        <span className="text-zinc-600 font-bold uppercase tracking-widest text-[9px] mr-1.5">Prompt</span>
                        {run.userMessage.text}
                    </p>
                )}
                <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono text-zinc-500">
                    <span>Entry: <span className="text-cyan-200 font-bold">{(analysis?.entryPoints || [])[0]?.price || 'N/A'}</span></span>
                    <span>SL: <span className="text-rose-300/90 font-bold">{analysis?.stopLoss || 'N/A'}</span></span>
                    <span>TP1: <span className="text-emerald-300/90 font-bold">{analysis?.takeProfit?.[0]?.price || 'N/A'}</span></span>
                </div>
            </div>

            {/* Expandable detail sections */}
            <div className="px-4 pb-3 space-y-1">
                {run.message?.thoughtProcesses && Object.keys(run.message.thoughtProcesses).length > 0 && (
                    <div>
                        <button onClick={() => setShowReasoning(!showReasoning)} className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                            Reasoning ({Object.keys(run.message.thoughtProcesses).length}) <ChevronDownIcon className={`w-3 h-3 transition-transform ${showReasoning ? 'rotate-180' : ''}`} />
                        </button>
                        <div className={`collapsible-content ${showReasoning ? 'expanded' : ''} space-y-2`}>
                            {Object.entries(run.message.thoughtProcesses).map(([key, text]) => (
                                <div key={key} className="p-2.5 bg-zinc-950 border border-white/5 rounded-lg">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mb-1">{modelIdToName[key] ?? key}</p>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{String(text)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {run.message?.debateTurns && run.message.debateTurns.length > 0 && (
                    <div>
                        <button onClick={() => setShowDebate(!showDebate)} className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                            Debate ({run.message.debateTurns.length} turns) <ChevronDownIcon className={`w-3 h-3 transition-transform ${showDebate ? 'rotate-180' : ''}`} />
                        </button>
                        <div className={`collapsible-content ${showDebate ? 'expanded' : ''} space-y-1.5`}>
                            {run.message.debateTurns.map((turn, i) => (
                                <div key={i} className="p-2.5 bg-zinc-950 border border-white/5 rounded-lg">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-400/80 mb-1">{turn.speaker}{turn.round ? ` · Round ${turn.round}` : ''}</p>
                                    <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">{turn.text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {analysis && (
                    <div>
                        <button onClick={() => setShowJson(!showJson)} className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 hover:text-cyan-300 flex items-center gap-1 transition-colors">
                            Analysis JSON <ChevronDownIcon className={`w-3 h-3 transition-transform ${showJson ? 'rotate-180' : ''}`} />
                        </button>
                        <div className={`collapsible-content ${showJson ? 'expanded' : ''}`}>
                            <pre className="p-2.5 bg-zinc-950 border border-white/5 rounded-lg text-[10px] text-zinc-500 leading-relaxed overflow-x-auto max-h-56 overflow-y-auto custom-scrollbar">{JSON.stringify(analysis, null, 2)}</pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(AutomationRunCard);

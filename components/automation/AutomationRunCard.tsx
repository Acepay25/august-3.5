import React, { useMemo, useState } from 'react';
import { AutomationRun } from '../../types/automation';
import { ChevronDownIcon, LoadingIcon } from '../shared/Icons';
import MarkdownRenderer from '../shared/MarkdownRenderer';

/** Minimal view of the stored hybrid snapshot (HybridDataPacket). */
interface HybridSnapshot {
    symbol?: string;
    regime?: { regime?: string; trendDirection?: string; adx?: number };
    confluence?: { score?: number; direction?: string; strength?: string };
    session?: { sessionName?: string; suggestedAction?: string };
}

/** Outcome actions offered on a completed run card. */
export type RunOutcomeConfirm = 'win' | 'loss' | 'entry_not_hit';

/**
 * One scheduled run in the automation's card feed — rendered like a normal
 * chat message (same pattern as the Trading workspace): a compact markdown
 * summary of the signal in a bubble, with Win / Loss / Entry-not-hit action
 * buttons beneath that log the outcome to the journal (funneling through the
 * same autopilot-confirm flow as the chat cards). Reasoning + debate turns
 * stay available as minimal text toggles; the raw analysis JSON is gone.
 */
const AutomationRunCard: React.FC<{
    run: AutomationRun;
    modelIdToName: Record<string, string>;
    onConfirmOutcome?: (run: AutomationRun, outcome: RunOutcomeConfirm) => void;
}> = ({ run, modelIdToName, onConfirmOutcome }) => {
    const [showReasoning, setShowReasoning] = useState(false);
    const [showDebate, setShowDebate] = useState(false);
    const [confirmed, setConfirmed] = useState<RunOutcomeConfirm | null>(null);

    const analysis = run.message?.analysis;
    const snapshot = (analysis?.marketSnapshot ?? undefined) as HybridSnapshot | undefined;
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

    // Compact chat-message summary of the signal (no raw JSON).
    const markdown = useMemo(() => {
        if (!analysis) return '';
        const lines: string[] = [];
        lines.push(`**${analysis.coinName ?? 'Unknown asset'} · ${analysis.direction ?? 'Neutral'} · ${analysis.confidence ?? '—'}**`);
        lines.push('');
        lines.push(`- **Entry:** ${analysis.entryPoints?.[0]?.price ?? 'N/A'} · **SL:** ${analysis.stopLoss ?? 'N/A'} · **TP1:** ${analysis.takeProfit?.[0]?.price ?? 'N/A'}${typeof analysis.probability === 'number' ? ` · **Prob:** ${Math.round(analysis.probability)}%` : ''}`);
        if (snapshot?.regime?.regime) {
            lines.push(`- **Regime:** ${snapshot.regime.regime.replace(/_/g, ' ')}${typeof snapshot.regime.adx === 'number' ? ` (ADX ${snapshot.regime.adx.toFixed(1)})` : ''}${typeof snapshot.confluence?.score === 'number' ? ` · **Confluence:** ${snapshot.confluence.score}/100 ${snapshot.confluence.direction ?? ''}` : ''}`);
        }
        if (snapshot?.session?.sessionName) {
            lines.push(`- **Session:** ${snapshot.session.sessionName}${snapshot.session.suggestedAction ? ` — ${snapshot.session.suggestedAction}` : ''}`);
        }
        if (analysis.strategy) {
            lines.push('');
            lines.push(analysis.strategy.length > 400 ? `${analysis.strategy.slice(0, 400)}…` : analysis.strategy);
        }
        return lines.join('\n');
    }, [analysis, snapshot]);

    const outcomeActions: { key: RunOutcomeConfirm; label: string; className: string }[] = [
        { key: 'win', label: 'Win', className: 'status-surface rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-4 py-2 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/25' },
        { key: 'loss', label: 'Loss', className: 'status-surface rounded-xl bg-rose-500/15 border border-rose-500/40 px-4 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/25' },
        { key: 'entry_not_hit', label: 'Entry not hit', className: 'rounded-xl border border-white/10 bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700' },
    ];

    return (
        <div className="w-full max-w-3xl mx-auto">
            {/* Chat bubble — like a normal AI message */}
            <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-4 sm:p-5 shadow-lg">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {statusBadge}
                    <span className={`font-black text-sm tracking-wider uppercase ${directionColor}`}>{direction}</span>
                    {analysis?.coinName && <span className="font-mono text-xs font-bold text-zinc-300">{analysis.coinName}</span>}
                    <span className="ml-auto text-[10px] font-mono text-zinc-500">{time}</span>
                </div>

                {run.status === 'error' && run.error && (
                    <div className="px-3 py-2.5 bg-rose-500/5 border border-rose-500/15 rounded-lg text-xs text-rose-300/90 leading-relaxed mb-3">
                        {run.error}
                    </div>
                )}

                {run.userMessage?.text && (
                    <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2 mb-2" title={run.userMessage.text}>
                        <span className="text-zinc-600 font-bold uppercase tracking-widest text-[9px] mr-1.5">Prompt</span>
                        {run.userMessage.text}
                    </p>
                )}

                <div className="prose-sm">
                    <MarkdownRenderer content={markdown} />
                </div>

                {/* Minimal prose toggles — reasoning and debate only (no JSON) */}
                {(run.message?.thoughtProcesses && Object.keys(run.message.thoughtProcesses).length > 0) || (run.message?.debateTurns && run.message.debateTurns.length > 0) ? (
                    <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
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
                    </div>
                ) : null}
            </div>

            {/* Outcome actions — same pattern as the workspace action buttons */}
            {run.status === 'complete' && analysis && onConfirmOutcome && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {outcomeActions.map(action => (
                        <button
                            key={action.key}
                            type="button"
                            disabled={confirmed !== null}
                            onClick={() => {
                                setConfirmed(action.key);
                                onConfirmOutcome(run, action.key);
                            }}
                            className={`${action.className} disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {confirmed === action.key
                                ? action.key === 'entry_not_hit' ? 'Logged to journal' : `Logged ${action.label}`
                                : action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default React.memo(AutomationRunCard);

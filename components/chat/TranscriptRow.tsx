
import React from 'react';
import { Message, MessageRole } from '../../types';
import { ChevronDownIcon, LinkIcon, CheckIcon } from '../shared/Icons';
import ReasoningRow from '../shared/ReasoningRow';
import LiveMarketDataView from '../market/LiveMarketDataView';
import DebateSummary from '../analysis/DebateSummary';
import TradingSignalCard from '../analysis/TradingSignalCard';
import DebateReplay from '../analysis/DebateReplay';
import DebateStage, { DebateStageActor } from '../analysis/DebateStage';
import DebateSidePanel from '../analysis/DebateSidePanel';
import ReplacementOfferCard from '../analysis/ReplacementOfferCard';
import DebateRunLog from '../analysis/DebateRunLog';
import RunContractPanel from '../analysis/RunContractPanel';
import EvidencePackCard from '../analysis/EvidencePackCard';
import ModelByline from '../shared/ModelByline';
import InlineApprovalCard from './InlineApprovalCard';
import { PreReadGate } from './PreReadGate';
import { ContextDisclosure } from './ContextDisclosure';
import { SkillCitationChips } from './SkillCitationChips';
import { loadPreReadEnabled } from '../../utils/preRead';
import AnalysisTracePanel from '../analysis/AnalysisTracePanel';
import AnalysisDetails from './AnalysisDetails';
import ToolActionsRow from './ToolActionsRow';
import SetupLifecycleCard from '../analysis/SetupLifecycleCard';
import { buildSupplementMarkdown, extractModeratorThinking } from '../../utils/analysisUtils';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { isEnsembleMessage as isEnsembleMessageOf, stageActorsForMessage } from '../../utils/debateStageActors';
import { deriveMessageDisplayText } from '../../utils/messageDisplayText';
import type { ChatContextProps } from './MessageItem';

// Helper to validate URLs (XSS prevention)
const isSafeUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://');
};

/**
 * The transcript row for a settled analysis: the analysis bubble (summary +
 * signal card + deep surfaces), the debate stage above it, and the run
 * chrome (byline, run ledger, sources) below. ChatArea's row dispatch routes
 * every `message.analysis` row here; MessageItem renders everything else.
 *
 * The JSX mirrors the sections MessageItem renders for analysis messages —
 * the row moved here as a whole so the dispatch could not change what a
 * settled analysis row shows.
 */
const TranscriptRow = React.memo(({ message, context }: { message: Message, context: ChatContextProps }) => {
    const {
        highlightedAnalysisId,
        confidenceCalibration, leverage, onViewImage,
        autopilotResolutions, onConfirmAutopilot, onDismissAutopilot,
        onSelectMessageForProbability,
        onCompareAnalysis,
        onReRunAnalysis,
        onToggleWatch,
        onRetryFailedRun,
        onSteerSeat,
        onStopSeat,
        onReplacementChoice,
        onForkDebate,
        sessionTradeCount,
        onPreReadCommit,
        inlineApprovals,
        onApprovalAllow,
        onApprovalDeny,
        onApprovalAlways,
        onApprovalNever,
        onApprovalShow,
        copiedMessageId,
        handleCopy,
        isSelectionMode, selectedMessageIds, onToggleMessageSelection,
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    // Which deep surface is open on the settled card — 'replay' |
    // 'runlog' | 'audit' | null. Replaces the scattered toggles.
    const [paneTab, setPaneTab] = React.useState<string | null>(null);
    const [isRunLedgerOpen, setIsRunLedgerOpen] = React.useState(false);
    const [isMemoryGateExpanded, setIsMemoryGateExpanded] = React.useState(false);

    const { leakedThinking, liveMarketJson, ensembleNote } =
        deriveMessageDisplayText(message);

    const thinkingEntries = Object.entries({
        ...(message.thoughtProcesses ?? {}),
        ...(message.reasoningProcesses ?? {}),
        ...(leakedThinking ? { __leaked: leakedThinking } : {}),
    }).filter(([, content]) => Boolean(content));
    // Ensemble reasoning is presented in the analyst progress/output card.
    // Do not duplicate it in the generic chat-level Thinking disclosure.
    const isEnsembleMessage = isEnsembleMessageOf(message);
    const debateTurns = message.debateTurns ?? message.postMortemDebateTurns ?? [];

    // Debate floor: one thinking bubble per debater in the chat
    // area; the full transcript streams in the right-hand side panel.
    // Actor derivation lives in utils/debateStageActors so the opt-in
    // DeskScene overlay projects the exact same debate state.
    const [debatePanelActor, setDebatePanelActor] = React.useState<string | null>(null);
    const stageActors = React.useMemo(
        (): DebateStageActor[] => stageActorsForMessage(message),
        [message],
    );

    // Live phase line for the floor caption — "Round 2 · Rebuttal rounds" —
    // so the watcher always knows where in the protocol the debate is.
    const livePhase = React.useMemo(() => {
        if (!message.isDebating) return undefined;
        const maxRound = debateTurns.reduce((m, t) => Math.max(m, t.round ?? 0), 0);
        const running = (message.runContract ?? []).find(s => s.state === 'running');
        const bits: string[] = [];
        if (maxRound > 0) bits.push(`Round ${maxRound}`);
        if (running) bits.push(running.label);
        return bits.length > 0 ? bits.join(' · ') : undefined;
    }, [message.isDebating, message.runContract, debateTurns]);

    // Exchange map: directed addressing edges (who replied to whom, how
    // often) — real back-and-forth vs parallel monologues at a glance.
    const debateExchanges = React.useMemo(() => {
        const counts = new Map<string, number>();
        for (const t of debateTurns) {
            if (!t.to?.length || t.speaker === 'System' || t.speaker === 'Moderator') continue;
            for (const target of t.to) {
                if (!target || target.toLowerCase() === t.speaker.toLowerCase()) continue;
                const key = `${t.speaker}\u0000${target}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        return [...counts.entries()]
            .map(([key, count]) => {
                const sep = key.indexOf('\u0000');
                return { from: key.slice(0, sep), to: key.slice(sep + 1), count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }, [debateTurns]);

    // While the debate is live, open the side transcript once so the full
    // thinking/output is visible beside the thinking bubbles.
    React.useEffect(() => {
        if (message.isDebating && stageActors.length > 0) {
            setDebatePanelActor(prev => prev ?? stageActors[0].id);
        }
    }, [message.isDebating, stageActors]);

    // The moderator's chain-of-thought shows as a Thinking row; the final
    // verdict PROSE does NOT render in the chat area — the TradingSignalCard
    // below is the moderator's only chat-area output.
    const moderatorThinking = extractModeratorThinking(message.reasoningProcesses, message.thoughtProcesses);

    // Harness-side data (gate, calibration, team verdict, memory insight,
    // freshness) — rendered as markdown sections inside the same card.
    const supplementMarkdown = React.useMemo(() => {
        return message.analysis ? buildSupplementMarkdown(message.analysis, confidenceCalibration) : '';
    }, [message.analysis, confidenceCalibration]);

    const bubbleClass = 'bg-transparent text-zinc-200';

    const isSelected = selectedMessageIds?.has(message.id);

    // Pre-read gate (§5a): the toggle is read once per mounted card; the
    // gate only stands between the user and a SETTLED verdict that has no
    // committed prior yet. Skip (local) reveals without committing; a
    // committed prior (persisted on the message) reveals everywhere.
    // (Hooks stay above the early return below.)
    const [preReadEnabled] = React.useState(loadPreReadEnabled);
    const [preReadSkipped, setPreReadSkipped] = React.useState(false);

    const handleSelectionClick = (e: React.MouseEvent) => {
        if (isSelectionMode && onToggleMessageSelection) {
            e.preventDefault();
            e.stopPropagation();
            onToggleMessageSelection(message.id);
        }
    };

    if (!message.analysis) return null;
    const analysis = message.analysis;

    // Pre-read gate (§5a): only the NEWEST message can be gated — older
    // settled cards must stay readable (the gate is a before-the-reveal
    // device; re-hiding history the user already read is not training,
    // it's a wall). latestMessageId is the last message in the thread, so
    // a follow-up send also releases the gate on the previous verdict.
    const preReadGateOpen = preReadEnabled
        && context.latestMessageId === message.id
        && !message.isDebating
        && !message.isPostMortem
        && !message.userPriorCall
        && !preReadSkipped;

    return (
        <div
            id={`message-${message.id}`}
            className={`status-surface flex items-start gap-2 sm:gap-4 my-2 sm:my-4 px-3 sm:px-4 lg:px-8 transition-all duration-200 chat-column
            ${isHighlighted ? 'rounded-2xl' : ''}
            ${isSelectionMode ? 'cursor-pointer hover:bg-zinc-800 rounded-xl py-2' : ''}
        `}
            onClick={isSelectionMode ? handleSelectionClick : undefined}
        >
            {isSelectionMode && (
                <div className="flex items-center justify-center self-center pr-2">
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            handleSelectionClick(event);
                        }}
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-zinc-500 ${isSelected ? 'bg-zinc-200 border-zinc-200' : 'border-zinc-500 bg-transparent'}`}
                        aria-label={`${isSelected ? 'Deselect' : 'Select'} message`}
                        aria-pressed={isSelected}
                    >
                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                    </button>
                </div>
            )}

            <div className={`w-full break-words relative group ${bubbleClass}`}>

                <>
                        {/* Main Content Container */}
                        <div>

                            {/* Inline thinking trace — collapsible reasoning row.
                                Ensemble messages present their reasoning inside the
                                Floor surface instead of this bubble. */}
                            {message.role === MessageRole.AI && !isEnsembleMessage && thinkingEntries.length > 0 && (
                                <div className="mb-4">
                                    <ReasoningRow
                                        thinking={thinkingEntries.map(([, content]) => content).join('\n\n')}
                                        label={thinkingEntries.length > 1 ? `Thinking · ${thinkingEntries.length} traces` : 'Thinking'}
                                        running={!!message.isStreaming}
                                    />
                                </div>
                            )}

                            {/* Debate floor — thinking bubbles per debater;
                                full transcripts stream in the side panel. */}
                            {stageActors.length > 0 && (
                                <div className="mb-4">
                                    <DebateStage
                                        actors={stageActors}
                                        caption={message.isDebating ? 'Debate in progress' : 'Debate floor'}
                                        phase={livePhase}
                                        stages={message.isDebating ? message.runContract : undefined}
                                        exchanges={debateExchanges}
                                        live={Boolean(message.isDebating)}
                                        onOpenActor={id => setDebatePanelActor(id)}
                                        onSteerSeat={message.isDebating ? onSteerSeat : undefined}
                                        onStopSeat={message.isDebating ? onStopSeat : undefined}
                                    />
                                    {/* Mid-debate replacement: the engine suspends
                                        until a candidate is picked or skipped — the
                                        choice must be visible or the wait is wasted.
                                        Shared card also renders inside the side panel. */}
                                    {message.replacementOffer && onReplacementChoice && (
                                        <ReplacementOfferCard
                                            offer={message.replacementOffer}
                                            onChoice={providerId => onReplacementChoice(message.id, providerId)}
                                            className="mt-2"
                                        />
                                    )}
                                    <DebateSidePanel
                                        open={debatePanelActor !== null}
                                        onClose={() => setDebatePanelActor(null)}
                                        turns={debateTurns}
                                        actorIds={stageActors.map(a => a.id)}
                                        activeActor={debatePanelActor}
                                        onSelectActor={id => setDebatePanelActor(id)}
                                        isLive={Boolean(message.isDebating)}
                                        liveToolEvents={message.liveToolEvents}
                                        reasoningProcesses={message.reasoningProcesses}
                                        runLog={message.debateRunLog}
                                        analysis={message.analysis}
                                        messageId={message.id}
                                        onForkDebate={onForkDebate}
                                        replacementOffer={message.replacementOffer}
                                        onReplacementChoice={onReplacementChoice
                                            ? providerId => onReplacementChoice(message.id, providerId)
                                            : undefined}
                                    />
                                </div>
                            )}

                            {/* Ensemble reasoning in the bubble: the moderator's
                                chain-of-thought streams in a Thinking row. Analyst
                                thinking stays in the Floor's seat modals to avoid
                                duplication. */}
                            {isEnsembleMessage && !message.isPostMortem && moderatorThinking && (
                                <div className="mt-3 mb-4">
                                    <ReasoningRow
                                        thinking={moderatorThinking}
                                        label="Moderator thinking"
                                        running={!!message.isDebating && !message.analysis}
                                    />
                                </div>
                            )}

                            {liveMarketJson && (
                                <div className="mb-4 sm:mb-6">
                                    <LiveMarketDataView jsonString={liveMarketJson} />
                                </div>
                            )}

                            {/* Pattern-memory gate — the user must see when
                                memory HALTED / downsized / warned the trade. */}
                            {message.patternMemoryGate && message.patternMemoryGate.gateResult !== 'PASS' && (
                                <div className={`mb-3 rounded-lg border p-3 ${message.patternMemoryGate.gateResult === 'HALT'
                                    ? 'status-surface border-rose-500/40 bg-rose-500/10'
                                    : message.patternMemoryGate.gateResult === 'REDUCE_SIZE'
                                        ? 'status-surface border-amber-500/40 bg-amber-500/10'
                                        : 'status-surface border-amber-500/30 bg-amber-500/5'}`}>
                                    <button
                                        type="button"
                                        onClick={() => setIsMemoryGateExpanded(o => !o)}
                                        className="w-full text-left flex items-start justify-between gap-2"
                                        aria-expanded={isMemoryGateExpanded}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${message.patternMemoryGate.gateResult === 'HALT' ? 'text-rose-400' : 'text-amber-400'}`}>
                                                {message.patternMemoryGate.gateResult === 'HALT' ? '⛔ Memory gate: halted' : message.patternMemoryGate.gateResult === 'REDUCE_SIZE' ? '⚠️ Memory gate: reduce size' : '⚡ Memory gate: warning'}
                                            </span>
                                        </div>
                                        <ChevronDownIcon className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${isMemoryGateExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    <p className="text-[11px] text-zinc-300 mt-1.5 leading-relaxed">{message.patternMemoryGate.reason}</p>
                                    {isMemoryGateExpanded && (
                                        <div className="mt-2 space-y-1.5 animate-fade-in">
                                            {message.patternMemoryGate.mandatoryQuestions.map((q, i) => (
                                                <p key={i} className="text-[11px] text-zinc-400">• {q}</p>
                                            ))}
                                            {message.patternMemoryGate.historicalFailures.length > 0 && (
                                                <div className="pt-1.5 border-t border-white/5">
                                                    <p className="text-[9px] uppercase tracking-widest font-bold text-zinc-500 mb-1">Matched historical trades</p>
                                                    {message.patternMemoryGate.historicalFailures.map((f, i) => (
                                                        <p key={i} className="text-[11px] text-zinc-400 leading-snug">
                                                            <span className={`font-bold ${f.outcome === 'LOSS' ? 'text-rose-400' : 'text-emerald-400'}`}>{f.outcome}</span>
                                                            {f.coinName ? ` · ${f.coinName}` : ''}{f.direction ? ` ${f.direction}` : ''}
                                                            {f.keyLesson ? <span className="text-zinc-500"> — {f.keyLesson}</span> : null}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* The settled analysis transcript: summary + deep
                                surfaces (Replay · Run log · Audit) + signal card
                                + harness details. Pre-read training mode
                                (§5a, opt-in): while enabled and no prior is
                                committed for this card, the verdict panel
                                stays behind the gate — commit first, reveal
                                after. Skip reveals without committing. */}
                            {preReadGateOpen ? (
                                <PreReadGate
                                    onCommit={prior => { onPreReadCommit?.(message.id, prior); }}
                                    onSkip={() => setPreReadSkipped(true)}
                                />
                            ) : (
                            <div className="ui-panel">
                                <DebateSummary debateTurns={debateTurns} analysis={analysis} />
                                {/* The settled run's deep surfaces live in one
                                    tab strip — Replay · Run log · Audit — instead
                                    of scattered toggles down the card. */}
                                {(() => {
                                    const tabs: Array<{ id: string; label: string }> = [];
                                    if (debateTurns.length > 0) tabs.push({ id: 'replay', label: 'Replay' });
                                    if ((message.debateRunLog?.length ?? 0) > 0 || message.runStats) tabs.push({ id: 'runlog', label: 'Run log' });
                                    if (message.runContract || message.evidencePack) tabs.push({ id: 'audit', label: 'Audit' });
                                    if (tabs.length === 0) return null;
                                    const activeTab = paneTab && tabs.some(t => t.id === paneTab) ? paneTab : null;
                                    return (
                                        <div className="flex items-center gap-1 border-b border-white/5 px-3 py-1.5">
                                            {tabs.map(tab => (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => setPaneTab(activeTab === tab.id ? null : tab.id)}
                                                    aria-pressed={activeTab === tab.id}
                                                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                                        activeTab === tab.id
                                                            ? 'bg-zinc-700/70 text-zinc-100'
                                                            : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200'
                                                    }`}
                                                >
                                                    {tab.label}
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}
                                {paneTab === 'replay' && debateTurns.length > 0 && (
                                    <div className="border-b border-white/5 px-4 py-3">
                                        <DebateReplay turns={debateTurns} onClose={() => setPaneTab(null)} />
                                    </div>
                                )}
                                <div className="border-t border-white/5">
                                <TradingSignalCard
                                    analysis={analysis}
                                    debateTurns={message.debateTurns}
                                    isLatest={context.latestMessageId === message.id}
                                    onReRun={onReRunAnalysis ? () => onReRunAnalysis(message.id) : undefined}
                                    supplementMarkdown={supplementMarkdown}
                                    ensembleNote={ensembleNote}
                                    calibration={confidenceCalibration}
                                    modelsUsed={message.modelsUsed}
                                    priorAnalysis={context.priorAnalysisById?.[message.id]}
                                    promptLane={message.runStats?.promptLane}
                                    runStats={message.runStats}
                                    onFollowUp={context.onFollowUpTicket ? (text) => context.onFollowUpTicket!(message.id, text) : undefined}
                                    leverage={leverage}
                                    bare
                                />
                                <AnalysisTracePanel message={message} />
                                </div>
                                <SetupLifecycleCard
                                    analysis={analysis}
                                    outcome={message.outcome}
                                    compact
                                    embedded
                                />
                                <div className="border-t border-white/5 px-4 pb-4">
                                {/* Inline approval cards — same actions
                                    as the Inbox modal, surfaced where the user is. */}
                                {(() => {
                                    const mine = (inlineApprovals ?? []).filter(i => i.messageId === message.id);
                                    return mine.length > 0 && onApprovalAllow && onApprovalDeny ? (
                                        <div className="mb-3 space-y-2">
                                            {mine.map(item => (
                                                <InlineApprovalCard
                                                    key={item.id}
                                                    item={item}
                                                    onAllow={onApprovalAllow}
                                                    onDeny={onApprovalDeny}
                                                    onAlways={onApprovalAlways}
                                                    onNever={onApprovalNever}
                                                    onShow={onApprovalShow}
                                                />
                                            ))}
                                        </div>
                                    ) : null;
                                })()}
                                <AnalysisDetails
                                    messageId={message.id}
                                    analysis={analysis}
                                    outcome={message.outcome}
                                    autopilotResolution={autopilotResolutions?.[message.id]}
                                    onLogTrade={context.handleInitiateLogTrade}
                                    onSkipTrade={context.handleInitiateSkipTrade}
                                    sessionTradeCount={sessionTradeCount}
                                    onConfirmAutopilot={onConfirmAutopilot}
                                    onDismissAutopilot={onDismissAutopilot}
                                    onSelectForProbability={onSelectMessageForProbability}
                                    onCompare={onCompareAnalysis}
                                    watched={Boolean(message.watched)}
                                    onToggleWatch={(id: string) => onToggleWatch?.(id)}
                                    message={message}
                                    tradingStyle={message.tradingStyle}
                                    highlighted={isHighlighted}
                                >
                                    {/* Audit surfaces: run contract + verdict evidence. */}
                                    <RunContractPanel stages={message.runContract} />
                                    <EvidencePackCard pack={message.evidencePack} />
                                </AnalysisDetails>
                                </div>
                                {(message.debateRunLog && message.debateRunLog.length > 0) || message.runStats ? (
                                    paneTab === 'runlog'
                                        ? <DebateRunLog events={message.debateRunLog ?? []} runStats={message.runStats} defaultOpen />
                                        : null
                                ) : null}
                                {paneTab === 'audit' && (message.runContract || message.evidencePack) && (
                                    <div className="border-t border-white/5 px-4 py-3">
                                        <RunContractPanel stages={message.runContract} />
                                        <EvidencePackCard pack={message.evidencePack} />
                                    </div>
                                )}
                                </div>
                            )}

                            {/* Failed-run retry: rebuild the same prompt + charts. */}
                            {message.retryOf && onRetryFailedRun && (
                                <button
                                    type="button"
                                    onClick={() => onRetryFailedRun(message.retryOf!.userMessageId)}
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-md text-sm font-medium transition-colors"
                                    aria-label="Retry the failed analysis with the same chart"
                                >
                                    Retry with same chart
                                </button>
                            )}

                            {/* Quiet byline: who sat on this desk, how long. */}
                            {!message.isDebating && !message.isPostMortem && message.runStats && (
                                <ModelByline runStats={message.runStats} />
                            )}

                            {Array.isArray(message.images) && message.images.length > 0 && (
                                <div className="mt-4 sm:mt-6">
                                    <div className={`grid gap-2 sm:gap-3 ${message.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                        {message.images.map((img, i) => (
                                            <button
                                                 type="button"
                                                 key={`${message.id}-img-${i}`}
                                                 className="group relative aspect-video rounded-xl sm:rounded-2xl overflow-hidden border border-white/10 shadow-md bg-zinc-900 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                                 onClick={() => {
                                                     if (isSelectionMode) return;
                                                     if (onViewImage) onViewImage(img);
                                                 }}
                                                 aria-label={`View trade screenshot ${i + 1}`}
                                                 disabled={isSelectionMode}
                                             >
                                                <img
                                                    src={img}
                                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                                                    alt="trade screenshot"
                                                />
                                                {message.imageSummaries?.[i] && (
                                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 sm:p-4 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                                        <p className="text-[10px] sm:text-xs font-mono text-zinc-300 truncate" title={message.imageSummaries[i]}>
                                                            {message.imageSummaries[i].replace(/Chart \d+ \| /, '')}
                                                        </p>
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {analysis && message.runStats?.analysts && message.runStats.analysts.length > 0 && (
                                <div className="mb-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                                        <button
                                            type="button"
                                            onClick={() => setIsRunLedgerOpen(o => !o)}
                                            aria-expanded={isRunLedgerOpen}
                                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                            title="Per-analyst cost & latency ledger"
                                        >
                                            {isRunLedgerOpen ? '▾ Run ledger' : '▸ Run ledger'}
                                        </button>
                                        {/* Per-message context disclosure (§10.1):
                                            the run's actual memory injections —
                                            the trust surface for the learning
                                            system itself. */}
                                        <ContextDisclosure
                                            messageCreatedAt={message.createdAt}
                                            messageFinishedAt={message.runStats?.finishedAt}
                                            isDebating={message.isDebating}
                                        />
                                        {/* Skill-citation chips (§10.1): the
                                            skills actually injected into this
                                            run — tap opens the card, ⚑ flags
                                            negative evidence. */}
                                        <SkillCitationChips
                                            messageCreatedAt={message.createdAt}
                                            messageFinishedAt={message.runStats?.finishedAt}
                                            messageId={message.id}
                                        />
                                        {message.text && (
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(message)}
                                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                                title="Copy the full analysis text"
                                                aria-label="Copy analysis text"
                                            >
                                                {copiedMessageId === message.id ? '✓ Copied' : '⧉ Copy'}
                                            </button>
                                        )}
                                    </div>
                                    {isRunLedgerOpen && (
                                        <div className="mt-1.5 overflow-x-auto rounded-lg border border-white/10 bg-zinc-900/60">
                                            <table className="w-full text-left text-[11px] border-collapse">
                                                <thead>
                                                    <tr className="text-zinc-500">
                                                        <th className="px-2 py-1 font-medium">Analyst</th>
                                                        <th className="px-2 py-1 font-medium">Model</th>
                                                        <th className="px-2 py-1 font-medium">Time</th>
                                                        <th className="px-2 py-1 font-medium">Chars</th>
                                                        <th className="px-2 py-1 font-medium">Est. tok</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {message.runStats.analysts.map(a => (
                                                        <tr key={`${a.providerId}::${a.modelId}`} className="border-t border-white/5 text-zinc-300">
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate" title={a.displayName}>{a.displayName}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate text-zinc-400" title={a.modelId}>{formatModelDisplayName(a.modelId)}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.durationMs !== undefined ? `${(a.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.charsOut !== undefined ? a.charsOut.toLocaleString() : '—'}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{
                                                                a.promptTokens !== undefined || a.completionTokens !== undefined
                                                                    ? ((a.promptTokens ?? 0) + (a.completionTokens ?? 0)).toLocaleString()
                                                                    : (a.charsOut !== undefined ? `~${Math.round(a.charsOut / 4).toLocaleString()}` : '—')
                                                            }</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {Array.isArray(message.toolActions) && message.toolActions.length > 0 && (
                                <ToolActionsRow actions={message.toolActions} />
                            )}

                            {Array.isArray(message.sources) && message.sources.length > 0 && <div className="mt-4 sm:mt-6 pt-4 border-t border-white/10"><h4 className="text-xs uppercase font-bold text-zinc-500 mb-2 sm:mb-3 tracking-widest">Reference Sources</h4><ul className="text-xs sm:text-sm space-y-2 sm:space-y-3">{message.sources.map((source, index) => (<li key={`${message.id}-src-${index}`}>{isSafeUrl(source.web.uri) ? (<a href={source.web.uri} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-zinc-100 hover:underline break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</a>) : (<span className="text-zinc-300 break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</span>)}</li>))}</ul></div>}

                        </div>
                </>
            </div>
        </div>
    );
});

export default TranscriptRow;

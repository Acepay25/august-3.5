/**
 * ChatTranscriptList — the dock's transcript rows, extracted from
 * TradeChatPanel. Props-only: every input is either data (the merged entry
 * list, the analysis-message-id map) or a callback the shell owns (`send`
 * for the retry chips, the Key Levels → chart channel, the pin toggle, the
 * journal logger). The proposal-card disposition map stays at MODULE scope
 * so it survives a dock unmount, exactly as it did in the panel.
 */

import React, { useState } from 'react';
import { Zap } from '../../shared/Icons';
import type { Message } from '../../../types/message';
import type { LiveEntry } from '../../../services/trade/chatStore';
import { parseKeyLevels, type MessageLevelLines } from '../../../services/trade/keyLevels';
import type { TradeProposal } from '../../../services/trade/proposedTrade';
import { formatSeatLabel } from '../../../utils/providerUtils';
import ChatWorkTimeline from './ChatWorkTimeline';
import TradeProposalCard, { TradeProposalLoggedRow } from './TradeProposalCard';
import VerdictAudit from '../../analysis/VerdictAudit';
import MemoryProvenanceStrip from '../../chat/MemoryProvenanceStrip';
import KeyLevelsCard from '../KeyLevelsCard';
import { CopyChip, FadingText, PinChip, RetryChip } from '../../shared/chatChips';

/** Per-entry disposition of a model proposal card ('logged' / 'dismissed').
 *  Lives at MODULE scope keyed by entry id, NOT in component state: the
 *  dock unmounts whenever the user leaves the trade surface, and a remount
 *  reset the flag — a second click on "Log this trade" then logged the
 *  SAME plan a second time. Bounded: proposal cards are rare; drop the
 *  oldest insertions when the cap is reached. */
const PROPOSAL_STATE_MAX = 500;
const proposalDisposition = new Map<string, 'logged' | 'dismissed'>();
const setProposalDisposition = (entryId: string, state: 'logged' | 'dismissed'): void => {
    if (proposalDisposition.size >= PROPOSAL_STATE_MAX) {
        const oldest = proposalDisposition.keys().next();
        if (!oldest.done) proposalDisposition.delete(oldest.value);
    }
    proposalDisposition.set(entryId, state);
};
/** Test hook: forget every recorded proposal disposition. */
export const __clearProposalStateForTests = (): void => { proposalDisposition.clear(); };

interface ChatTranscriptListProps {
    /** The merged conversation rows (a bot session is a VIEW of the
     *  canonical conversation — the merge happened in the shell). */
    entries: LiveEntry[];
    /** The shell's send — retry chips re-run a user bubble through it. */
    send: (raw: string, retryOf?: string) => Promise<void>;
    /** entryId → App-side analysis message id for ensemble runs launched
     *  from the dock (Locate's scroll target). */
    analysisMessageIds: Record<string, string>;
    /** Resolve an analysis message id into the App-side message (the
     *  verdict audit block). Absent ⇒ the audit block does not render. */
    getAnalysisMessage?: (messageId: string) => Message | undefined;
    /** The chart the transcript talks about (Key Levels card rows). */
    symbol: string;
    /** The freshest mark for the levels card's Dist column — the canvas
     *  snapshot's markPrice, never a re-fetch. */
    getMark: () => number | null;
    /** The ownership-arbitrated Key Levels → chart channel (dock-owned). */
    onChatLevels: (payload: MessageLevelLines | null, ownerId?: string) => void;
    /** Pin / unpin the signal behind an entry (App-side message ids only). */
    onToggleWatch?: (messageId: string) => void;
    /** Message ids currently pinned, so the chip shows the real state. */
    pinnedMessageIds?: ReadonlySet<string>;
    /** "Log this trade" on a model proposal → App records an OPEN trade.
     *  Absent ⇒ the Log button is hidden (no journal attached). */
    onLogProposedTrade?: (proposal: TradeProposal) => void;
}

const ChatTranscriptList: React.FC<ChatTranscriptListProps> = ({
    entries, send, analysisMessageIds, getAnalysisMessage, symbol, getMark, onChatLevels,
    onToggleWatch, pinnedMessageIds, onLogProposedTrade,
}) => {
    /** Re-render trigger for the module-scope proposal dispositions (see
     *  proposalDisposition): the disposition itself must SURVIVE a dock
     *  unmount, the state here only makes React repaint the card. */
    const [proposalTick, setProposalTick] = useState(0);
    /** Proposal card disposition for one entry — read from the MODULE map
     *  (see proposalDisposition), so the 'logged' state survives a dock
     *  unmount/remount and "Log this trade" can never be clicked twice for
     *  the same plan. proposalTick is the repaint trigger. */
    const proposalStateOf = (id: string): 'logged' | 'dismissed' | undefined => {
        void proposalTick;
        return proposalDisposition.get(id);
    };
    // "Is any LATER entry still streaming?" — the retry/copy chips on a USER
    // bubble stay hidden while the whole following generation runs (a PANEL
    // turn streams seat 2 while seat 1 has settled, and a mid-turn retry
    // could wipe the live room). Computed ONCE per render with a single
    // reverse pass; the old per-row `entries.slice(i + 1).some(...)` was
    // O(n²) on every streaming chunk.
    // (The rows themselves stay unmemoized on purpose: they read the module
    // proposalDisposition map through the proposalTick counter, so they are
    // not props-pure — a memo boundary would have to thread module state
    // through props for no win at the 60-entry cap.)
    const answerStreamingFlags = React.useMemo<boolean[]>(() => {
        const flags = new Array<boolean>(entries.length);
        let seen = false;
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            flags[i] = seen;
            if (entries[i].streaming) seen = true;
        }
        return flags;
    }, [entries]);
    return (
        <>
            {entries.map((e, i) => {
                const answerStreaming = answerStreamingFlags[i];
                // Key-levels protocol: the fenced block the model closes an
                // analysis with renders as the chart-linked card, never as
                // raw text — and an OPEN (still-streaming) fence is hidden
                // from the bubble too, so the protocol never flashes.
                const aiLevels = e.role === 'ai' && !e.notice ? parseKeyLevels(e.text) : null;
                const shownText = aiLevels?.hadBlock ? aiLevels.clean : e.text;
                const analysisId = analysisMessageIds[e.id];
                // Only a settled answer has a verdict to explain, and only
                // an entry this dock ran has an id to resolve it from.
                const verdict = e.streaming || e.notice ? undefined
                    : (analysisId ? getAnalysisMessage?.(analysisId) : undefined);
                return (
                <div key={e.id} className="chat-fade-in" data-entry-id={e.id} data-message-id={analysisId ?? e.id} data-testid={`chat-entry-${e.role}`}>
                    {e.role === 'user' ? (
                        <div className="flex flex-col items-end gap-1">
                            {e.image && (
                                <div className="group/msg flex flex-col items-end gap-0.5">
                                    <img src={e.image} alt="attached" className="max-h-40 rounded-lg border border-white/10 object-contain" />
                                    {!answerStreaming && <RetryChip onRetry={() => void send('', e.id)} />}
                                </div>
                            )}
                            {!e.image && e.imageOmitted && (
                                // A restored backup carries no image bytes: the row must
                                // still say an image was attached — and never via an <img>
                                // with a missing src, which renders as a broken icon.
                                <div
                                    data-testid="chat-image-omitted"
                                    className="rounded-lg border border-white/10 bg-zinc-900/60 px-2 py-1 text-ui-xs text-zinc-500"
                                >
                                    image not backed up ({e.imageOmitted.mime}, {Math.max(1, Math.round(e.imageOmitted.bytes / 1024))} KB)
                                </div>
                            )}
                            {e.text && e.text !== '(chart screenshot)' && (
                                <div className="group/msg flex max-w-[85%] items-start gap-1">
                                    {!answerStreaming && <CopyChip text={e.text} className="mt-2" />}
                                    {!answerStreaming && <RetryChip onRetry={() => void send('', e.id)} className="mt-2" />}
                                    <p className="min-w-0 rounded-bubble bg-zinc-800 px-3 py-2 text-ui-sm leading-5 text-zinc-100">{e.text}</p>
                                </div>
                            )}
                        </div>
                    ) : e.notice ? (
                        <p className="flex items-center gap-1.5 text-ui-xs font-semibold uppercase tracking-wider text-amber-400" data-testid="chat-notice">
                            <span className="sr-only">⚡ </span>
                            <Zap className="h-3 w-3 shrink-0" />
                            <span>{e.tools[0] ?? 'Harness event'}</span>
                        </p>
                    ) : (
                        <div className="group/msg space-y-1">
                            {e.speaker && (
                                <p className="font-mono text-ui-2xs uppercase tracking-widest text-zinc-500">{formatSeatLabel(e.speaker.split(':')[1] ?? e.speaker)}</p>
                            )}
                            <ChatWorkTimeline entry={e} />
                            <div className="text-ui-sm leading-5 text-zinc-200">
                                {shownText
                                    ? <FadingText text={shownText} streaming={!!e.streaming} />
                                    : null}
                            </div>
                            {shownText && !e.streaming && (
                                <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
                                    <CopyChip text={shownText} />
                                    {onToggleWatch && analysisId && pinnedMessageIds && (
                                        <PinChip pinned={pinnedMessageIds.has(analysisId)}
                                            onToggle={() => onToggleWatch(analysisId)} />
                                    )}
                                </div>
                            )}
                            {/* The one "what the AI remembered" row. Once the
                                answer has settled — an open stream is still
                                pulling injections in, so its window has no
                                upper bound yet. */}
                            {shownText && !e.streaming && !e.notice && (
                                <MemoryProvenanceStrip
                                    startedAt={e.at}
                                    nextAt={entries[i + 1]?.at}
                                    messageId={e.id}
                                />
                            )}
                            {verdict?.analysis && (
                                <VerdictAudit
                                    analysis={verdict.analysis}
                                    evidencePack={verdict.evidencePack}
                                    runContract={verdict.runContract}
                                    className="mt-1.5"
                                />
                            )}
                            {aiLevels && aiLevels.levels.length > 0 && !e.streaming && (
                                <KeyLevelsCard
                                    messageId={e.id}
                                    levels={aiLevels.levels}
                                    symbol={symbol}
                                    getMark={getMark}
                                    onChatLevels={onChatLevels}
                                />
                            )}
                            {e.proposal && !proposalStateOf(e.id) && (
                                <TradeProposalCard
                                    proposal={e.proposal}
                                    canLog={!!onLogProposedTrade}
                                    onLog={() => {
                                        // Double-log guard: the disposition lives at module
                                        // scope, so it survived even before this fix's second
                                        // half — the map lookup makes a re-click after a dock
                                        // unmount/remount (fresh component, same store entry)
                                        // a NO-OP instead of a second journal row.
                                        if (proposalDisposition.get(e.id)) return;
                                        onLogProposedTrade?.(e.proposal!);
                                        setProposalDisposition(e.id, 'logged');
                                        setProposalTick(t => t + 1);
                                    }}
                                    onCancel={() => { if (proposalDisposition.get(e.id)) return; setProposalDisposition(e.id, 'dismissed'); setProposalTick(t => t + 1); }}
                                />
                            )}
                            {e.proposal && proposalStateOf(e.id) === 'logged' && <TradeProposalLoggedRow />}
                        </div>
                    )}
                </div>
                );
            })}
        </>
    );
};

export default React.memo(ChatTranscriptList);

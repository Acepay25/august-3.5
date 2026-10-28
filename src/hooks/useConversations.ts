import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Conversation, Message, MessageRole } from '../types';
import { messageTraceText } from '../utils/traceText';
import {
    activeIndex,
    hasVersions,
    mergeParked,
    popParked,
    pushEdit,
    splitAt,
    stepIndex,
    versionCount,
    type PromptEdit,
    type TurnSnapshot,
} from '../utils/messageVersions';

// No cap on messages per conversation (owner ruling, 2026-10-27: "store
// everything"). There used to be a 200-message trim here, FIFO above the first
// row, justified by save latency and blob size — and it was a SILENT one: the
// 201st turn evicted an earlier exchange that later re-analyses could still be
// referencing, so the trader's history shortened without saying so. The whole
// messages array is re-serialised on the debounced save either way; that cost is
// now the owner's to accept rather than one this hook pays on their behalf.
// The one limit that remains on this path is the storage quota itself, and a
// refused write is reported (MemoryFilesService.getNotebookWriteFailure), not
// swallowed.

export function useConversations() {
    // Master state for all conversation data.
    const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    // Derived state for the active conversation.
    const activeConversation = useMemo(() =>
        conversationHistory.find(c => c.id === activeConversationId),
        [conversationHistory, activeConversationId]);

    const messages = activeConversation?.messages || [];

    // Ref to hold the latest messages for async access to prevent stale
    // closures. Assigned during render (not in a post-commit effect) so async
    // code reading it after an updateMessages call can never see the previous
    // array — the effect lag forced multiple in-file workarounds elsewhere
    // (matches the loggedTradesRef pattern in App).
    const messagesRef = useRef<Message[]>([]);
    messagesRef.current = messages;

    // Per-conversation selections. Provider enable/disable + per-provider model
    // selection now live in ProviderConfig (global, via useProviderConfigs).
    // The conversation only tracks the moderator provider/model and the vision model.
    const selectedOcrModel = activeConversation?.ocrModel || '';
    const moderatorProviderId = activeConversation?.moderatorProviderId || '';
    const moderatorModel = activeConversation?.moderatorModel || '';

    const updateMessages = useCallback((updater: (prevMessages: Message[]) => Message[], conversationId: string | null = activeConversationId) => {
        setConversationHistory(prevHistory => {
            return prevHistory.map(conv => {
                if (conv.id === conversationId) {
                    // Every turn the updater returns is kept. The trim that used
                    // to live here evicted the trader's own history; see the
                    // note at the top of this file.
                    return { ...conv, messages: updater(conv.messages) };
                }
                return conv;
            });
        });
    }, [activeConversationId]);

    const updateActiveConversation = useCallback((updater: (conv: Conversation) => Conversation) => {
        setConversationHistory(prev => prev.map(c =>
            c.id === activeConversationId ? updater(c) : c
        ));
    }, [activeConversationId]);

    const handleSetVisionModel = (modelId: string) => updateActiveConversation(c => ({ ...c, ocrModel: modelId }));
    const handleSetSelectedOcrModel = (id: string) => updateActiveConversation(c => ({ ...c, ocrModel: id }));

    /* ── Revert and versions ───────────────────────────────────────────────
       The rule lives on the CONVERSATION store, not in a surface. One
       conversation has two readers — the Agents surface and the Chart AI dock,
       joined by `entriesForSession` — and a revert applied inside one of them
       would appear and then be undone by the other's next merge. Here there is
       one writer, and both readers see the same thread.

       The counting and the list surgery are in `utils/messageVersions.ts`; this
       file only knows how a `Message` maps onto a generation. */

    /** A message's live fields, as one generation. */
    const snapshot = (m: Message): TurnSnapshot => ({
        text: m.text ?? '',
        reasoning: messageTraceText(m),
        processes: m.thoughtProcesses,
        tools: m.toolEvents ?? [],
        toolIds: m.toolIds ?? [],
        actions: m.toolActions ?? [],
        workedMs: typeof m.runStats?.durationMs === 'number' ? m.runStats.durationMs : undefined,
        effort: m.runStats?.effort,
        error: m.error,
        at: Number.isFinite(Date.parse(m.createdAt)) ? Date.parse(m.createdAt) : Date.now(),
    });

    /** Make a generation the live one. Everything a turn is made of travels
     *  with it — the answer, its trace, its tool trail and the ids that open
     *  the real payloads — so stepping between versions cannot show one
     *  answer's prose over another's work. */
    const withSnapshot = (m: Message, snap: TurnSnapshot): Message => ({
        ...m,
        text: snap.text,
        thoughtProcesses: snap.processes,
        toolEvents: snap.tools.length ? snap.tools : undefined,
        toolIds: snap.toolIds.length ? snap.toolIds : undefined,
        toolActions: snap.actions?.length ? snap.actions : undefined,
        error: snap.error,
        // The run ledger is the pipeline's own record; only the two numbers a
        // generation actually changes are rewritten, and a row that never had
        // one stays without one rather than gaining a fabricated stub.
        runStats: m.runStats
            ? { ...m.runStats, durationMs: snap.workedMs ?? m.runStats.durationMs, effort: snap.effort ?? m.runStats.effort }
            : m.runStats,
    });

    /** Take every turn AFTER `messageId` off the live thread and park it.
     *  Returns how many turns moved; 0 means nothing did, which is also the
     *  answer for a stale id — the thread is left intact rather than truncated
     *  on a bookkeeping miss. */
    const revertToMessage = useCallback((messageId: string): number => {
        let moved = 0;
        updateActiveConversation(conv => {
            const { keep, parked } = splitAt(conv.messages, messageId);
            if (!parked) return conv;
            moved = parked.rows.length;
            return { ...conv, messages: keep, parked: [...(conv.parked ?? []), parked] };
        });
        return moved;
    }, [updateActiveConversation]);

    /** Put the most recently parked tail back. A turn that has been re-run in
     *  the meantime is not duplicated — `mergeParked` drops the id it already
     *  has live. Returns the number of turns restored. */
    const restoreParkedTurns = useCallback((): number => {
        let back = 0;
        updateActiveConversation(conv => {
            const popped = popParked(conv.parked);
            if (!popped.rest) return conv;
            const merged = mergeParked(conv.messages, popped.rows);
            back = merged.length - conv.messages.length;
            return { ...conv, messages: merged, parked: popped.rest.length ? popped.rest : undefined };
        });
        return back;
    }, [updateActiveConversation]);

    /** Edit a prompt the trader already sent. The words they first sent are kept
     *  on the row, and the answer that grew from them becomes a generation of
     *  the SAME row rather than a second message — one question, its versions.
     *  Everything after it is parked by the same rule a revert uses, so the
     *  caller can re-run the edited question without the old thread trailing it.
     *
     *  Returns the superseded answer so the caller can hand it to the re-run. */
    const editMessageText = useCallback((messageId: string, newText: string): {
        ok: boolean; parked: number; prior: PromptEdit[];
    } => {
        let out = { ok: false, parked: 0, prior: [] as PromptEdit[] };
        updateActiveConversation(conv => {
            const idx = conv.messages.findIndex(m => m.id === messageId);
            if (idx < 0) return conv;
            const target = conv.messages[idx];
            if (target.role !== MessageRole.USER) return conv;   // only a prompt you sent
            const trimmed = newText.trim();
            if (!trimmed || trimmed === target.text) return conv; // nothing changed, nothing recorded
            const edits = pushEdit(target.edits, target.text, Date.now());
            const { keep, parked } = splitAt(
                conv.messages.map((m, i) => (i === idx ? { ...m, edits, text: trimmed } : m)),
                messageId,
            );
            out = { ok: true, parked: parked?.rows.length ?? 0, prior: edits };
            return {
                ...conv,
                messages: keep,
                parked: parked ? [...(conv.parked ?? []), parked] : conv.parked,
            };
        });
        return out;
    }, [updateActiveConversation]);

    /** Step the answer shown between the versions this row holds. */
    const stepMessageGeneration = useCallback((messageId: string, delta: number): void => {
        updateMessages(prev => prev.map(m => {
            if (m.id !== messageId || !hasVersions(m)) return m;
            const to = stepIndex(m, delta);
            const count = versionCount(m);
            const gens = m.gens ?? [];
            // The newest generation is the live row itself, so the last index
            // means "exchange whatever is parked for what is showing".
            const target = to === count - 1 ? snapshot(m) : gens[to];
            if (!target) return m;
            const nextGens = to === count - 1
                ? gens
                : gens.map((g, i) => (i === to ? snapshot(m) : g));
            return withSnapshot({ ...m, gens: nextGens }, { ...target, at: target.at });
        }));
    }, [updateMessages]);

    /** Whether a row can be stepped, so the host draws a stepper only where
     *  there is a choice to make. */
    const versionInfo = useCallback((m: Message) => ({
        show: hasVersions(m),
        index: activeIndex(m),
        total: versionCount(m),
    }), []);

    return {
        conversationHistory,
        setConversationHistory,
        activeConversationId,
        setActiveConversationId,
        activeConversation,
        messages,
        messagesRef,
        updateMessages,
        updateActiveConversation,
        selectedOcrModel,
        moderatorProviderId,
        moderatorModel,
        handleSetVisionModel,
        handleSetSelectedOcrModel,
        revertToMessage,
        restoreParkedTurns,
        editMessageText,
        stepMessageGeneration,
        versionInfo,
    };
}

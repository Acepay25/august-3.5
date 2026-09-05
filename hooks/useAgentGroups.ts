/**
 * useAgentGroups — runs a group ROOM (plan botmode-scan G2): Hermes
 * group-rounds semantics in-process. Round 1 = the @mentioned members
 * (@everyone/all = fan-out parity with the old single pass); each turn is
 * fed ONLY the room messages newer than what that member last saw; a
 * reply that @mentions teammates sets next round's speakers; replying
 * exactly "(pass)" is silence — no bubble, no room entry; a round with no
 * mentions settles the room. Bounded by ROOM_ROUND_CAP rounds and
 * ROOM_TURN_CAP model turns per send. Replies stream into their own
 * message attributed by modelsUsed[providerId] = modelId.
 *
 * The caller supplies message append/patch functions (App's
 * updateMessages) and the provider configs; the hook exposes the
 * activity entries ("X is working…", "✓ X replied", "○ X passed")
 * and the currently working bot id for the roster's active-now chip.
 */

import { useCallback, useRef, useState } from 'react';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import { ProviderConfig } from '../types/provider';
import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import { tryFetchHybridDataFromPromptWithCalibration } from '../services/analysis/HybridIntelligenceService';
import { AgentBot } from '../services/agents/agentRoster';
import { readBotSystemMarkdown, readBotMemoryMarkdown } from '../services/bots/BotMemoryService';
import {
    ROOM_HUMAN_LABEL,
    ROOM_ROUND_CAP,
    ROOM_TURN_CAP,
    buildRoomSystemPrompt,
    couldStillBePass,
    isPassReply,
    parseRoomMentions,
    renderRoomTurn,
    type RoomEntry,
} from '../services/agents/groupRounds';

export interface GroupActivityEntry {
    id: string;
    kind: 'sent' | 'working' | 'replied' | 'passed';
    botName?: string;
    at: number;
    detail?: string;
}

const isProviderReady = (p: ProviderConfig): boolean =>
    p.isEnabled && p.apiKey.trim().length > 0 && p.models.length > 0;

export interface UseAgentGroupsResult {
    workingBotId: string | null;
    isRunning: boolean;
    activity: GroupActivityEntry[];
    runGroupThread: (group: { id: string; memberIds: string[] }, prompt: string, bots: AgentBot[]) => Promise<void>;
    /** Abort the in-flight room round: streams are aborted, the loop stops
     *  at the next member boundary, and partial bubbles are marked done. */
    cancelRun: () => void;
}

export const useAgentGroups = ({
    providerConfigs,
    appendMessage,
    patchMessage,
    username,
    /** Hybrid Intelligence (R54): when ON, live market data is fetched once
     *  per send (symbol detected from the prompt) and the enhanced packet
     *  injection is added to EVERY member's system prompt — the whole room
     *  reasons over the same live read, not just the debate pipeline. */
    hybridEnabled = false,
}: {
    providerConfigs: ProviderConfig[];
    appendMessage: (msg: Message) => void;
    patchMessage: (id: string, patch: Partial<Message>) => void;
    /** Active profile — enables per-bot persona/notes in room turns. */
    username?: string | null;
    hybridEnabled?: boolean;
}): UseAgentGroupsResult => {
    const [workingBotId, setWorkingBotId] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [activity, setActivity] = useState<GroupActivityEntry[]>([]);
    const runNonce = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const pushActivity = useCallback((entry: Omit<GroupActivityEntry, 'id' | 'at'>) => {
        setActivity(prev => [...prev, { ...entry, id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }]);
    }, []);
    const pushActivityRef = useRef(pushActivity);
    pushActivityRef.current = pushActivity;

    /** User-facing cancel: a stale nonce makes every subsequent turn
     *  bail (the `runNonce.current !== nonce` guards), the in-flight
     *  stream's AbortController is fired, and the room settles. */
    const cancelRun = useCallback(() => {
        runNonce.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        setWorkingBotId(null);
        setIsRunning(false);
        pushActivityRef.current({ kind: 'passed', botName: 'Room', detail: 'cancelled' });
    }, []);

    const runGroupThread = useCallback(async (group: { id: string; memberIds: string[] }, prompt: string, bots: AgentBot[]): Promise<void> => {
        const trimmed = prompt.trim();
        if (!trimmed || group.memberIds.length === 0) return;
        const nonce = ++runNonce.current;

        const members = group.memberIds
            .map(id => bots.find(b => b.id === id))
            .filter((b): b is AgentBot => Boolean(b));
        if (members.length === 0) return;

        // Round 1 speakers: @mention routing (Hermes's deterministic parse
        // — name/title/no-space forms + @everyone). No mention = the old
        // fan-out (every member speaks once), which keeps single-pass
        // behavior byte-identical for plain prompts.
        const mentioned = parseRoomMentions(trimmed, members);
        let speakers: AgentBot[] = mentioned.length > 0 ? mentioned : members;

        // The prompt lands once as the thread opener.
        appendMessage({
            id: `usr-${Date.now()}`,
            role: MessageRole.USER,
            text: trimmed,
            createdAt: new Date().toISOString(),
            roomId: group.id,
        });
        pushActivity({ kind: 'sent' });
        setIsRunning(true);
        const abort = new AbortController();
        abortRef.current = abort;

        // Hybrid Intelligence for the room (R54): fetched ONCE per send,
        // injected into EVERY member's system prompt — the whole room
        // shares the same live market read. Silent fallback to plain
        // prompts when the symbol can't be detected or the fetch fails.
        let hybridInjection = '';
        if (hybridEnabled) {
            try {
                const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(trimmed);
                if (runNonce.current !== nonce) return;
                if (hybridResult) hybridInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
            } catch { /* offline / no symbol — the room runs without live data */ }
        }

        // The room log: everything said so far. Each member tracks the
        // index it last saw — a turn is fed ONLY the newer entries (this
        // is what makes multi-round cheap, Hermes group-rounds parity).
        const room: RoomEntry[] = [{ speaker: ROOM_HUMAN_LABEL, text: trimmed }];
        const lastSeen = new Map<string, number>();
        let turns = 0;

        try {
            for (let round = 1; round <= ROOM_ROUND_CAP && speakers.length > 0; round++) {
                const nextSpeakers = new Map<string, AgentBot>();
                for (const bot of speakers) {
                    if (runNonce.current !== nonce) return;
                    if (turns >= ROOM_TURN_CAP) {
                        pushActivity({ kind: 'passed', botName: bot.name, detail: 'turn budget' });
                        continue;
                    }
                    const provider = providerConfigs.find(p => p.id === bot.providerId);
                    if (!provider || !isProviderReady(provider) || !provider.models.includes(bot.modelId)) {
                        pushActivity({ kind: 'passed', botName: bot.name, detail: 'provider offline' });
                        continue;
                    }
                    turns++;

                    setWorkingBotId(bot.id);
                    pushActivity({ kind: 'working', botName: bot.name });

                    const unseen = room.slice(lastSeen.get(bot.id) ?? 0);
                    // Advance BEFORE the turn: the member's own reply is
                    // pushed to the room after this point, so it lands in
                    // the NEXT window (rendered "You:") — the model sees
                    // what it said, never the prompt twice.
                    lastSeen.set(bot.id, room.length);
                    const system = buildRoomSystemPrompt(bot, {
                        persona: username ? readBotSystemMarkdown(bot.id) : null,
                        notes: username ? readBotMemoryMarkdown(bot.id) : null,
                        members,
                    }) + (hybridInjection ? `\n\n${hybridInjection}` : '');

                    const config = { ...provider, selectedModel: bot.modelId };
                    const replyId = `grp-${Date.now()}-${bot.id}-${round}`;
                    appendMessage({
                        id: replyId,
                        role: MessageRole.AI,
                        text: '',
                        createdAt: new Date().toISOString(),
                        modelsUsed: { [provider.id]: bot.modelId },
                        isStreaming: true,
                        roomId: group.id,
                    });

                    let visible = '';
                    let lastFlush = 0;
                    try {
                        const responseText = await streamQuickResponse(
                            config,
                            renderRoomTurn(bot.name, unseen),
                            [],
                            system,
                            abort.signal,
                            undefined,
                            delta => {
                                visible += delta;
                                // A pure "(pass)" must never render — hold
                                // the bubble empty while it could still be.
                                if (couldStillBePass(visible)) return;
                                const now = Date.now();
                                if (now - lastFlush > 120) {
                                    lastFlush = now;
                                    patchMessage(replyId, { text: visible });
                                }
                            },
                        );
                        if (runNonce.current !== nonce) return;
                        const finalText = responseText || visible;
                        if (isPassReply(finalText)) {
                            // Silence is a first-class outcome: no bubble,
                            // no room entry — just the activity feed.
                            patchMessage(replyId, { text: '', isStreaming: false, hidden: true });
                            pushActivity({ kind: 'passed', botName: bot.name });
                        } else {
                            patchMessage(replyId, { text: finalText, isStreaming: false });
                            room.push({ speaker: bot.name, text: finalText });
                            pushActivity({ kind: 'replied', botName: bot.name });
                            // Deterministic routing: mentions in this reply
                            // speak next round (self-excluded; no echo loop).
                            for (const t of parseRoomMentions(finalText, members)) {
                                if (t.id !== bot.id) nextSpeakers.set(t.id, t);
                            }
                        }
                    } catch (error) {
                        if (runNonce.current === nonce) {
                            const aborted = abort.signal.aborted;
                            // The transport already mapped the raw failure to a
                            // user-safe message (toFriendlyProviderError) — show
                            // WHY the turn died instead of a generic
                            // "provider error" that leaves the user guessing.
                            const rawReason = error instanceof Error ? error.message.trim() : '';
                            const reason = rawReason
                                ? /[.!?]$/.test(rawReason) ? rawReason.slice(0, 160) : `${rawReason.slice(0, 160)}.`
                                : 'provider error';
                            patchMessage(replyId, {
                                text: aborted
                                    ? (visible ? `${visible}\n\n(cancelled)` : '')
                                    : (visible
                                        ? `${visible}\n\n(failed: ${reason})`
                                        : `(${bot.name} could not reply — ${reason})`),
                                isStreaming: false,
                                hidden: aborted && !visible,
                            });
                            if (!aborted) pushActivity({ kind: 'passed', botName: bot.name, detail: reason });
                        }
                    }
                }
                // A round where nobody was addressed = the room settled.
                speakers = [...nextSpeakers.values()];
            }
        } finally {
            if (abortRef.current === abort) abortRef.current = null;
            if (runNonce.current === nonce) {
                setWorkingBotId(null);
                setIsRunning(false);
            }
        }
    }, [providerConfigs, appendMessage, patchMessage, pushActivity, username, hybridEnabled]);

    return { workingBotId, isRunning, activity, runGroupThread, cancelRun };
};

export default useAgentGroups;

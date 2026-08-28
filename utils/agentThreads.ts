/**
 * agentThreads — per-agent 1:1 threads as a VIEW over the single flat
 * conversation array. No new storage: a provider's thread is derived
 * from the messages the provider actually participated in.
 *
 * Attribution rules:
 *  - An AI message belongs to provider P when `modelsUsed` contains
 *    exactly P as its only key — that's the single-model reply path
 *    (streamQuickResponse sets `modelsUsed: { [provider.id]: model }`).
 *    Ensemble/debate messages (multiple providers) stay in the Team
 *    thread and do not leak into every participant's 1:1.
 *  - A user message belongs to the thread of the AI reply that follows
 *    it (prompts are carried by the reply they produced). Leading user
 *    messages with no reply yet are not attributable and stay in Team.
 *  - A system message inherits the thread attribution of the message
 *    before it (it happened "during" that conversation slice).
 *
 * The roster (last-message preview + unread count) is derived from the
 * same walk, so the rail and the thread view can never disagree.
 */

import { MessageRole } from '../types/enums';
import { Message } from '../types/message';

/** 'team' selects the unfiltered conversation (debates etc.). */
export type ThreadSelection = { kind: 'team' } | { kind: 'provider'; providerId: string };

/**
 * Derive the per-agent thread slice for one provider. Returns the
 * messages in conversation order (a subset of the input array —
 * same object identities, so memoization downstream stays cheap).
 */
export const threadForProvider = (messages: Message[], providerId: string): Message[] => {
    const out: Message[] = [];
    // Prompts waiting for the next AI reply that claims them.
    let pendingUser: Message[] = [];
    let pendingSystem: Message[] = [];
    for (const m of messages) {
        if (m.role === MessageRole.USER) {
            pendingUser.push(m);
            continue;
        }
        if (m.role === MessageRole.SYSTEM) {
            // System rows ride along with whatever slice is open: they
            // flush into our thread if the next AI reply is ours, and
            // drop if it belongs to another provider.
            pendingSystem.push(m);
            continue;
        }
        // AI message: single-provider replies claim the pending prompts.
        const keys = m.modelsUsed ? Object.keys(m.modelsUsed) : [];
        if (keys.length === 1 && keys[0] === providerId) {
            out.push(...pendingUser, ...pendingSystem, m);
            pendingUser = [];
            pendingSystem = [];
        } else {
            // Ensemble reply (or someone else's 1:1) — the prompts it
            // answered belong to that other thread; drop them here.
            pendingUser = [];
            pendingSystem = [];
        }
    }
    // Trailing prompts with no reply yet: attribute to no agent thread
    // (they surface in Team so the trader never loses a draft's reply).
    return out;
};

export interface AgentThreadPreview {
    /** Last message in the agent's thread (may be the agent's or the trader's). */
    lastMessage: Message | null;
    /** ISO timestamp of the last thread message, for the rail's relative time. */
    lastAt: string | null;
    /** One-line plain-text preview of the last message. */
    previewText: string;
}

/** Plain-text preview of a message for the roster row. */
export const previewTextFor = (m: Message): string => {
    const raw = (m.text || '').trim();
    if (raw) return raw.replace(/\s+/g, ' ').slice(0, 90);
    if (m.analysis) return `Analysis · ${m.analysis.coinName ?? 'setup'}`;
    if (m.isDebating || (m.debateTurns && m.debateTurns.length > 0)) return 'Debate transcript';
    return '';
};

/** Roster preview for one provider: last thread message + text. */
export const threadPreview = (messages: Message[], providerId: string): AgentThreadPreview => {
    const thread = threadForProvider(messages, providerId);
    const lastMessage = thread.length > 0 ? thread[thread.length - 1] : null;
    return {
        lastMessage,
        lastAt: lastMessage?.createdAt ?? null,
        previewText: lastMessage ? previewTextFor(lastMessage) : '',
    };
};

/**
 * Unread count for one provider: AI messages in the thread newer than
 * the last time the trader opened that thread. `lastOpenedAt` is an
 * ISO timestamp (absent = never opened → everything unread, capped).
 */
export const unreadCount = (
    messages: Message[],
    providerId: string,
    lastOpenedAt: string | null | undefined,
): number => {
    const thread = threadForProvider(messages, providerId);
    if (thread.length === 0) return 0;
    const openedMs = lastOpenedAt ? Date.parse(lastOpenedAt) : NaN;
    if (Number.isNaN(openedMs)) {
        // Never opened: count the recent tail, not the whole history.
        return Math.min(thread.filter(m => m.role === MessageRole.AI).length, 9);
    }
    return thread.filter(
        m => m.role === MessageRole.AI && Date.parse(m.createdAt) > openedMs,
    ).length;
};

/** Per-provider last-opened timestamps, persisted via PreferencesService. */
export type AgentThreadOpenedMap = Record<string, string>;

/** Mark a thread opened now (returns the next map; caller persists). */
export const markThreadOpened = (map: AgentThreadOpenedMap, providerId: string): AgentThreadOpenedMap => ({
    ...map,
    [providerId]: new Date().toISOString(),
});

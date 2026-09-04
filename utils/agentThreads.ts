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

/** Which conversation surface is open. 'bot' = a named bot's 1:1;
 *  'group' = a bot group room (also the debate room — the Team merged
 *  into groups); 'coach' = the learning inbox (skill drafts + queue
 *  proposals). */
export type ThreadSelection =
    | { kind: 'bot'; botId: string }
    | { kind: 'group'; groupId: string }
    | { kind: 'coach' };

/**
 * Derive the per-agent thread slice for one provider — optionally
 * scoped to an exact model (a bot's model), so two bots on one
 * provider with different models keep separate threads. Returns the
 * messages in conversation order (a subset of the input array —
 * same object identities, so memoization downstream stays cheap).
 */
export const threadForProvider = (messages: Message[], providerId: string, modelId?: string): Message[] => {
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
            // An attributed system row (a failed reply's error bubble) is
            // claimable: it belongs to the thread whose provider/model it
            // names, so the failure surfaces inside that thread.
            const sysKeys = m.modelsUsed ? Object.keys(m.modelsUsed) : [];
            if (sysKeys.length === 1 && sysKeys[0] === providerId
                && (!modelId || m.modelsUsed?.[sysKeys[0]] === modelId)) {
                out.push(...pendingUser, ...pendingSystem, m);
                pendingUser = [];
                pendingSystem = [];
                continue;
            }
            // Unattributed system rows ride along with whatever slice is
            // open: they flush into our thread if the next AI reply is
            // ours, and drop if it belongs to another provider.
            pendingSystem.push(m);
            continue;
        }
        // AI message: single-provider replies claim the pending prompts.
        const keys = m.modelsUsed ? Object.keys(m.modelsUsed) : [];
        const model = keys.length === 1 ? m.modelsUsed?.[keys[0]] : undefined;
        const mine = keys.length === 1
            && keys[0] === providerId
            && (!modelId || model === modelId);
        if (mine) {
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

/** A group member's claim key: provider + the bot's exact model. */
export interface GroupMemberKey {
    providerId: string;
    modelId: string;
}

/**
 * Derive a group's slice: prompts + replies from ANY member bot
 * (matched by provider+model). Unlike 1:1 threads, trailing prompts
 * are KEPT — a just-sent prompt with replies still streaming renders
 * as an open thread ("X is thinking…").
 */
export const threadForGroup = (messages: Message[], members: GroupMemberKey[]): Message[] => {
    const out: Message[] = [];
    let pendingUser: Message[] = [];
    for (const m of messages) {
        if (m.role === MessageRole.USER) {
            pendingUser.push(m);
            continue;
        }
        if (m.role === MessageRole.SYSTEM) {
            // Attributed system rows (failed replies) claim like member
            // replies so the error lands inside the group thread.
            const sysKeys = m.modelsUsed ? Object.keys(m.modelsUsed) : [];
            const sysMine = sysKeys.length === 1 && members.some(
                mem => sysKeys[0] === mem.providerId && (!mem.modelId || m.modelsUsed?.[sysKeys[0]] === mem.modelId),
            );
            if (sysMine) {
                out.push(...pendingUser, m);
                pendingUser = [];
            }
            continue;
        }
        const keys = m.modelsUsed ? Object.keys(m.modelsUsed) : [];
        const mine = keys.length === 1 && members.some(
            mem => keys[0] === mem.providerId && (!mem.modelId || m.modelsUsed?.[keys[0]] === mem.modelId),
        );
        if (mine) {
            out.push(...pendingUser, m);
            pendingUser = [];
        } else if (pendingUser.length > 0) {
            // A non-member replied first — the prompts belonged to it.
            pendingUser = [];
        }
    }
    return [...out, ...pendingUser];
};

export interface GroupThread {
    prompt: Message;
    /** Member replies in arrival order. */
    replies: Message[];
}

/** Split a group slice into threads: each user prompt opens one. */
export const splitGroupThreads = (slice: Message[]): GroupThread[] => {
    const threads: GroupThread[] = [];
    let current: GroupThread | null = null;
    for (const m of slice) {
        if (m.role === MessageRole.USER) {
            current = { prompt: m, replies: [] };
            threads.push(current);
        } else {
            if (!current) {
                // Replies before any prompt (legacy slice) — synthesize a headless thread.
                current = { prompt: m, replies: [] };
                threads.push(current);
            }
            current.replies.push(m);
        }
    }
    return threads;
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
 * `modelId` scopes to an exact model (a bot's model) — same semantics
 * as threadForProvider.
 */
export const unreadCount = (
    messages: Message[],
    providerId: string,
    lastOpenedAt: string | null | undefined,
    modelId?: string,
): number => {
    const thread = threadForProvider(messages, providerId, modelId);
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

/**
 * Unread count over an already-derived thread slice (bots use
 * unreadCount; groups need the same math over threadForGroup output).
 * Absent `lastOpenedAt` = never opened → recent tail, capped at 9.
 */
export const unreadInSlice = (
    slice: Message[],
    lastOpenedAt: string | null | undefined,
): number => {
    const ai = slice.filter(m => m.role === MessageRole.AI);
    if (ai.length === 0) return 0;
    const openedMs = lastOpenedAt ? Date.parse(lastOpenedAt) : NaN;
    if (Number.isNaN(openedMs)) return Math.min(ai.length, 9);
    return ai.filter(m => Date.parse(m.createdAt) > openedMs).length;
};

// ─── last-opened persistence (plan §10.1 unread badges) ────────────────────

const openedKey = (username: string): string =>
    `agent_threads_opened_v1_${(username || 'default').trim() || 'default'}`;

/** Load the per-thread last-opened map for a user ({} when none). */
export const loadThreadOpenedMap = (username: string): AgentThreadOpenedMap => {
    try {
        const raw = localStorage.getItem(openedKey(username));
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed as AgentThreadOpenedMap : {};
    } catch {
        return {};
    }
};

export const saveThreadOpenedMap = (username: string, map: AgentThreadOpenedMap): void => {
    try {
        localStorage.setItem(openedKey(username), JSON.stringify(map));
    } catch { /* best-effort */ }
};

/**
 * ToolAction ledger helpers (R54) — pure message transforms so every
 * writer (pipeline, post-mortem, quick-save) appends with the SAME
 * semantics: append-only, capped, immutable copies.
 */

import { Message, ToolAction } from '../types/message';

/** Hard cap per message — the ledger is a digest, not an audit dump. */
export const MAX_TOOL_ACTIONS = 50;

/** Append actions to one message's ledger (no-op when not found). */
export const appendToolActions = (
    messages: Message[],
    messageId: string,
    actions: ToolAction[],
): Message[] => {
    if (actions.length === 0) return messages;
    let touched = false;
    const next = messages.map(m => {
        if (m.id !== messageId) return m;
        touched = true;
        return { ...m, toolActions: [...(m.toolActions ?? []), ...actions].slice(-MAX_TOOL_ACTIONS) };
    });
    return touched ? next : messages;
};

/** Timestamp helper — one clock read per batch. */
export const toolActionStamp = (): string => new Date().toISOString();

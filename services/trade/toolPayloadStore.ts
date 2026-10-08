/**
 * toolPayloadStore — the real bytes behind a collapsed tool row, kept so
 * expanding the row shows what the tool actually returned.
 *
 * THE PROBLEM. The transcript stores one human LINE per tool call
 * (`StoredChatEntry.tools`: "order book · buy wall at 88k"). That line is a
 * digest built for a model's prompt, sized for a budget — not the result. So the
 * row that says a tool ran cannot show what it returned, and the one place the
 * full output did exist (`toolArtifactStore`) is IN MEMORY, TTL'd to 30 minutes
 * and cleared at every debate start. After a reload there is nowhere to look.
 *
 * WHY A SIDE STORE AND NOT A FIELD ON THE ENTRY. `EXPORT_KEY_CAPS` caps
 * `trade_chat_sessions_v1` at 512 KB and sweeps the WHOLE key when it is over —
 * that is a ceiling on what a BACKUP may carry, and the live bytes are left
 * alone. Putting 8,000-char payloads inside entries would push the transcripts
 * themselves out of every backup: a tool-heavy session would trade its own
 * conversation for its own tool output. Separate key, separate cap.
 *
 * THE ONE RULE. Refuse growth, never evict (`utils/memoryBudget.ts`' doctrine):
 * at the ceiling the NEWEST payload is refused and every byte already saved is
 * kept. Nothing here is regenerable — an order book from an hour ago cannot be
 * re-fetched as the same fact — so eviction would be silent data loss dressed as
 * housekeeping. A refused write is RECORDED and surfaced, because a caller that
 * catches-and-logs turns memory loss into an invisible state.
 */

import type { ToolPayload } from '../analysis/DeskToolsService';

/** Chars kept per payload. Matches `readToolArtifact`'s page ceiling
 *  (`toolArtifactStore.ts`): one page is one payload, so a row expands onto the
 *  same slice a seat would have paged. */
export const MAX_PAYLOAD_CHARS = 8_000;

/** Total chars across all payloads for one user. */
export const MAX_PAYLOAD_TOTAL_CHARS = 1_000_000;

export interface StoredToolPayload {
    toolCallId: string;
    name: string;
    label: string;
    ok: boolean;
    artifact: string | null;
    kept?: number;
    total?: number;
    text: string;
    /** Epoch-ms, for a stable oldest-first order when the budget is refused. */
    at: number;
}

/** What went wrong when a payload could not be kept. Modelled on
 *  `MemoryFilesService.getNotebookWriteFailure`: a sticky record, because the
 *  alternative is a `console.warn` inside a streaming loop that nobody reads and
 *  that turns lost bytes into an invisible state. */
export interface PayloadWriteFailure {
    kind: 'quota' | 'budget' | 'error';
    /** Bytes this write wanted to store. */
    bytes: number;
    at: number;
    message?: string;
}

const keyFor = (user: string): string => `trade_tool_payloads_v1_${user}`;

const activeUser = (): string => {
    // Same fallback as the rest of the app's per-user stores: `utils/activeUser`
    // publishes 'last_active_user' and defaults to 'default'.
    return (typeof localStorage !== 'undefined' && localStorage.getItem('last_active_user')) || 'default';
};

let failure: PayloadWriteFailure | null = null;

/** The last payload write that could not be kept, or null. STICKY: it survives
 *  until a later write succeeds, so a UI can say "the last N results were not
 *  kept" instead of showing rows that silently have nothing behind them. */
export const getPayloadWriteFailure = (): PayloadWriteFailure | null => failure;

const recordFailure = (next: PayloadWriteFailure): void => { failure = next; };

const clearFailure = (): void => { failure = null; };

const readAll = (user: string): StoredToolPayload[] => {
    try {
        const raw = localStorage.getItem(keyFor(user));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Defensive: a corrupt row is dropped rather than throwing, because this
        // is called from inside a streaming loop where a throw would take the
        // transcript write down with it.
        return parsed.filter((p): p is StoredToolPayload =>
            !!p && typeof p === 'object' && typeof (p as StoredToolPayload).toolCallId === 'string');
    } catch {
        return [];
    }
};

const writeAll = (user: string, payloads: StoredToolPayload[]): void => {
    localStorage.setItem(keyFor(user), JSON.stringify(payloads));
};

/**
 * Persist one tool call's real output. Returns true when it is kept.
 *
 * A THROWING `setItem` is the specific hazard here: this runs once per tool call
 * inside a streaming loop, and a bare `console.warn` on failure is the exact
 * silent hole `saveSessions` still has. So a storage error is caught, RECORDED,
 * and rethrown to the caller's existing handler — the transcript write must
 * never be collateral damage, but the loss must never be invisible either.
 */
export const saveToolPayload = (payload: ToolPayload, now = Date.now()): boolean => {
    const user = activeUser();
    // Cap the text here rather than trusting the caller: `budgetToolContent`
    // already clips most results, but a forged tool's output is not its business.
    const text = payload.text.length > MAX_PAYLOAD_CHARS ? payload.text.slice(0, MAX_PAYLOAD_CHARS) : payload.text;
    const stored: StoredToolPayload = {
        toolCallId: payload.toolCallId,
        name: payload.name,
        label: payload.label,
        ok: payload.ok,
        artifact: payload.artifact,
        ...(payload.kept !== undefined ? { kept: payload.kept } : {}),
        ...(payload.total !== undefined ? { total: payload.total } : {}),
        text,
        at: now,
    };

    try {
        const all = readAll(user);
        // Newest last. A repeat id replaces in place rather than appending —
        // a retried call has one payload, not two.
        const existing = all.findIndex(p => p.toolCallId === stored.toolCallId);
        const next = existing >= 0 ? all.map((p, i) => (i === existing ? stored : p)) : [...all, stored];

        // REFUSE, never evict: drop THIS payload (the newest) when the budget is
        // already spent. Every byte already saved stays saved.
        const total = next.reduce((n, p) => n + p.text.length, 0);
        if (total > MAX_PAYLOAD_TOTAL_CHARS) {
            const withoutNewest = existing >= 0 ? all : next.slice(0, -1);
            const after = withoutNewest.reduce((n, p) => n + p.text.length, 0);
            if (after > MAX_PAYLOAD_TOTAL_CHARS) {
                // Even the current set is over — keep it exactly as it is. A
                // store that refuses at high-water must not then start deleting.
                recordFailure({ kind: 'budget', bytes: text.length, at: now });
                return false;
            }
            recordFailure({
                kind: 'budget',
                bytes: text.length,
                at: now,
                message: `payload store is at its ${MAX_PAYLOAD_TOTAL_CHARS}-char ceiling`,
            });
            writeAll(user, withoutNewest);
            return false;
        }

        writeAll(user, next);
        clearFailure();
        return true;
    } catch (e) {
        // Quota or private mode. Record it so the row can say so honestly, then
        // rethrow: the caller's own handler decides whether this is fatal, and
        // swallowing here is how a store fails with a full cache and no signal.
        recordFailure({
            kind: 'quota',
            bytes: text.length,
            at: now,
            message: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
};

/** The payload behind one tool call, or null when it was never kept. */
export const readToolPayload = (toolCallId: string): StoredToolPayload | null =>
    readAll(activeUser()).find(p => p.toolCallId === toolCallId) ?? null;

/** Every payload for the active user, oldest first. */
export const listToolPayloads = (): StoredToolPayload[] => readAll(activeUser());

/** Total chars currently stored — what a Health-style surface would report. */
export const payloadStoreSize = (): number => listToolPayloads().reduce((n, p) => n + p.text.length, 0);

/** Clear every payload for the active user. */
export const clearToolPayloads = (): void => {
    try { localStorage.removeItem(keyFor(activeUser())); } catch { /* nothing to clear */ }
};

/** Test seam: forget the sticky failure. */
export const __clearPayloadFailureForTests = (): void => { failure = null; };

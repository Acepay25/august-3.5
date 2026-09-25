/**
 * chatStore — the Chart AI dock's session state, hoisted OUT of React so an
 * in-flight answer survives a surface switch. The trade surface is mounted
 * only while its tab is active, so a plain useState panel would unmount (and
 * its unmount-cleanup abort) the moment the user glanced at the Journal — the
 * stream died mid-sentence. Living in a module singleton instead: the run
 * keeps streaming into the store while the panel is gone, and remounting
 * re-subscribes to the SAME live entries (streaming text resumes on screen).
 *
 * Also owns the per-session AbortControllers (so switching tabs never aborts
 * another session's run — only an explicit Stop or deleting a session does),
 * the debounced persistence into chatSessions (streaming flags stripped, so a
 * half-finished answer is never written to storage), and the HARNESS SIGNAL
 * QUEUE: level-watch price events land here, not in a component ref, so a hit
 * that arrives while a run is busy — or while the dock is unmounted — is
 * never dropped; the panel flushes the queue when the session goes idle.
 *
 * Persistence is user-scoped and honest about it: the store remembers WHICH
 * user it loaded for and refuses to write the previous user's chats into the
 * newly active user's key — a detected switch rehydrates from the new key
 * instead. A `storage` listener keeps two windows of the same user from
 * silently clobbering each other (refresh when idle; a live stream wins).
 */

import {
    ChatSession, StoredChatEntry, createSession, loadSessions, saveSessions, storageKey,
} from './chatSessions';
import { getActiveUsername, LAST_ACTIVE_USER_KEY } from '../../utils/activeUser';
import type { TradeProposal } from './proposedTrade';

/** A trade currently open in this session (logged but not yet resolved by
 *  the outcome autopilot). The model context loader in useAnalysisPipeline
 *  can consult this so the chat session sees which of its recommendations are
 *  still in flight. Runtime-only — never persisted (reset on rehydrate). */
export interface OpenTradeRow {
    tradeId: string;
    symbol: string;
    direction: string;
    entry: string;
    stopLoss: string;
    takeProfits: string[];
    openedAt: string;
}

/** Stored entry + the non-persisted streaming flag for the in-flight answer. */
export type LiveEntry = StoredChatEntry & {
    streaming?: boolean;
    /** A trade the model PRESENTED via the present_trade tool — the dock
     *  renders it as a card with Log-this-trade / Cancel. Not persisted. */
    proposal?: TradeProposal;
};
export type LiveSession = Omit<ChatSession, 'entries'> & {
    entries: LiveEntry[];
    /** Trades logged from this session whose outcome has not yet resolved.
     *  Cleared when the autopilot (or manual flow) closes the trade. */
    openTrades?: Record<string, OpenTradeRow>;
    /** Chronological list of trade ids ever logged from this session — the
     *  model context loader's channel for "do you remember your last
     *  recommendation?" even after the trade has resolved. */
    loggedTradeIds?: string[];
};

/** The immutable snapshot React reads via useSyncExternalStore. `running` is
 *  the set of session ids with a live stream, so the composer knows what's
 *  busy without a second subscription. `signals` is the pending harness
 *  signal queue (see takeHarnessSignals). */
export interface ChatSnapshot {
    sessions: LiveSession[];
    activeId: string;
    running: Record<string, true>;
    signals: string[];
}

let sessions: LiveSession[] = [];
let activeId = '';
let loaded = false;
/** The user the in-memory sessions were loaded for — the persist guard's
 *  anchor. Writing while this differs from getActiveUsername() would leak
 *  one user's chats into another's storage key. */
let loadedFor = '';
let pendingSignals: string[] = [];
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let saveTimer = 0;
let storageWatched = false;

let snapshot: ChatSnapshot = { sessions, activeId, running: {}, signals: [] };

/** Last-open session id, per user — so a reload returns to the same chat. */
const activeKey = (user: string): string => `trade_chat_active_v1_${user}`;

const rebuild = (): void => {
    const running: Record<string, true> = {};
    for (const id of controllers.keys()) running[id] = true;
    snapshot = { sessions, activeId, running, signals: pendingSignals };
};

const emit = (): void => {
    rebuild();
    for (const l of listeners) l();
    schedulePersist();
};

/** Persist the settled transcript. An entry that is still streaming is
 *  EXCLUDED from the write (a half-finished answer must never land) but does
 *  NOT block the rest — previously one stuck `streaming:true` bubble (a seat
 *  that threw after partial text, or an aborted full-analysis) silently
 *  re-armed this timer forever and froze EVERY session's persistence until
 *  reload. */
const schedulePersist = (): void => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        if (getActiveUsername() !== loadedFor) { rehydrate(); return; }
        const stored: ChatSession[] = sessions.map(s => ({
            ...s,
            entries: s.entries
                .filter(e => !e.streaming)
                .map(({ streaming: _streaming, proposal: _proposal, ...rest }) => rest),
            // openTrades / loggedTradeIds are runtime-only — persisted sessions
            // never carry them (a reload means "we have no live trade state"),
            // so strip them defensively here even though chatSessions.ts also
            // doesn't write them out.
            openTrades: undefined,
            loggedTradeIds: undefined,
        }));
        saveSessions(stored);
        // The last-open session rides the same debounce — reopening the app
        // (or the Trade surface) lands back in this session, with its chart
        // setup, model and effort restored from the session row itself.
        try { localStorage.setItem(activeKey(loadedFor), activeId); } catch { /* private mode */ }
    }, 400);
};

/** Load the CURRENT user's sessions into memory and notify subscribers. */
const rehydrate = (): void => {
    loadedFor = getActiveUsername();
    const stored = loadSessions();
    sessions = stored.length > 0 ? stored : [createSession()];
    let wanted = '';
    try { wanted = localStorage.getItem(activeKey(loadedFor)) || ''; } catch { /* private mode */ }
    activeId = sessions.some(s => s.id === wanted) ? wanted : sessions[0].id;
    rebuild();
    for (const l of listeners) l();
};

const ensureLoaded = (): void => {
    if (loaded) return;
    loaded = true;
    rehydrate();
    if (!storageWatched && typeof window !== 'undefined') {
        storageWatched = true;
        window.addEventListener('storage', ev => {
            if (!loaded) return;
            // Another window switched users → adopt the new key's chats.
            if (ev.key === LAST_ACTIVE_USER_KEY) {
                if (getActiveUsername() !== loadedFor) rehydrate();
                return;
            }
            // Another window wrote THIS user's chats → refresh, but only
            // while nothing is streaming here (the live transcript wins).
            if (ev.key === storageKey() && getActiveUsername() === loadedFor
                && !sessions.some(s => controllers.has(s.id))) {
                rehydrate();
            }
        });
    }
};

export const subscribe = (fn: () => void): (() => void) => {
    ensureLoaded();
    listeners.add(fn);
    return () => { listeners.delete(fn); };
};

export const getSnapshot = (): ChatSnapshot => {
    ensureLoaded();
    return snapshot;
};

export const getActiveId = (): string => { ensureLoaded(); return activeId; };

export const setActiveId = (id: string): void => {
    ensureLoaded();
    if (id === activeId) return;
    activeId = id;
    emit();
};

/** Append a fresh session and (optionally) make it active. Returns its id. */
export const addSession = (partial: Partial<LiveSession> = {}, activate = true): string => {
    ensureLoaded();
    const fresh: LiveSession = { ...createSession(), ...partial, entries: partial.entries ?? [] };
    sessions = [...sessions, fresh];
    if (activate) activeId = fresh.id;
    emit();
    return fresh.id;
};

/** Delete a session; aborts its in-flight run (a real teardown, unlike a
 *  tab switch). Keeps at least one session alive. Returns the new active id. */
export const removeSession = (id: string): string => {
    ensureLoaded();
    controllers.get(id)?.abort();
    controllers.delete(id);
    const next = sessions.filter(s => s.id !== id);
    if (next.length === 0) {
        const fresh: LiveSession = { ...createSession(), entries: [] };
        sessions = [fresh];
        activeId = fresh.id;
        emit();
        return fresh.id;
    }
    sessions = next;
    if (id === activeId) activeId = next[next.length - 1].id;
    emit();
    return activeId;
};

/** Immutably update one session (entries, title, panel seats…). */
export const mutate = (id: string, fn: (s: LiveSession) => LiveSession): void => {
    ensureLoaded();
    sessions = sessions.map(s => (s.id === id ? fn(s) : s));
    emit();
};

// ── Logged-trade harness visibility (openTrades, loggedTradeIds) ─────────────
// The Chart AI dock's chat session is blind to its OWN trade-logging events
// unless we hand it state. These helpers are the only allowed mutators for
// the openTrades / loggedTradeIds invariants so the rest of the codebase
// doesn't widen the surface.

/** Push a notice-style entry ("trade logged", "trade closed…") into a
 *  session — renders as a compact system line, not a model answer. The
 *  session id defaults to the active session so the caller rarely has to
 *  look it up. */
export const addChatSystemEntry = (text: string, sid?: string): string | null => {
    ensureLoaded();
    const target = sid ?? activeId;
    if (!target) return null;
    if (!sessions.some(s => s.id === target)) return null;
    const id = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    mutate(target, s => ({
        ...s,
        entries: [...s.entries, { id, role: 'ai', text: '', tools: [text], notice: true }],
    }));
    return id;
};

/** Record that `tradeId` was logged from `sid` (or the active session).
 *  Adds it to the session's `openTrades` ledger AND to `loggedTradeIds`
 *  (the model context loader's channel for "your last recommendation…").
 *  No-op if the session doesn't exist. */
export const addOpenTrade = (row: OpenTradeRow, sid?: string): void => {
    ensureLoaded();
    const target = sid ?? activeId;
    if (!target) return;
    if (!sessions.some(s => s.id === target)) return;
    mutate(target, s => {
        const prevIds = s.loggedTradeIds ?? [];
        const nextIds = prevIds.includes(row.tradeId) ? prevIds : [...prevIds, row.tradeId];
        return {
            ...s,
            openTrades: { ...(s.openTrades ?? {}), [row.tradeId]: row },
            loggedTradeIds: nextIds,
        };
    });
};

/** Clear a trade from the openTrades ledger once the outcome resolves.
 *  `loggedTradeIds` is preserved (it's the channel for resolved trades too).
 *  No-op if the session or trade id is unknown. */
export const removeOpenTrade = (tradeId: string, sid?: string): void => {
    ensureLoaded();
    const target = sid ?? activeId;
    if (!target) return;
    if (!sessions.some(s => s.id === target)) return;
    mutate(target, s => {
        if (!(s.openTrades && tradeId in s.openTrades)) return s;
        const next = { ...s.openTrades };
        delete next[tradeId];
        return { ...s, openTrades: next };
    });
};

/** Find the session id whose entries include a chat entry with id === `entryId`.
 *  Used to route a "trade logged" event back to the harness that presented
 *  the trade (the conversation Message.id and the chat entry id are the
 *  same in the present_trade path). Returns undefined if no match. */
export const findSessionByEntryId = (entryId: string): string | undefined => {
    ensureLoaded();
    return sessions.find(s => s.entries.some(e => e.id === entryId))?.id;
};

/** Convenience: snapshot of the openTrades ledger for the active session. */
export const getOpenTrades = (sid?: string): Record<string, OpenTradeRow> => {
    ensureLoaded();
    const target = sid ?? activeId;
    const s = sessions.find(x => x.id === target);
    return s?.openTrades ? { ...s.openTrades } : {};
};

// ── Harness signal queue (level-watch price events) ─────────────────────────

/** Queue a `[HARNESS SIGNAL …]` text for the panel to run as a model turn.
 *  Capped so a runaway watch can't flood the transcript. */
export const queueHarnessSignal = (text: string): void => {
    pendingSignals = [...pendingSignals, text].slice(-8);
    emit();
};

/** Drain the queued signals (the panel calls this when the session is idle). */
export const takeHarnessSignals = (): string[] => {
    if (pendingSignals.length === 0) return [];
    const out = pendingSignals;
    pendingSignals = [];
    emit();
    return out;
};

// ── Run controllers (per session, so switching tabs never cancels) ──────────

export const beginRun = (sid: string, controller: AbortController): void => {
    controllers.set(sid, controller);
    emit();
};

export const getController = (sid: string): AbortController | undefined => controllers.get(sid);

/** End a run ONLY if the store still holds THIS run's controller.
 *  chatStore keys controllers by session; a second beginRun (a queued harness
 *  flush racing this run, or a double-submit that slipped through) REPLACES the
 *  entry — and a blind endRun(sid) would then delete the NEWER run's slot,
 *  leaving it un-stoppable while the finished one's `busy` ghost lingers.
 *  Identity check: whoever owns the slot clears the slot. Lives here, beside
 *  the controller map it reads, so every caller shares one rule. */
export const endRunOwned = (sid: string, controller: AbortController): void => {
    if (controllers.get(sid) === controller) endRun(sid);
};

export const endRun = (sid: string): void => {
    controllers.delete(sid);
    emit();
};

/** Explicit Stop: abort the active session's run (the button's job). */
export const abortActive = (): void => {
    const ctrl = controllers.get(activeId);
    if (ctrl) ctrl.abort();
};

/** Test hook: reset the singleton between suites. */
export const __resetForTests = (): void => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    listeners.clear();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = 0;
    sessions = [];
    activeId = '';
    loaded = false;
    loadedFor = '';
    pendingSignals = [];
    snapshot = { sessions, activeId, running: {}, signals: [] };
};

/**
 * chatSessions — persistence for the Trade panel's Chart AI chats. Storage is
 * per active user in localStorage with hard caps (MAX_SESSIONS most-recent
 * sessions, MAX_ENTRIES most-recent entries each) so a long-lived terminal
 * can't grow the blob forever. Pure module (no React, no network) so the
 * title/trim/validation rules are unit-testable.
 *
 * A session is either a SOLO chat (one selected model, optionally bound to a
 * roster bot persona) or a PANEL — up to PANEL_MAX_MODELS models that see
 * each other's turns and can message each other through the debate mailbox
 * while answering. Entries carry the rendering chrome the dock needs: the
 * model that spoke, its reasoning trace, tool-call lines and the model
 * side-effect rows (memory/skill/tool proposals) the transcript renders.
 */

import { getActiveUsername } from '../../utils/activeUser';
import type { Message, ToolAction } from '../../types/message';
import { MessageRole } from '../../types/enums';

/** One turn in a session. `role` stays 'user' | 'ai' for storage
 *  compatibility; an ai entry may belong to one panel seat (speaker). */
export interface StoredChatEntry {
    id: string;
    role: 'user' | 'ai';
    text: string;
    /** Tool-call lines rendered as "▸ …" under the answer. */
    tools: string[];
    /** Panel sessions: which seat/model said this. */
    speaker?: string;
    /** Chain-of-thought trace (the dock's collapsible Thought row). */
    reasoning?: string;
    /** Model side-effects (proposals/writes) surfaced as status rows. */
    actions?: ToolAction[];
    /** Attached image (screenshot or upload) shown in the transcript,
     *  data URL, size-capped before storing. */
    image?: string;
    /** A BACKUP artifact, never a live value: `ExportService` strips image bytes
     *  from the exported copy (a 60-entry session can carry a 1.2 MB screenshot
     *  each) and leaves this stub in place so the transcript still says an image
     *  was there. The live key is never written with it. Read side keeps it
     *  verbatim — `sanitizeEntry` spreads the entry. */
    imageOmitted?: { bytes: number; mime: string };
    /** Harness row (level-watch price event, panel notices): rendered as a
     *  compact system line, never as a model answer. */
    notice?: boolean;
    /** Epoch-ms the entry was created. Memory attribution needs it: "which
     *  injections shaped this answer" is a window join over the injection log,
     *  and without a per-entry timestamp the window has no lower bound — which
     *  is why the citation strip could never be mounted. The upper bound comes
     *  from the NEXT entry's stamp, so a later run's injections cannot leak
     *  onto this answer. Optional: entries stored before this field existed
     *  simply show no strip rather than a wrong one. */
    at?: number;
}

export type SessionKind = 'solo' | 'panel' | 'group';

/** A row stored before the Coach inbox left the dock can still say
 *  kind 'coach'; the loader drops those rather than reopening them as chats. */
type LegacySessionKind = SessionKind | 'coach';

/** One panel seat: a specific model inside a specific provider. */
export interface PanelSeatRef { providerId: string; modelId: string; botId?: string }

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    entries: StoredChatEntry[];
    /** Missing on legacy rows ⇒ 'solo'. */
    kind?: SessionKind;
    /** Panel sessions: the seats (providerId + modelId), max PANEL_MAX_MODELS. */
    panelModels?: PanelSeatRef[];
    /** Solo sessions bound to a roster bot: the answer runs with the bot's
     *  persona + provider/model (the roster's thread carried INTO Chart AI). */
    botId?: string;
    /** Group-room sessions: the dock mirrors this AgentGroup's transcript. */
    groupId?: string;
    /** Chart setup bound to this session — restored when the session is
     *  re-opened, so each chat keeps the instrument + interval it discussed.
     *  Missing on legacy rows ⇒ restore nothing (keep the current chart). */
    symbol?: string;
    interval?: string;
    /** The composer's thinking-effort choice for this session. */
    effort?: string;
    /** Solo sessions: the model (providerId:modelId) this chat answers with. */
    soloModel?: string;
    /** Runtime-only open-trade ledger (chat store lives on this in memory,
     *  but the on-disk shape mirrors the field so a round-trip through
     *  saveSessions/loadSessions doesn't strip it). Cleared by the harness
     *  resolution site — never meaningful across reloads. */
    openTrades?: Record<string, import('./chatStore').OpenTradeRow>;
    /** Runtime-only list of every trade id ever logged from this session.
     *  Lives alongside openTrades for the same round-trip reason. */
    loggedTradeIds?: string[];
}

export const MAX_SESSIONS = 12;
export const MAX_ENTRIES = 60;
/** The user asked for "max 5 models that talk to each other". */
export const PANEL_MAX_MODELS = 5;
/** Bound stored reasoning so 60 long-thinking turns can't sink the blob. */
const MAX_REASONING_CHARS = 4000;
const MAX_IMAGE_CHARS = 1_200_000;
const TITLE_MAX = 36;

export const storageKey = (): string => `trade_chat_sessions_v1_${getActiveUsername()}`;

export const createSession = (kind: SessionKind = 'solo', panelModels: PanelSeatRef[] = []): ChatSession => {
    const now = Date.now();
    return {
        id: `s-${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: kind === 'panel' ? 'New panel' : 'New chat',
        createdAt: now,
        updatedAt: now,
        entries: [],
        kind,
        panelModels: kind === 'panel' ? panelModels.slice(0, PANEL_MAX_MODELS) : undefined,
    };
};

/** Session title = the first user question, one line, no markdown noise. */
export const titleFromMessage = (text: string): string => {
    const line = (text.trim().split('\n')[0] || '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
    if (!line) return 'New chat';
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
};

const validToolAction = (a: unknown): a is ToolAction => {
    const v = a as ToolAction;
    return !!v && typeof v === 'object' && typeof v.tool === 'string' && typeof v.ok === 'boolean';
};

const validEntry = (e: unknown): e is StoredChatEntry => {
    const v = e as StoredChatEntry;
    return !!v && typeof v === 'object'
        && typeof v.id === 'string'
        && (v.role === 'user' || v.role === 'ai')
        && typeof v.text === 'string'
        && Array.isArray(v.tools)
        && v.tools.every(t => typeof t === 'string');
};

const sanitizeEntry = (e: StoredChatEntry): StoredChatEntry => ({
    ...e,
    reasoning: typeof e.reasoning === 'string' && e.reasoning.trim() ? e.reasoning.slice(0, MAX_REASONING_CHARS) : undefined,
    actions: Array.isArray(e.actions) ? e.actions.filter(validToolAction).slice(0, 50) : undefined,
    image: typeof e.image === 'string' && e.image.startsWith('data:image/') && e.image.length <= MAX_IMAGE_CHARS ? e.image : undefined,
    notice: e.notice === true ? true : undefined,
});

const validSession = (s: unknown): s is ChatSession => {
    const v = s as ChatSession;
    return !!v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.entries);
};

const validPanelModel = (m: unknown): m is PanelSeatRef => {
    const v = m as { providerId?: unknown; modelId?: unknown };
    return !!v && typeof v.providerId === 'string' && typeof v.modelId === 'string';
};

const VALID_EFFORTS = new Set(['off', 'low', 'medium', 'high', 'max', 'auto']);

/** Read + validate + bound the stored list; any corruption yields []. */
export const loadSessions = (): ChatSession[] => {
    try {
        const raw = localStorage.getItem(storageKey());
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed
            .filter(validSession)
            // The Coach inbox used to be a dock session (kind 'coach') holding
            // no transcript of its own. It is the Learn surface's tab now, so a
            // stored one drops rather than resurfacing as an empty chat.
            .filter(s => (s.kind as LegacySessionKind | undefined) !== 'coach')
            .map(s => ({
                id: s.id,
                title: typeof s.title === 'string' && s.title.trim() ? s.title : 'New chat',
                createdAt: Number.isFinite(s.createdAt) ? s.createdAt : now,
                updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : now,
                kind: s.kind === 'panel' || s.kind === 'group' ? s.kind : 'solo' as const,
                panelModels: Array.isArray(s.panelModels) ? s.panelModels.filter(validPanelModel).slice(0, PANEL_MAX_MODELS) : undefined,
                botId: typeof s.botId === 'string' && s.botId ? s.botId : undefined,
                groupId: typeof s.groupId === 'string' && s.groupId ? s.groupId : undefined,
                symbol: typeof s.symbol === 'string' && s.symbol.trim() ? s.symbol.toUpperCase() : undefined,
                interval: typeof s.interval === 'string' && s.interval.trim() ? s.interval : undefined,
                effort: typeof s.effort === 'string' && VALID_EFFORTS.has(s.effort) ? s.effort : undefined,
                soloModel: typeof s.soloModel === 'string' && s.soloModel ? s.soloModel : undefined,
                entries: s.entries.filter(validEntry).slice(-MAX_ENTRIES).map(sanitizeEntry),
            }));
    } catch {
        return [];
    }
};

const trimForStorage = (sessions: ChatSession[]): ChatSession[] => fitToByteBudget(
    sessions
        .slice(-MAX_SESSIONS)
        .map(s => ({ ...s, entries: s.entries.filter(validEntry).slice(-MAX_ENTRIES).map(sanitizeEntry) })),
);

/**
 * A COUNT cap is not a SIZE cap, and this store needs both.
 *
 * 12 sessions × 60 entries is unbounded in bytes: `MAX_IMAGE_CHARS` lets a single
 * entry carry 1.2 MB, so the list can ask for hundreds of megabytes against a
 * ~5 MB origin quota. The quota is SHARED — on web this store IS `localStorage`
 * (see `PreferencesService`), so one fat chat makes every other store's write
 * throw too, while the transcript still looks saved in memory. The count trim
 * above could never catch that, because 3 sessions full of screenshots is already
 * under it.
 *
 * Trim in the order that costs the trader least: oldest screenshots first (the
 * TEXT of that exchange survives — a chart image can be re-taken, a past
 * argument cannot), then entries past the count cap, then whole oldest sessions.
 */
export const MAX_STORED_CHARS = 3_500_000;

const serialized = (sessions: ChatSession[]): string => {
    try {
        return JSON.stringify(sessions);
    } catch {
        // A cycle cannot be built by these readers, but a throw here must not
        // become a lost transcript: an empty string trims everything, and the
        // caller still has the in-memory copy.
        return '';
    }
};

const fitToByteBudget = (sessions: ChatSession[]): ChatSession[] => {
    let size = serialized(sessions).length;
    if (size <= MAX_STORED_CHARS) return sessions;
    // Work on copies; sessions and entries are ordered oldest first, which is
    // the order both passes sacrifice in.
    const work: ChatSession[] = sessions.map(s => ({ ...s, entries: s.entries.map(e => ({ ...e })) }));

    // Pass 1 — drop the oldest screenshot, one at a time. The words of that
    // exchange stay: an image can be re-taken, a past argument cannot.
    //
    // Size is tracked by SUBTRACTING each removed image rather than re-serializing
    // the whole list per drop: a base64 payload escapes identically inside JSON, so
    // the arithmetic is exact where it matters, and re-measuring a half-gigabyte
    // blob once per image is what made this loop unusable.
    for (const s of work) {
        for (const e of s.entries) {
            if (size <= MAX_STORED_CHARS) return work;
            if (!e.image) continue;
            size -= e.image.length + '"image":'.length + 2;
            e.image = undefined;
        }
    }

    // Pass 2 — shave the oldest transcripts, newest entries first, down to ten.
    for (const s of work) {
        if (size <= MAX_STORED_CHARS) break;
        if (s.entries.length <= 10) continue;
        const removed = s.entries.slice(0, s.entries.length - 10);
        s.entries = s.entries.slice(-10);
        size -= removed.reduce((n, e) => n + (e.text?.length ?? 0) + e.id.length + 24, 0);
    }

    // Pass 3 — the only thing left to lose is whole oldest conversations.
    while (size > MAX_STORED_CHARS && work.length > 1) {
        const gone = work.shift()!;
        size -= gone.entries.reduce((n, e) => n + (e.text?.length ?? 0) + e.id.length + 24, 0);
    }
    return work;
};

/** Strip every image — the retry that keeps a transcript saving at all. */
const withoutAnyImages = (sessions: ChatSession[]): ChatSession[] =>
    sessions.map(s => ({ ...s, entries: s.entries.map(e => (e.image ? { ...e, image: undefined } : e)) }));

export const saveSessions = (sessions: ChatSession[]): void => {
    const key = storageKey();
    const trimmed = trimForStorage(sessions);
    try {
        localStorage.setItem(key, serialized(trimmed));
    } catch {
        // Quota or private mode. Retry with the screenshots gone rather than
        // reporting silence: losing the transcript is worse than losing the
        // images, and a swallowed throw meant BOTH stores failed quietly.
        try {
            localStorage.setItem(key, serialized(withoutAnyImages(trimmed)));
            console.warn('[chatSessions] saved without screenshots after a quota failure');
        } catch {
            console.error('[chatSessions] transcript NOT persisted (quota or private mode)');
        }
    }
};

/**
 * One history row, as a transcript entry.
 *
 * WHY THIS EXISTS. A bot's conversation lives in App's `messages` (that is what
 * the Chat rail renders, and what the Journal, the analyses gallery and the
 * learning loop all read). The Chart AI dock renders a `chatStore` session. So
 * "Open in Chart AI" used to create an EMPTY session for that bot and quietly
 * drop the entire conversation the trader had just built — the button implied
 * continuity and delivered a blank page.
 *
 * This converts the Chat rail's rows into the shape the dock stores, so a bot
 * session opened in the dock can be seeded with the history it should have
 * inherited. It is a ONE-WAY adoption, deliberately: the dock continues the
 * conversation with its own richer transport (streaming, desk tools, reasoning
 * rows, key levels) rather than replaying the Chat's. Fully unifying the two
 * means one store owning both surfaces, which is a larger change than a
 * converter — this closes the data loss without pretending to be that.
 */
export const liveEntryFromMessage = (m: Message): StoredChatEntry => {
    const traces = [
        ...Object.values(m.reasoningProcesses ?? {}),
        ...Object.values(m.thoughtProcesses ?? {}),
    ].filter(t => !!t && t.trim().length > 0);
    const at = m.createdAt ? Date.parse(m.createdAt) : NaN;
    return {
        id: m.id,
        role: m.role === MessageRole.USER ? 'user' : 'ai',
        text: m.text || '',
        tools: Object.values(m.liveToolEvents ?? {}).flat(),
        // Left unset on purpose: the dock stamps the answering seat from the
        // session's own bot, so a stale name here would fight it.
        speaker: undefined,
        reasoning: traces.length > 0 ? traces.join('\n\n') : undefined,
        actions: m.toolActions,
        image: m.images?.[0],
        // A row with an unparseable timestamp keeps `at` undefined rather than
        // stamping it as 0: the memory-attribution window join treats a real
        // stamp as meaningful and 0 as noise.
        at: Number.isFinite(at) ? at : undefined,
    };
};

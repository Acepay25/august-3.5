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
import type { ToolAction } from '../../types/message';

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
    /** Harness row (level-watch price event, panel notices): rendered as a
     *  compact system line, never as a model answer. */
    notice?: boolean;
}

export type SessionKind = 'solo' | 'panel' | 'coach' | 'group';

/** One panel seat: a specific model inside a specific provider. */
export interface PanelSeatRef { providerId: string; modelId: string }

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

/** The dock's session kinds: chats, panels, the Coach inbox, and room mirrors. */
export const isSpecialKind = (kind: SessionKind | undefined): boolean =>
    kind === 'coach' || kind === 'group';

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
            .map(s => ({
                id: s.id,
                title: typeof s.title === 'string' && s.title.trim() ? s.title : 'New chat',
                createdAt: Number.isFinite(s.createdAt) ? s.createdAt : now,
                updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : now,
                kind: s.kind === 'panel' || s.kind === 'coach' || s.kind === 'group' ? s.kind : 'solo' as const,
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

const trimForStorage = (sessions: ChatSession[]): ChatSession[] => sessions
    .slice(-MAX_SESSIONS)
    .map(s => ({ ...s, entries: s.entries.filter(validEntry).slice(-MAX_ENTRIES).map(sanitizeEntry) }));

export const saveSessions = (sessions: ChatSession[]): void => {
    try {
        localStorage.setItem(storageKey(), JSON.stringify(trimForStorage(sessions)));
    } catch {
        /* quota / private mode — chats stay in memory this session */
    }
};

/**
 * chatSessions — persistence for the Trade panel's Chart AI chats. The dock
 * used to be one ephemeral transcript; the user can now run parallel sessions
 * (new / switch / delete) like chat tabs, and they survive reloads. Storage is
 * per active user in localStorage with hard caps (MAX_SESSIONS most-recent
 * sessions, MAX_ENTRIES most-recent entries each) so a long-lived terminal
 * can't grow the blob forever. Pure module (no React, no network) so the
 * title/trim/validation rules are unit-testable.
 */

import { getActiveUsername } from '../../utils/activeUser';

export interface StoredChatEntry {
    id: string;
    role: 'user' | 'ai';
    text: string;
    /** Tool-call lines rendered as "▸ …" under the answer. */
    tools: string[];
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    entries: StoredChatEntry[];
}

export const MAX_SESSIONS = 12;
export const MAX_ENTRIES = 60;
const TITLE_MAX = 36;

export const storageKey = (): string => `trade_chat_sessions_v1_${getActiveUsername()}`;

export const createSession = (): ChatSession => {
    const now = Date.now();
    return { id: `s-${now}-${Math.random().toString(36).slice(2, 8)}`, title: 'New chat', createdAt: now, updatedAt: now, entries: [] };
};

/** Session title = the first user question, one line, no markdown noise. */
export const titleFromMessage = (text: string): string => {
    const line = (text.trim().split('\n')[0] || '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
    if (!line) return 'New chat';
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
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

const validSession = (s: unknown): s is ChatSession => {
    const v = s as ChatSession;
    return !!v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.entries);
};

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
                entries: s.entries.filter(validEntry).slice(-MAX_ENTRIES),
            }));
    } catch {
        return [];
    }
};

const trimForStorage = (sessions: ChatSession[]): ChatSession[] => sessions
    .slice(-MAX_SESSIONS)
    .map(s => ({ ...s, entries: s.entries.filter(validEntry).slice(-MAX_ENTRIES) }));

export const saveSessions = (sessions: ChatSession[]): void => {
    try {
        localStorage.setItem(storageKey(), JSON.stringify(trimForStorage(sessions)));
    } catch {
        /* quota / private mode — chats stay in memory this session */
    }
};

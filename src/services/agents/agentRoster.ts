/**
 * agentRoster — named bots and group chats.
 * A bot is a named teammate bound to one provider model ("select a
 * model in a provider"); it has its own face, title, description and
 * 1:1 chat. A group binds several bots into a room where one prompt
 * fans out to the members serially with an activity feed.
 *
 * Persistence: per-user localStorage keys + a tiny pub/sub so open
 * surfaces refresh on edits without a reload.
 */

import type { RolePreset } from '../../components/chat/pixelAvatars';
import type { BotFaceSpec } from '../../components/chat/BotFace';
import { getActiveUsername } from '../../utils/activeUser';

/** Whose notebook a bot reads. Moved here with the bot type: it is the roster's
 *  field, and the legacy Preferences store that also declared it is gone. */
export type BotMemoryScope = 'global' | 'personal' | 'isolated';

export interface AgentBot {
    id: string;
    name: string;
    title?: string;
    description?: string;
    /** The provider this bot thinks with. */
    providerId: string;
    /** The model this bot thinks with (within providerId). */
    modelId: string;
    /** Whose notebook this bot thinks with (WS-3.1). Absent/'global' reads the
     *  shared book; 'isolated' keeps to its own notes, and nothing it learns
     *  is retrieved by others. Carried over from the legacy HermesBot field —
     *  without it the roster's scope contract was unimplementable, since the
     *  turn sites had no field to read and hardcoded 'global'. */
    memoryScope?: BotMemoryScope;
    /** Free-text trader instructions. Absent = the general-analyst default. */
    customPrompt?: string;
    /** Avatar: a built-in geometric face, our pixel roles, 'auto', or an
     *  uploaded image clipped to a container shape (data URL). */
    avatar:
        | { kind: 'face'; spec: BotFaceSpec }
        | { kind: 'pixel'; role: RolePreset }
        | { kind: 'upload'; src: string; shape: BotFaceSpec['shape'] }
        | { kind: 'auto' };
    createdAt: string;
}

export interface AgentGroup {
    id: string;
    name?: string;
    /** Member bot ids, in send order. */
    memberIds: string[];
    createdAt: string;
}

const BOTS_KEY = 'agents_bots_v1';
const GROUPS_KEY = 'agents_groups_v1';

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = (): void => { for (const l of listeners) l(); };

/** Subscribe to bot/group changes. Returns an unsubscribe fn. */
export const subscribeAgentRoster = (l: Listener): (() => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

const read = <T,>(prefix: string): T[] => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
        const raw = window.localStorage.getItem(`${prefix}_${getActiveUsername()}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
        return [];
    }
};

const write = <T,>(prefix: string, items: T[]): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(`${prefix}_${getActiveUsername()}`, JSON.stringify(items));
    } catch {
        // Quota / private mode — non-critical, ignore.
    }
    notify();
};

/** Raw localStorage is an unvalidated boundary: a corrupted or foreign backup
 *  can hold null/array rows. Both roster reads drop them rather than throwing
 *  from a useState initializer and taking the Agents surface down. */
const isStoredRow = (row: unknown): row is Record<string, unknown> =>
    !!row && typeof row === 'object' && !Array.isArray(row);

export const getBots = (): AgentBot[] => {
    // Migration (owner ruling, 2026-10-19): roles and per-role tool presets are
    // gone. Stored rows are rewritten the first time they are read, so a profile
    // stops carrying either field instead of being silently tolerated forever.
    const raw = read<Record<string, unknown>>(BOTS_KEY);
    let changed = false;
    const bots = raw.flatMap((row) => {
        if (!isStoredRow(row) || typeof row.id !== 'string') {
            changed = true;
            return [];
        }
        if (!('role' in row) && !('enabledTools' in row)) return [row as unknown as AgentBot];
        changed = true;
        const clean = { ...row };
        delete clean.role;
        delete clean.enabledTools;
        return [clean as unknown as AgentBot];
    });
    if (changed) write(BOTS_KEY, bots);
    return bots;
};

export const getGroups = (): AgentGroup[] => {
    const raw = read<Record<string, unknown>>(GROUPS_KEY);
    let changed = false;
    const groups = raw.flatMap((row) => {
        // `AgentsView` dereferences `g.memberIds.length` while rendering; a
        // missing array is the group-side twin of the null-bot crash.
        if (!isStoredRow(row) || typeof row.id !== 'string' || !Array.isArray(row.memberIds)) {
            changed = true;
            return [];
        }
        const memberIds = row.memberIds.filter((m): m is string => typeof m === 'string');
        if (memberIds.length !== row.memberIds.length) {
            changed = true;
            return [{ ...row, memberIds } as unknown as AgentGroup];
        }
        return [row as unknown as AgentGroup];
    });
    if (changed) write(GROUPS_KEY, groups);
    return groups;
};

export const saveBot = (bot: AgentBot): void => write(BOTS_KEY, [...getBots(), bot]);
export const updateBot = (id: string, patch: Partial<Omit<AgentBot, 'id'>>): void =>
    write(BOTS_KEY, getBots().map(b => (b.id === id ? { ...b, ...patch } : b)));
export const removeBot = (id: string): void => {
    write(BOTS_KEY, getBots().filter(b => b.id !== id));
    // Groups holding the bot keep running without it.
    write(GROUPS_KEY, getGroups()
        .map(g => ({ ...g, memberIds: g.memberIds.filter(m => m !== id) }))
        .filter(g => g.memberIds.length > 0));
};

export const saveGroup = (group: AgentGroup): void => write(GROUPS_KEY, [...getGroups(), group]);
export const updateGroup = (id: string, patch: Partial<Omit<AgentGroup, 'id'>>): void =>
    write(GROUPS_KEY, getGroups().map(g => (g.id === id ? { ...g, ...patch } : g)));
export const removeGroup = (id: string): void => write(GROUPS_KEY, getGroups().filter(g => g.id !== id));

/** Default display name for a group: member names joined. */
export const groupDisplayName = (group: AgentGroup, bots: AgentBot[]): string => {
    if (group.name) return group.name;
    const names = group.memberIds
        .map(id => findBotById(bots, id)?.name)
        .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : 'Group';
};

/** A bot by id — shared lookup for roster rails, groups, and routines. */
export const findBotById = (bots: AgentBot[], id: string): AgentBot | undefined =>
    bots.find(b => b.id === id);

export const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

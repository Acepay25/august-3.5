/**
 * agentRoster — named bots and group chats, Hermes-Bot-Mode style.
 * A bot is a named teammate bound to one provider model ("select a
 * model in a provider"); it has its own face, title, description and
 * 1:1 chat. A group binds several bots into a room where one prompt
 * fans out to the members serially with an activity feed.
 *
 * Persistence mirrors services/desk/roleOverrides: per-user
 * localStorage keys + a tiny pub/sub so open surfaces refresh on
 * edits without a reload.
 */

import type { RolePreset } from '../../components/desk/pixelAvatars';
import type { BotFaceSpec } from '../../components/chat/BotFace';
import { AnalystRole } from '../../types/enums';
import { getActiveUsername } from '../../utils/activeUser';

export interface AgentBot {
    id: string;
    name: string;
    title?: string;
    description?: string;
    /** The provider this bot thinks with. */
    providerId: string;
    /** The model this bot thinks with (within providerId). */
    modelId: string;
    /** Debate persona: a built-in AnalystRole inherits that role's curated
     *  prompt (optionally refined by customPrompt); omitted = the
     *  general-analyst default. Formerly a TEAM-seat field — groups'
     *  members carry it now (the Team/group merge). */
    role?: AnalystRole;
    /** Free-text trader instructions. On a built-in role they REFINE the
     *  role prompt; unroled they REPLACE the default mandate. */
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

/** One analyst seat on a team: a provider model the harness will run. */
export interface AgentTeamSeat {
    providerId: string;
    modelId: string;
    /** Debate persona for this seat. A built-in AnalystRole inherits that
     *  role's curated prompt; omit (or UNASSIGNED) for the general-analyst
     *  default: full-scope market analysis aimed at the best signal, desk
     *  tools + web search included. */
    role?: AnalystRole;
    /** Free-text trader instructions. On a built-in role they REFINE the
     *  role prompt; on a general seat they REPLACE the default mandate. */
    customPrompt?: string;
}

/**
 * A Team — the trader's own configuration of the harness. Activating a
 * team points the ensemble debate (hybrid intelligence, trade log, the
 * whole pipeline) at exactly these seats: there is no fixed trio. The
 * debate engine requires at least 2 analysts; teams seat 2–10 (6+ run
 * as LENS PODS — see utils/teamRoster).
 */
export interface AgentTeam {
    id: string;
    name?: string;
    /** Analyst seats, in debate order (2–10). */
    seats: AgentTeamSeat[];
    /** Optional chair — overrides the global moderator while active. */
    moderator?: AgentTeamSeat;
    createdAt: string;
}

const BOTS_KEY = 'agents_bots_v1';
const GROUPS_KEY = 'agents_groups_v1';
const TEAMS_KEY = 'agents_teams_v1';
const ACTIVE_TEAM_KEY = 'agents_active_team_v1';

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

export const getBots = (): AgentBot[] => read<AgentBot>(BOTS_KEY);
export const getGroups = (): AgentGroup[] => read<AgentGroup>(GROUPS_KEY);
export const getTeams = (): AgentTeam[] => read<AgentTeam>(TEAMS_KEY);

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

export const saveTeam = (team: AgentTeam): void => write(TEAMS_KEY, [...getTeams(), team]);
export const updateTeam = (id: string, patch: Partial<Omit<AgentTeam, 'id'>>): void =>
    write(TEAMS_KEY, getTeams().map(t => (t.id === id ? { ...t, ...patch } : t)));
export const removeTeam = (id: string): void => {
    write(TEAMS_KEY, getTeams().filter(t => t.id !== id));
    if (getActiveTeamId() === id) setActiveTeamId(null);
};

/** The team the harness currently runs — null = Settings-derived legacy. */
export const getActiveTeamId = (): string | null => {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        return window.localStorage.getItem(`${ACTIVE_TEAM_KEY}_${getActiveUsername()}`) || null;
    } catch {
        return null;
    }
};
export const setActiveTeamId = (id: string | null): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        if (id) window.localStorage.setItem(`${ACTIVE_TEAM_KEY}_${getActiveUsername()}`, id);
        else window.localStorage.removeItem(`${ACTIVE_TEAM_KEY}_${getActiveUsername()}`);
    } catch {
        // Quota / private mode — non-critical.
    }
    notify();
};

/** Default display name for a group: member names joined (Hermes-style). */
export const groupDisplayName = (group: AgentGroup, bots: AgentBot[]): string => {
    if (group.name) return group.name;
    const names = group.memberIds
        .map(id => bots.find(b => b.id === id)?.name)
        .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : 'Group';
};

export const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

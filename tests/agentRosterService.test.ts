import { describe, it, expect, afterEach } from 'vitest';
import {
    getBots, getGroups, saveBot, saveGroup, removeBot, removeGroup,
    type AgentBot, type AgentGroup,
} from '../services/agents/agentRoster';

afterEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
});

const bot = (id: string, name: string): AgentBot => ({
    id,
    name,
    providerId: 'p1',
    modelId: 'model-a',
    avatar: { kind: 'auto' },
    createdAt: new Date().toISOString(),
});

const groupOf = (id: string, memberIds: string[]): AgentGroup => ({
    id,
    memberIds,
    createdAt: new Date().toISOString(),
});

describe('agentRoster deletion (service layer)', () => {
    it('removeBot drops the bot and pulls it out of groups', () => {
        saveBot(bot('b1', 'Scout'));
        saveBot(bot('b2', 'Raven'));
        saveGroup(groupOf('g1', ['b1', 'b2']));
        removeBot('b1');
        expect(getBots().map(b => b.id)).toEqual(['b2']);
        expect(getGroups().find(g => g.id === 'g1')?.memberIds).toEqual(['b2']);
    });

    it('a group left empty by a deletion is removed entirely', () => {
        saveBot(bot('b1', 'Scout'));
        saveGroup(groupOf('g1', ['b1']));
        saveGroup(groupOf('g2', ['b1', 'ghost']));
        removeBot('b1');
        // g1 held only the deleted bot → gone; g2 survives with 'ghost'.
        expect(getGroups().map(g => g.id)).toEqual(['g2']);
        expect(getGroups()[0].memberIds).toEqual(['ghost']);
    });

    it('removeGroup drops only that room; bots are untouched', () => {
        saveBot(bot('b1', 'Scout'));
        saveGroup(groupOf('g1', ['b1']));
        saveGroup(groupOf('g2', ['b1']));
        removeGroup('g1');
        expect(getGroups().map(g => g.id)).toEqual(['g2']);
        expect(getBots()).toHaveLength(1);
    });
});

import { getTeams, saveTeam, updateTeam as updateTeamStore, removeTeam as removeTeamStore, getActiveTeamId, setActiveTeamId as setActiveTeamIdStore, type AgentTeam } from '../services/agents/agentRoster';

const teamOf = (id: string, name?: string): AgentTeam => ({
    id,
    name,
    seats: [
        { providerId: 'p1', modelId: 'model-a' },
        { providerId: 'p2', modelId: 'model-b' },
    ],
    createdAt: new Date().toISOString(),
});

describe('agentRoster team CRUD (the Team is user-owned)', () => {
    it('saves, updates, and removes teams', () => {
        saveTeam(teamOf('t1', 'Alpha'));
        saveTeam(teamOf('t2', 'Beta'));
        updateTeamStore('t1', { name: 'Alpha Desk' });
        expect(getTeams().map(t => t.name)).toEqual(['Alpha Desk', 'Beta']);
        removeTeamStore('t2');
        expect(getTeams().map(t => t.id)).toEqual(['t1']);
    });

    it('tracks the active team; removing it clears the active pointer', () => {
        saveTeam(teamOf('t1'));
        expect(getActiveTeamId()).toBeNull();
        setActiveTeamIdStore('t1');
        expect(getActiveTeamId()).toBe('t1');
        removeTeamStore('t1');
        expect(getActiveTeamId()).toBeNull();
        expect(getTeams()).toEqual([]);
    });

    it('removing a non-active team keeps the active pointer', () => {
        saveTeam(teamOf('t1'));
        saveTeam(teamOf('t2'));
        setActiveTeamIdStore('t1');
        removeTeamStore('t2');
        expect(getActiveTeamId()).toBe('t1');
        setActiveTeamIdStore(null);
    });
});

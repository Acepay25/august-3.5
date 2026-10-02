import { describe, it, expect, afterEach } from 'vitest';
import {
    getBots, getGroups, saveBot, saveGroup, removeBot, removeGroup, findBotById,
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


describe('findBotById', () => {
    it('finds a bot by id or returns undefined', () => {
        const bots = [bot('b1', 'Scout'), bot('b2', 'Raven')];
        expect(findBotById(bots, 'b2')?.name).toBe('Raven');
        expect(findBotById(bots, 'ghost')).toBeUndefined();
    });
});

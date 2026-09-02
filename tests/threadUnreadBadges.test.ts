import { describe, it, expect, beforeEach } from 'vitest';

// Batch 13 (§10.1): the unread-badge substrate — model-scoped unreadCount,
// the group-slice helper, and the per-user opened-map persistence.

import {
    unreadCount,
    unreadInSlice,
    markThreadOpened,
    loadThreadOpenedMap,
    saveThreadOpenedMap,
    threadForProvider,
} from '../utils/agentThreads';
import { Message, MessageRole } from '../types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 30);

const aiMsg = (id: string, providerId: string, modelId: string, atMs: number): Message => ({
    id,
    role: MessageRole.AI,
    text: `reply ${id}`,
    createdAt: new Date(atMs).toISOString(),
    modelsUsed: { [providerId]: modelId },
});

describe('unreadCount model scoping', () => {
    it('counts only the bot model\'s replies when modelId is given', () => {
        const messages = [
            aiMsg('m1', 'p1', 'model-a', T0),
            aiMsg('m2', 'p1', 'model-b', T0 + 60_000),
        ];
        expect(unreadCount(messages, 'p1', null, 'model-a')).toBe(1);
        expect(unreadCount(messages, 'p1', null, 'model-b')).toBe(1);
        expect(unreadCount(messages, 'p1', null)).toBe(2);
    });
});

describe('unreadInSlice', () => {
    it('never-opened slices cap at 9; opened slices count newer AI only', () => {
        const slice = Array.from({ length: 12 }, (_, i) => aiMsg(`m${i}`, 'p1', 'model-a', T0 + i * 60_000));
        expect(unreadInSlice(slice, null)).toBe(9);
        expect(unreadInSlice(slice, new Date(T0 + 5 * 60_000).toISOString())).toBe(6);
        expect(unreadInSlice([], null)).toBe(0);
    });
});

describe('thread opened-map persistence', () => {
    beforeEach(() => localStorage.clear());
    it('round-trips per user; other users start empty', () => {
        const map = markThreadOpened({}, 'bot-1');
        saveThreadOpenedMap('alice', map);
        expect(loadThreadOpenedMap('alice')['bot-1']).toBeTruthy();
        expect(loadThreadOpenedMap('bob')['bot-1']).toBeUndefined();
    });
    it('markThreadOpened refreshes the timestamp', () => {
        const first = markThreadOpened({}, 'bot-1');
        const second = markThreadOpened(first, 'bot-1');
        expect(Date.parse(second['bot-1'])).toBeGreaterThanOrEqual(Date.parse(first['bot-1']));
    });
    it('corrupt storage degrades to {}', () => {
        localStorage.setItem('agent_threads_opened_v1_carol', 'not json');
        expect(loadThreadOpenedMap('carol')).toEqual({});
    });
});

describe('threadForProvider (regression: badge scoping source)', () => {
    it('single-model AI replies land in exactly one thread', () => {
        const messages = [aiMsg('m1', 'p1', 'model-a', T0), aiMsg('m2', 'p2', 'model-x', T0 + 1)];
        expect(threadForProvider(messages, 'p1', 'model-a').map(m => m.id)).toEqual(['m1']);
    });
});

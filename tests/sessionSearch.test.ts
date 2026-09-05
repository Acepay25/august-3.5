import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatChatHitsDigest, searchChatHistory, invalidateChatHistoryIndex } from '../services/infrastructure/sessionSearch';
import type { Conversation } from '../types/trade';

// Minimal dbService mock: one profile holding two conversations, served from
// a mutable array so tests can simulate a profile change between searches.
let LIVE_CONVERSATIONS: Conversation[] = [];
const CONVERSATIONS: Conversation[] = [
    {
        id: 'c1',
        timestamp: Date.now() - 86_400_000,
        title: 'BTC short debate',
        messages: [
            { id: 'm1', role: 'user' as never, text: 'What about a BTC short at the range high?', createdAt: new Date().toISOString() },
            { id: 'm2', role: 'ai' as never, text: 'The moderator verdict flagged funding squeeze risk on the BTC short; conviction stayed low.', createdAt: new Date().toISOString() },
        ] as never[],
        ocrModel: '',
        moderatorProviderId: 'p',
        moderatorModel: 'm',
        leverage: 10,
    },
    {
        id: 'c2',
        timestamp: Date.now() - 7 * 86_400_000,
        title: 'ETH scalp notes',
        messages: [
            { id: 'm3', role: 'ai' as never, text: 'ETH continuation looked healthy above the 4h reclaim.', createdAt: new Date().toISOString() },
        ] as never[],
        ocrModel: '',
        moderatorProviderId: 'p',
        moderatorModel: 'm',
        leverage: 10,
    },
] as unknown as Conversation[];

vi.mock('../services/infrastructure/dbService', () => ({
    getUserProfile: vi.fn(async () => ({ username: 'tester', conversations: LIVE_CONVERSATIONS })),
}));

describe('session search', () => {
    beforeEach(() => {
        localStorage.setItem('last_active_user', 'tester');
        LIVE_CONVERSATIONS = CONVERSATIONS;
        invalidateChatHistoryIndex();
    });

    it('finds passages across conversations and ranks them', async () => {
        const hits = await searchChatHistory('BTC short');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].conversationTitle).toBe('BTC short debate');
        expect(hits[0].excerpt.toLowerCase()).toContain('btc short'.slice(0, 3));
    });

    it('returns empty for no-match and junk queries', async () => {
        expect(await searchChatHistory('zzqqxxyy')).toEqual([]);
        expect(await searchChatHistory('the a an')).toEqual([]); // stop words only
    });

    it('formats a bounded plain-text digest for the desk tool', () => {
        const digest = formatChatHitsDigest([
            { conversationId: 'c1', conversationTitle: 'BTC short debate', at: new Date().toISOString(), speaker: 'ai', excerpt: 'Funding squeeze risk on the BTC short.', score: 5 },
        ]);
        expect(digest).toContain('[BTC short debate');
        expect(digest.length).toBeLessThanOrEqual(1600);
        expect(formatChatHitsDigest([])).toMatch(/No matching/i);
    });

    it('rebuilds the cached index when the profile changes between searches', async () => {
        // First search builds + caches the index over CONVERSATIONS.
        expect((await searchChatHistory('SOL perps')).length).toBe(0);
        // A new conversation lands in the profile (fingerprint changes).
        const extra: Conversation = {
            ...CONVERSATIONS[0],
            id: 'c3',
            timestamp: Date.now(),
            title: 'SOL notes',
            messages: [{ id: 'm9', role: 'ai', text: 'SOL perps funding flipped positive.' }] as never[],
        } as unknown as Conversation;
        LIVE_CONVERSATIONS = [...CONVERSATIONS, extra];
        const hits = await searchChatHistory('SOL perps');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].conversationTitle).toBe('SOL notes');
    });

    it('an in-place text edit is visible after explicit invalidation', async () => {
        await searchChatHistory('stayed low'); // build the index over the original text
        expect((await searchChatHistory('hot')).length).toBe(0);
        // Same length, same first/last chars: the fingerprint cannot see this
        // edit ('low.' → 'hot.'), so the cached rows must be dropped by hand.
        const edited = CONVERSATIONS.map(c => ({
            ...c,
            messages: c.messages.map(m => m.id === 'm2'
                ? { ...m, text: 'The moderator verdict flagged funding squeeze risk on the BTC short; conviction stayed hot.' }
                : m),
        }));
        LIVE_CONVERSATIONS = edited as unknown as Conversation[];
        invalidateChatHistoryIndex('tester');
        const hits = await searchChatHistory('hot');
        expect(hits.length).toBeGreaterThan(0);
    });
});

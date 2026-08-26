import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatChatHitsDigest, searchChatHistory } from '../services/infrastructure/sessionSearch';
import type { Conversation } from '../types/trade';

// Minimal dbService mock: one profile holding two conversations.
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
    getUserProfile: vi.fn(async () => ({ username: 'tester', conversations: CONVERSATIONS })),
}));

describe('session search', () => {
    beforeEach(() => {
        localStorage.setItem('last_active_user', 'tester');
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
});

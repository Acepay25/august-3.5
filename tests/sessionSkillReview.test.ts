/**
 * sessionSkillReview — the conversation-driven skill loop. The outcome scorer
 * and cadence are pure/deterministic; the LLM extraction and the full review
 * are driven with a mocked transport, exactly like the post-mortem tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(),
}));

import { sendChatRequest } from '../services/providers/GenericProviderService';
import { fetchKlines } from '../services/analysis/KlineService';
import {
    scoreHypotheticalTrade, thesisFingerprint, recordSessionForReview,
    extractDiscussedTrades, runSessionSkillReview, runThesisResolver,
    cacheOpenThesis, type DiscussedThesis,
} from '../services/learning/sessionSkillReview';
import { listSkillDrafts } from '../utils/skillDrafts';

const USER = 'alice';
const cfg = { id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1', apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false, models: ['m'], selectedModel: 'm' } as never;

const clearThrottle = (): void => localStorage.removeItem('session_review_resolver_v1:alice');

const candle = (high: number, low: number) => ({ high, low });

beforeEach(() => {
    localStorage.clear();
    vi.mocked(sendChatRequest).mockReset();
    vi.mocked(fetchKlines).mockReset();
});

describe('scoreHypotheticalTrade', () => {
    const long: Pick<DiscussedThesis, 'direction' | 'stopLoss' | 'takeProfit'> = { direction: 'Long', stopLoss: 90, takeProfit: 110 };
    const short: Pick<DiscussedThesis, 'direction' | 'stopLoss' | 'takeProfit'> = { direction: 'Short', stopLoss: 110, takeProfit: 90 };

    it('long wins when TP is touched before SL', () => {
        expect(scoreHypotheticalTrade(long, [candle(95, 94), candle(111, 96)])).toBe('win');
    });
    it('long loses when SL is touched first', () => {
        expect(scoreHypotheticalTrade(long, [candle(95, 89)])).toBe('loss');
    });
    it('an ambiguous bar that spans both is scored a LOSS (no favourable fill)', () => {
        expect(scoreHypotheticalTrade(long, [candle(111, 89)])).toBe('loss');
    });
    it('short mirrors', () => {
        expect(scoreHypotheticalTrade(short, [candle(95, 89)])).toBe('win');
        expect(scoreHypotheticalTrade(short, [candle(111, 100)])).toBe('loss');
    });
    it('neither level touched → open', () => {
        expect(scoreHypotheticalTrade(long, [candle(100, 95)])).toBe('open');
    });
});

describe('thesisFingerprint + cadence', () => {
    it('is stable for the same levels and differs across them', () => {
        const t = { symbol: 'BTC', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: '', atMs: 0, interval: '15m' } as DiscussedThesis;
        expect(thesisFingerprint(t)).toBe(thesisFingerprint({ ...t, thesis: 'different words' }));
        expect(thesisFingerprint(t)).not.toBe(thesisFingerprint({ ...t, stopLoss: 80 }));
    });
    it('fires the review every 3 sessions and resets', () => {
        expect(recordSessionForReview(USER, 3)).toBe(false);
        expect(recordSessionForReview(USER, 3)).toBe(false);
        expect(recordSessionForReview(USER, 3)).toBe(true);
        expect(recordSessionForReview(USER, 3)).toBe(false); // counter reset
    });
});

describe('extractDiscussedTrades', () => {
    it('parses a JSON array and drops malformed / backwards rows', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'btcusdt', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
            { symbol: 'ETHUSDT', direction: 'short', entry: 3000, stop: 3100, target: 2900, thesis: 'fade' },
            { symbol: 'SOLUSDT', direction: 'long', entry: 100, stopLoss: 110, takeProfit: 90 }, // backwards → dropped
            { symbol: 'X', direction: 'long', entry: 5 }, // missing levels → dropped
        ]));
        const out = await extractDiscussedTrades('user: I would long BTC 100 stop 90 target 110. model: agreed, reclaim setup.', cfg, 'BTCUSDT');
        expect(out.length).toBe(2);
        expect(out[0]).toMatchObject({ symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110 });
        expect(out[1]).toMatchObject({ symbol: 'ETHUSDT', direction: 'Short', stopLoss: 3100, takeProfit: 2900 });
    });
    it('returns [] on garbage / no provider output', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue('no json here');
        expect(await extractDiscussedTrades('some long enough transcript about trading', cfg, 'BTCUSDT')).toEqual([]);
    });
});

describe('runSessionSkillReview', () => {
    const session = { id: 's1', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: 0, symbol: 'BTCUSDT' };

    it('queues a repeat draft for a thesis that won', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
        const n = await runSessionSkillReview(USER, [session], cfg);
        expect(n).toBe(1);
        const drafts = listSkillDrafts(USER);
        expect(drafts[0].crafted.kind).toBe('repeat');
        expect(drafts[0].tradeId).toContain('session:BTCUSDT:Long');
    });

    it('queues an avoid draft for a thesis that lost', async () => {
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 100, low: 89, close: 90, volume: 1 }] as never);
        const n = await runSessionSkillReview(USER, [session], cfg);
        expect(n).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.kind).toBe('avoid');
    });

    it('skips unresolved theses and never double-drafts the same idea', async () => {
        const thesis = JSON.stringify([{ symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' }]);
        vi.mocked(sendChatRequest).mockResolvedValue(thesis);
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never); // open
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        // Now resolve it as a win and run twice — second run must dedupe.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(1);
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        expect(listSkillDrafts(USER).length).toBe(1);
    });
});

describe('runThesisResolver (event-driven resolution)', () => {
    const thesis: DiscussedThesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' };

    it('queues a cached thesis the moment price resolves it — once', async () => {
        cacheOpenThesis(USER, 's1', thesis);
        // Still unresolved → nothing queued, thesis stays cached.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never);
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(0);
        // Price resolves it as a win → the draft lands WITHOUT another
        // extraction pass.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(1);
        expect(listSkillDrafts(USER)[0].tradeId).toBe(thesisFingerprint(thesis));
        // Judged once — a resolved thesis never re-nags.
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(0);
    });

    it('resolves theses the every-3 extraction pass cached as open', async () => {
        const session = { id: 's2', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: 0, symbol: 'BTCUSDT' };
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never); // open
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        // Days later, the bars printed — the resolver catches it on the next
        // send without waiting for the next 3-session boundary.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 1, open: 100, high: 89, low: 80, close: 85, volume: 1 }] as never); // SL hit
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.kind).toBe('avoid');
    });
});

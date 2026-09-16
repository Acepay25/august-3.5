/**
 * sessionSkillReview — the conversation-driven skill loop. The outcome scorer
 * and cadence are pure/deterministic; the LLM extraction and the full review
 * are driven with a mocked transport, exactly like the post-mortem tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(),
}));

import { sendChatRequest, getQuickResponse } from '../services/providers/GenericProviderService';
import { fetchKlines } from '../services/analysis/KlineService';
import {
    scoreHypotheticalTrade, thesisFingerprint, recordSessionForReview,
    extractDiscussedTrades, runSessionSkillReview, runThesisResolver,
    cacheOpenThesis, craftedSkillFromThesis, type DiscussedThesis,
} from '../services/learning/sessionSkillReview';
import { listSkillDrafts, tombstoneSkillDraftKey, draftTriggerKey } from '../utils/skillDrafts';

const USER = 'alice';
const cfg = { id: 'p', name: 'P', apiKey: 'k', baseUrl: 'https://x/v1', apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false, models: ['m'], selectedModel: 'm' } as never;

const clearThrottle = (): void => localStorage.removeItem('session_review_resolver_v1:alice');

const candle = (high: number, low: number) => ({ high, low });

beforeEach(() => {
    localStorage.clear();
    vi.mocked(sendChatRequest).mockReset();
    vi.mocked(fetchKlines).mockReset();
    // Default: the worth gate cannot parse a verdict out of undefined → the
    // evidence tier falls back to the deterministic bar (historical test
    // behavior). Judged-reject tests override this per test.
    vi.mocked(getQuickResponse).mockReset();
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
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
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
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 100, low: 89, close: 90, volume: 1 }] as never);
        const n = await runSessionSkillReview(USER, [session], cfg);
        expect(n).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.kind).toBe('avoid');
    });

    it('skips unresolved theses and never double-drafts the same idea', async () => {
        const thesis = JSON.stringify([{ symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' }]);
        vi.mocked(sendChatRequest).mockResolvedValue(thesis);
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never); // open
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        // Now resolve it as a win and run twice — second run must dedupe.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(1);
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        expect(listSkillDrafts(USER).length).toBe(1);
    });

    it('MUST NOT score a thesis against candles that printed BEFORE it (lookahead)', async () => {
        // Regression: KlineService stores time in MILLISECONDS, but the filter
        // used `k.time * 1000 >= atMs`, which is always true for real ms epochs
        // → a pre-thesis winning bar leaked into the window and minted a false
        // 'repeat' skill. The conversation happened at T; a winning candle from
        // 1h BEFORE T must be ignored.
        const T = 1_700_000_000_000; // ms
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([
            { time: T - 3_600_000, open: 100, high: 111, low: 99, close: 110, volume: 1 }, // pre-thesis win (must be dropped)
            { time: T, open: 100, high: 101, low: 95, close: 100, volume: 1 },              // post-thesis: unresolved
        ] as never);
        const s = { id: 'sT', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: T, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(0); // NOT a false win
        expect(listSkillDrafts(USER)).toHaveLength(0);
    });

    it('scores a thesis on the candles that printed AFTER it', async () => {
        const T = 1_700_000_000_000;
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([
            { time: T - 3_600_000, open: 100, high: 111, low: 99, close: 110, volume: 1 }, // pre-thesis (dropped)
            { time: T + 60_000, open: 100, high: 112, low: 99, close: 111, volume: 1 },     // post-thesis win
        ] as never);
        const s = { id: 'sT2', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: T, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.kind).toBe('repeat');
    });

    it('REFUSES to score when the fetched 120-bar window starts AFTER the thesis (partial window ⇒ no verdict)', async () => {
        // A 3-day-old thesis on 15m candles: the last 120 bars cover ~30h,
        // so the fetch starts 2.5 days AFTER the discussion. Within that
        // partial window price touches TP and never the stop — the old code
        // minted a false 'repeat' WIN draft even though the stop may have
        // blown two days earlier, OUTSIDE the covered window. The honest
        // answer is "cannot tell": cache as open, queue nothing.
        const T = Date.now() - 3 * 86_400_000;
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([
            { time: T + 2.5 * 86_400_000, open: 100, high: 111, low: 99, close: 110, volume: 1 },
            { time: T + 2.9 * 86_400_000, open: 105, high: 112, low: 100, close: 111, volume: 1 },
        ] as never);
        const s = { id: 'sOld', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: T, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        // Not discarded either — kept as an open thesis for the resolver.
        expect(localStorage.getItem('session_review_open_theses_v1:alice')).toContain('"BTCUSDT"');
    });

    it('a SKIPPED gate result never marks the thesis drafted (cooldown cannot silence it forever)', async () => {
        const thesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' } as DiscussedThesis;
        const fp = thesisFingerprint(thesis);
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never); // WIN
        // Active tombstone cooldown for this exact trigger → the evidence
        // gate returns 'skipped' WITHOUT ever judging the idea.
        tombstoneSkillDraftKey(draftTriggerKey('BTC', craftedSkillFromThesis(thesis, 'win')), USER);

        const s = { id: 'sSkip', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: 0, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(0);

        const drafted = JSON.parse(localStorage.getItem('session_review_drafted_v1:alice') || '[]') as string[];
        // Pre-fix markDrafted fired on 'skipped' too — the thesis could
        // NEVER be drafted again even after the cooldown expired.
        expect(drafted).not.toContain(fp);
        // It remains eligible: still in the open cache for a later resolver run.
        expect(localStorage.getItem('session_review_open_theses_v1:alice')).toContain('"BTCUSDT"');
    });

    it('a JUDGED reject (worth-gate skip verdict) fingerprints the thesis — no re-judging churn', async () => {
        const thesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' } as DiscussedThesis;
        const fp = thesisFingerprint(thesis);
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never); // WIN
        // The worth gate JUDGES the idea and refuses it (confidence ≥ 0.55
        // so the verdict rides through as 'skip').
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify({
            verdict: 'skip', reason: 'one-off narrative, not a repeatable edge', confidence: 0.8,
        }));

        const s = { id: 'sJudged', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: 0, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(0);

        // Pre-fix this returned plain 'skipped' → the thesis stayed eligible
        // and the resolver re-ran the full klines+LLM worth-gate on it every
        // 10 minutes for the whole 14-day TTL (each re-cache refreshed
        // cachedAtMs, extending the TTL unboundedly).
        const drafted = JSON.parse(localStorage.getItem('session_review_drafted_v1:alice') || '[]') as string[];
        expect(drafted).toContain(fp);
        // Not parked in the open cache either.
        expect(localStorage.getItem('session_review_open_theses_v1:alice')).not.toContain('"BTCUSDT"');
        // A later pass skips it WITHOUT paying the gate again.
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(0);
        expect(vi.mocked(getQuickResponse)).toHaveBeenCalledTimes(1);
    });

    it('resolver: a JUDGED reject markDrafts and ages out; a never-judged skip retries', async () => {
        const thesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' } as DiscussedThesis;
        const fp = thesisFingerprint(thesis);
        cacheOpenThesis(USER, 's1', thesis);
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never); // WIN
        vi.mocked(getQuickResponse).mockResolvedValue(JSON.stringify({
            verdict: 'skip', reason: 'not repeatable', confidence: 0.8,
        }));
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(0);
        const drafted = JSON.parse(localStorage.getItem('session_review_drafted_v1:alice') || '[]') as string[];
        expect(drafted).toContain(fp);
        // Judged once → dropped from the open cache (not kept for retry).
        expect(JSON.parse(localStorage.getItem('session_review_open_theses_v1:alice') || '[]')).toHaveLength(0);
    });

    it('cacheOpenThesis never refreshes cachedAtMs — re-caching cannot extend the TTL', async () => {
        const thesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' } as DiscussedThesis;
        cacheOpenThesis(USER, 's1', thesis);
        const before = JSON.parse(localStorage.getItem('session_review_open_theses_v1:alice') || '[]');
        await new Promise(res => setTimeout(res, 5));
        // The pre-fix drop-and-re-push rewrote the row with a FRESH
        // cachedAtMs — a never-judged skip path renewed its 14-day TTL
        // every review pass and the cache never aged out.
        cacheOpenThesis(USER, 's2', { ...thesis });
        const rows = JSON.parse(localStorage.getItem('session_review_open_theses_v1:alice') || '[]');
        expect(rows).toHaveLength(1);
        expect(rows[0].cachedAtMs).toBe(before[0].cachedAtMs);
        expect(rows[0].sessionId).toBe('s1');
    });

    it('the dedupe set stores thesis FINGERPRINTS, not session ids (eviction stays honest)', async () => {
        const thesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' } as DiscussedThesis;
        vi.mocked(sendChatRequest).mockResolvedValue(JSON.stringify([
            { symbol: 'BTCUSDT', direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', interval: '15m' },
        ]));
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
        const s = { id: 's-42', transcript: 'user: long BTC 100 stop 90 target 110 here', atMs: 0, symbol: 'BTCUSDT' };
        expect(await runSessionSkillReview(USER, [s], cfg)).toBe(1);
        const drafted = JSON.parse(localStorage.getItem('session_review_drafted_v1:alice') || '[]') as string[];
        // Exactly the judged fingerprint — the dead `session.id` write used
        // to occupy slots of the 200-cap set and evict real fingerprints.
        expect(drafted).toEqual([thesisFingerprint(thesis)]);
    });
});

describe('runThesisResolver (event-driven resolution)', () => {
    const thesis: DiscussedThesis = { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfit: 110, thesis: 'reclaim', atMs: 0, interval: '15m' };

    it('queues a cached thesis the moment price resolves it — once', async () => {
        cacheOpenThesis(USER, 's1', thesis);
        // Still unresolved → nothing queued, thesis stays cached.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never);
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(0);
        // Price resolves it as a win → the draft lands WITHOUT another
        // extraction pass.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 111, low: 99, close: 110, volume: 1 }] as never);
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
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 }] as never); // open
        expect(await runSessionSkillReview(USER, [session], cfg)).toBe(0);
        expect(listSkillDrafts(USER)).toHaveLength(0);
        // Days later, the bars printed — the resolver catches it on the next
        // send without waiting for the next 3-session boundary.
        vi.mocked(fetchKlines).mockResolvedValue([{ time: 0, open: 100, high: 89, low: 80, close: 85, volume: 1 }] as never); // SL hit
        clearThrottle();
        expect(await runThesisResolver(USER, cfg)).toBe(1);
        expect(listSkillDrafts(USER)[0].crafted.kind).toBe('avoid');
    });
});

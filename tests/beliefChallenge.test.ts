import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.4d — settled beliefs need a challenge path: a deterministic rolling-window
// counter per belief slug for WIN trades whose direction contradicts the
// belief's claim; ≥3 in 30 days → FLAG for review (queued proposal) — NEVER
// auto-invalidation; a human decides.

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { upsertSettledBeliefUnlocked } from '../services/learning/settledBeliefs';
import { contestedDirection, runBeliefChallengePass } from '../services/learning/beliefChallenge';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'bc-user';

const makeWin = (id: string, direction: 'Long' | 'Short', coin: string, daysAgo: number, family?: string): LoggedTrade => ({
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analysis: { coinName: coin, direction, detectedPatternFamily: family ?? 'premium sweep' } as any,
    outcome: TradeOutcome.WIN,
    timestamp: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
} as LoggedTrade);

describe('contestedDirection', () => {
    it('extracts the warned direction from the belief body', () => {
        expect(contestedDirection('Never short into premium')).toBe('short');
        expect(contestedDirection('Avoid going long on news days')).toBe('long');
        expect(contestedDirection('Don\'t buy the trend candle')).toBe('long');
        expect(contestedDirection('Always wait for the reclaim')).toBeNull(); // no prohibition
    });
});

describe('runBeliefChallengePass', () => {
    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    it('flags a belief at ≥3 contradicting wins and NEVER invalidates it', async () => {
        await upsertSettledBeliefUnlocked({ slug: 'never-short-premium', body: 'Never short into premium', evidenceCount: 5, regime: 'trend' }, USER);
        const trades = [
            makeWin('w1', 'Short', 'BTCUSDT', 2),
            makeWin('w2', 'Short', 'BTCUSDT', 5),
            makeWin('w3', 'Short', 'BTCUSDT', 8),
        ];
        const flags = await runBeliefChallengePass(USER, trades);
        expect(flags).toBe(1); // 3 contradictions → one flag (deduped)
        const props = JSON.parse(localStorage.getItem('learning_proposals_v1:' + USER) ?? '[]');
        expect(props).toHaveLength(1);
        expect(props[0].kind).toBe('contradiction');
        expect(props[0].text).toContain('never-short-premium');
        // The belief is still settled — the challenge is a flag, not an erasure.
        const beliefs = parseBeliefsFromCache();
        expect(beliefs.some(b => b.slug === 'never-short-premium' && b.status === 'settled')).toBe(true);
    });

    it('re-runs produce no new flags (event dedupe + pending proposal dedupe)', async () => {
        await upsertSettledBeliefUnlocked({ slug: 'never-short-premium', body: 'Never short into premium', evidenceCount: 5 }, USER);
        const trades = [
            makeWin('w1', 'Short', 'BTCUSDT', 2),
            makeWin('w2', 'Short', 'BTCUSDT', 5),
            makeWin('w3', 'Short', 'BTCUSDT', 8),
        ];
        expect(await runBeliefChallengePass(USER, trades)).toBe(1);
        expect(await runBeliefChallengePass(USER, trades)).toBe(0);
    });

    it('ignores trade-direction mismatches and context mismatches', async () => {
        await upsertSettledBeliefUnlocked({ slug: 'never-short-premium', body: 'Never short into btc premium', evidenceCount: 5 }, USER);
        const trades = [
            makeWin('long1', 'Long', 'BTCUSDT', 2),             // opposite stance — no contradiction
            makeWin('eth1', 'Short', 'ETHUSDT', 3),             // wrong context — no contradiction
        ];
        const flags = await runBeliefChallengePass(USER, trades);
        expect(flags).toBe(0);
    });

    it('flags only once per trade (same trade cannot contradict twice)', async () => {
        await upsertSettledBeliefUnlocked({ slug: 'never-short-premium', body: 'Never short into premium', evidenceCount: 5 }, USER);
        const trades = [
            makeWin('only1', 'Short', 'BTCUSDT', 2),
            makeWin('only2', 'Short', 'BTCUSDT', 4),
            makeWin('only3', 'Short', 'BTCUSDT', 6),
            makeWin('dup', 'Short', 'BTCUSDT', 2),  // same info as only1 — deduped by id
        ];
        // 3 unique contradicting trades → 1 flag (dup doesn't add a 4th)
        expect(await runBeliefChallengePass(USER, trades)).toBe(1);
    });
});

/** Read the beliefs back from the notebook cache (status must stay settled). */
const parseBeliefsFromCache = (): Array<{ slug: string; status: string }> => {
    const file = getMemoryFiles().files.find(f => f.name === 'settled-beliefs.md');
    if (!file) return [];
    const out: Array<{ slug: string; status: string }> = [];
    let slug = '';
    for (const line of file.content.split('\n')) {
        const h = line.match(/^##\s+(.+)$/);
        if (h) { slug = h[1].trim(); continue; }
        const s = line.match(/^status:\s*(settled|invalidated)/i);
        if (s) out.push({ slug, status: s[1].toLowerCase() });
    }
    return out;
};

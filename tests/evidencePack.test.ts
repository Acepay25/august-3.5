import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoggedTrade } from '../types';
import { TradeOutcome } from '../types';

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

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    buildSetupStatsLine,
    computeSetupClusterStats,
    buildVerdictEvidencePack,
    deriveSetupQueryFromPrompt,
    EVIDENCE_PACK_MAX_CHARS,
} from '../services/learning/EvidencePackService';
import { ARBITER_ALLOWED_TOOLS, DESK_TOOL_DEFINITIONS } from '../services/analysis/DeskToolsService';

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as LoggedTrade['analysis'],
    outcome: TradeOutcome.LOSS,
    timestamp: '2026-08-20T12:00:00.000Z',
    postMortem: '**Key Lesson:** Wait for the reclaim before entering.',
    ...overrides,
} as LoggedTrade);

describe('EvidencePackService', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles('test-user');
    });

    it('computes cluster stats over coin+direction+family', () => {
        const trades = [
            makeTrade(),
            makeTrade({ id: 'w1', outcome: TradeOutcome.WIN }),
            makeTrade({ id: 'other-coin', analysis: { coinName: 'ETHUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as LoggedTrade['analysis'] }),
        ];
        const stats = computeSetupClusterStats('BTC', 'Short', 'Family A', trades);
        expect(stats).not.toBeNull();
        expect(stats!.sample).toBe(2);
        expect(stats!.wins).toBe(1);
        expect(stats!.losses).toBe(1);
        expect(stats!.worstLesson).toContain('reclaim');
    });

    it('returns null stats with no history and a thin-sample line below 3', () => {
        expect(computeSetupClusterStats('BTC', 'Short', undefined, [])).toBeNull();
        const line = buildSetupStatsLine('BTC', 'Short', undefined, [makeTrade()]);
        expect(line).toContain('too thin');
    });

    it('builds a full evidence pack with similar trades capped at 3', () => {
        const trades = Array.from({ length: 6 }, (_, i) =>
            makeTrade({ id: `s${i}`, timestamp: new Date(Date.parse('2026-08-20T12:00:00Z') - i * 86_400_000).toISOString() }));
        const pack = buildVerdictEvidencePack(deriveSetupQueryFromPrompt('BTC short fakeout watch'), trades);
        expect(pack.ui.similar.length).toBeLessThanOrEqual(3);
        expect(pack.ui.statsLine).not.toBe('');
        expect(pack.promptBlock).toContain('Similar closed trades');
        expect(pack.promptBlock.length).toBeLessThanOrEqual(EVIDENCE_PACK_MAX_CHARS + 2);
    });

    it('degrades to an empty prompt block with no data', () => {
        const pack = buildVerdictEvidencePack(undefined, []);
        expect(pack.promptBlock).toBe('');
    });

    it('derives the setup query from the prompt like the pipeline does', () => {
        const q = deriveSetupQueryFromPrompt('ETH long continuation into demand');
        expect(q.coin).toBe('ETH');
        expect(q.direction).toBe('Long');
        expect(q.family).toBe('Family C');
    });
});

describe('Desk tools additions', () => {
    it('registers get_setup_history_stats in the catalog and arbiter policy', () => {
        const names = DESK_TOOL_DEFINITIONS.map(t => t.function.name);
        expect(names).toContain('get_setup_history_stats');
        expect(ARBITER_ALLOWED_TOOLS).toContain('recall');
        expect(ARBITER_ALLOWED_TOOLS).toContain('get_setup_history_stats');
        // The arbiter must NOT have order-book/derivatives by default (D0.2).
        expect(ARBITER_ALLOWED_TOOLS).not.toContain('get_order_book');
        expect(ARBITER_ALLOWED_TOOLS).not.toContain('get_derivatives');
    });

    it('runs get_setup_history_stats offline from the journal', async () => {
        const { executeDeskTool } = await import('../services/analysis/DeskToolsService');
        const trades = [
            makeTrade(),
            makeTrade({ id: 'w2', outcome: TradeOutcome.WIN }),
            makeTrade({ id: 'w3', outcome: TradeOutcome.WIN }),
        ];
        const res = await executeDeskTool(
            { id: 'c1', name: 'get_setup_history_stats', arguments: { symbol: 'BTCUSDT', direction: 'Short' } },
            { defaultSymbol: 'BTCUSDT', trades },
        );
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.content) as { sample: number; wins: number; losses: number };
        expect(parsed.sample).toBe(3);
        expect(parsed.wins).toBe(2);
        expect(parsed.losses).toBe(1);
    });

    it('answers honestly when there is no sample', async () => {
        const { executeDeskTool } = await import('../services/analysis/DeskToolsService');
        const res = await executeDeskTool(
            { id: 'c2', name: 'get_setup_history_stats', arguments: { symbol: 'SOLUSDT' } },
            { defaultSymbol: 'BTCUSDT', trades: [] },
        );
        expect(res.ok).toBe(true);
        expect(JSON.parse(res.content)).toMatchObject({ sample: 0 });
    });
});

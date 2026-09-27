import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the real PreferencesService fallback (localStorage) but neutralize the
// async persistence so saves are silent no-ops in jsdom.
vi.mock('../services/infrastructure/PreferencesService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    return { ...actual, setPreferenceObject: vi.fn(async () => undefined) };
});

import { creditedWinForAnalyst, syncFromTradeLog, loadPerformanceData } from '../services/backtesting/ModelPerformanceService';
import { TradeAnalysis } from '../types/analysis';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';

const analysisWithConsensus = (direction: string, providerId: string, callDirection: string): TradeAnalysis => ({
    direction: direction as TradeAnalysis['direction'],
    analystConsensus: {
        entries: [{ providerId, direction: callDirection }],
    },
} as unknown as TradeAnalysis);

const loggedTrade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    outcome: TradeOutcome.WIN,
    timestamp: new Date().toISOString(),
    modelsUsed: { provA: 'model-x' },
    ...over,
} as LoggedTrade);

describe('creditedWinForAnalyst — the one per-analyst credit semantic', () => {
    it('credits an agreeing analyst the trade outcome', () => {
        const analysis = analysisWithConsensus('Long', 'provA', 'Long');
        expect(creditedWinForAnalyst(analysis, true, 'provA')).toBe(true);
        expect(creditedWinForAnalyst(analysis, false, 'provA')).toBe(false);
    });

    it('credits a DISSENTING analyst the inverse outcome', () => {
        const analysis = analysisWithConsensus('Long', 'provA', 'Short');
        expect(creditedWinForAnalyst(analysis, true, 'provA')).toBe(false);
        expect(creditedWinForAnalyst(analysis, false, 'provA')).toBe(true);
    });

    it('falls back to the raw outcome without a consensus entry or direction', () => {
        expect(creditedWinForAnalyst(undefined, true, 'provA')).toBe(true);
        expect(creditedWinForAnalyst({ direction: 'Long' } as TradeAnalysis, true, 'provA')).toBe(true);
    });
});

describe('syncFromTradeLog — rebuild uses the same credit as the incremental path', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('a dissenting analyst accrues the INVERSE outcome in the rebuild (was raw before)', () => {
        // WIN trade; provA called Short. Incremental path: creditedWin=false.
        // The rebuild used to credit every provider the raw verdict, so the
        // same model's record flipped meaning on every app restart.
        syncFromTradeLog([
            loggedTrade({
                analysis: analysisWithConsensus('Long', 'provA', 'Short'),
            }),
            loggedTrade({
                id: 't2',
                analysis: analysisWithConsensus('Long', 'provA', 'Long'),
            }),
        ]);
        const data = loadPerformanceData();
        const provA = data['provA'];
        expect(provA).toBeDefined();
        // One dissenting loss + one agreeing win.
        expect(provA.overallStats.losses).toBe(1);
        expect(provA.overallStats.wins).toBe(1);
        expect(provA.overallStats.total).toBe(2);
    });
});

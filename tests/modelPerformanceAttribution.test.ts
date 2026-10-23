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

describe('syncConfidenceCalibrationFromTradeLog — the buckets are derived, not accumulated', () => {
    // `analysis.confidence` is what the incremental writer buckets on; the
    // consensus entry decides whether the sample is a win for THIS provider.
    const highCall = (providerId: string, callDirection = 'Long'): TradeAnalysis =>
        ({ ...analysisWithConsensus('Long', providerId, callDirection), confidence: 'High' }) as unknown as TradeAnalysis;

    // The service keeps its buckets in a module-level cache that deliberately
    // outlives localStorage.clear(), so each test gets a FRESH module — the
    // same reason syncFromTradeLog resets its own cache on rebuild.
    let svc: typeof import('../services/backtesting/ModelPerformanceService');
    beforeEach(async () => {
        localStorage.clear();
        vi.resetModules();
        svc = await import('../services/backtesting/ModelPerformanceService');
    });

    it('a rebuild reproduces exactly what the incremental writer counted — two writers, one format', () => {
        const trades = [
            loggedTrade({ id: 'a', analysis: highCall('provA') }),
            loggedTrade({ id: 'b', outcome: TradeOutcome.LOSS, analysis: highCall('provA') }),
        ];
        // The incremental path, verbatim from useTradeLogging.ts:177-191.
        for (const t of trades) {
            const isWin = t.outcome === TradeOutcome.WIN;
            for (const p of svc.getTradeProviders(t)) {
                svc.recordProviderConfidenceCalibration(
                    p, (t.analysis as TradeAnalysis).confidence || 'Medium',
                    svc.creditedWinForAnalyst(t.analysis, isWin, p),
                );
            }
        }
        const incremental = svc.getCalibrationSummaries().find(s => s.provider === 'provA');
        svc.syncConfidenceCalibrationFromTradeLog(trades);
        const rebuilt = svc.getCalibrationSummaries().find(s => s.provider === 'provA');
        // If these drift apart, one of the two writers has its own idea of what
        // a sample is, and the Brier panel changes shape across a restart.
        expect(rebuilt?.samples).toBe(incremental?.samples);
        expect(rebuilt?.brierScore).toBe(incremental?.brierScore);
        expect(rebuilt?.samples).toBe(2);
    });

    it('a re-settled trade un-counts on the next rebuild (the counters-only defect)', () => {
        // Logged as a WIN at High confidence…
        svc.recordProviderConfidenceCalibration('provA', 'High', true);
        expect(svc.getCalibrationSummaries().find(s => s.provider === 'provA')?.highGap).toBe(-30);
        // …then re-settled to a LOSS. The incremental writer has no reverse
        // gear, so the ONLY honest fix is deriving from the log: declared 70 %,
        // realized 0 % ⇒ gap +70, not the stale −30 of a bucket that never
        // heard about the re-settlement. The Brier term for a LOSS at the 0.7
        // anchor is anchor² = 0.49 — a win would have been (1−0.7)² = 0.09.
        svc.syncConfidenceCalibrationFromTradeLog([
            loggedTrade({ id: 'a', outcome: TradeOutcome.LOSS, analysis: highCall('provA') }),
        ]);
        const s = svc.getCalibrationSummaries().find(x => x.provider === 'provA');
        expect(s?.samples).toBe(1);
        expect(s?.highGap).toBe(70);
        expect(s?.brierScore).toBeCloseTo(0.49, 4);
    });

    it('a mirror-corrected plan counts in NEITHER writer', () => {
        // The incremental writer skips mirrored plans (providers = []), so the
        // rebuild must skip the same rows or a corrected trade starts counting
        // for a call the model never made.
        svc.syncConfidenceCalibrationFromTradeLog([
            loggedTrade({ id: 'm', analysis: { ...highCall('provA'), levelsCorrected: true } as unknown as TradeAnalysis }),
        ]);
        expect(svc.getCalibrationSummaries().find(s => s.provider === 'provA')).toBeUndefined();
    });

    it('a provider the log cannot reconstruct survives the rebuild (the legacy shelf)', () => {
        svc.recordProviderConfidenceCalibration('legacy-provider', 'Low', false);
        svc.syncConfidenceCalibrationFromTradeLog([
            loggedTrade({ id: 'x', analysis: highCall('provA') }),
        ]);
        const providers = svc.getCalibrationSummaries().map(s => s.provider);
        expect(providers).toContain('legacy-provider');
        expect(providers).toContain('provA');
    });
});

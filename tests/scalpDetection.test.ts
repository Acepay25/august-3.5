/**
 * The scalp/swing detector had no tests at all (2026-09-22).
 *
 * `ScalpDetectionService` is the producer the Journal's ◆ scalp / ◇ swing filter
 * needs, and it was called by nothing. One reason to leave it alone was honest:
 * an untested heuristic writing into persisted journal rows is not a change
 * anyone should land blind. This file removes that reason, so wiring becomes a
 * decision about thresholds rather than a leap of faith.
 *
 * It also pins the coupling that makes wiring non-trivial: the applier does not
 * only label a trade, it FILLS `validityDurationMinutes` when absent — and that
 * field is what `OutcomeAutopilotService` uses to decide a setup has expired.
 * So the same call that colours a journal row also widens autopilot's reach.
 */

import { describe, it, expect } from 'vitest';
import {
    applyTradeTypeToAnalysis,
    detectTradeType,
    getTradeTypeStats,
    validateScalpTrade,
    validateSwingTrade,
    withDetectedTradeType,
} from '../services/analysis/ScalpDetectionService';
import { TradeOutcome } from '../types/enums';
import type { LoggedTrade, TradeAnalysis } from '../types';

/** Fixture builder. Takes a loose object on purpose: the assertions here are
 *  about the detector's decisions, and hand-writing a complete `PatternDetail`
 *  / `EntryPoint` for every case would only test the type declarations. */
const a = (over: object = {}): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'Medium',
    strategy: 'Fade the first break of the range.',
    ...over,
} as TradeAnalysis);

const logged = (id: string, type: 'scalp' | 'swing' | undefined, outcome: string, pnl?: number): LoggedTrade => ({
    id,
    tradeType: type,
    outcome: outcome as LoggedTrade['outcome'],
    pnlAmount: pnl,
    timestamp: '2026-09-01T00:00:00.000Z',
    analysis: a({ tradeType: undefined }),
} as LoggedTrade);

describe('detectTradeType', () => {
    it('calls a tight stop, short window, 5m momentum setup a scalp — with reasons', () => {
        const r = detectTradeType(a({
            stopLossPercentage: '-0.6%',
            validityDurationMinutes: 20,
            strategy: '5m momentum continuation',
        }));
        expect(r.detectedType).toBe('scalp');
        expect(r.confidence).toBe('high');       // 3 + 2 + 2 = 7 vs 0
        expect(r.suggestedValidityMinutes).toBe(20);
        expect(r.reasons.join(' ')).toMatch(/Tight SL/);
        expect(r.reasons.join(' ')).toMatch(/Short validity/);
        // One keyword reason only: the loop breaks on the FIRST hit in
        // threshold order, so "5m momentum" reports 5m, not momentum.
        expect(r.reasons.join(' ')).toMatch(/Strategy contains/);
    });

    it('calls a wide stop, long window, swing-worded plan a swing', () => {
        const r = detectTradeType(a({
            stopLossPercentage: '-2.5%',
            validityDurationMinutes: 400,
            strategy: 'Weekly swing from the daily shelf',
        }));
        expect(r.detectedType).toBe('swing');
        expect(r.confidence).toBe('high');
        expect(r.suggestedValidityMinutes).toBe(330);
    });

    it('reads the stored signed SL as a magnitude, not a signed number', () => {
        // The percentage is persisted negative ("-1.5%"). Without abs() every
        // trade scored scalp, because -1.5 ≤ 1.0, and the swing branch became
        // unreachable — so this case must score NEITHER factor.
        const r = detectTradeType(a({ stopLossPercentage: '-1.5%' }));
        expect(r.reasons.join(' ')).not.toMatch(/Tight SL/);
        expect(r.reasons.join(' ')).not.toMatch(/Wide SL/);
    });

    it('falls back to swing with low confidence when nothing speaks either way', () => {
        const r = detectTradeType(a({}));
        expect(r.detectedType).toBe('swing');
        expect(r.confidence).toBe('low');
        expect(r.reasons).toEqual([]);
    });

    it('reports medium confidence for a one-point margin', () => {
        const r = detectTradeType(a({ validityDurationMinutes: 25 }));   // scalp +2 only
        expect(r.detectedType).toBe('scalp');
        expect(r.confidence).toBe('medium');
    });

    it('counts the pattern timeframe as evidence, in both directions', () => {
        const short = detectTradeType(a({ detectedPatterns: [{ timeframe: '1m' }] }));
        const long = detectTradeType(a({ detectedPatterns: [{ timeframe: '1d' }] }));
        expect(short.reasons.join(' ')).toMatch(/short timeframe/);
        expect(long.reasons.join(' ')).toMatch(/higher timeframe/);
        expect(long.detectedType).toBe('swing');
    });
});

describe('applyTradeTypeToAnalysis', () => {
    it('labels an untyped analysis from the detection', () => {
        const out = applyTradeTypeToAnalysis(a({ stopLossPercentage: '-0.4%', validityDurationMinutes: 15 }));
        expect(out.tradeType).toBe('scalp');
    });

    it('leaves a manual override alone', () => {
        const manual = a({ tradeType: 'swing', tradeTypeManualOverride: true, stopLossPercentage: '-0.2%', validityDurationMinutes: 5 });
        expect(applyTradeTypeToAnalysis(manual).tradeType).toBe('swing');
    });

    /** THE COUPLING. This is why wiring the detector into finalization is not a
     *  cosmetic change: an analysis with no stated validity gains one here, and
     *  `OutcomeAutopilotService` expires a setup from exactly that field. A
     *  verdict that never auto-expired starts expiring the moment the detector
     *  is called. */
    it('fills a missing validity — the side effect that reaches autopilot', () => {
        const out = applyTradeTypeToAnalysis(a({ stopLossPercentage: '-0.4%' }));
        expect(out.tradeType).toBe('scalp');
        // Not left undefined: the detector's suggestion lands, and with it the
        // autopilot expiry window this verdict never had.
        expect(out.validityDurationMinutes).toBe(20);
        const stated = applyTradeTypeToAnalysis(a({ stopLossPercentage: '-0.4%', validityDurationMinutes: 10 }));
        expect(stated.validityDurationMinutes).toBe(10);
    });

    it('never overwrites a validity the model already stated', () => {
        const out = applyTradeTypeToAnalysis(a({ validityDurationMinutes: 90, stopLossPercentage: '-0.4%', detectedPatterns: [{ timeframe: '1m' }] }));
        expect(out.validityDurationMinutes).toBe(90);
    });
});

describe('validateScalpTrade', () => {
    const scalp = (entry: string, sl: string, tp: string, over: Partial<TradeAnalysis> = {}) =>
        a({ direction: 'Long', entryPoints: [{ price: entry }], stopLoss: sl, takeProfit: [{ price: tp }], ...over });

    it('passes a well-formed scalp', () => {
        const r = validateScalpTrade(scalp('100000', '99600', '100900'));
        expect(r.isValid).toBe(true);
        expect(r.shouldDowngrade).toBe(false);
    });

    it('flags inverted levels instead of silently skipping them', () => {
        // TP below entry / SL above: the old `risk > 0` guard ignored these and
        // let an inverted scalp through undowngraded.
        const r = validateScalpTrade(scalp('100000', '100400', '99500'));
        expect(r.shouldDowngrade).toBe(true);
        expect(r.warnings.join(' ')).toMatch(/wrong side of entry/);
    });

    it('downgrades a scalp under 1:1 risk to reward', () => {
        const r = validateScalpTrade(scalp('100000', '99000', '100500'));   // 1:0.5
        expect(r.shouldDowngrade).toBe(true);
        expect(r.warnings.join(' ')).toMatch(/below minimum 1:1/);
    });

    it('downgrades off-hours and weekend scalps', () => {
        const off = validateScalpTrade(scalp('100000', '99600', '100900'), { currentSession: 'off_hours', isWeekend: false });
        const weekend = validateScalpTrade(scalp('100000', '99600', '100900'), { currentSession: 'london', isWeekend: true });
        expect(off.shouldDowngrade).toBe(true);
        expect(weekend.warnings.join(' ')).toMatch(/Weekend/);
    });

    it('warns on a confident scalp with a loose stop, without downgrading it', () => {
        const r = validateScalpTrade(scalp('100000', '99600', '100900', { confidence: 'High', stopLossPercentage: '-0.9%' }));
        expect(r.warnings.join(' ')).toMatch(/loose for a scalp/);
        expect(r.shouldDowngrade).toBe(false);
    });
});

describe('validateSwingTrade', () => {
    it('recommends 1.5:1 but never downgrades a swing for missing it', () => {
        // 120 reward against 1000 risk is 1.2:1 — 101500 would be exactly 1.5
        // and correctly pass, so the boundary matters here.
        const r = validateSwingTrade(a({
            direction: 'Long', entryPoints: [{ price: '100000' }], stopLoss: '99000', takeProfit: [{ price: '101200' }],
        }));
        expect(r.warnings.join(' ')).toMatch(/below recommended 1.5:1/);
        expect(r.shouldDowngrade).toBe(false);
    });

    it('warns that a swing with a short window is mis-tagged', () => {
        const r = validateSwingTrade(a({ validityDurationMinutes: 30 }));
        expect(r.warnings.join(' ')).toMatch(/Short validity window/);
    });

    it('stays silent when levels cannot be parsed', () => {
        expect(validateSwingTrade(a({})).warnings).toEqual([]);
    });
});

/** A declined verdict has no entry, no stop and no target — and until both
 *  validators optional-chained their entry, calling either one on that shape
 *  threw `Cannot read properties of undefined (reading '0')`. Any wiring of this
 *  service into finalization would have hit it on the first "Avoid" the model
 *  produced, so the fix is pinned rather than assumed. */
describe('validators tolerate a declined verdict with no levels', () => {
    const declined = a({ direction: 'Neutral', confidence: 'Low', validityDurationMinutes: 45 });

    it('validates a swing with no entry at all', () => {
        expect(() => validateSwingTrade(declined)).not.toThrow();
        const r = validateSwingTrade(declined);
        expect(r.warnings.join(' ')).toMatch(/Short validity window/);
        expect(r.shouldDowngrade).toBe(false);
    });

    it('validates a scalp with no entry at all', () => {
        expect(() => validateScalpTrade(declined)).not.toThrow();
        const r = validateScalpTrade(declined);
        // No prices means no R:R opinion — silence, not a false pass or a crash.
        expect(r.warnings).toEqual([]);
        expect(r.isValid).toBe(true);
    });
});

/** The pipeline calls THIS one, not `applyTradeTypeToAnalysis`, because the
 *  validity fill would hand an expiry window to verdicts that never had one.
 *  If this ever starts touching validity, autopilot quietly widens. */
describe('withDetectedTradeType', () => {
    it('labels an untyped verdict', () => {
        const out = withDetectedTradeType(a({ stopLossPercentage: '-0.3%', validityDurationMinutes: 15 }));
        expect(out.tradeType).toBe('scalp');
    });

    it('leaves validity exactly as it was — including absent', () => {
        const out = withDetectedTradeType(a({ stopLossPercentage: '-0.3%' }));
        expect(out.tradeType).toBe('scalp');
        expect(out.validityDurationMinutes).toBeUndefined();
        const stated = withDetectedTradeType(a({ validityDurationMinutes: 90 }));
        expect(stated.validityDurationMinutes).toBe(90);
    });

    it('never relabels a type that is already stated', () => {
        const swing = a({ tradeType: 'swing', stopLossPercentage: '-0.2%', validityDurationMinutes: 5 });
        expect(withDetectedTradeType(swing).tradeType).toBe('swing');
        expect(withDetectedTradeType(swing)).toBe(swing);      // untouched object
    });

    it('labels a declined verdict without throwing on its missing levels', () => {
        const declined = a({ direction: 'Neutral', confidence: 'Low' });
        expect(withDetectedTradeType(declined).tradeType).toBe('swing');
    });
});

describe('getTradeTypeStats', () => {
    it('keeps unlabelled legacy trades in the swing bucket instead of dropping them', () => {
        const stats = getTradeTypeStats([
            logged('s1', 'scalp', TradeOutcome.WIN, 100),
            logged('s2', 'scalp', TradeOutcome.LOSS, -50),
            logged('l1', undefined, TradeOutcome.WIN, 200),
        ]);
        expect(stats.scalp).toMatchObject({ wins: 1, losses: 1, winRate: 50 });
        expect(stats.swing.wins).toBe(1);
        expect(stats.swing.winRate).toBe(100);
    });

    it('computes win rate from DECIDED trades only', () => {
        const stats = getTradeTypeStats([
            logged('w', 'scalp', TradeOutcome.WIN, 100),
            logged('n', 'scalp', TradeOutcome.ENTRY_NOT_HIT),
            logged('m', 'scalp', TradeOutcome.SKIPPED),
        ]);
        expect(stats.scalp.wins).toBe(1);
        expect(stats.scalp.losses).toBe(0);
        expect(stats.scalp.winRate).toBe(100);
    });
});

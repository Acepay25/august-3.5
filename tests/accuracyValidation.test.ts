import { describe, expect, it } from 'vitest';
import { validateMultiTimeframeConfluence, validateRiskReward } from '../services/validation/AccuracyValidationService';
import { validateTimeframeAlignment, matchPatternMemory } from '../services/validation/TradeValidationGate';
import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';

describe('accuracy validation confidence policy', () => {
    it('downgrades an ordinary opposing MTF read instead of forcing Avoid', () => {
        const result = validateMultiTimeframeConfluence(
            { direction: 'bearish', score: 40, strength: 'moderate', alignment: ['4h'], conflicts: ['15m'] },
            'Long',
            'Medium',
        );

        expect(result.adjustedConfidence).toBe('Low');
        expect(result.adjustedConfidence).not.toBe('Avoid');
        expect(result.warnings.some(warning => /not Avoid/i.test(warning))).toBe(true);
    });

    it('keeps Avoid for a strongly opposing MTF read', () => {
        const result = validateMultiTimeframeConfluence(
            { direction: 'bearish', score: 20, strength: 'strong', alignment: ['4h'], conflicts: ['15m', '1h'] },
            'Long',
            'High',
        );

        expect(result.adjustedConfidence).toBe('Avoid');
        expect(result.warnings.some(warning => /HARD BLOCK/i.test(warning))).toBe(true);
    });

    it('treats contested missing alignment as Low, but no-evidence data as Avoid', () => {
        const contested = validateTimeframeAlignment(
            { alignment: [], conflicts: ['mixed EMA'] },
            'Medium',
        );
        const empty = validateTimeframeAlignment(
            { alignment: [], conflicts: [] },
            'Medium',
        );

        expect(contested.adjustedConfidence).toBe('Low');
        expect(empty.adjustedConfidence).toBe('Avoid');
    });
});

// Tier-0 #7 (deep-dive 2026-09-15): validateRiskReward used to measure risk
// and reward with Math.abs and never received the direction — a Long with
// the stop ABOVE entry looked like a healthy 2:1 trade. With `direction`
// supplied the distances are signed through the shared ordering gate.
describe('validateRiskReward — direction-aware ordering (Tier-0 #7)', () => {
    it('rejects a Long with the stop above entry even though the abs ratio is healthy', () => {
        // Legacy Math.abs math: risk 500, reward 1000 → ratio 2.0 ≥ 1.5 → PASS.
        const result = validateRiskReward(95000, 95500, 96000, 300, 'Medium', 'Long');
        expect(result.isValid).toBe(false);
        expect(result.orderingValid).toBe(false);
        expect(result.ratio).toBe(0); // no measurable risk in the stated direction
        expect(result.warnings.some(w => /INVERTED PLAN \(Long\)/i.test(w))).toBe(true);
        expect(result.orderingFixes?.length).toBeGreaterThan(0);
    });

    it('rejects a Long whose target sits below entry (phantom-reward case)', () => {
        const result = validateRiskReward(95000, 94500, 94000, 300, 'Medium', 'Long');
        expect(result.isValid).toBe(false);
        expect(result.orderingValid).toBe(false);
        expect(result.warnings.some(w => /INVERTED PLAN/i.test(w))).toBe(true);
    });

    it('rejects an inverted Short (stop below entry)', () => {
        // Absolute distances: risk 1000, reward 500 → ratio 0.5, but the real
        // bug is the sign — a short stop MUST sit above entry.
        const result = validateRiskReward(95000, 94000, 94500, 300, 'Medium', 'Short');
        expect(result.isValid).toBe(false);
        expect(result.orderingValid).toBe(false);
        expect(result.warnings.some(w => /INVERTED PLAN \(Short\)/i.test(w))).toBe(true);
    });

    it('accepts a correctly ordered Long', () => {
        const result = validateRiskReward(95000, 94500, 96000, 300, 'Medium', 'Long');
        expect(result.isValid).toBe(true);
        expect(result.orderingValid).toBe(true);
        expect(result.ratio).toBeCloseTo(2);
        expect(result.orderingFixes).toBeUndefined();
    });

    it('accepts a correctly ordered Short with signed distances', () => {
        const result = validateRiskReward(95000, 96000, 93000, 300, 'Medium', 'Short');
        expect(result.isValid).toBe(true);
        expect(result.ratio).toBeCloseTo(2);
    });

    it('keeps the legacy absolute-value behavior for direction-less callers', () => {
        const result = validateRiskReward(95000, 95500, 96000, 300, 'Medium');
        expect(result.orderingValid).toBeUndefined();
        expect(result.ratio).toBeCloseTo(2);
    });

    it('still flags a sub-ATR stop as invalid', () => {
        const result = validateRiskReward(95000, 94950, 96000, 300, 'Medium', 'Long');
        expect(result.isValid).toBe(false);
        expect(result.orderingValid).toBe(true);
        expect(result.warnings.some(w => /TIGHT STOP/.test(w))).toBe(true);
    });
});

describe('matchPatternMemory is symbol-scoped', () => {
    const analysis = (coinName: string): TradeAnalysis => ({
        coinName,
        direction: 'Long',
        confidence: 'Medium',
        probability: 60,
        strategy: 'trend continuation',
        activeStrategies: [],
        entryPoints: [{ price: '100', description: 'retest' }],
        stopLoss: '95',
        takeProfit: [{ price: '110' }],
        marketConditions: {
            pattern: 'Breakout', candleBehavior: '', timeframeAlignment: '',
            rsi: 'overbought', macd: '', sentiment: 'bullish',
        },
        historicalCorrelation: '',
        detectedPatternFamily: 'Family C',
        createdAt: new Date().toISOString(),
    });

    const btcLoss: LoggedTrade = {
        id: 'loss-btc',
        analysis: analysis('BTCUSDT'),
        outcome: TradeOutcome.LOSS,
        timestamp: '2026-08-01T00:00:00.000Z',
    };

    it('does NOT fire a LOSS warning for a different coin (direction+family+rsi+sentiment alone ≠ pattern memory)', () => {
        // ETH setup vs the BTC loss: every dimension the old scorer checked
        // is identical — only the COIN differs — yet that used to produce
        // "similar to a previous LOSS (BTC Long…)" for an ETH analysis.
        const out = matchPatternMemory(analysis('ETHUSDT'), [btcLoss]);
        expect(out.warning).toBeNull();
        expect(out.matchedTrade).toBeNull();
    });

    it('still fires for the SAME coin (normalized: BTC vs BTCUSDT)', () => {
        const out = matchPatternMemory(analysis('BTC'), [btcLoss]);
        expect(out.warning).toContain('PATTERN MEMORY ALERT');
        expect(out.similarity).toBeGreaterThanOrEqual(70);
        expect(out.matchedTrade?.id).toBe('loss-btc');
    });

    it('lets an explicitly market-wide view (no symbol) keep cross-coin precedent', () => {
        const marketWide = { ...analysis(''), direction: 'Long' } as TradeAnalysis;
        const out = matchPatternMemory(marketWide, [btcLoss]);
        expect(out.warning).toContain('PATTERN MEMORY ALERT');
    });
});

import { describe, expect, it } from 'vitest';
import { validateMultiTimeframeConfluence, validateRiskReward } from '../services/validation/AccuracyValidationService';
import { validateTimeframeAlignment } from '../services/validation/TradeValidationGate';

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

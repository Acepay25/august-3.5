import { describe, expect, it } from 'vitest';
import { validateMultiTimeframeConfluence } from '../services/validation/AccuracyValidationService';
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

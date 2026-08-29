import { describe, it, expect } from 'vitest';

// Grade-tiered risk + Kelly advisory (Batch 2) — the deterministic ticket-math
// extensions layered onto the existing sizing.

import { gradeRiskTier, kellyAdvisory } from '../utils/ticketSize';

describe('gradeRiskTier', () => {
    it('Grade A keeps the full base risk', () => {
        const tier = gradeRiskTier('A', 1);
        expect(tier.riskPercent).toBe(1);
        expect(tier.line).toContain('full 1%');
    });

    it('Grade B halves the risk', () => {
        const tier = gradeRiskTier('B', 1);
        expect(tier.riskPercent).toBe(0.5);
        expect(tier.line).toContain('half risk');
    });

    it('Grades C/D/F fall to quarter risk with no-trade guidance', () => {
        for (const grade of ['C', 'D', 'F'] as const) {
            const tier = gradeRiskTier(grade, 2);
            expect(tier.riskPercent).toBe(0.5);
            expect(tier.line).toContain('no-trade guidance');
        }
    });

    it('a missing grade keeps the stated risk (backward compatible)', () => {
        const tier = gradeRiskTier(undefined, 1.5);
        expect(tier.riskPercent).toBe(1.5);
        expect(tier.line).toBe('1.5% risk');
    });

    it('an invalid base falls back to 1%', () => {
        const tier = gradeRiskTier('A', Number.NaN);
        expect(tier.riskPercent).toBe(1);
    });
});

describe('kellyAdvisory', () => {
    it('W=60%, R=2 (n≥20) → f*=0.4, half=20%, quarter=10%', () => {
        // 12 wins, 8 losses, avg win $200, avg loss $100 → W=0.6, R=2
        const adv = kellyAdvisory(12, 8, 200, 100);
        expect(adv.fullKelly).toBeCloseTo(0.4);
        expect(adv.halfKelly).toBeCloseTo(0.2);
        expect(adv.quarterKelly).toBeCloseTo(0.1);
        expect(adv.sampleSize).toBe(20);
        expect(adv.line).toContain('f*=40.0%');
        expect(adv.line).toContain('noisy edge');
    });

    it('n<20 → no advisory (Kelly on a thin journal is a random number generator)', () => {
        const adv = kellyAdvisory(6, 4, 200, 100);
        expect(adv.line).toBe('');
        expect(adv.fullKelly).toBe(0);
    });

    it('n≥40 drops the noisy-edge caveat', () => {
        const adv = kellyAdvisory(28, 16, 200, 100);
        expect(adv.line).toContain('journal-derived');
        expect(adv.line).not.toContain('noisy');
    });

    it('a negative edge advises no size instead of a negative fraction', () => {
        // W=30%, R=1 → f* = 0.3 − 0.7/1 = −0.4
        const adv = kellyAdvisory(6, 14, 100, 100);
        expect(adv.fullKelly).toBeLessThanOrEqual(0);
        expect(adv.quarterKelly).toBe(0);
        expect(adv.line).toContain('negative');
        expect(adv.line).toContain('no size');
    });

    it('zero losses (or zero avg loss) → undefined estimate, no line', () => {
        expect(kellyAdvisory(20, 0, 200, 100).line).toBe('');
        expect(kellyAdvisory(20, 5, 200, 0).line).toBe('');
    });
});

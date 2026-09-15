/**
 * MonteCarloPanel — the Kelly pill must pass the TRUE average win
 * (result.avgWinPercent, wave-2 computeKellyFraction 5th arg). Without it
 * the service divides EV/winRate, which is not avg win and systematically
 * shrinks (here: zeroes) the recommended fraction.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MonteCarloPanel from '../components/dashboards/MonteCarloPanel';
import type { MonteCarloResult } from '../components/dashboards/analyticsShared';
import { computeKellyFraction } from '../services/analysis/MonteCarloService';

const RESULT: MonteCarloResult = {
    simulations: 1000,
    winRate: 50,
    winCount: 500,
    expectedValue: 2,
    timeframe: '15m',
    probabilities: { tp1Hit: 40, tp2Hit: 20, tp3Hit: 5, slHit: 20, timeout: 15 },
    maxDrawdownAvg: 3,
    confidenceInterval: { lower: -5, upper: 8 },
    avgWinPercent: 8,
};

const kellyText = (): string => {
    const label = screen.getByText('Kelly (position)');
    return (label.parentElement?.textContent ?? '').trim();
};

describe('MonteCarloPanel Kelly pill', () => {
    it('feeds avgWinPercent into computeKellyFraction (5th arg)', () => {
        render(<MonteCarloPanel monteCarloResult={RESULT} />);
        const expected = computeKellyFraction(
            RESULT.winRate, RESULT.expectedValue,
            RESULT.probabilities.slHit, RESULT.confidenceInterval.lower,
            RESULT.avgWinPercent,
        );
        // b = 8/5 = 1.6 → k = (1.6·0.5 − 0.5)/1.6 = 18.75 % → "19%"
        expect(expected).toBeCloseTo(0.1875, 4);
        expect(kellyText()).toContain(`${(expected * 100).toFixed(0)}%`);
        expect(kellyText()).toBe('Kelly (position)19%');
    });

    it('would have shown 0% with the legacy EV/winRate guess', () => {
        // Guards the direction of the fix: same inputs, NO 5th arg → the
        // derived avgWin 2/0.5=4 gives b=0.8 → negative kelly → clamped 0.
        const legacy = computeKellyFraction(
            RESULT.winRate, RESULT.expectedValue,
            RESULT.probabilities.slHit, RESULT.confidenceInterval.lower,
        );
        expect(legacy).toBe(0);
        // The panel no longer renders that figure for this result.
        render(<MonteCarloPanel monteCarloResult={RESULT} />);
        expect(kellyText()).not.toBe('Kelly (position)0%');
    });

    it('legacy results without avgWinPercent fall back safely', () => {
        const legacyResult = { ...RESULT, avgWinPercent: undefined };
        render(<MonteCarloPanel monteCarloResult={legacyResult} />);
        expect(kellyText()).toBe('Kelly (position)0%');
    });
});

/**
 * Confidence-calibration single-writer. ModelPerformanceService's per-model
 * providers-shaped blob used to be written to the SAME localStorage key
 * ('confidence_calibration') that the VersionHistoryDashboard reads as the
 * bucketed {high,medium,low,avoid} ConfidenceCalibration — so each side parsed
 * the other's shape into all-`undefined` fields (silent corruption). MPS now
 * owns 'model_confidence_calibration'; on first cold read it lifts a
 * providers-shaped blob off the shared key and removes it there, while leaving
 * a bucketed blob (never ours) untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getCalibrationSummaries } from '../services/backtesting/ModelPerformanceService';

const SHARED = 'confidence_calibration';
const OWN = 'model_confidence_calibration';

describe('confidence calibration — no more shared-key collision', () => {
    beforeEach(() => localStorage.clear());

    it('lifts a providers-shaped blob onto its own key and clears the shared one', () => {
        const providersBlob = {
            providers: {
                gemini: { high: { wins: 3, total: 4 }, medium: { wins: 1, total: 2 }, low: { wins: 0, total: 1 } },
            },
            lastUpdated: 'x',
        };
        localStorage.setItem(SHARED, JSON.stringify(providersBlob));

        // Cold read of the calibration store triggers the lift. (Previously
        // exercised via the dead getModelConfidenceCalibration; the read
        // surface that survives is getCalibrationSummaries, which loads the
        // same blob through the same migration path.)
        const summaries = getCalibrationSummaries();

        // The blob was adopted (not lost) — gemini's 7 samples survive the lift.
        const gemini = summaries.find(s => s.provider === 'gemini');
        expect(gemini?.samples).toBe(7);
        // It now lives under MPS's OWN key…
        expect(localStorage.getItem(OWN)).toBeTruthy();
        // …and is REMOVED from the shared key the dashboard reads, so the two
        // writers can never clobber each other again.
        expect(localStorage.getItem(SHARED)).toBeNull();
    });
});

/**
 * teamRoster — the seat bounds the analysis pipeline clamps to.
 *
 * The roster STORE and the two render helpers that used to live beside these
 * constants were removed 2026-10-02 (nothing read or wrote them). What is left
 * is the part the pipeline actually depends on, so that is what this pins: the
 * debate can seat a second voice, and it can never exceed the pod cap.
 */
import { describe, it, expect } from 'vitest';
import { TEAM_MIN_SEATS, TEAM_MAX_SEATS, LENS_ROSTER_ROLES } from '../utils/teamRoster';
import { AnalystRole } from '../types/enums';

describe('team seat bounds', () => {
    it('requires at least two analysts — the debate needs a voice to argue with', () => {
        expect(TEAM_MIN_SEATS).toBe(2);
    });

    it('caps the seat count, and the cap is above the flat-floor threshold', () => {
        expect(TEAM_MAX_SEATS).toBe(10);
        expect(TEAM_MAX_SEATS).toBeGreaterThan(TEAM_MIN_SEATS);
    });

    it('lists the three lens seats in floor order', () => {
        expect(LENS_ROSTER_ROLES).toEqual([
            AnalystRole.MACRO_VOLATILITY,
            AnalystRole.TECHNICAL_ANALYST,
            AnalystRole.RISK_EXECUTION,
        ]);
    });
});

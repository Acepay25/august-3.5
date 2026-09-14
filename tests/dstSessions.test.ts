/**
 * DST-aware session detection. detectTradingSession previously used a fixed
 * UTC table that silently mismatched the packet's (DST-shifted) session
 * labels for half the year. Same wall-hour now classifies by the region's
 * actual clock: London opens 07 UTC under BST but 08 UTC under GMT.
 */

import { describe, it, expect } from 'vitest';
import { detectTradingSession } from '../services/validation/ConfidenceCalibrationService';
import { getEffectiveSessions } from '../services/infrastructure/SessionService';

const iso = (s: string): string => new Date(s).toISOString();

describe('detectTradingSession — DST boundaries', () => {
    it('07:30 UTC is London in July (BST) but not-London in January (GMT)', () => {
        expect(detectTradingSession(iso('2026-07-15T07:30:00Z'))).toBe('london');
        expect(detectTradingSession(iso('2026-01-15T07:30:00Z'))).not.toBe('london');
    });

    it('the London/NY overlap opens at 13 UTC in summer and 14 UTC in winter', () => {
        expect(detectTradingSession(iso('2026-07-15T13:30:00Z'))).toBe('overlap');
        // 13:30 in January is still London-only (NY opens 14:00 in winter)
        expect(detectTradingSession(iso('2026-01-15T13:30:00Z'))).toBe('london');
    });

    it('deep Asian night is asian in both seasons', () => {
        expect(detectTradingSession(iso('2026-07-15T02:00:00Z'))).toBe('asian');
        expect(detectTradingSession(iso('2026-01-15T02:00:00Z'))).toBe('asian');
    });

    it('aligns with the effective-session edges the packet feeds the model', () => {
        const summer = getEffectiveSessions(new Date('2026-07-15T00:00:00Z'));
        const winter = getEffectiveSessions(new Date('2026-01-15T00:00:00Z'));
        // London open hour flips by exactly one across the two seasons.
        expect(summer.london.start).not.toBe(winter.london.start);
        expect(winter.london.start - summer.london.start).toBe(1);
    });

    it('a malformed timestamp falls back to asian rather than throwing', () => {
        expect(detectTradingSession('not-a-date')).toBe('asian');
    });
});

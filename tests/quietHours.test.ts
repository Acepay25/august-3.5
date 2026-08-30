import { describe, it, expect } from 'vitest';

// Quiet hours (Batch 7, plan §5.5) — silent-window math for price alerts.

import { isWithinQuietHours, quietHoursLabel, DEFAULT_QUIET_HOURS } from '../utils/quietHours';

const at = (utcHour: number): Date => new Date(Date.UTC(2026, 7, 30, utcHour, 30));
void at; // (kept for UTC-vs-local clarity; the util reads local wall clock)
// Local-time helper: the util reads getHours() (local wall clock), so tests
// pin the LOCAL hour via a local-time Date constructor.
const local = (hour: number): Date => new Date(2026, 7, 30, hour, 30);

describe('isWithinQuietHours', () => {
    it('disabled config is never quiet', () => {
        expect(isWithinQuietHours({ enabled: false, startHour: 23, endHour: 7 }, local(2))).toBe(false);
    });
    it('equal start/end hours mean off', () => {
        expect(isWithinQuietHours({ enabled: true, startHour: 7, endHour: 7 }, local(7))).toBe(false);
    });
    it('wrap-around window (23→07) covers late night and early morning', () => {
        const cfg = { enabled: true, startHour: 23, endHour: 7 };
        expect(isWithinQuietHours(cfg, local(23))).toBe(true);
        expect(isWithinQuietHours(cfg, local(2))).toBe(true);
        expect(isWithinQuietHours(cfg, local(6))).toBe(true);
        expect(isWithinQuietHours(cfg, local(7))).toBe(false);
        expect(isWithinQuietHours(cfg, local(12))).toBe(false);
        expect(isWithinQuietHours(cfg, local(22))).toBe(false);
    });
    it('same-day window (1→6) does not wrap', () => {
        const cfg = { enabled: true, startHour: 1, endHour: 6 };
        expect(isWithinQuietHours(cfg, local(0))).toBe(false);
        expect(isWithinQuietHours(cfg, local(1))).toBe(true);
        expect(isWithinQuietHours(cfg, local(5))).toBe(true);
        expect(isWithinQuietHours(cfg, local(6))).toBe(false);
    });
    it('end hour is exclusive, start hour inclusive', () => {
        const cfg = { enabled: true, startHour: 10, endHour: 11 };
        expect(isWithinQuietHours(cfg, local(10))).toBe(true);
        expect(isWithinQuietHours(cfg, local(11))).toBe(false);
    });
});

describe('quietHoursLabel / defaults', () => {
    it('formats zero-padded hours', () => {
        expect(quietHoursLabel({ enabled: true, startHour: 23, endHour: 7 })).toBe('23:00–07:00');
        expect(quietHoursLabel({ enabled: true, startHour: 1, endHour: 6 })).toBe('01:00–06:00');
    });
    it('default ships disabled with the 23→07 window staged', () => {
        expect(DEFAULT_QUIET_HOURS.enabled).toBe(false);
        expect(DEFAULT_QUIET_HOURS.startHour).toBe(23);
        expect(DEFAULT_QUIET_HOURS.endHour).toBe(7);
    });
});

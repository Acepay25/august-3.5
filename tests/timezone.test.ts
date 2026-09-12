/**
 * timezone — the terminal speaks Philippine time (Asia/Manila, UTC+8, no
 * DST). These pins prove a UTC print like 13:08 is SHOWN as 21:08, so the
 * chart/clock strings match the user's wall clock (the original "13:08 UTC"
 * complaint was the formatter, not the data).
 */

import { describe, it, expect } from 'vitest';
import { phtClock, phtClockSeconds, phtStamp, phtDay, phtAxisTick, phtFullStamp } from '../utils/timezone';

describe('PHT clock helpers', () => {
    it('13:08 UTC prints as 21:08 PHT', () => {
        expect(phtClock('2026-09-11T13:08:00Z')).toBe('21:08');
        expect(phtClockSeconds('2026-09-11T13:08:42Z')).toBe('21:08:42');
        expect(phtStamp('2026-09-11T13:08:00Z')).toBe('Sep 11, 21:08');
        expect(phtFullStamp('2026-09-11T13:08:42Z')).toBe('Sep 11, 21:08:42');
        expect(phtDay('2026-09-11T13:08:00Z')).toBe('Sep 11');
    });

    it('crosses the date at the right boundary (16:00 UTC = midnight PHT)', () => {
        expect(phtClock('2026-09-11T16:00:00Z')).toBe('00:00');
        // 16:00 UTC Sep 11 is Sep 12 in Manila — the DAY label follows.
        expect(phtDay('2026-09-11T16:30:00Z')).toBe('Sep 12');
    });

    it('accepts epoch ms and rejects garbage gracefully', () => {
        expect(phtClock(Date.parse('2026-09-11T13:08:00Z'))).toBe('21:08');
        expect(phtClock(NaN)).toBe('—');
        expect(phtAxisTick(Number.NaN)).toBe('');
    });

    it('chart axis ticks format in PHT: clock for time ticks, date for coarse', () => {
        const seconds = Date.parse('2026-09-11T13:08:00Z') / 1000;
        expect(phtAxisTick(seconds, 'time')).toBe('21:08');
        expect(phtAxisTick(seconds, 'day')).toBe('Sep 11');
        expect(phtAxisTick(seconds, 'full')).toBe('Sep 11, 21:08');
    });
});

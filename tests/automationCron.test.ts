import { describe, it, expect } from 'vitest';
import { parseCron, cronMatches, nextCronTime, countMissedRuns } from '../services/automation/cronParser';

const at = (minute: number, hour: number, dom: number, month: number, dow: number): Date =>
    new Date(2026, month - 1, dom, hour, minute, 0, 0);

describe('parseCron', () => {
    it('accepts a valid 5-field expression', () => {
        expect(parseCron('*/15 * * * *')).not.toBeNull();
        expect(parseCron('0 9 * * 1-5')).not.toBeNull();
        expect(parseCron('30 0,12 * * 0')).not.toBeNull();
    });

    it('rejects malformed expressions', () => {
        expect(parseCron('')).toBeNull();
        expect(parseCron('* * * *')).toBeNull();          // 4 fields
        expect(parseCron('* * * * * *')).toBeNull();      // 6 fields
        expect(parseCron('60 * * * *')).toBeNull();       // minute out of range
        expect(parseCron('* 24 * * *')).toBeNull();       // hour out of range
        expect(parseCron('* * 32 * *')).toBeNull();       // dom out of range
        expect(parseCron('* * * 13 *')).toBeNull();       // month out of range
        expect(parseCron('*/0 * * * *')).toBeNull();      // zero step
        expect(parseCron('a * * * *')).toBeNull();        // garbage
        expect(parseCron('5-1 * * * *')).toBeNull();      // inverted range
    });

    it('normalizes dow 7 to Sunday (0)', () => {
        const fields = parseCron('0 9 * * 7')!;
        expect(fields.dow!.has(0)).toBe(true);
        expect(fields.dow!.has(7)).toBe(false);
    });
});

describe('cronMatches', () => {
    it('matches every 15 minutes', () => {
        expect(cronMatches('*/15 * * * *', at(0, 10, 5, 6, 0))).toBe(true);
        expect(cronMatches('*/15 * * * *', at(15, 10, 5, 6, 0))).toBe(true);
        expect(cronMatches('*/15 * * * *', at(45, 10, 5, 6, 0))).toBe(true);
        expect(cronMatches('*/15 * * * *', at(7, 10, 5, 6, 0))).toBe(false);
    });

    it('matches hourly on the hour', () => {
        expect(cronMatches('0 * * * *', at(0, 23, 1, 1, 1))).toBe(true);
        expect(cronMatches('0 * * * *', at(1, 23, 1, 1, 1))).toBe(false);
    });

    it('matches a daily wall-clock time', () => {
        expect(cronMatches('0 9 * * *', at(0, 9, 15, 3, 4))).toBe(true);
        expect(cronMatches('0 9 * * *', at(0, 10, 15, 3, 4))).toBe(false);
    });

    it('matches weekdays only (dow restricted, dom wildcard)', () => {
        // 2026-06-08 is a Monday.
        expect(cronMatches('0 9 * * 1-5', at(0, 9, 8, 6, 1))).toBe(true);
        // 2026-06-07 is a Sunday.
        expect(cronMatches('0 9 * * 1-5', at(0, 9, 7, 6, 0))).toBe(false);
    });

    it('applies OR semantics when both dom and dow are restricted', () => {
        // "0 0 13 * 5" fires on the 13th OR any Friday.
        const thirteenth = at(0, 0, 13, 6, 5);   // 2026-06-13 IS a Saturday
        const friday = at(0, 0, 12, 6, 5);       // 2026-06-12 is a Friday
        const other = at(0, 0, 14, 6, 0);        // Sunday the 14th
        expect(cronMatches('0 0 13 * 5', thirteenth)).toBe(true);
        expect(cronMatches('0 0 13 * 5', friday)).toBe(true);
        expect(cronMatches('0 0 13 * 5', other)).toBe(false);
    });
});

describe('nextCronTime', () => {
    it('finds the next quarter-hour mark', () => {
        const next = nextCronTime('*/15 * * * *', at(7, 10, 5, 6, 0))!;
        expect(next.getMinutes()).toBe(15);
        expect(next.getHours()).toBe(10);
    });

    it('rolls into the next hour/day', () => {
        const next = nextCronTime('0 9 * * *', at(30, 10, 5, 6, 0))!;
        expect(next.getHours()).toBe(9);
        expect(next.getDate()).toBe(6); // next day
    });

    it('returns null for invalid cron', () => {
        expect(nextCronTime('not-a-cron', new Date())).toBeNull();
    });
});

describe('countMissedRuns', () => {
    it('counts the hourly ticks in a gap and respects the cap', () => {
        const since = at(0, 0, 1, 1, 4); // 00:00 Jan 1
        const now = at(30, 5, 1, 1, 4);  // 05:30 Jan 1 → ticks at 01:00..05:00 = 5 (00:00 excluded)
        expect(countMissedRuns('0 * * * *', since, now, 10)).toBe(5);
        expect(countMissedRuns('0 * * * *', since, now, 3)).toBe(3); // capped
    });

    it('returns 0 when nothing fired in the window', () => {
        const since = at(10, 9, 1, 1, 4);
        const now = at(50, 9, 1, 1, 4);
        expect(countMissedRuns('0 9 * * *', since, now, 3)).toBe(0);
    });
});

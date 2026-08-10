import { describe, it, expect } from 'vitest';
import { parseCron, cronMatches, nextCronTime, countMissedRuns, hasCronFireBetween, humanizeCron } from '../services/automation/cronParser';

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
        expect(parseCron('60 * * * *')).toBeNull();       // minute out of range
        expect(parseCron('* 24 * * *')).toBeNull();       // hour out of range
        expect(parseCron('* * 32 * *')).toBeNull();       // dom out of range
        expect(parseCron('* * * 13 *')).toBeNull();       // month out of range
        expect(parseCron('*/0 * * * *')).toBeNull();      // zero step
        expect(parseCron('a * * * *')).toBeNull();        // garbage
        expect(parseCron('5-1 * * * *')).toBeNull();      // inverted range
        expect(parseCron('* * * * *')).not.toBeNull();    // 5 wildcards = every minute (valid)
        expect(parseCron('* * * * * *')).not.toBeNull();  // 6 wildcards = every second (valid)
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

describe('seconds field (6-field cron)', () => {
    it('parses a 6-field expression with a leading seconds field', () => {
        const fields = parseCron('15 30 14 * * 1,3')!;
        expect(fields.second!.has(15)).toBe(true);
        expect(fields.minute!.has(30)).toBe(true);
        expect(fields.hour!.has(14)).toBe(true);
        expect(fields.dow!.has(1) && fields.dow!.has(3)).toBe(true);
    });

    it('matches the exact second', () => {
        // Mon 2026-06-08 at 14:30:15.
        const d = new Date(2026, 5, 8, 14, 30, 15, 0);
        expect(cronMatches('15 30 14 * * 1', d)).toBe(true);
        expect(cronMatches('15 30 14 * * 1', new Date(2026, 5, 8, 14, 30, 16, 0))).toBe(false);
        expect(cronMatches('15 30 14 * * 1', new Date(2026, 5, 8, 14, 30, 15, 0))).toBe(true);
    });

    it('resolves the exact second in nextCronTime', () => {
        const next = nextCronTime('15 30 14 * * 1', at(0, 14, 8, 6, 1))!;
        expect(next.getSeconds()).toBe(15);
        expect(next.getMinutes()).toBe(30);
        expect(next.getHours()).toBe(14);
    });

    it('is backward compatible with 5-field expressions (any second)', () => {
        expect(cronMatches('0 9 * * *', new Date(2026, 5, 8, 9, 0, 42, 0))).toBe(true);
    });
});

describe('hasCronFireBetween', () => {
    it('catches a second-exact fire inside the tick window', () => {
        // Fire at 14:30:15; window (14:30:10, 14:30:16].
        const from = new Date(2026, 5, 8, 14, 30, 10, 0);
        const to = new Date(2026, 5, 8, 14, 30, 16, 0);
        expect(hasCronFireBetween('15 30 14 * * 1', from, to)).toBe(true);
        // Window before the fire.
        expect(hasCronFireBetween('15 30 14 * * 1', new Date(2026, 5, 8, 14, 30, 0, 0), new Date(2026, 5, 8, 14, 30, 10, 0))).toBe(false);
    });

    it('catches a minute-granularity fire', () => {
        const from = new Date(2026, 5, 8, 8, 59, 50, 0);
        const to = new Date(2026, 5, 8, 9, 0, 10, 0);
        expect(hasCronFireBetween('0 9 * * *', from, to)).toBe(true);
    });
});

describe('humanizeCron', () => {
    it('humanizes the generated daily-at-time shape', () => {
        expect(humanizeCron('0 0 9 * * 0,1,2,3,4,5,6')).toBe('Daily at 09:00:00');
        expect(humanizeCron('0 0 9 * * 1,2,3,4,5')).toBe('Weekdays at 09:00:00');
        expect(humanizeCron('15 30 14 * * 1,3')).toBe('Mon, Wed at 14:30:15');
        expect(humanizeCron('0 0 9 * * 0,6')).toBe('Weekends at 09:00:00');
    });

    it('falls back to the raw expression for custom schedules', () => {
        // A dom-restricted schedule (e.g. on the 1st and 15th) is not one of
        // the generated day/time shapes → raw expression.
        expect(humanizeCron('0 9 1,15 * *')).toBe('0 9 1,15 * *');
        expect(humanizeCron('*/15 * * * *')).toBe('Every 15 min — Daily');
    });

    it('humanizes the every-N frequency shapes', () => {
        // Every 30 minutes on weekdays: minute step, all hours.
        expect(humanizeCron('*/30 * * * 1,2,3,4,5')).toBe('Every 30 min — Weekdays');
        // Every 3 hours every day: minute 0, hour step.
        expect(humanizeCron('0 */3 * * 0,1,2,3,4,5,6')).toBe('Every 3 h — Daily');
        // Every hour on weekends.
        expect(humanizeCron('0 * * * 0,6')).toBe('Every 1 h — Weekends');
        // Every minute = step 1.
        expect(humanizeCron('* * * * *')).toBe('Every 1 min — Daily');
    });
});

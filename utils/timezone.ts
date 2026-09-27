/**
 * timezone — the terminal speaks Philippine time (Asia/Manila, UTC+8, no DST).
 * One home for the display zone so the chart axes, harness signals, context
 * stamps and clock chips all agree: the user reads ONE clock, and the model
 * never echoes a UTC time the user has to mentally convert.
 *
 * IMPORTANT: these helpers only format a LABEL. Everywhere the underlying
 * value stays a real unix timestamp — the chart's candle data, drawings and
 * snapshots are untouched; only the strings shown to the model/user change.
 */

/** PHT is UTC+8 year-round (no DST since 1978) — safe as a constant. */
export const PHT_LABEL = 'PHT';
export const PHT_ZONE = 'Asia/Manila';

const clockFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: PHT_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const clockSecFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: PHT_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: PHT_ZONE, month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat('en-US', { timeZone: PHT_ZONE, month: 'short', day: 'numeric', year: 'numeric' });
const dayTimeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const fullFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
// en-CA renders the ISO-like 'YYYY-MM-DD' the ledgers group by.
const phtDayKeyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PHT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

const dateOf = (at: Date | number | string): Date | null => {
    const d = at instanceof Date ? at : new Date(at);
    return Number.isFinite(d.getTime()) ? d : null;
};

/** 'HH:mm' (24h) in Philippine time. Accepts a Date or epoch MILLISECONDS. */
export const phtClock = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? clockFmt.format(d) : '—';
};

/** 'HH:mm:ss' PHT — the exact-precision stamp the model reads and repeats. */
export const phtClockSeconds = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? clockSecFmt.format(d) : '—';
};

/** 'Sep 11 21:08' — compact stamp. Accepts a Date or epoch MILLISECONDS. */
export const phtStamp = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? dayTimeFmt.format(d) : '—';
};

/** 'Sep 11 21:08:30' — second-precision stamp (ms input). */
export const phtFullStamp = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? fullFmt.format(d) : '—';
};

/** 'Sep 11' only (ms input). */
export const phtDay = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? dayFmt.format(d) : '—';
};

/** 'Sep 11, 2026' — the full date with year (ms/Date/string input), for
 *  journal rows and backups where a bare 'Sep 11' is ambiguous across years. */
export const phtDayYear = (at: Date | number | string): string => {
    const d = dateOf(at);
    return d ? dayYearFmt.format(d) : '—';
};

/** 'YYYY-MM-DD' calendar day in Philippine time — the ONE day key every
 *  ledger, rollup, streak and backup stamp groups by. A UTC slice
 *  (`toISOString().slice(0, 10)`) shifted each boundary by 8 hours, so the
 *  same trading evening split across two keys. Accepts epoch MILLISECONDS
 *  (default now); '' for a non-finite input (never throws, unlike
 *  toISOString on an invalid date). */
export const phtDayKey = (ms?: number): string => {
    const d = ms === undefined ? new Date() : new Date(ms);
    return Number.isFinite(d.getTime()) ? phtDayKeyFmt.format(d) : '';
};

/**
 * lightweight-charts axis tick formatter. Time is a UTCTimestamp (SECONDS);
 * format it in PHT so the bottom rail reads Manila time. Hours/minutes for
 * intraday ticks, the date for coarser ones (Intl handles the boundary).
 * @param granularity 'time' → 'HH:mm', 'day' → 'Mon d', else 'Mon d HH:mm'.
 */
export const phtAxisTick = (timeSeconds: number, granularity: 'time' | 'day' | 'full' = 'time'): string => {
    const d = dateOf(timeSeconds * 1000);
    if (!d) return '';
    if (granularity === 'time') return clockFmt.format(d);
    if (granularity === 'day') return dayFmt.format(d);
    return dayTimeFmt.format(d);
};

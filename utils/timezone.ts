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
const dayTimeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const fullFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PHT_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
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

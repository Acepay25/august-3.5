/**
 * Minimal cron parser — 5-field (minute hour day-of-month month day-of-week)
 * or 6-field with a leading SECONDS field (quartz style):
 *   second minute hour day-of-month month day-of-week
 *
 * Supported field syntax:
 *   *            every value
 *   <star>/n      every n-th value, e.g. star-slash-15 for every 15 minutes
 *   a-b          inclusive range
 *   a-b/n        range with step
 *   a,b,c        list
 *   ?            treated as * (dom/dow, quartz compatibility)
 *
 * Day-of-week: 0-7 where 0 and 7 are both Sunday. Numeric months only
 * (no JAN/FEB names). Standard cron day semantics: when both dom and dow
 * are restricted, EITHER matching counts as a hit.
 */

export interface CronFields {
    second: Set<number> | null; // null = any second (5-field expressions)
    minute: Set<number> | null; // null = '*'
    hour: Set<number> | null;
    dom: Set<number> | null;
    month: Set<number> | null;
    dow: Set<number> | null;
}

const FIELD_RANGES: [keyof CronFields, number, number][] = [
    ['second', 0, 59],
    ['minute', 0, 59],
    ['hour', 0, 23],
    ['dom', 1, 31],
    ['month', 1, 12],
    ['dow', 0, 7],
];

/** Parse one cron field into the set of matching values, or null for '*'. */
export const parseCronField = (field: string, min: number, max: number): Set<number> | null => {
    const raw = field.trim();
    if (raw === '*' || raw === '?') return null;

    const values = new Set<number>();
    for (const part of raw.split(',')) {
        if (!part) return null;
        // "*/step" — every step-th value across the whole range.
        const starStep = part.match(/^\*\/(\d+)$/);
        if (starStep) {
            const step = parseInt(starStep[1], 10);
            if (step <= 0) return null;
            for (let v = min; v <= max; v += step) values.add(v);
            continue;
        }
        const rangeMatch = part.match(/^(\d+)(?:-(\d+))?(?:\/(\d+))?$/);
        if (!rangeMatch) return null;
        const start = parseInt(rangeMatch[1], 10);
        const end = rangeMatch[2] !== undefined ? parseInt(rangeMatch[2], 10) : start;
        const step = rangeMatch[3] !== undefined ? parseInt(rangeMatch[3], 10) : 1;
        if (step <= 0 || start < min || end > max || start > end) return null;
        for (let v = start; v <= end; v += step) values.add(v);
    }
    return values.size > 0 ? values : null;
};

/** Parse a full 5- or 6-field expression. Returns null when invalid. */
export const parseCron = (expr: string): CronFields | null => {
    const parts = (expr || '').trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) return null;

    const fields: CronFields = { second: null, minute: null, hour: null, dom: null, month: null, dow: null };
    // 6-field expressions carry a leading seconds field; 5-field ones match
    // any second (second stays null). FIELD_RANGES starts at the seconds
    // slot, so 5-field expressions shift by one.
    const startIndex = parts.length === 6 ? 0 : 1;
    for (let i = 0; i < parts.length; i++) {
        const [key, min, max] = FIELD_RANGES[startIndex + i];
        const parsed = parseCronField(parts[i], min, max);
        if (parsed === null && parts[i] !== '*' && parts[i] !== '?') return null;
        fields[key] = parsed;
    }

    // Normalize dow: 7 = Sunday = 0.
    if (fields.dow) {
        const dow = new Set<number>();
        for (const v of fields.dow) dow.add(v === 7 ? 0 : v);
        fields.dow = dow;
    }

    return fields;
};

const setMatches = (set: Set<number> | null, value: number): boolean => set === null || set.has(value);

/** Minute/hour/dom/month/dow part of the match (seconds excluded). */
const minuteMatches = (fields: CronFields, date: Date): boolean => {
    if (!setMatches(fields.minute, date.getMinutes())) return false;
    if (!setMatches(fields.hour, date.getHours())) return false;
    if (!setMatches(fields.month, date.getMonth() + 1)) return false;

    // Day semantics: dom restricted XOR dow restricted → that one governs;
    // both restricted → either counts; neither → every day.
    const domRestricted = fields.dom !== null;
    const dowRestricted = fields.dow !== null;
    const domMatches = setMatches(fields.dom, date.getDate());
    const dowMatches = setMatches(fields.dow, date.getDay());
    if (domRestricted && dowRestricted) {
        if (!domMatches && !dowMatches) return false;
    } else if (domRestricted && !domMatches) {
        return false;
    } else if (dowRestricted && !dowMatches) {
        return false;
    }

    return true;
};

/** Does the cron expression fire on the given local date (second-exact)? */
export const cronMatches = (expr: string, date: Date): boolean => {
    const fields = parseCron(expr);
    if (!fields) return false;
    if (!minuteMatches(fields, date)) return false;
    if (fields.second !== null && !setMatches(fields.second, date.getSeconds())) return false;
    return true;
};

/**
 * Find the next fire time strictly after `from`. Iterates minute by minute
 * and resolves the exact second inside a matched minute (a 6-field cron
 * with a seconds value fires at that second). Returns null when nothing
 * matches within `maxLookaheadMs` (default 30 days).
 */
export const nextCronTime = (expr: string, from: Date, maxLookaheadMs = 30 * 24 * 60 * 60 * 1000): Date | null => {
    const fields = parseCron(expr);
    if (!fields) return null;

    const cursor = new Date(from.getTime());
    cursor.setMilliseconds(0);
    cursor.setSeconds(cursor.getSeconds() + 1); // strictly after `from`
    const deadline = from.getTime() + maxLookaheadMs;

    while (cursor.getTime() <= deadline) {
        if (minuteMatches(fields, cursor)) {
            if (fields.second === null) return new Date(cursor); // :00 of the minute
            // Resolve the exact second inside this matched minute.
            const minuteStart = new Date(cursor);
            minuteStart.setSeconds(0, 0);
            const seconds = [...fields.second].sort((a, b) => a - b);
            for (const s of seconds) {
                const t = minuteStart.getTime() + s * 1000;
                if (t >= cursor.getTime() && t <= deadline) return new Date(t);
            }
        }
        cursor.setMinutes(cursor.getMinutes() + 1);
        cursor.setSeconds(0, 0);
    }
    return null;
};

/**
 * Count how many times the cron fired in the half-open interval
 * (since, now]. Capped at `cap` (catch-up runs are bounded). Minute
 * granularity: a matched minute counts once regardless of its second.
 */
export const countMissedRuns = (expr: string, since: Date, now: Date, cap = 3): number => {
    const fields = parseCron(expr);
    if (!fields || !since || !now || now.getTime() <= since.getTime()) return 0;

    const cursor = new Date(since.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1); // strictly after `since`

    let count = 0;
    while (cursor.getTime() <= now.getTime() && count < cap) {
        if (minuteMatches(fields, cursor)) count++;
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return count;
};

/**
 * True when the cron fires at least once in the half-open window
 * (from, to]. Second-exact when the expression carries a seconds field —
 * the scheduler checks this every tick instead of matching "now" exactly
 * (a coarse tick can never land on an arbitrary :07 second otherwise).
 */
export const hasCronFireBetween = (expr: string, from: Date, to: Date): boolean => {
    const fields = parseCron(expr);
    if (!fields || !from || !to || to.getTime() <= from.getTime()) return false;

    if (fields.second !== null) {
        // Second-exact: step second by second through the window.
        const cursor = new Date(from.getTime() + 1000);
        cursor.setMilliseconds(0);
        while (cursor.getTime() <= to.getTime()) {
            if (cronMatches(expr, cursor)) return true;
            cursor.setTime(cursor.getTime() + 1000);
        }
        return false;
    }

    // Minute-granularity: check each minute BOUNDARY inside the window
    // (stepping +60s from a mid-minute cursor would skip the boundary).
    const cursor = new Date(from.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    while (cursor.getTime() <= to.getTime()) {
        if (minuteMatches(fields, cursor)) return true;
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return false;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Human-readable schedule for the generated shapes:
 *   "Weekdays at 09:00:00", "Every 30 min — Weekdays", "Every 3 h — Daily",
 *   "Mon, Wed at 14:30:15"; falls back to the raw expression otherwise.
 */
export const humanizeCron = (expr: string): string => {
    const fields = parseCron(expr);
    if (!fields) return expr;

    // Only humanize the generated shapes — narrowing happens inline so TS
    // sees the non-null sets. '*' fields mean the full range.
    if (fields.dom !== null || fields.month !== null) return expr;

    const minutes = fields.minute !== null
        ? [...fields.minute].sort((a, b) => a - b)
        : Array.from({ length: 60 }, (_, i) => i);
    const hours = fields.hour !== null
        ? [...fields.hour].sort((a, b) => a - b)
        : Array.from({ length: 24 }, (_, i) => i);

    // Day label from the dow set (Mon..Sun display order).
    const dayLabel = (() => {
        if (fields.dow === null || fields.dow.size === 7) return 'Daily';
        const days = [...fields.dow]
            .sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b)))
            .map(d => DAY_NAMES[d]);
        if (days.join(',') === 'Mon,Tue,Wed,Thu,Fri') return 'Weekdays';
        if (days.join(',') === 'Sat,Sun') return 'Weekends';
        return days.join(', ');
    })();

    // Every-N frequency shapes (a stepped minute or hour field).
    if (minutes.length > 1 && hours.length === 24) {
        return `Every ${minutes[1] - minutes[0]} min — ${dayLabel}`;
    }
    if (hours.length > 1 && minutes.length === 1) {
        return `Every ${hours[1] - hours[0]} h — ${dayLabel}`;
    }

    // Once per day at a fixed time.
    if (minutes.length === 1 && hours.length === 1) {
        const s = fields.second !== null && fields.second.size === 1 ? [...fields.second][0] : 0;
        const time = `${String(hours[0]).padStart(2, '0')}:${String(minutes[0]).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${dayLabel} at ${time}`;
    }

    return expr;
};

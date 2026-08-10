/**
 * Minimal 5-field cron parser (minute hour day-of-month month day-of-week).
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
    minute: Set<number> | null; // null = '*'
    hour: Set<number> | null;
    dom: Set<number> | null;
    month: Set<number> | null;
    dow: Set<number> | null;
}

const FIELD_RANGES: [keyof CronFields, number, number][] = [
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

/** Parse a full 5-field expression. Returns null when invalid. */
export const parseCron = (expr: string): CronFields | null => {
    const parts = (expr || '').trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const fields: CronFields = { minute: null, hour: null, dom: null, month: null, dow: null };
    for (let i = 0; i < 5; i++) {
        const [key, min, max] = FIELD_RANGES[i];
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

/** Does the cron expression fire on the given local date? */
export const cronMatches = (expr: string, date: Date): boolean => {
    const fields = parseCron(expr);
    if (!fields) return false;

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

/**
 * Find the next fire time strictly after `from`. Scans minute by minute up
 * to `maxLookaheadMs` (default 30 days) — plenty for any cron. Returns null
 * when nothing matches in the window.
 */
export const nextCronTime = (expr: string, from: Date, maxLookaheadMs = 30 * 24 * 60 * 60 * 1000): Date | null => {
    const fields = parseCron(expr);
    if (!fields) return null;

    const cursor = new Date(from.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1); // strictly after `from`

    const deadline = from.getTime() + maxLookaheadMs;
    while (cursor.getTime() <= deadline) {
        if (cronMatches(expr, cursor)) return new Date(cursor);
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return null;
};

/**
 * Count how many times the cron fired in the half-open interval
 * (since, now]. Capped at `cap` (catch-up runs are bounded).
 */
export const countMissedRuns = (expr: string, since: Date, now: Date, cap = 3): number => {
    const fields = parseCron(expr);
    if (!fields || !since || !now || now.getTime() <= since.getTime()) return 0;

    const cursor = new Date(since.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1); // strictly after `since`

    let count = 0;
    while (cursor.getTime() <= now.getTime() && count < cap) {
        if (cronMatches(expr, cursor)) count++;
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return count;
};

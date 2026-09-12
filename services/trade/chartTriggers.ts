/**
 * chartTriggers — the pure half of the "watch or schedule" harness: the
 * model arms a PRICE watch ("tell me when BTC prints above 112,000") or a
 * TIME wake ("check the chart back in 30 minutes"), and when the condition
 * holds the harness wakes the model with a trigger signal it can act on —
 * evaluate the setup live and alert the user. Pure + dependency-free (like
 * tradePlanLevels), so the semantics are unit-testable with no React/network.
 *
 * Fire-once: every armed watch fires AT MOST once and is then removed by the
 * service — a "ready to trade" alert that re-pings every tick is a bug.
 * Unlike plan levels (advisory touches on an existing plan), a trigger whose
 * condition is ALREADY true at arm time fires on its first tick: the model
 * just asked to be told the moment X is true — if X is true now, that moment
 * is now.
 */

import { phtClock } from '../../utils/timezone';

/** A price condition the harness watches the live mark against. */
export interface PriceWatch {
    kind: 'price';
    /** Stable id the model quotes back (w-…). */
    id: string;
    symbol: string;
    condition: 'above' | 'below';
    price: number;
    /** Why the model armed it — echoed in the fired signal ("breakout reclaim…"). */
    note: string;
    /** Epoch ms deadline; expired watches are dropped silently. */
    expiresAt: number;
    createdAt: number;
}

/** A scheduled wake-up: the model asks to re-check the chart at a time. */
export interface TimeWake {
    kind: 'time';
    id: string;
    symbol: string;
    /** Epoch ms to fire at/after. */
    atMs: number;
    note: string;
    createdAt: number;
}

export type WatchItem = PriceWatch | TimeWake;

export interface WatchFired {
    watch: WatchItem;
    /** Live mark at fire time (last known for time wakes). */
    price: number | null;
    /** Epoch ms. */
    at: number;
}

/** Does this watch's condition hold RIGHT NOW? */
export const watchConditionHolds = (w: WatchItem, price: number | null, nowMs: number): boolean => {
    if (w.kind === 'time') return nowMs >= w.atMs;
    if (price === null || !Number.isFinite(price)) return false;
    return w.condition === 'above' ? price >= w.price : price <= w.price;
};

/** Is this watch past its deadline (expired silently, never fires)? */
export const watchExpired = (w: WatchItem, nowMs: number): boolean =>
    w.kind === 'price' && nowMs > w.expiresAt;

/** Parse + validate the watch_price tool arguments. Returns null on reject
 *  (the caller surfaces the reason to the model). */
export const parsePriceWatch = (args: Record<string, unknown>, defaults: {
    symbol: string; makeId: () => string; nowMs: number;
}): { watch?: PriceWatch; error?: string } => {
    const priceRaw = typeof args.price === 'number' ? args.price : Number(args.price);
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) return { error: 'price must be a positive number' };
    const condition = args.condition === 'below' ? 'below' : args.condition === 'above' ? 'above' : null;
    if (!condition) return { error: 'condition must be "above" or "below"' };
    const minutesRaw = args.expiresInMinutes !== undefined ? Number(args.expiresInMinutes) : 720;
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.min(minutesRaw, 7 * 24 * 60) : 720;
    return {
        watch: {
            kind: 'price', id: defaults.makeId(),
            symbol: String(args.symbol ?? defaults.symbol ?? '').toUpperCase() || defaults.symbol,
            condition, price: priceRaw,
            note: String(args.note ?? 'target reached').slice(0, 200),
            expiresAt: defaults.nowMs + minutes * 60_000, createdAt: defaults.nowMs,
        },
    };
};

/** Parse + validate the wake_me tool arguments. */
export const parseTimeWake = (args: Record<string, unknown>, defaults: {
    symbol: string; makeId: () => string; nowMs: number;
}): { wake?: TimeWake; error?: string } => {
    const minutesRaw = typeof args.inMinutes === 'number' ? args.inMinutes : Number(args.inMinutes);
    if (!Number.isFinite(minutesRaw) || minutesRaw < 1) return { error: 'inMinutes must be a number ≥ 1' };
    const minutes = Math.min(minutesRaw, 7 * 24 * 60);
    return {
        wake: {
            kind: 'time', id: defaults.makeId(),
            symbol: String(args.symbol ?? defaults.symbol ?? '').toUpperCase() || defaults.symbol,
            atMs: defaults.nowMs + minutes * 60_000,
            note: String(args.note ?? 'scheduled re-check').slice(0, 200), createdAt: defaults.nowMs,
        },
    };
};

/** Human summary of one watch ("BTCUSDT above 112,000 (w-4k1) until 21:31"). */
export const describeWatch = (w: WatchItem, nowMs = Date.now()): string => {
    if (w.kind === 'price') {
        return `${w.symbol} ${w.condition} ${w.price} [${w.id}] (expires ${phtClock(w.expiresAt)} PHT)`;
    }
    const inMin = Math.max(0, Math.round((w.atMs - nowMs) / 60_000));
    return `${w.symbol} scheduled re-check at ${phtClock(w.atMs)} PHT, in ${inMin}m [${w.id}]`;
};

/** The armed-watches block the model reads with every message: what it is
 *  waiting on, so it never double-arms and can reason about pending alerts. */
export const describeWatchesForModel = (watches: WatchItem[], nowMs = Date.now()): string => {
    if (watches.length === 0) return '';
    return [
        `[ARMED HARNESSES — watches YOU set with watch_price/wake_me; the harness fires one [HARNESS TRIGGER] signal each, then they lapse]`,
        ...watches.map(w => `- ${describeWatch(w, nowMs)} — note: "${w.note}"`),
        'Do not re-arm an existing watch for the same condition; cancel_watch first if the reason changed.',
    ].join('\n');
};

/** The trigger-fired signal text handed to the model when a watch completes. */
export const formatWatchFiredForModel = (fired: WatchFired, armedCount: number): string => {
    const { watch, price } = fired;
    const when = phtClock(fired.at);
    const cond = watch.kind === 'price'
        ? `${watch.symbol} printed ${price ?? '—'}, ${watch.condition} the watched ${watch.price}`
        : `the scheduled ${watch.symbol} re-check time arrived (${phtClock(watch.atMs)} PHT)${price !== null ? ` with mark ${price}` : ''}`;
    return [
        `[HARNESS TRIGGER — scheduled watch fired, not the user] Watch ${watch.id}: ${cond}. Time ${when} PHT.`,
        `The note you attached when arming it: "${watch.note}".`,
        armedCount > 0 ? `Still armed after this: ${armedCount} watch(es).` : 'No other watches are armed.',
        'Act on it now: pull a fresh read (desk tools), tell the user whether their awaited condition is here and whether the setup is ready to trade or not, and arm a new watch only if there is a specific reason to.',
    ].join(' ');
};

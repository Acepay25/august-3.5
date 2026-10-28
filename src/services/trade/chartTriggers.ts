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
 * Unlike plan levels (advisory touches on an existing plan), a watch is a
 * promise about the FUTURE: `watchService.arm` REFUSES a price condition the
 * live tape already satisfies, because firing it on the tick it was armed told
 * the trader something they already knew and spent a model turn saying so. A
 * TIME wake is different — its deadline is in the future by construction
 * (`inMinutes ≥ 1`), and one whose minute has already passed on an app reopen
 * still owes the model its turn.
 */

import { phtClock } from '../../utils/timezone';
import { baseOf, quoteOf } from '../../utils/symbol';
import { priceArgError } from './tradePlanLevels';

/** Canonical full futures symbol from a model-supplied one ('BTC' → 'BTCUSDT',
 *  'BTC/USDT' → 'BTCUSDT', 'BTCUSDT' unchanged) — the utils/symbol doctrine
 *  (PR#5). Arming a watch under a bare base was a silent death loop: the live
 *  feed ticks the FULL symbol so the watch never matched, the REST poll 400'd
 *  on every 5s attempt (fetchMarkPrice('BTC')), and cancel/disarm by the full
 *  symbol could not remove it. Empty input falls through to the caller's
 *  default (already canonical from the viewed chart). */
function normalizeWatchSymbol(value: string): string {
    const trimmed = value.trim();
    return trimmed ? `${baseOf(trimmed)}${quoteOf(trimmed)}` : trimmed;
}

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
    /** The dock session that armed it. The wake must reach THAT thread: the
     *  queue used to hand every signal to whichever session was on screen, so a
     *  watch armed for one chart could be answered in another
     *  (the 2026-10-27 audit L-7). Absent for a watch armed before this field. */
    sid?: string;
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
    /** See PriceWatch.sid. */
    sid?: string;
}

export type WatchItem = PriceWatch | TimeWake;

export interface WatchFired {
    watch: WatchItem;
    /** Live mark at fire time (last known for time wakes). */
    price: number | null;
    /** Epoch ms. */
    at: number;
    /** True when this event is the watch's DEADLINE passing without the
     *  condition ever holding — a lapse the trader was promised a report
     *  on, not a trigger. The subscriber records it in the thread that
     *  armed the watch; it does not ping the OS. */
    expired?: boolean;
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
    // The shared rule, not a third copy: the drawing tools took any finite
    // number, so 0 became a watch trigger at a price that cannot exist.
    const badPrice = priceArgError(priceRaw, 'price');
    if (badPrice) return { error: badPrice };    const condition = args.condition === 'below' ? 'below' : args.condition === 'above' ? 'above' : null;
    if (!condition) return { error: 'condition must be "above" or "below"' };
    const minutesRaw = args.expiresInMinutes !== undefined ? Number(args.expiresInMinutes) : 720;
    const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.min(minutesRaw, 7 * 24 * 60) : 720;
    return {
        watch: {
            kind: 'price', id: defaults.makeId(),
            // Model-supplied symbols are normalized to the canonical full
            // futures form; the default comes from the viewed chart and is
            // trusted. Empty/garbage-free args.symbol falls through to it.
            symbol: normalizeWatchSymbol(String(args.symbol ?? '')) || defaults.symbol,
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
            // Model-supplied symbols are normalized to the canonical full
            // futures form; the default comes from the viewed chart and is
            // trusted. Empty/garbage-free args.symbol falls through to it.
            symbol: normalizeWatchSymbol(String(args.symbol ?? '')) || defaults.symbol,
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

/** A watch's OWN deadline — a price watch's expiry, a time wake's scheduled
 *  minute. Never the moment the harness noticed: a watch that lapsed while the
 *  app was shut is noticed on the next boot, and printing `fired.at` there
 *  claimed a deadline as far from the real one as the app was closed. */
const watchDeadline = (w: WatchItem): number => (w.kind === 'price' ? w.expiresAt : w.atMs);

/** The trigger-fired signal text handed to the model when a watch completes —
 *  either because the condition held or because its deadline passed first.
 *  An EXPIRED watch closes the promise the note made ("check back in 30
 *  minutes"): before this it was deleted in silence and the seat never
 *  learned the wait was over with nothing to report. */
export const formatWatchFiredForModel = (fired: WatchFired, armedCount: number): string => {
    const { watch, price } = fired;
    const when = phtClock(fired.at);
    if (fired.expired) {
        // Only a price watch can lapse (watchExpired is price-only); describe
        // any other kind from its own fields rather than assume.
        const cond = watch.kind === 'price'
            ? `${watch.symbol} ${watch.condition} ${watch.price}`
            : describeWatch(watch, fired.at);
        const event = [
            `[HARNESS TRIGGER — a watch lapsed, not the user] Watch ${watch.id}: ${cond} never printed before its ${phtClock(watchDeadline(watch))} PHT deadline.`,
            `The note you attached when arming it: "${watch.note}".`,
            armedCount > 0 ? `Still armed after this: ${armedCount} watch(es).` : 'No other watches are armed.',
        ].join(' ');
        return `${event}
Close the loop in one short line: tell the user the watch lapsed without the level being met. Do not run a fresh analysis for this, and do not re-arm the same watch on your own.`;
    }
    const cond = watch.kind === 'price'
        ? `${watch.symbol} printed ${price ?? '—'}, ${watch.condition} the watched ${watch.price}`
        : `the scheduled ${watch.symbol} re-check time arrived (${phtClock(watch.atMs)} PHT)${price !== null ? ` with mark ${price}` : ''}`;
    // Instruction on its own line — see formatLevelHitForModel: the notice
    // row shows the first line, and "ACT ON IT NOW…" is for the model only.
    const event = [
        `[HARNESS TRIGGER — scheduled watch fired, not the user] Watch ${watch.id}: ${cond}. Time ${when} PHT.`,
        `The note you attached when arming it: "${watch.note}".`,
        armedCount > 0 ? `Still armed after this: ${armedCount} watch(es).` : 'No other watches are armed.',
    ].join(' ');
    return `${event}
Act on it now: pull a fresh read (desk tools), tell the user whether their awaited condition is here and whether the setup is ready to trade or not, and arm a new watch only if there is a specific reason to.`;
};

/** Several watches hitting their deadlines in one sweep (the service's 1s
 *  clock evaluates in a burst) become ONE transcript record — N instruction
 *  blocks for the same close-the-loop ask is noise, and the store's signal
 *  queue caps at 8, so a 10-lapse burst as separate signals would drop the
 *  oldest two. Grouped per session by the caller. */
export const formatWatchesLapsedForModel = (fireds: WatchFired[], armedCount: number): string => {
    const lines = fireds.map(f => {
        const w = f.watch;
        const cond = w.kind === 'price'
            ? `${w.symbol} ${w.condition} ${w.price}`
            : `${w.symbol} scheduled re-check`;
        return `- ${cond} [${w.id}] — note: "${w.note}" (deadline ${phtClock(watchDeadline(w))} PHT)`;
    });
    const event = [
        `[HARNESS TRIGGER — ${fireds.length} watch(es) lapsed, not the user] Their deadlines passed without the conditions ever holding:`,
        ...lines,
        armedCount > 0 ? `Still armed after this: ${armedCount} watch(es).` : 'No other watches are armed.',
    ].join('\n');
    return `${event}
Close the loop in one short line per watch: tell the user each wait ended without its level printing. Do not run fresh analyses for these, and do not re-arm the same watches on your own.`;
};

/** An armed watch DROPPED to make room for a newer one — deliberately NOT
 *  worded as a lapse: the deadline had not passed and the condition was never
 *  tested again. The arm receipt promised the seat a wake, so the drop owes it
 *  a record, and that record must say what actually happened. */
export const formatWatchEvictedForModel = (watch: WatchItem, armedCount: number): string => {
    const cond = watch.kind === 'price'
        ? `${watch.symbol} ${watch.condition} ${watch.price}`
        : `the scheduled ${watch.symbol} re-check at ${phtClock(watch.atMs)} PHT`;
    const event = [
        `[HARNESS TRIGGER — a watch was dropped, not the user] Watch ${watch.id}: ${cond} was evicted to make room for a newer watch before its ${phtClock(watchDeadline(watch))} PHT deadline. It will never fire.`,
        `The note you attached when arming it: "${watch.note}".`,
        armedCount > 0 ? `Still armed after this: ${armedCount} watch(es).` : 'No other watches are armed.',
    ].join(' ');
    return `${event}
Close the loop in one short line: tell the user that wait was dropped without a result. Do not re-arm it on your own unless the user asks for it again.`;
};

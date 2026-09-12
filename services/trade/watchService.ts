/**
 * watchService — the "watch or schedule" harness the MODEL drives: it arms
 * price watches and time wakes through the watch_price / wake_me desk tools,
 * and when a condition holds it emits to subscribers (TradeView queues the
 * signal into chatStore, the dock runs it as a model turn → the model alerts
 * the user). Same singleton shape as levelWatchService/PriceAlertService.
 *
 * CONTRACT: advisory only — it never trades, resolves or logs anything. It
 * wakes the model; the model decides what the alert says.
 *
 * Fire-once + lapse: a watch fires exactly once and is then removed (its
 * note may not survive contact with a re-ping). Price watches also expire
 * silently at their deadline. Armed watches persist per user in localStorage
 * (`trade_watches_v1_${user}`, capped), so "check back in 30 minutes" survives
 * a reload — and firing needs a live clock: the service runs its own 1s
 * interval while wakes are armed (the price path is driven by the feed's
 * tick()), because a scheduled wake is about the CLOCK, not the tape.
 */

import { getActiveUsername } from '../../utils/activeUser';
import {
    watchConditionHolds, watchExpired,
    type WatchFired, type WatchItem,
} from './chartTriggers';

const WATCHES_KEY_PREFIX = 'trade_watches_v1';
const MAX_WATCHES = 10;

const storageKey = (user: string): string => `${WATCHES_KEY_PREFIX}_${user}`;

let watches = new Map<string, WatchItem>();
let loadedFor = '';
let lastPrice: number | null = null;
let lastPriceSymbol = '';
const subscribers = new Set<(fired: WatchFired, remaining: WatchItem[]) => void>();
let clock: ReturnType<typeof setInterval> | null = null;

const persist = (): void => {
    try {
        localStorage.setItem(storageKey(loadedFor), JSON.stringify([...watches.values()].slice(-MAX_WATCHES)));
    } catch { /* private mode — watches live in memory this session */ }
};

const validWatch = (w: unknown): w is WatchItem => {
    const v = w as WatchItem & Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.symbol !== 'string') return false;
    if (typeof v.createdAt !== 'number') return false;
    if (v.kind === 'price') {
        return (v.condition === 'above' || v.condition === 'below')
            && typeof v.price === 'number' && Number.isFinite(v.price)
            && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt);
    }
    return v.kind === 'time' && typeof v.atMs === 'number' && Number.isFinite(v.atMs);
};

/** Adopt the CURRENT user's armed watches (and drop the previous user's —
 *  the chatStore lesson: track who you loaded for). */
const loadWatches = (): void => {
    const user = getActiveUsername();
    if (user === loadedFor) return;
    loadedFor = user;
    watches = new Map();
    try {
        const raw = localStorage.getItem(storageKey(user));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            const nowMs = Date.now();
            for (const w of parsed) {
                if (validWatch(w) && !watchExpired(w, nowMs) && (w.kind === 'price' || w.atMs > nowMs - 60_000)) {
                    watches.set(w.id, w);
                }
            }
        }
    } catch { /* fresh slate */ }
    syncClock();
};

const syncClock = (): void => {
    const needsClock = [...watches.values()].some(w => w.kind === 'time');
    if (needsClock && !clock) clock = setInterval(() => evaluateWatches(Date.now()), 1000);
    if (!needsClock && clock) { clearInterval(clock); clock = null; }
};

const emit = (fired: WatchFired, remaining: WatchItem[]): void => {
    for (const cb of subscribers) {
        try { cb(fired, remaining); } catch { /* one bad listener must not stall the harness */ }
    }
};

/** Evaluate every watch against the given clock + last known price; fire the
 *  ones whose condition holds (each at most once, then removed). */
const evaluateWatches = (nowMs: number): void => {
    loadWatches();
    if (watches.size === 0) return;
    for (const w of [...watches.values()]) {
        if (watchExpired(w, nowMs)) { watches.delete(w.id); continue; }
        // The price only rides the signal when it's THIS symbol's mark —
        // a cross-symbol number is worse than none.
        const price = lastPriceSymbol === w.symbol ? lastPrice : null;
        if (!watchConditionHolds(w, price, nowMs)) continue;
        watches.delete(w.id);
        persist();
        emit({ watch: w, price, at: nowMs }, [...watches.values()]);
    }
    syncClock();
};

/** Arm a parsed watch (chartTriggers.parsePriceWatch / parseTimeWake). */
export const arm = (w: WatchItem): void => {
    loadWatches();
    if (watches.size >= MAX_WATCHES) {
        // Oldest first out — the newest ask is the one the user just made.
        const oldest = [...watches.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (oldest) watches.delete(oldest.id);
    }
    watches.set(w.id, w);
    persist();
    syncClock();
    // A condition that is ALREADY true (e.g. armed above a price already
    // printing) fires on the spot — "tell me the moment X is true" where X
    // is true now means: now. Without this a quiet feed (unchanged prints
    // never re-call tick) could leave it armed-but-already-satisfied.
    evaluateWatches(Date.now());
};

export const cancel = (id: string): boolean => {
    loadWatches();
    const had = watches.delete(id);
    if (had) { persist(); syncClock(); }
    return had;
};

/** Cancel by prefix (w-cancel-all helper for the model: every watch on a
 *  symbol, or everything). */
export const cancelWhere = (pred: (w: WatchItem) => boolean): number => {
    loadWatches();
    let n = 0;
    for (const w of [...watches.values()]) {
        if (pred(w)) { watches.delete(w.id); n += 1; }
    }
    if (n > 0) { persist(); syncClock(); }
    return n;
};

export const list = (symbol?: string): WatchItem[] => {
    loadWatches();
    const all = [...watches.values()];
    return symbol ? all.filter(w => w.symbol === symbol) : all;
};

/** The live-feed tick (TradeView calls it with its mark price, ~1s): records
 *  the price and lets price watches fire the moment it touches. */
export const tick = (symbol: string, price: number): void => {
    if (!Number.isFinite(price) || price <= 0) return;
    lastPrice = price;
    lastPriceSymbol = symbol;
    evaluateWatches(Date.now());
};

/** Clock-only evaluation — for when the feed is quiet but wakes are due.
 *  The internal 1s clock calls this too; exported for tests. */
export const tickTime = (): void => { evaluateWatches(Date.now()); };

export const subscribe = (cb: (fired: WatchFired, remaining: WatchItem[]) => void): (() => void) => {
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
};

/** Test hook: reset the singleton (localStorage persists — that's how a
 *  reload is simulated). */
export const __resetForTests = (): void => {
    watches = new Map();
    loadedFor = '';
    lastPrice = null;
    lastPriceSymbol = '';
    subscribers.clear();
    if (clock) { clearInterval(clock); clock = null; }
};

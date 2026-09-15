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
 * interval while ANY watch is armed. Price watches ride the visible chart
 * feed's tick() when it covers their symbol, and the same clock REST-polls
 * the mark price (Binance futures premiumIndex, ~5s per symbol) for the
 * non-visible ones — before that, a watch armed while the chart pointed at
 * another coin could never see a tick for its symbol and silently expired
 * (Tier-0 #6).
 */

import { getActiveUsername } from '../../utils/activeUser';
import {
    watchConditionHolds, watchExpired,
    type WatchFired, type WatchItem,
} from './chartTriggers';

const WATCHES_KEY_PREFIX = 'trade_watches_v1';
const MAX_WATCHES = 10;
/** A price is only trusted while fresh: the visible-chart feed prints ~1s
 *  apart and the REST poll refreshes non-visible symbols every ~5s. Beyond
 *  this window a cached print is worse than none (the cross-symbol gate). */
const PRICE_MAX_AGE_MS = 10_000;
/** Per-symbol REST throttle for armed-but-not-visible symbols. */
const PRICE_POLL_INTERVAL_MS = 5_000;

const storageKey = (user: string): string => `${WATCHES_KEY_PREFIX}_${user}`;

let watches = new Map<string, WatchItem>();
let loadedFor = '';
/** Last price per symbol + when it arrived. The chart feed's tick() only
 *  ever carries the ACTIVE symbol, so a per-symbol map (not one last-price)
 *  is what lets the REST poll side-feed armed watches on other coins —
 *  previously they silently expired because `lastPriceSymbol === w.symbol`
 *  could never hold for a non-visible symbol (Tier-0 #6). */
let priceBySymbol = new Map<string, { price: number; at: number }>();
const lastPollAttempt = new Map<string, number>();
const pollInFlight = new Set<string>();
const subscribers = new Set<(fired: WatchFired, remaining: WatchItem[]) => void>();
let clock: ReturnType<typeof setInterval> | null = null;

const persist = (): void => {
    try {
        localStorage.setItem(storageKey(loadedFor), JSON.stringify([...watches.values()].slice(-MAX_WATCHES)));
    } catch { /* private mode — watches live in memory this session */ }
};

/** Mark price (futures) for one armed-but-not-visible symbol. Deliberately a
 *  tiny local helper — importing MarketDataService would drag the whole
 *  multi-provider market layer into every harness consumer bundle. The
 *  ~4s abort keeps a stalled endpoint from piling up requests behind the
 *  5s throttle (and from hanging test workers). */
const fetchMarkPrice = async (symbol: string): Promise<number | null> => {
    try {
        const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(4000)
            : undefined;
        const response = await fetch(
            `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
            signal ? { signal } : undefined,
        );
        if (!response.ok) return null;
        const data: unknown = await response.json();
        const raw = (data as { markPrice?: unknown } | null)?.markPrice;
        const price = typeof raw === 'string' ? parseFloat(raw) : NaN;
        return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
        return null; // geo-block/offline — next tick retries after the throttle
    }
};

/** REST-poll every armed price symbol whose feed went stale (the visible
 *  chart tick refreshes its symbol ~1s, so in practice only non-visible
 *  symbols reach this — and a unmounted chart degrades to polled, not
 *  silently dead). Each symbol is attempted at most once per
 *  PRICE_POLL_INTERVAL_MS (throttle counts attempts, not successes, so a
 *  dead endpoint can't hot-loop). */
const pollStaleSymbols = (nowMs: number): void => {
    const targets = new Set<string>();
    for (const w of watches.values()) {
        if (w.kind !== 'price') continue;
        const entry = priceBySymbol.get(w.symbol);
        if (entry && nowMs - entry.at < PRICE_POLL_INTERVAL_MS) continue; // feed is fresh
        targets.add(w.symbol);
    }
    for (const symbol of targets) {
        if (pollInFlight.has(symbol)) continue;
        if (nowMs - (lastPollAttempt.get(symbol) ?? 0) < PRICE_POLL_INTERVAL_MS) continue;
        lastPollAttempt.set(symbol, nowMs);
        pollInFlight.add(symbol);
        void fetchMarkPrice(symbol).then(price => {
            if (price !== null) {
                priceBySymbol.set(symbol, { price, at: Date.now() });
                evaluateWatches(Date.now());
            }
        }).finally(() => pollInFlight.delete(symbol));
    }
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
    // The clock now serves BOTH kinds: time wakes fire off it, and price
    // watches on symbols the visible chart isn't feeding rely on it to run
    // the REST poll — an armed price watch with no clock was the silent
    // expiry (Tier-0 #6). It stops as soon as nothing is armed.
    const needsClock = watches.size > 0;
    if (needsClock && !clock) {
        clock = setInterval(() => {
            const now = Date.now();
            pollStaleSymbols(now);
            evaluateWatches(now);
        }, 1000);
    }
    if (!needsClock && clock) { clearInterval(clock); clock = null; }
};

const emit = (fired: WatchFired, remaining: WatchItem[]): void => {
    for (const cb of subscribers) {
        try { cb(fired, remaining); } catch { /* one bad listener must not stall the harness */ }
    }
};

/** The freshest trustworthy mark for a watch's symbol: the visible chart
 *  feed (tick) or the REST poll both write priceBySymbol; a print older
 *  than PRICE_MAX_AGE_MS means the feed for it died — better none than a
 *  stale cross-symbol number. */
const priceFor = (symbol: string, nowMs: number): number | null => {
    const entry = priceBySymbol.get(symbol);
    if (!entry || nowMs - entry.at > PRICE_MAX_AGE_MS) return null;
    return entry.price;
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
        const price = priceFor(w.symbol, nowMs);
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
    priceBySymbol.set(symbol, { price, at: Date.now() });
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
    priceBySymbol = new Map();
    lastPollAttempt.clear();
    pollInFlight.clear();
    subscribers.clear();
    if (clock) { clearInterval(clock); clock = null; }
};

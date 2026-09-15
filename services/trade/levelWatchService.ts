/**
 * levelWatchService — the harness side of "price reached a plan level, tell
 * Chart AI". Same shape as PriceAlertService/OutcomeAutopilotService: a
 * module singleton the trade surface arms from present_trade proposals and
 * ticks from the live mark-price feed; hits go to subscribers (TradeView
 * queues them into chatStore, which routes them to the dock as a model turn).
 *
 * CONTRACT (load-bearing): ADVISORY ONLY — this warns, it never resolves.
 * OutcomeAutopilotService owns SL/TP resolution and the post-mortem for
 * logged trades; both watch the same levels deliberately (one grades the
 * trade, one prompts the conversation). Nothing here writes trade outcomes.
 *
 * Fire-once: every level id that fires is latched in localStorage per user
 * (`trade_level_hits_v1_${user}`, capped), so a reload — or re-watching the
 * same plan — never re-pings a level that already spoke. The latch tracks
 * which user it was loaded for, so a user switch reloads instead of leaking
 * one profile's latches into another's key (the chatStore lesson). Armed
 * plans persist too (`trade_level_arms_v1_${user}`) — a reload no longer
 * silently un-watches a live trade; the per-user adopt re-arms from storage.
 *
 * Ticks ride the visible chart's live feed (TradeView calls tick() with its
 * mark, ~1s) — but that feed only ever carries the VIEWED coin. A plan armed
 * for another symbol (a background/harness turn presenting an off-view
 * instrument — reachable since the wave-3 turn-context; or an adopted
 * reload/user-switch plan on a coin the chart isn't on) could therefore never
 * see a tick and went silent — the same Tier-0 #6 shape watchService fixed
 * for price watches. So the service runs its own 1s interval while ANY plan
 * is armed and REST-polls the mark price (Binance futures premiumIndex,
 * ~5s per symbol, same fetch+throttle shape as watchService's) for symbols
 * whose last feed print went stale; a polled print runs through the exact
 * same tick() crossing logic, so notify/queueHarnessSignal routing is
 * automatic. A fresh live tick suppresses polling for its symbol, and the
 * interval stops as soon as nothing is armed.
 */

import { getActiveUsername } from '../../utils/activeUser';
import { fetchMarkPrice } from './markPricePoll';
import {
    buildPlanLevels, detectLevelHits, staleLevelsAtArm,
    type LevelHit, type PlanLevel, type WatchPlan,
} from './tradePlanLevels';

interface ArmedPlan {
    plan: WatchPlan;
    levels: PlanLevel[];
    /** Last accepted tick for this plan (crossing/dedup anchor). */
    prev: number | null;
}

const HITS_KEY_PREFIX = 'trade_level_hits_v1';
/** Latched ids are warnings that already spoke — bound the blob. */
const MAX_LATCHED = 200;
/** Armed plans persist under the sibling key so a reload doesn't silently
 *  un-watch a live trade (deep-dive Tier-1: the latch persisted, the armed
 *  set was memory-only). */
const ARMS_KEY_PREFIX = 'trade_level_arms_v1';
const MAX_ARMS = 10;
/** Per-symbol REST throttle for armed-but-not-visible symbols — the visible
 *  chart feed refreshes its symbol ~1s, so in practice only off-view symbols
 *  go stale and get polled (a quiet/unmounted chart degrades to polled too).
 *  Same 5s cadence as watchService's cross-symbol poll. */
const PRICE_POLL_INTERVAL_MS = 5_000;

const hitsKey = (user: string): string => `${HITS_KEY_PREFIX}_${user}`;
const armsKey = (user: string): string => `${ARMS_KEY_PREFIX}_${user}`;

let armed = new Map<string, ArmedPlan>();
let fired = new Set<string>();
let firedFor = '';
const subscribers = new Set<(hit: LevelHit, plan: WatchPlan) => void>();
/** Last price per symbol + when it arrived. tick() (the visible chart feed)
 *  and the REST poll both write here; the freshness check is what identifies
 *  the symbols the poller owns — the poller never fetches a symbol the view
 *  feed printed within the last ~5s. */
let priceBySymbol = new Map<string, { price: number; at: number }>();
const lastPollAttempt = new Map<string, number>();
const pollInFlight = new Set<string>();
let clock: ReturnType<typeof setInterval> | null = null;

const validPlan = (p: unknown): p is WatchPlan => {
    const v = p as WatchPlan & Record<string, unknown>;
    return !!v && typeof v === 'object'
        && typeof v.planId === 'string' && typeof v.symbol === 'string'
        && (v.direction === 'Long' || v.direction === 'Short')
        && typeof v.entry === 'number' && Number.isFinite(v.entry)
        && typeof v.stopLoss === 'number' && Number.isFinite(v.stopLoss)
        && Array.isArray(v.takeProfits)
        && v.takeProfits.every(t => typeof t === 'number' && Number.isFinite(t));
};

/** Rebuild the armed map from the current user's persisted plans. `prev`
 *  resets to null — the first post-reload tick is judged on the plain touch
 *  test (the "first-tick fallback" detectLevelHits already documents), and
 *  the fire-once latch keeps anything that spoke pre-reload silent. */
const loadArmed = (): void => {
    try {
        const raw = localStorage.getItem(armsKey(firedFor));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        for (const p of parsed.slice(-MAX_ARMS)) {
            if (!validPlan(p)) continue;
            armed.set(p.planId, { plan: p, levels: buildPlanLevels(p), prev: null });
        }
    } catch { /* fresh arms set */ }
};

const persistArmed = (): void => {
    try {
        const plans = [...armed.values()].slice(-MAX_ARMS).map(a => a.plan);
        if (plans.length === 0) localStorage.removeItem(armsKey(firedFor));
        else localStorage.setItem(armsKey(firedFor), JSON.stringify(plans));
    } catch { /* private mode — plans live in memory this session */ }
};

/** Adopt the CURRENT user's latch + armed set (cheap no-op while the user is
 *  unchanged). On a switch, ALSO drop the previous user's in-memory ARMED
 *  plans before reloading this user's: the fired-latch is per-user, but
 *  `armed` was a module-global, so without this A's plan would be ticked
 *  against B's price feed and fire B's Chart AI. */
const loadFired = (): void => {
    const user = getActiveUsername();
    if (user === firedFor) return;
    firedFor = user;
    armed = new Map();
    fired = new Set();
    try {
        const raw = localStorage.getItem(hitsKey(user));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) fired = new Set(parsed.filter((x): x is string => typeof x === 'string'));
    } catch { /* fresh latch */ }
    loadArmed();
    // A switch can empty or populate `armed` — the REST-poll clock follows it.
    syncClock();
};

const persistFired = (): void => {
    try {
        localStorage.setItem(hitsKey(firedFor), JSON.stringify([...fired].slice(-MAX_LATCHED)));
    } catch { /* private mode — latches live in memory this session */ }
};

/** REST-poll every armed plan's symbol whose feed went stale. The visible
 *  chart tick refreshes its symbol ~1s, so in practice only off-view symbols
 *  reach this (a plan armed by a background turn for a coin the chart isn't
 *  on — Tier-0 #6 for this watch family). Each symbol is attempted at most
 *  once per PRICE_POLL_INTERVAL_MS (throttle counts attempts, not successes,
 *  so a dead endpoint can't hot-loop); a successful print runs the existing
 *  tick() crossing logic, which carries the subscriber routing (notify +
 *  queueHarnessSignal live on the subscribe path, so polled hits route the
 *  same as view-fed ones). */
const pollStaleSymbols = (nowMs: number): void => {
    loadFired(); // a user switch mid-watch replaces `armed` (and may end the clock)
    if (armed.size === 0) { syncClock(); return; }
    const targets = new Set<string>();
    for (const a of armed.values()) {
        const entry = priceBySymbol.get(a.plan.symbol);
        if (entry && nowMs - entry.at < PRICE_POLL_INTERVAL_MS) continue; // feed is fresh
        targets.add(a.plan.symbol);
    }
    for (const symbol of targets) {
        if (pollInFlight.has(symbol)) continue;
        if (nowMs - (lastPollAttempt.get(symbol) ?? 0) < PRICE_POLL_INTERVAL_MS) continue;
        lastPollAttempt.set(symbol, nowMs);
        pollInFlight.add(symbol);
        void fetchMarkPrice(symbol).then(price => {
            if (price !== null) tick(symbol, price);
        }).finally(() => pollInFlight.delete(symbol));
    }
};

/** The 1s poll clock. It runs while ANY plan is armed — deliberately NOT only
 *  while a symbol looks stale: if the clock stopped the moment every print
 *  was fresh, a view feed that then died (unmounted chart, dropped socket)
 *  would have nothing left to notice the staleness, and the silent-starvation
 *  gap would re-open. An armed plan with no live feed to tick it is exactly
 *  the case this exists for (same reasoning as watchService's clock). */
const syncClock = (): void => {
    const needsClock = armed.size > 0;
    if (needsClock && !clock) {
        clock = setInterval(() => pollStaleSymbols(Date.now()), 1000);
    }
    if (!needsClock && clock) { clearInterval(clock); clock = null; }
};

/** Start watching a plan. `priceAtArm` (the live mark, if known) feeds the
 *  stale-plan guard: a plan already through its stop/target latches silently
 *  and is NOT armed — no tick-0 pings for a dead or paid plan. */
export const arm = (plan: WatchPlan, priceAtArm: number | null): void => {
    loadFired();
    const stale = staleLevelsAtArm(plan, priceAtArm);
    if (stale.length > 0) {
        stale.forEach(id => fired.add(id));
        persistFired();
        return;
    }
    armed.set(plan.planId, { plan, levels: buildPlanLevels(plan), prev: null });
    persistArmed();
    // The arm may have introduced a symbol the live feed never ticks — make
    // sure the REST poll clock exists to cover it.
    syncClock();
};

export const disarm = (planId: string): void => {
    loadFired();
    if (armed.delete(planId)) { persistArmed(); syncClock(); }
};

/** Drop every plan on a symbol (the trade surface resets its watch when the
 *  user switches instruments — fired latches persist, so nothing re-pings). */
export const disarmSymbol = (symbol: string): void => {
    loadFired();
    let changed = false;
    for (const [id, a] of armed) if (a.plan.symbol === symbol) { armed.delete(id); changed = true; }
    if (changed) { persistArmed(); syncClock(); }
};

/** One live price observation for a symbol — either the visible chart's
 *  ~1s mark feed (TradeView) or the internal REST poll feeding an off-view
 *  symbol. Records the print (freshness gates the poller) and runs the
 *  crossing logic for that symbol's armed plans. */
export const tick = (symbol: string, price: number): void => {
    loadFired(); // adopt a user switch BEFORE the empty check — the reload
    // may populate `armed` itself
    if (!Number.isFinite(price) || price <= 0) return; // never poison `prev`/freshness
    priceBySymbol.set(symbol, { price, at: Date.now() });
    if (armed.size === 0) return;
    const isFired = (id: string): boolean => fired.has(id);
    for (const a of armed.values()) {
        if (a.plan.symbol !== symbol) continue;
        const hits = detectLevelHits(a.levels, a.plan.direction, a.prev, price, isFired);
        a.prev = price;
        if (hits.length === 0) continue;
        for (const h of hits) fired.add(h.levelId);
        persistFired();
        for (const h of hits) {
            for (const cb of subscribers) {
                try { cb(h, a.plan); } catch { /* one bad listener must not stall the watch */ }
            }
        }
    }
};

export const subscribe = (cb: (hit: LevelHit, plan: WatchPlan) => void): (() => void) => {
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
};

/** Plans currently under watch (the dock renders their levels into the
 *  model's context via describePlanForModel). loadFired() first so a
 *  user switch adopted here re-reads the incoming user's persisted arms. */
export const getArmedPlans = (): WatchPlan[] => {
    loadFired();
    return [...armed.values()].map(a => a.plan);
};

/** Which of an armed plan's levels have already fired. */
export const firedLevelsFor = (planId: string): string[] => {
    loadFired();
    const a = armed.get(planId);
    return a ? a.levels.map(l => l.id).filter(id => fired.has(id)) : [];
};

/** Test hook: reset the singleton between suites (localStorage persists —
 *  that's exactly how a reload is simulated). */
export const __resetForTests = (): void => {
    armed = new Map();
    fired = new Set();
    firedFor = '';
    subscribers.clear();
    priceBySymbol = new Map();
    lastPollAttempt.clear();
    pollInFlight.clear();
    if (clock) { clearInterval(clock); clock = null; }
};

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
 */

import { getActiveUsername } from '../../utils/activeUser';
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

const hitsKey = (user: string): string => `${HITS_KEY_PREFIX}_${user}`;
const armsKey = (user: string): string => `${ARMS_KEY_PREFIX}_${user}`;

let armed = new Map<string, ArmedPlan>();
let fired = new Set<string>();
let firedFor = '';
const subscribers = new Set<(hit: LevelHit, plan: WatchPlan) => void>();

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
};

const persistFired = (): void => {
    try {
        localStorage.setItem(hitsKey(firedFor), JSON.stringify([...fired].slice(-MAX_LATCHED)));
    } catch { /* private mode — latches live in memory this session */ }
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
};

export const disarm = (planId: string): void => {
    loadFired();
    if (armed.delete(planId)) persistArmed();
};

/** Drop every plan on a symbol (the trade surface resets its watch when the
 *  user switches instruments — fired latches persist, so nothing re-pings). */
export const disarmSymbol = (symbol: string): void => {
    loadFired();
    let changed = false;
    for (const [id, a] of armed) if (a.plan.symbol === symbol) { armed.delete(id); changed = true; }
    if (changed) persistArmed();
};

/** One live price observation for a symbol (the feed's ~1s mark price). */
export const tick = (symbol: string, price: number): void => {
    loadFired(); // adopt a user switch BEFORE the empty check — the reload
    if (armed.size === 0) return; // may populate `armed` itself
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
};

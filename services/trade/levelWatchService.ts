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
 * one profile's latches into another's key (the chatStore lesson).
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

const hitsKey = (user: string): string => `${HITS_KEY_PREFIX}_${user}`;

let armed = new Map<string, ArmedPlan>();
let fired = new Set<string>();
let firedFor = '';
const subscribers = new Set<(hit: LevelHit, plan: WatchPlan) => void>();

/** Adopt the CURRENT user's latch (cheap no-op while the user is unchanged). */
const loadFired = (): void => {
    const user = getActiveUsername();
    if (user === firedFor) return;
    firedFor = user;
    fired = new Set();
    try {
        const raw = localStorage.getItem(hitsKey(user));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) fired = new Set(parsed.filter((x): x is string => typeof x === 'string'));
    } catch { /* fresh latch */ }
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
};

export const disarm = (planId: string): void => { armed.delete(planId); };

/** Drop every plan on a symbol (the trade surface resets its watch when the
 *  user switches instruments — fired latches persist, so nothing re-pings). */
export const disarmSymbol = (symbol: string): void => {
    for (const [id, a] of armed) if (a.plan.symbol === symbol) armed.delete(id);
};

/** One live price observation for a symbol (the feed's ~1s mark price). */
export const tick = (symbol: string, price: number): void => {
    if (armed.size === 0) return;
    loadFired();
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
 *  model's context via describePlanForModel). */
export const getArmedPlans = (): WatchPlan[] => [...armed.values()].map(a => a.plan);

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

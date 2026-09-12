/**
 * tradePlanLevels — the pure half of the harness level-watch: derive the
 * watchable levels of a presented trade plan, detect direction-aware
 * touches on live price ticks, and render the plan / a hit as the text the
 * Chart AI model reads. Mirrors the chatPanel/chatStore split (pure logic +
 * a singleton service), so every rule here is unit-testable with no React
 * and no network.
 *
 * CONTRACT: this is ADVISORY ONLY. It warns the model that a level was
 * reached; it never resolves anything. OutcomeAutopilotService owns SL/TP
 * resolution + post-mortem for logged trades. Both watch the same levels on
 * purpose — one grades the trade, one prompts the conversation — and the
 * fire-once latch (persisted per user by levelWatchService) keeps a level
 * from ever pinging twice, across reloads.
 */

import { phtClock } from '../../utils/timezone';

export interface PlanLevel {
    /** Stable id the model quotes back: `${planId}:ENTRY|:SL|:TP1..N`. */
    id: string;
    kind: 'entry' | 'sl' | 'tp';
    label: string;
    price: number;
    tpIndex?: number;
}

export interface WatchPlan {
    planId: string;
    symbol: string;
    direction: 'Long' | 'Short';
    entry: number;
    stopLoss: number;
    takeProfits: number[];
}

export interface LevelHit {
    levelId: string;
    kind: PlanLevel['kind'];
    label: string;
    /** The plan's level price. */
    price: number;
    /** The tick that touched it. */
    hitPrice: number;
    /** Epoch ms. */
    at: number;
}

/** One row per watchable level, ids stable for the plan's whole life. */
export const buildPlanLevels = (p: WatchPlan): PlanLevel[] => {
    const levels: PlanLevel[] = [
        { id: `${p.planId}:ENTRY`, kind: 'entry', label: 'Entry', price: p.entry },
        { id: `${p.planId}:SL`, kind: 'sl', label: 'Stop loss', price: p.stopLoss },
    ];
    p.takeProfits.forEach((tp, i) => levels.push({
        id: `${p.planId}:TP${i + 1}`, kind: 'tp', label: `TP${i + 1}`, price: tp, tpIndex: i + 1,
    }));
    return levels;
};

/** Direction-aware touch: is `price` at or through this level? A Long's
 *  entry/stop sit BELOW the market (fire at `<=`), its targets ABOVE (`>=`);
 *  a Short mirrors. A touch test subsumes mid-tick crossings — any print on
 *  the far side of the level fires, however fast the market moved. */
const touches = (level: PlanLevel, price: number, direction: 'Long' | 'Short'): boolean => {
    if (!Number.isFinite(level.price) || level.price <= 0) return false;
    const beyond = direction === 'Long'
        ? (level.kind === 'tp' ? price >= level.price : price <= level.price)
        : (level.kind === 'tp' ? price <= level.price : price >= level.price);
    return beyond;
};

/** Every unfired level this tick touches. `prev` is the last accepted tick:
 *  an unchanged print can't newly touch anything, so it's skipped (the
 *  feed's 1s mark price repeats constantly). The first tick (prev === null)
 *  is judged on the plain touch test — the "first-tick fallback". */
export const detectLevelHits = (
    levels: PlanLevel[],
    direction: 'Long' | 'Short',
    prev: number | null,
    price: number,
    isFired: (levelId: string) => boolean,
): LevelHit[] => {
    if (!Number.isFinite(price) || price <= 0) return [];
    if (prev !== null && prev === price) return [];
    const at = Date.now();
    return levels
        .filter(l => !isFired(l.id) && touches(l, price, direction))
        .map(l => ({ levelId: l.id, kind: l.kind, label: l.label, price: l.price, hitPrice: price, at }));
};

/**
 * Stale-plan guard: levels to latch SILENTLY at arm time. If the market is
 * already through the stop or a target when the plan is armed, the plan is
 * already invalidated or paid — pinging "SL HIT" on tick 0 for a plan the
 * user just watched die is noise, so every level is suppressed. An entry
 * already in range is NOT stale (the zone is live right now) — it fires on
 * the first tick like any other touch.
 */
export const staleLevelsAtArm = (p: WatchPlan, priceAtArm: number | null): string[] => {
    if (priceAtArm === null || !Number.isFinite(priceAtArm) || priceAtArm <= 0) return [];
    const levels = buildPlanLevels(p);
    const dead = levels.some(l => (l.kind === 'sl' || l.kind === 'tp') && touches(l, priceAtArm, p.direction));
    return dead ? levels.map(l => l.id) : [];
};

/** The armed-plan block the model reads with every message: the live plan,
 *  each level's id, and which levels already fired (never to be re-
 *  announced). Empty firedIds ⇒ "nothing has fired yet". */
export const describePlanForModel = (p: WatchPlan, firedIds: string[]): string => {
    const levels = buildPlanLevels(p);
    const fired = new Set(firedIds);
    const rows = levels.map(l => `${l.label} ${l.price}${fired.has(l.id) ? ' — FIRED' : ''} [${l.id}]`);
    return [
        `[ARMED PLAN — harness level watch on ${p.direction} ${p.symbol}, plan ${p.planId}. Advisory only: the harness warns, it never places or closes anything.]`,
        rows.join(' · '),
        fired.size > 0
            ? `Already fired: ${levels.filter(l => fired.has(l.id)).map(l => l.id).join(', ')} — never re-announce these.`
            : 'No level has fired yet.',
    ].join('\n');
};

/** The exact text a level hit sends to the model (the harness signal). The
 *  level id is named explicitly so the model can say WHICH level spoke. */
export const formatLevelHitForModel = (p: WatchPlan, hit: LevelHit, firedIds: string[]): string => {
    const when = phtClock(hit.at);
    const others = firedIds.filter(id => id !== hit.levelId);
    return [
        `[HARNESS SIGNAL — price event, not the user] Plan ${p.planId}: ${hit.label} @ ${hit.price} HIT (mark ${hit.hitPrice}, ${when} PHT).`,
        `Level id ${hit.levelId}.`,
        `Plan: Entry ${p.entry} · SL ${p.stopLoss} · TP ${p.takeProfits.join(' / ')}.`,
        others.length > 0 ? `Already fired: ${others.join(', ')}.` : 'This is the first level of this plan to fire.',
        'Warn the user now: what hit, the price, whether the rest of the plan holds, and refer to levels by id. Do not re-announce fired levels.',
    ].join(' ');
};

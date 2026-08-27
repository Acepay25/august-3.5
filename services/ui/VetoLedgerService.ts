/**
 * VetoLedgerService — falsification tracking for skill vetoes.
 *
 * A confirmed AVOID skill blocks a setup, so no trade outcome ever arrives to
 * refute it: unchallenged vetoes silently shrink the tradeable universe.
 * This ledger makes vetoes measurable claims:
 *
 *   1. When enforcement (or the moderator's skip_to_verdict) vetoes a setup,
 *      `recordVeto` stamps the skill, coin, direction and the price at veto
 *      time, plus what the blocked setup WOULD have targeted (TP/SL).
 *   2. The shared price feed (PriceAlertService.trackSymbol) observes the
 *      path afterward. `evaluateVetoes` settles each pending entry:
 *        • WOULD_TP  — price hit the would-be take-profit first (the veto
 *                      cost a winner → counts AGAINST the skill)
 *        • WOULD_SL  — price hit the would-be stop first (veto vindicated)
 *        • EXPIRED   — neither level touched within the window
 *   3. Per-skill accuracy rollups (`getAccuracyBySkill`) are read straight
 *      from the ledger by the Learning Dashboard; nothing is written back
 *      into skill frontmatter — the ledger is the single source of truth.
 *
 * Persistence rides Preferences (per-user), bounded like every other ledger.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { PriceAlertService } from '../ui/PriceAlertService';
import { recordMemoryInjection } from '../learning/MemoryInjectionService';
import type { SkillMeta } from '../learning/SkillMemoryService';

export type VetoOutcome = 'PENDING' | 'WOULD_TP' | 'WOULD_SL' | 'EXPIRED';

export interface VetoRecord {
    id: string;
    /** Skill file name, e.g. "btc-short-avoid.md". */
    skillName: string;
    coinName: string;
    symbol: string;
    /** Direction of the BLOCKED setup. */
    direction: 'Long' | 'Short' | 'Neutral';
    /** Price when the veto fired. */
    referencePrice: number;
    /** What the blocked setup would have targeted (absolute USDT levels). */
    wouldTakeProfit?: number;
    wouldStopLoss?: number;
    /** Which TP target was used for the would-be outcome (1-based). */
    tpIndex?: number;
    regime?: string;
    createdAt: string;
    settledAt?: string;
    outcome: VetoOutcome;
    /** Max favorable excursion while pending (% from reference). */
    maxFavorablePercent?: number;
    reason?: string;
}

const KEY_PREFIX = 'skill_veto_ledger_v1_';
const MAX_RECORDS = 300;
/** A pending veto expires after this long without touching either level. */
const EXPIRY_MS = 7 * 86_400_000; // 7 days

type ChangeCallback = () => void;

class VetoLedgerServiceClass {
    private records = new Map<string, VetoRecord>();
    /** Which user's records the in-memory cache currently holds — the app
     *  can switch users, and a stale cache must not leak across ledgers. */
    private cacheUser: string | null = null;
    private changeSubscribers = new Set<ChangeCallback>();
    private unsubscribePrices: (() => void) | null = null;
    private releaseMonitor: (() => void) | null = null;
    private initializedUsers = new Set<string>();
    // Serialize preference writes (same pattern as SetupWatchService).
    private saveChain: Promise<void> = Promise.resolve();

    async init(username: string): Promise<void> {
        const key = username || 'default';
        // Always re-pin the feed user FIRST — the app can switch users
        // A → B → A, and the early return below must not leave price ticks
        // settling B's ledger while A is back in the app.
        this.setCurrentUser(key);
        if (this.initializedUsers.has(key)) return;
        this.initializedUsers.add(key);
        await this.load(username);
        this.ensureFeed();
        // Settle anything already past its expiry on load.
        await this.evaluateVetoes(username);
    }

    /** Stamp a fresh veto. Fire-and-forget safe; never throws. */
    async recordVeto(params: {
        username: string;
        skill: SkillMeta;
        skillName: string;
        coinName?: string;
        direction?: 'Long' | 'Short' | 'Neutral';
        entryPrice?: number;
        takeProfits?: Array<{ price: number }>;
        stopLoss?: number;
        regime?: string;
        reason?: string;
    }): Promise<VetoRecord | null> {
        try {
            const ref = params.entryPrice ?? 0;
            if (!params.coinName || !(ref > 0)) return null;
            // Price-tick settlement runs for `currentUsername` — pin it to
            // the user this veto belongs to even when init() hasn't run yet
            // (the pipeline can fire a veto before any dashboard opened).
            this.setCurrentUser(params.username);
            const symbol = PriceAlertService.normalizeSymbol(params.coinName);
            const tpList = params.takeProfits?.map(t => t.price) ?? [];
            const tpIdx = tpList.findIndex(p => p > 0);
            const tp = tpIdx >= 0 ? tpList[tpIdx] : undefined;
            const rec: VetoRecord = {
                id: `veto_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                skillName: params.skillName,
                coinName: params.coinName,
                symbol,
                direction: params.direction ?? 'Neutral',
                referencePrice: ref,
                wouldTakeProfit: tp && ((params.direction ?? 'Long') === 'Long' ? tp > ref : tp < ref) ? tp : undefined,
                wouldStopLoss: params.stopLoss != null && params.stopLoss > 0
                    && ((params.direction ?? 'Long') === 'Long' ? params.stopLoss < ref : params.stopLoss > ref)
                    ? params.stopLoss
                    : undefined,
                tpIndex: tpIdx >= 0 ? tpIdx + 1 : undefined,
                regime: params.regime,
                createdAt: new Date().toISOString(),
                outcome: 'PENDING',
                reason: params.reason,
            };
            const list = await this.loadList(params.username);
            const merged = [rec, ...list];
            const next = merged.slice(0, MAX_RECORDS);
            // A PENDING record pushed off the cap still holds a feed claim —
            // release it or the symbol stays tracked forever.
            for (const evicted of merged.slice(MAX_RECORDS)) {
                if (evicted.outcome === 'PENDING') PriceAlertService.untrackSymbol(evicted.symbol);
            }
            await this.saveList(params.username, next);
            this.records.clear();
            next.forEach(r => this.records.set(r.id, r));
            PriceAlertService.trackSymbol(symbol);
            this.ensureFeed();
            this.notifyChange();
            // Decision-bias closure: a veto is a decision the harness made, but
            // until now the NEXT analysis never knew it happened — the skill got
            // no attribution and the setup silently re-presented as if unblocked.
            // Record a synthetic injection source so attribution, lift and the
            // dashboard see the veto, and a future matching setup can surface
            // "this was vetoed last time, here is how it resolved". Fire-and-
            // forget: telemetry must never break the veto path.
            void recordMemoryInjection(params.username, {
                stage: 'verdict',
                audience: 'moderator',
                coin: params.coinName,
                sources: [{ path: `veto/${params.skillName}`, kind: 'veto' }],
            }).catch(() => { /* telemetry is best-effort */ });
            return rec;
        } catch (e) {
            console.warn('[VetoLedger] recordVeto failed:', e);
            return null;
        }
    }

    /**
     * Evaluate all pending vetoes against current prices; expire stale ones.
     * Returns how many entries transitioned state (settled) this pass. MFE
     * updates are in-memory only and do not count as a transition.
     */
    async evaluateVetoes(username: string): Promise<number> {
        const list = await this.loadList(username);
        let changed = 0;
        // MFE is a running max kept for diagnostics — persisting it on every
        // improving tick amplifies preference writes, so it only updates the
        // in-memory cache here and rides the NEXT settle transition to disk.
        let mfeTouched = false;
        // Symbols whose veto transitions PENDING → settled in THIS pass — one
        // feed claim released per transition. Re-releasing symbols that
        // settled in an EARLIER pass would decrement refcounts owned by
        // other consumers (setup watches, fresh vetoes) and could silently
        // drop THEIR symbols from the price feed.
        const settledNow: string[] = [];
        const now = Date.now();
        const next = list.map(rec => {
            if (rec.outcome !== 'PENDING') return rec;
            const created = Date.parse(rec.createdAt);
            if (!Number.isFinite(created) || now - created > EXPIRY_MS) {
                changed += 1;
                settledNow.push(rec.symbol);
                return { ...rec, outcome: 'EXPIRED' as VetoOutcome, settledAt: new Date().toISOString() };
            }
            const price = PriceAlertService.getCurrentPrice(rec.symbol);
            if (price == null || !isFinite(price) || price <= 0) return rec;

            // Track favorable excursion for diagnostics (in-memory only).
            const movePct = ((price - rec.referencePrice) / rec.referencePrice) * 100;
            const favorable = rec.direction === 'Short' ? -movePct : movePct;
            if (favorable > (rec.maxFavorablePercent ?? 0)) {
                rec = { ...rec, maxFavorablePercent: Math.round(favorable * 100) / 100 };
                mfeTouched = true;
            }

            // First-touch ordering: check SL before TP when both are within
            // reach — conservative for the skill (a near-simultaneous touch
            // counts as vindicated rather than costly).
            const hitSl = rec.wouldStopLoss != null && (
                rec.direction === 'Short'
                    ? price >= rec.wouldStopLoss
                    : price <= rec.wouldStopLoss
            );
            const hitTp = rec.wouldTakeProfit != null && (
                rec.direction === 'Short'
                    ? price <= rec.wouldTakeProfit
                    : price >= rec.wouldTakeProfit
            );
            if (hitSl) {
                changed += 1;
                settledNow.push(rec.symbol);
                return { ...rec, outcome: 'WOULD_SL' as VetoOutcome, settledAt: new Date().toISOString() };
            }
            if (hitTp) {
                changed += 1;
                settledNow.push(rec.symbol);
                return { ...rec, outcome: 'WOULD_TP' as VetoOutcome, settledAt: new Date().toISOString() };
            }
            return rec;
        });
        if (changed > 0) {
            await this.saveList(username, next);
            this.records.clear();
            next.forEach(r => this.records.set(r.id, r));
            this.notifyChange();
        } else if (mfeTouched) {
            // Refresh the cache so the running MFE survives to the next
            // settle-driven persist — but skip the preference write and the
            // subscriber fan-out (nothing a consumer renders changed yet).
            this.records.clear();
            next.forEach(r => this.records.set(r.id, r));
        }
        for (const s of settledNow) PriceAlertService.untrackSymbol(s);
        return changed;
    }

    /** All records for the user (newest first). */
    async getAll(username: string): Promise<VetoRecord[]> {
        return this.loadList(username);
    }

    /** Per-skill accuracy rollup: { hits, runs } where a "hit" is a veto that
     *  saved a loser (WOULD_SL) and a "run" is one that blocked a winner. */
    async getAccuracyBySkill(username: string): Promise<Record<string, { hits: number; runs: number; pending: number }>> {
        const list = await this.loadList(username);
        const out: Record<string, { hits: number; runs: number; pending: number }> = {};
        for (const r of list) {
            const slot = out[r.skillName] ??= { hits: 0, runs: 0, pending: 0 };
            if (r.outcome === 'WOULD_SL') slot.hits += 1;
            else if (r.outcome === 'WOULD_TP') slot.runs += 1;
            else if (r.outcome === 'PENDING') slot.pending += 1;
        }
        return out;
    }

    subscribeChanges(cb: ChangeCallback): () => void {
        this.changeSubscribers.add(cb);
        return () => this.changeSubscribers.delete(cb);
    }

    /** Test-only reset. */
    resetForTest(): void {
        this.records.clear();
        this.cacheUser = null;
        this.currentUsername = null;
        this.initializedUsers.clear();
        this.changeSubscribers.clear();
        this.unsubscribePrices?.();
        this.unsubscribePrices = null;
        this.releaseMonitor?.();
        this.releaseMonitor = null;
    }

    private notifyChange(): void {
        this.changeSubscribers.forEach(cb => {
            try { cb(); } catch { /* subscriber errors never break the ledger */ }
        });
    }

    private ensureFeed(): void {
        if (this.unsubscribePrices) return;
        this.releaseMonitor = PriceAlertService.acquireMonitor();
        this.unsubscribePrices = PriceAlertService.subscribePrices(() => {
            // Tick-driven evaluation is debounced through the microtask queue;
            // actual state changes only happen inside evaluateVetoes.
            void this.evaluateVetoes(this.currentUsername ?? 'default');
        });
    }

    private currentUsername: string | null = null;
    /** Remembered by init() so price ticks know whose ledger to settle. */
    setCurrentUser(username: string): void {
        this.currentUsername = username || 'default';
    }

    private async loadList(username: string): Promise<VetoRecord[]> {
        const key = `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;
        if (this.records.size > 0 && this.cacheUser === key) {
            return Array.from(this.records.values());
        }
        try {
            const stored = await getPreferenceObject<VetoRecord[]>(key);
            const list = Array.isArray(stored) ? stored : [];
            this.records.clear();
            this.cacheUser = key;
            list.forEach(r => this.records.set(r.id, r));
            return list;
        } catch {
            return [];
        }
    }

    private async saveList(username: string, list: VetoRecord[]): Promise<void> {
        try {
            const key = `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;
            this.saveChain = this.saveChain
                .then(() => setPreferenceObject(key, list))
                .catch(e => console.warn('[VetoLedger] Save error:', e));
            await this.saveChain;
        } catch (e) {
            console.warn('[VetoLedger] saveList failed:', e);
        }
    }

    private async load(username: string): Promise<void> {
        await this.loadList(username);
        this.setCurrentUser(username);
    }
}

export const VetoLedgerService = new VetoLedgerServiceClass();

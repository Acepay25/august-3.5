/**
 * SetupWatchService — price-triggered re-debates ("watch this setup").
 *
 * A watch attaches a price trigger to a completed analysis message. The
 * trigger rides the real-time price feed owned by PriceAlertService (shared
 * WebSocket + polling loop — no second socket, no duplicated pause/resume
 * lifecycle handling). When the condition is met the watch flips to
 * TRIGGERED (fire-once) and fire subscribers are notified; the app then
 * launches a fresh debate for the same setup with the previous verdict as
 * context. Change subscribers are notified on any mutation so UI can stay in
 * sync via useSyncExternalStore.
 *
 * Watches are immutable-by-replacement: every mutation stores a new object in
 * the map, so getSnapshot() returns a stable reference that only changes when
 * the watch actually changes.
 */

import { SetupWatch, SetupWatchTriggerEvent } from '../../types';
import { getPreferenceObject, setPreferenceObject, removePreference, PREF_KEYS } from '../infrastructure/PreferencesService';
import { getActiveUsername } from '../../utils/activeUser';
import { PriceAlertService } from './PriceAlertService';

type FireCallback = (trigger: SetupWatchTriggerEvent) => void;
type ChangeCallback = () => void;

export interface CreateSetupWatchParams {
    messageId: string;
    coinName: string;
    triggerType: SetupWatch['triggerType'];
    priceLevel?: number;
    percent?: number;
    referencePrice: number;
    direction?: SetupWatch['direction'];
}

/** Human-readable trigger description, e.g. "price breaks above $69,420". */
export const describeWatchTrigger = (watch: Pick<SetupWatch, 'triggerType' | 'priceLevel' | 'percent' | 'referencePrice'>): string => {
    const fmt = (n: number | undefined): string =>
        n == null || !isFinite(n) ? '—' : n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
    switch (watch.triggerType) {
        case 'PRICE_ABOVE':
            return `price breaks above ${fmt(watch.priceLevel)}`;
        case 'PRICE_BELOW':
            return `price drops below ${fmt(watch.priceLevel)}`;
        case 'PCT_MOVE':
            return `price moves ±${watch.percent}% from ${fmt(watch.referencePrice)}`;
        case 'INVALIDATION':
            return `invalidation ${fmt(watch.priceLevel)}`;
        default:
            return 'price condition';
    }
};

class SetupWatchServiceClass {
    private watches = new Map<string, SetupWatch>();
    private fireSubscribers = new Set<FireCallback>();
    private changeSubscribers = new Set<ChangeCallback>();
    private unsubscribePrices: (() => void) | null = null;
    private releaseMonitor: (() => void) | null = null;
    private initialized = false;
    /** Profile the in-memory watch map belongs to. Watches persist under
     *  `setup_watches_v1_<username>` — the global key was unscoped (audit
     *  §2.5) and one user's re-debate triggers used to arm under another. */
    private loadedUser: string | null = null;
    /** Bumped by every init/reset so a superseded profile switch can't
     *  commit the outgoing user's watches into the incoming one's session
     *  (mirrors GlobalLearningService._initGeneration). */
    private initGeneration = 0;
    // Serialize preference writes: fire-and-forget async saves can land out
    // of order and let an older snapshot overwrite a newer re-arm.
    private saveChain: Promise<void> = Promise.resolve();

    /**
     * Load persisted watches and start consuming the price feed. Idempotent
     * FOR THE SAME USER only: an init for a different profile (the switch
     * path) tears the previous user's state down and loads the incoming
     * user's key — the old unconditional `if (initialized) return;` made the
     * post-switch re-init a no-op, so the new user inherited the old user's
     * armed watches.
     */
    async init(username?: string): Promise<void> {
        const user = username ?? getActiveUsername();
        if (this.initialized && this.loadedUser === user) return;
        const gen = ++this.initGeneration;
        this.teardownFeed();
        this.releaseTrackedSymbols();
        this.watches.clear();
        this.loadedUser = user;
        this.initialized = true;
        const fetched = await this.fetchWatches(user);
        if (gen !== this.initGeneration || this.loadedUser !== user) return;
        if (fetched) this.hydrateWatches(fetched.watches, fetched.migrate);
        if (fetched?.migrate) {
            // The blob moved into THIS user's key — retire the shared global
            // one so the next profile never re-adopts the same watches.
            removePreference(PREF_KEYS.SETUP_WATCHES).catch(() => { /* best effort */ });
        }
        this.ensureFeed();
    }

    /**
     * Profile switch: drop the outgoing user's watches from MEMORY and
     * release the feed hooks, and re-arm init so the incoming user's
     * init() actually loads their own persisted set. Their storage is
     * untouched — it is keyed per user and re-adopted on next login.
     */
    reset(): void {
        this.initGeneration++;
        this.teardownFeed();
        this.releaseTrackedSymbols();
        this.watches.clear();
        this.loadedUser = null;
        this.initialized = false;
    }

    /**
     * Create a watch for an analysis message. One active watch per message —
     * returns the existing ARMED watch when present (mirrors the alert
     * dedupe in PriceAlertService). Returns null when the trigger config is
     * invalid (missing/zero level or percent).
     */
    createWatch(params: CreateSetupWatchParams): SetupWatch | null {
        const existing = this.getWatchForMessage(params.messageId);
        if (existing?.status === 'ARMED') return existing;
        if (existing) this.watches.delete(existing.id); // stale triggered/canceled watch replaced

        const symbol = PriceAlertService.normalizeSymbol(params.coinName);
        const watch: SetupWatch = {
            id: `watch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            messageId: params.messageId,
            coinName: params.coinName,
            symbol,
            triggerType: params.triggerType,
            priceLevel: params.priceLevel,
            percent: params.percent,
            referencePrice: params.referencePrice,
            direction: params.direction,
            status: 'ARMED',
            createdAt: new Date().toISOString(),
            triggerCount: 0,
        };
        if (!this.isValidWatch(watch)) return null;

        this.watches.set(watch.id, watch);
        // Register the symbol with the shared feed so ticks flow even without
        // a pre-existing price alert (the feed only streams alert symbols).
        PriceAlertService.trackSymbol(watch.symbol);
        void this.saveWatches();
        this.ensureFeed();
        this.notifyChange();
        console.log(`[SetupWatchService] Armed watch for ${symbol}: ${describeWatchTrigger(watch)}`);
        return watch;
    }

    /** Cancel an armed/triggered watch. */
    cancelWatch(watchId: string): boolean {
        const watch = this.watches.get(watchId);
        if (!watch) return false;
        this.watches.delete(watchId);
        // Drop the feed registration once the last watch for the symbol is
        // gone (trackSymbol/untrackSymbol are ref-counted by SetupWatchService).
        const stillTracked = Array.from(this.watches.values()).some(w => w.symbol === watch.symbol);
        if (!stillTracked) PriceAlertService.untrackSymbol(watch.symbol);
        void this.saveWatches();
        this.notifyChange();
        return true;
    }

    /**
     * Re-arm a TRIGGERED watch so it can fire again. Used when a watch fires
     * while another analysis run is in flight — the pipeline re-arms it and
     * the next price tick (≤10s polling) launches the re-debate once free.
     */
    rearmWatch(watchId: string): boolean {
        const watch = this.watches.get(watchId);
        if (!watch || watch.status !== 'TRIGGERED') return false;
        this.watches.set(watch.id, { ...watch, status: 'ARMED', triggeredAt: undefined });
        void this.saveWatches();
        this.notifyChange();
        return true;
    }

    getWatchForMessage(messageId: string): SetupWatch | undefined {
        return Array.from(this.watches.values()).find(w => w.messageId === messageId);
    }

    getAllWatches(): SetupWatch[] {
        return Array.from(this.watches.values());
    }

    /** Fire-event subscription — called once per trigger, with the price. */
    subscribe(callback: FireCallback): () => void {
        this.fireSubscribers.add(callback);
        return () => this.fireSubscribers.delete(callback);
    }

    /** Change subscription — called on any create/cancel/rearm/trigger/load. */
    subscribeChanges(callback: ChangeCallback): () => void {
        this.changeSubscribers.add(callback);
        return () => this.changeSubscribers.delete(callback);
    }

    /** Test-only: wipe in-memory state + feed hooks. */
    resetForTest(): void {
        this.reset();
        this.fireSubscribers.clear();
        this.changeSubscribers.clear();
    }

    /** Release the shared-feed hold and the tick subscription (if held). */
    private teardownFeed(): void {
        this.unsubscribePrices?.();
        this.unsubscribePrices = null;
        this.releaseMonitor?.();
        this.releaseMonitor = null;
    }

    /** Give back every trackSymbol hold this profile's watches took —
     *  without it the outgoing user's symbols keep streaming under the
     *  incoming one and the ref-counts drift upward across switches. */
    private releaseTrackedSymbols(): void {
        for (const watch of this.watches.values()) {
            PriceAlertService.untrackSymbol(watch.symbol);
        }
    }

    private isValidWatch(watch: SetupWatch): boolean {
        switch (watch.triggerType) {
            case 'PRICE_ABOVE':
            case 'PRICE_BELOW':
                return watch.priceLevel != null && watch.priceLevel > 0;
            case 'PCT_MOVE':
                return watch.percent != null && watch.percent > 0 && watch.referencePrice > 0;
            case 'INVALIDATION':
                return watch.priceLevel != null && watch.priceLevel > 0;
            default:
                return false;
        }
    }

    private ensureFeed(): void {
        if (this.unsubscribePrices) return;
        // Hold the shared feed even with zero alerts, then subscribe to ticks.
        this.releaseMonitor = PriceAlertService.acquireMonitor();
        this.unsubscribePrices = PriceAlertService.subscribePrices((symbol, price) => {
            this.handlePriceTick(symbol, price);
        });
        // Evaluate immediately against any already-cached prices (the socket
        // may have been running before this watch existed).
        for (const watch of this.watches.values()) {
            const current = PriceAlertService.getCurrentPrice(watch.symbol);
            if (current != null) this.handlePriceTick(watch.symbol, current);
        }
    }

    private handlePriceTick(symbol: string, price: number): void {
        if (!isFinite(price) || price <= 0) return;
        for (const watch of this.watches.values()) {
            if (watch.status !== 'ARMED' || watch.symbol !== symbol) continue;
            if (this.evaluateWatch(watch, price)) this.fireWatch(watch, price);
        }
    }

    private evaluateWatch(watch: SetupWatch, price: number): boolean {
        switch (watch.triggerType) {
            case 'PRICE_ABOVE':
                return watch.priceLevel != null && price >= watch.priceLevel;
            case 'PRICE_BELOW':
                return watch.priceLevel != null && price <= watch.priceLevel;
            case 'PCT_MOVE': {
                if (watch.percent == null || watch.percent <= 0 || watch.referencePrice <= 0) return false;
                return (Math.abs(price - watch.referencePrice) / watch.referencePrice) * 100 >= watch.percent;
            }
            case 'INVALIDATION':
                if (watch.priceLevel == null) return false;
                if (watch.direction === 'Short') return price >= watch.priceLevel;
                return price <= watch.priceLevel;
            default:
                return false;
        }
    }

    private fireWatch(watch: SetupWatch, currentPrice: number): void {
        const triggered: SetupWatch = {
            ...watch,
            status: 'TRIGGERED',
            triggeredAt: new Date().toISOString(),
            triggerCount: watch.triggerCount + 1,
        };
        this.watches.set(watch.id, triggered);
        void this.saveWatches();
        console.log(`[SetupWatchService] Watch fired for ${watch.symbol}: ${describeWatchTrigger(watch)} @ $${currentPrice}`);
        this.notifyChange();
        this.fireSubscribers.forEach(cb => {
            try {
                cb({ watch: triggered, currentPrice });
            } catch (e) {
                console.error('[SetupWatchService] Fire subscriber error:', e);
            }
        });
    }

    private notifyChange(): void {
        this.changeSubscribers.forEach(cb => {
            try {
                cb();
            } catch (e) {
                console.error('[SetupWatchService] Change subscriber error:', e);
            }
        });
    }

    /** Per-user storage key (`setup_watches_v1_<username>`). */
    private storageKey(): string {
        return `${PREF_KEYS.SETUP_WATCHES}_v1_${this.loadedUser ?? getActiveUsername()}`;
    }

    private saveWatches(): Promise<void> {
        // Snapshot the map at CALL time, then queue behind any in-flight
        // write so an earlier snapshot can never land after a later one.
        const data = Array.from(this.watches.values());
        this.saveChain = this.saveChain
            .then(() => setPreferenceObject(this.storageKey(), data))
            .catch(e => console.warn('[SetupWatchService] Save error:', e));
        return this.saveChain;
    }

    /** Read-only fetch for the given profile — hydration + migration writes
     *  happen after the staleness check in init(). */
    private async fetchWatches(user: string): Promise<{ watches: SetupWatch[]; migrate: boolean } | null> {
        try {
            const key = `${PREF_KEYS.SETUP_WATCHES}_v1_${user}`;
            const stored = await getPreferenceObject<SetupWatch[]>(key);
            if (Array.isArray(stored)) return { watches: stored, migrate: false };
            // One-time migration: adopt the pre-scoping global blob.
            const legacy = await getPreferenceObject<SetupWatch[]>(PREF_KEYS.SETUP_WATCHES);
            if (Array.isArray(legacy)) return { watches: legacy, migrate: true };
            return null;
        } catch (e) {
            console.error('[SetupWatchService] Load error:', e);
            return null;
        }
    }

    private hydrateWatches(stored: SetupWatch[], migrate: boolean): void {
        stored.forEach(w => {
            // Drop canceled watches; keep ARMED (re-arm across restarts)
            // and TRIGGERED (so the card shows "re-debate launched").
            if (!w || w.status === 'CANCELED') return;
            this.watches.set(w.id, w);
            // Re-register the feed symbol after a restart — the feed only
            // streams symbols that are explicitly tracked.
            PriceAlertService.trackSymbol(w.symbol);
        });
        if (this.watches.size > 0) {
            console.log(`[SetupWatchService] Loaded ${this.watches.size} setup watch(es)`);
            // Persist once under the NEW per-user key (moves the legacy blob
            // out of the shared global key on first load).
            if (migrate) void this.saveWatches();
        }
    }
}

// Singleton export
export const SetupWatchService = new SetupWatchServiceClass();

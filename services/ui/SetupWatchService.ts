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
import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';
import { PriceAlertService } from './PriceAlertService';

type FireCallback = (trigger: SetupWatchTriggerEvent) => void;
type ChangeCallback = () => void;

export interface CreateSetupWatchParams {
    messageId: string;
    coinName: string;
    triggerType: SetupWatch['triggerType'];
    priceLevel?: number;
    percent?: number;
    /** Current price at watch creation — baseline for PCT_MOVE. */
    referencePrice: number;
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
    // Serialize preference writes: fire-and-forget async saves can land out
    // of order and let an older snapshot overwrite a newer re-arm.
    private saveChain: Promise<void> = Promise.resolve();

    /**
     * Load persisted watches and start consuming the price feed. Idempotent.
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;
        await this.loadWatches();
        this.ensureFeed();
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
        this.watches.clear();
        this.fireSubscribers.clear();
        this.changeSubscribers.clear();
        this.unsubscribePrices?.();
        this.unsubscribePrices = null;
        this.releaseMonitor?.();
        this.releaseMonitor = null;
        this.initialized = false;
    }

    private isValidWatch(watch: SetupWatch): boolean {
        switch (watch.triggerType) {
            case 'PRICE_ABOVE':
            case 'PRICE_BELOW':
                return watch.priceLevel != null && watch.priceLevel > 0;
            case 'PCT_MOVE':
                return watch.percent != null && watch.percent > 0 && watch.referencePrice > 0;
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

    private saveWatches(): Promise<void> {
        // Snapshot the map at CALL time, then queue behind any in-flight
        // write so an earlier snapshot can never land after a later one.
        const data = Array.from(this.watches.values());
        this.saveChain = this.saveChain
            .then(() => setPreferenceObject(PREF_KEYS.SETUP_WATCHES, data))
            .catch(e => console.warn('[SetupWatchService] Save error:', e));
        return this.saveChain;
    }

    private async loadWatches(): Promise<void> {
        try {
            const stored = await getPreferenceObject<SetupWatch[]>(PREF_KEYS.SETUP_WATCHES);
            if (!Array.isArray(stored)) return;
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
            }
        } catch (e) {
            console.error('[SetupWatchService] Load error:', e);
        }
    }
}

// Singleton export
export const SetupWatchService = new SetupWatchServiceClass();

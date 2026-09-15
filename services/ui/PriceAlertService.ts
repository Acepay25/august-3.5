/**
 * PriceAlertService - Real-time price monitoring for trade alerts
 *
 * Features:
 * - WebSocket connection to Binance for real-time prices
 * - Configurable alert thresholds
 * - Push notifications when price approaches Entry/TP/SL
 *
 * On native platforms, alerts are delivered via
 * @capacitor/local-notifications (so they fire even when the app is
 * backgrounded) and the WebSocket/polling loop is paused on `pause` and
 * resumed on `resume` via @capacitor/app. On web, the Web Notifications API
 * is used as a fallback.
 */

import { Capacitor } from '@capacitor/core';
import { TradeAnalysis } from '../../types';
import { getPreferenceObject, setPreferenceObject, removePreference, PREF_KEYS } from '../infrastructure/PreferencesService';
import { parsePrice as canonicalParsePrice } from '../../utils/analysisUtils';
import { getActiveUsername } from '../../utils/activeUser';
import { QuietHoursConfig, DEFAULT_QUIET_HOURS, isWithinQuietHours } from '../../utils/quietHours';

export interface PriceAlert {
    id: string;
    tradeId: string;
    coinName: string;
    symbol: string; // Normalized symbol (e.g., BTCUSDT)
    direction: 'Long' | 'Short' | 'Neutral';
    entryPrice: number;
    stopLoss: number;
    takeProfits: number[];
    thresholdPercent: number; // How close price needs to be to trigger (default 0.5%)
    enabled: boolean;
    createdAt: string;
    triggeredLevels: Set<string>; // Track which alerts already fired
}

export interface AlertTrigger {
    type: 'ENTRY' | 'STOP_LOSS' | 'TAKE_PROFIT';
    level: number;
    currentPrice: number;
    coinName: string;
    percentAway: number;
    tpIndex?: number; // For TP alerts, which TP (1, 2, 3...)
}

type AlertCallback = (trigger: AlertTrigger) => void;

class PriceAlertServiceClass {
    private alerts: Map<string, PriceAlert> = new Map();
    /** Profile the in-memory alerts were loaded for. Alerts persist under a
     *  per-user key (audit §2.5: this service was one of the unscoped four). */
    private storageUser: string | null = null;
    /** Bumped by every init() so a superseded profile switch can't commit. */
    private initGeneration = 0;
    private ws: WebSocket | null = null;
    private prices: Map<string, number> = new Map();
    private subscribers: Set<AlertCallback> = new Set();
    private pollingInterval: ReturnType<typeof setInterval> | null = null;
    private wsReconnectAttempts = 0;
    /** Last price accepted per symbol — identical consecutive ticks are
     *  deduped (the Binance ticker repeats its close across frames). */
    private lastTickPrices = new Map<string, number>();
    // Tracked so pause()/stopMonitoring() can cancel a pending reconnect —
    // an untracked timer would reopen the socket (and its monitoring loop)
    // after the user disabled alerts or backgrounded the app.
    private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private maxReconnectAttempts = 5;
    private isPaused = false; // true when app is backgrounded
    private nativeListenersRegistered = false;
    private nativeNotificationIdCounter = 1000;
    /** Lowercase symbols actually present in the OPEN combined-stream URL.
     *  The stream list is baked at connect time — comparing the needed set
     *  against it is what lets ensureMonitoring detect a stale-but-OPEN
     *  socket and rebuild it (Tier-0 #5: symbols armed mid-session used to
     *  never receive ticks until an unrelated socket flap). */
    private streamSymbols = new Set<string>();
    // SetupWatchService (and future consumers) can hook the same real-time
    // price feed instead of opening their own socket/poll loop.
    private priceSubscribers: Set<(symbol: string, price: number) => void> = new Set();
    // Non-alert consumers that need the feed running even with 0 alerts
    // (setup watches). Monitoring stops only when alerts AND holders are 0.
    private externalMonitorHolders = 0;
    // Symbols that must stay in the feed without owning a price alert
    // (setup watches, live-price refresh). Merged into the WebSocket stream
    // list and the polling loop so ticks reach emitPriceTick for them.
    private trackedSymbols: Map<string, number> = new Map();
    // Quiet hours (Batch 7): alerts inside the silent window QUEUE instead of
    // notifying — sleep protection for a 24/7 market. The in-app subscriber
    // callback still fires (the transcript shows the trigger); only the
    // notification is deferred until the window ends.
    private quietHours: QuietHoursConfig = DEFAULT_QUIET_HOURS;
    private pendingQuiet: AlertTrigger[] = [];
    private static readonly MAX_PENDING_QUIET = 25;

    constructor() {
        // Wire native app lifecycle (pause/resume) so we stop the
        // WebSocket + polling loop when the app is backgrounded and restart
        // it on resume. This saves battery and prevents WebView throttling
        // from causing stale-price alerts.
        this.registerNativeLifecycle();
    }

    /**
     * Register Capacitor App pause/resume listeners (native only).
     * No-op on web — web relies on the visibilitychange listeners installed
     * elsewhere, and the Web Notifications path handles backgrounded delivery.
     */
    private async registerNativeLifecycle(): Promise<void> {
        if (this.nativeListenersRegistered) return;
        try {
            if (!Capacitor.isNativePlatform()) return;
            const { App } = await import('@capacitor/app');
            App.addListener('appStateChange', ({ isActive }) => {
                if (isActive) {
                    this.resume();
                } else {
                    this.pause();
                }
            });
            this.nativeListenersRegistered = true;
        } catch (err) {
            console.warn('[PriceAlertService] Native lifecycle not registered:', err);
        }
    }

    /**
     * Pause all monitoring (called on app background).
     */
    pause(): void {
        if (this.isPaused) return;
        this.isPaused = true;
        console.log('[PriceAlertService] Paused (backgrounded)');
        // Close the WebSocket — it would be throttled by the WebView anyway.
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
    }

    /**
     * Resume monitoring (called on app foreground).
     */
    resume(): void {
        if (!this.isPaused) return;
        this.isPaused = false;
        console.log('[PriceAlertService] Resumed (foregrounded)');
        if (this.alerts.size > 0 || this.externalMonitorHolders > 0 || this.trackedSymbols.size > 0) {
            this.ensureMonitoring();
        }
    }

    /**
     * Initialize service (load alerts for a profile). Idempotent per user:
     * the profile loader calls reset() on the switch path, then init(username)
     * rehydrates the INCOMING user's alerts from their own storage key.
     * A generation token (mirrors GlobalLearningService._initGeneration)
     * keeps a superseded switch from committing the OUTGOING profile's
     * alerts after the incoming profile already initialized.
     */
    async init(username?: string): Promise<void> {
        const user = username ?? getActiveUsername();
        const gen = ++this.initGeneration;
        if (this.storageUser !== user) {
            // Defensive: never hydrate the outgoing profile's alerts into the
            // incoming one, even if the caller skipped reset().
            this.alerts.clear();
            this.storageUser = user;
        }
        const fetched = await this.fetchAlerts(user);
        if (gen !== this.initGeneration || this.storageUser !== user) return;
        if (fetched) this.hydrateAlerts(fetched.alerts);
        if (fetched?.migratedFromLegacy) {
            // Persist the migrated blob under the NEW owner's key and retire
            // the shared global one (post-staleness — never writes for an
            // abandoned profile switch).
            this.saveAlerts();
            if (fetched.migratedFromGlobalKey) {
                removePreference(PREF_KEYS.PRICE_ALERTS).catch(() => { /* best effort */ });
            }
        }
        await this.loadQuietHours();
        if (gen !== this.initGeneration || this.storageUser !== user) return;
        await this.registerNativeLifecycle();
    }

    /**
     * Profile switch: drop every alert, the quiet-hours queue, the WebSocket
     * and the polling loop (audit §2.5 — this service had no reset at all, so
     * the previous profile's alerts kept streaming + notifying under the next
     * one). Storage is untouched: alerts live under the outgoing user's own
     * key and are re-adopted when they log back in.
     */
    reset(): void {
        this.alerts.clear();
        this.pendingQuiet = [];
        this.storageUser = null;
        // The ref-counts of the OUTGOING profile's feed holds must not
        // survive the switch — SetupWatch/autopilot release theirs around
        // this call (no-ops on a cleared map), and a leaked count would
        // strand the old user's symbols in every later stream.
        this.trackedSymbols.clear();
        this.stopMonitoring();
    }

    /**
     * Quiet hours (Batch 7): load the silent window, expose get/set for the
     * AlertManager settings row. Setting a window that is currently open does
     * NOT flush (we're inside it); closing/shortening one flushes what queued.
     */
    private async loadQuietHours(): Promise<void> {
        try {
            const cfg = await getPreferenceObject<QuietHoursConfig>(PREF_KEYS.QUIET_HOURS);
            if (cfg && typeof cfg.enabled === 'boolean'
                && Number.isFinite(cfg.startHour) && Number.isFinite(cfg.endHour)) {
                this.quietHours = cfg;
            }
        } catch { /* keep defaults */ }
    }

    getQuietHours(): QuietHoursConfig {
        return { ...this.quietHours };
    }

    setQuietHours(cfg: QuietHoursConfig): void {
        this.quietHours = cfg;
        setPreferenceObject(PREF_KEYS.QUIET_HOURS, cfg).catch(e =>
            console.warn('[PriceAlertService] Quiet hours save failed:', e)
        );
        if (!isWithinQuietHours(cfg)) this.flushQuietQueue();
    }

    private flushQuietQueue(): void {
        if (this.pendingQuiet.length === 0) return;
        const queued = this.pendingQuiet.splice(0, this.pendingQuiet.length);
        for (const t of queued) this.sendNotification(t);
    }

    /**
     * Create a new price alert for a trade.
     * Deduplicates by tradeId: the card's "Set alerts" button and the
     * LiveMarket toggle can both fire for the same trade — two alerts would
     * trigger duplicate notifications for the same levels.
     */
    createAlert(
        tradeId: string,
        analysis: TradeAnalysis,
        thresholdPercent: number = 0.5
    ): PriceAlert {
        const existing = this.getAlertForTrade(tradeId);
        if (existing) {
            console.log(`[PriceAlertService] Alert already exists for trade ${tradeId}, returning existing`);
            return existing;
        }

        const coinName = analysis.coinName || 'UNKNOWN';
        const symbol = this.normalizeSymbol(coinName);

        const entryPrice = this.parsePrice(analysis.entryPoints?.[0]?.price);
        const stopLoss = this.parsePrice(analysis.stopLoss);
        const takeProfits = (analysis.takeProfit || [])
            .map(tp => this.parsePrice(tp.price))
            .filter(p => p > 0);

        const alert: PriceAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            tradeId,
            coinName,
            symbol,
            direction: analysis.direction as 'Long' | 'Short' | 'Neutral',
            entryPrice,
            stopLoss,
            takeProfits,
            thresholdPercent,
            enabled: true,
            createdAt: new Date().toISOString(),
            triggeredLevels: new Set()
        };

        this.alerts.set(alert.id, alert);
        this.saveAlerts();
        this.ensureMonitoring();

        console.log(`[PriceAlertService] Created alert for ${symbol}:`, alert);
        return alert;
    }

    /**
     * Remove an alert
     */
    removeAlert(alertId: string): boolean {
        const deleted = this.alerts.delete(alertId);
        this.saveAlerts();

        // Stop monitoring if nothing needs the feed anymore
        this.maybeStopMonitoring();

        return deleted;
    }

    /**
     * Subscribe to raw price ticks for every monitored symbol. The callback
     * receives (symbol, price) on each WebSocket message / polling tick for
     * any symbol the service is currently tracking. Returns an unsubscribe
     * function. Consumers that need ticks while no alerts exist must also
     * hold the feed via acquireMonitor().
     */
    subscribePrices(callback: (symbol: string, price: number) => void): () => void {
        this.priceSubscribers.add(callback);
        return () => this.priceSubscribers.delete(callback);
    }

    /**
     * Declare that an external consumer needs the price feed running even
     * with zero alerts (e.g. setup watches). Returns a release function —
     * the feed stops once the last holder releases and no alerts remain.
     */
    acquireMonitor(): () => void {
        this.externalMonitorHolders++;
        this.ensureMonitoring();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.externalMonitorHolders = Math.max(0, this.externalMonitorHolders - 1);
            this.maybeStopMonitoring();
        };
    }

    /**
     * Stop monitoring only when neither alerts nor external holders need it.
     */
    private maybeStopMonitoring(): void {
        if (this.alerts.size === 0 && this.externalMonitorHolders === 0 && this.trackedSymbols.size === 0) {
            this.stopMonitoring();
        }
    }

    /**
     * Toggle alert enabled/disabled
     */
    toggleAlert(alertId: string): boolean {
        const alert = this.alerts.get(alertId);
        if (alert) {
            alert.enabled = !alert.enabled;
            this.saveAlerts();
            return alert.enabled;
        }
        return false;
    }

    /**
     * Get alert for a specific trade
     */
    getAlertForTrade(tradeId: string): PriceAlert | undefined {
        return Array.from(this.alerts.values()).find(a => a.tradeId === tradeId);
    }

    /**
     * Get all active alerts
     */
    getAllAlerts(): PriceAlert[] {
        return Array.from(this.alerts.values());
    }

    /**
     * Subscribe to alert triggers
     */
    subscribe(callback: AlertCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Get current price for a symbol
     */
    getCurrentPrice(symbol: string): number | undefined {
        return this.prices.get(symbol);
    }

    /**
     * Register a symbol that must stay in the price feed even without a
     * price alert (setup watches, veto ledger). Ref-counted: several
     * consumers may track the same symbol, and one consumer releasing must
     * not drop the feed for the others. Starts monitoring on first holder.
     */
    trackSymbol(symbol: string): boolean {
        const normalized = this.normalizeSymbol(symbol);
        if (!normalized) return false;
        const count = this.trackedSymbols.get(normalized) ?? 0;
        this.trackedSymbols.set(normalized, count + 1);
        if (count > 0) return false;
        this.ensureMonitoring();
        return true;
    }

    /**
     * Release one tracking claim on a symbol. The symbol leaves the feed
     * only when the LAST holder releases. Monitoring stops only when
     * alerts, holders, and tracked symbols are all gone.
     */
    untrackSymbol(symbol: string): boolean {
        const normalized = this.normalizeSymbol(symbol);
        const count = this.trackedSymbols.get(normalized) ?? 0;
        if (count <= 0) return false;
        if (count > 1) {
            this.trackedSymbols.set(normalized, count - 1);
            return false;
        }
        this.trackedSymbols.delete(normalized);
        this.maybeStopMonitoring();
        return true;
    }

    /**
     * Ref-counted symbol hold with a release function (mirrors
     * acquireMonitor). The OutcomeAutopilotService wraps each registration's
     * subscribeTicks window in one of these so autopilot-only coins actually
     * receive ticks — without a price alert or setup watch tracking the
     * symbol, getCurrentPrice stayed empty forever and the tick episodes
     * silently never accumulated.
     */
    acquireSymbol(symbol: string): () => void {
        this.trackSymbol(symbol);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.untrackSymbol(symbol);
        };
    }

    /**
     * Start monitoring prices via WebSocket
     */
    private ensureMonitoring(): void {
        if (this.alerts.size === 0 && this.externalMonitorHolders === 0 && this.trackedSymbols.size === 0) return;
        // Don't start monitoring while backgrounded — resume() will
        // call this again on foreground.
        if (this.isPaused) return;

        // Use polling for Capacitor/mobile compatibility
        if (!this.pollingInterval) {
            this.startPolling();
        }

        // Also try WebSocket for faster updates
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
            return;
        }

        // Socket is OPEN — but the combined-stream URL was baked at connect
        // time, so symbols added mid-session never arrive (Tier-0 #5).
        // Rebuild the stream whenever a needed symbol is missing from it.
        // Removals are deliberately NOT a rebuild trigger: an extra streamed
        // symbol is harmless, and closing on every untrack would cause
        // reconnect churn.
        const needed = this.neededStreamSymbols();
        for (const symbol of needed) {
            if (!this.streamSymbols.has(symbol)) {
                console.log('[PriceAlertService] Tracked set changed while OPEN — rebuilding combined stream');
                this.closeSocketQuietly();
                this.connectWebSocket();
                break;
            }
        }
    }

    /** Every symbol that must be in the live feed (alerts + tracked), lower
     *  cased for the Binance stream URL. */
    private neededStreamSymbols(): Set<string> {
        return new Set([
            ...Array.from(this.alerts.values()).map(a => a.symbol.toLowerCase()),
            ...Array.from(this.trackedSymbols.keys()).map(s => s.toLowerCase()),
        ]);
    }

    /** True when the OPEN socket's stream covers everything we need right now
     *  (the polling loop uses this to decide it may stand down). */
    private streamIsCurrent(): boolean {
        for (const symbol of this.neededStreamSymbols()) {
            if (!this.streamSymbols.has(symbol)) return false;
        }
        return true;
    }

    /**
     * Detach every handler from the current socket and drop the reference
     * BEFORE it is replaced or closed. Without this, a stale onclose from
     * the old socket can schedule a reconnect over (or flap) the healthy
     * replacement — and the old socket kept re-entering acceptTick after
     * we considered it gone.
     */
    private closeSocketQuietly(): void {
        const ws = this.ws;
        this.ws = null;
        this.streamSymbols = new Set();
        if (!ws) return;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
            ws.close();
        } catch { /* already closing/closed */ }
    }

    /**
     * Connect to Binance WebSocket
     */
    private connectWebSocket(): void {
        try {
            const symbols = [...this.neededStreamSymbols()];
            if (symbols.length === 0) return;

            // Drop any previous socket's handlers before the reference is
            // replaced (its onclose must never touch the new one).
            this.closeSocketQuietly();

            const streams = symbols.map(s => `${s}@ticker`).join('/');
            const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

            this.ws = new WebSocket(url);
            this.streamSymbols = new Set(symbols);

            this.ws.onopen = () => {
                console.log('[PriceAlertService] WebSocket connected');
                this.wsReconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.data && data.data.s && data.data.c) {
                        const symbol = data.data.s; // e.g., BTCUSDT
                        const price = parseFloat(data.data.c); // Current price
                        this.acceptTick(symbol, price);
                    }
                } catch (e) {
                    console.error('[PriceAlertService] WebSocket message error:', e);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[PriceAlertService] WebSocket error:', error);
            };

            this.ws.onclose = () => {
                console.log('[PriceAlertService] WebSocket closed');
                // Attempt reconnect — but NEVER while paused: pause() closes
                // the socket, and close() fires onclose asynchronously, so
                // without this guard a backgrounded app re-spawns the socket
                // (and the poll) five seconds later.
                if (this.isPaused) return;
                // externalMonitorHolders MUST be in this guard: a
                // SetupWatch-only consumer (zero alerts, zero tracked
                // symbols of its own until createWatch) could never recover
                // a flapped socket because nothing armed the reconnect.
                const needsFeed = this.alerts.size > 0
                    || this.externalMonitorHolders > 0
                    || this.trackedSymbols.size > 0;
                if (needsFeed && this.wsReconnectAttempts < this.maxReconnectAttempts) {
                    this.wsReconnectAttempts++;
                    this.wsReconnectTimer = setTimeout(() => {
                        this.wsReconnectTimer = null;
                        this.connectWebSocket();
                    }, 5000 * this.wsReconnectAttempts);
                }
            };
        } catch (error) {
            console.error('[PriceAlertService] Failed to connect WebSocket:', error);
        }
    }

    /**
     * One price observation from any source (WS or poll). Dedupes identical
     * ticks — Binance's ticker repeats the same close price across frames,
     * and re-running alert checks + subscriber fan-out for an unchanged
     * number is pure waste.
     */
    private acceptTick(symbol: string, price: number): void {
        if (!Number.isFinite(price) || price <= 0) return;
        if (this.lastTickPrices.get(symbol) === price) return;
        this.lastTickPrices.set(symbol, price);
        this.prices.set(symbol, price);
        this.checkAlerts(symbol, price);
    }

    /**
     * Start polling as fallback. The interval stays cheap while the
     * WebSocket is healthy (it returns without fetching) and takes over the
     * moment the socket drops — so the poll is a true fallback, not a
     * parallel second feed. Symbols are fetched in ONE batched request
     * instead of one sequential fetch per symbol.
     */
    private startPolling(): void {
        this.pollingInterval = setInterval(async () => {
            if (this.isPaused) return;
            // WS healthy AND its stream covers every needed symbol → the
            // socket is the feed; skip the poll. An OPEN-but-stale stream
            // (symbols added mid-session before the rebuild landed) must NOT
            // silence the poll — that early-return was half of Tier-0 #5.
            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.streamIsCurrent()) return;
            const symbols = [...new Set([
                ...Array.from(this.alerts.values()).map(a => a.symbol),
                ...Array.from(this.trackedSymbols.keys()),
            ])];
            if (symbols.length === 0) return;

            try {
                const query = symbols.map(s => `"${s}"`).join(',');
                const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=[${query}]`);
                if (!response.ok) return;
                const data = await response.json();
                const rows = Array.isArray(data) ? data : [data];
                for (const row of rows) {
                    const symbol = typeof row?.symbol === 'string' ? row.symbol : null;
                    const price = typeof row?.price === 'string' ? parseFloat(row.price) : NaN;
                    if (symbol && Number.isFinite(price)) this.acceptTick(symbol, price);
                }
            } catch (e) {
                console.error(`[PriceAlertService] Batched poll error (${symbols.length} symbols):`, e);
            }
        }, 10000); // Poll every 10 seconds
    }

    /**
     * Stop all monitoring
     */
    private stopMonitoring(): void {
        this.closeSocketQuietly();
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        this.wsReconnectAttempts = 0;
        // Forget the dedup memory: the next monitoring start must fan out its
        // first tick even if the price never changed while we were stopped.
        this.lastTickPrices.clear();
    }

    /**
     * Direction-aware level touch — mirrors the (private) `touches()` in
     * services/trade/tradePlanLevels.ts, replicated here because that helper
     * is not exported and its file is outside this fix's edit budget. The old
     * symmetric `|price-level|/level <= threshold` test missed gap-through
     * prints: a stop blown straight from 1% away to 2% below reads "never
     * approached". A level is touched when price enters its approach band OR
     * prints past it. A Long's entry/stop sit below the market (touch = price
     * at-or-BELOW the band's upper edge), its targets above (at-or-ABOVE the
     * lower edge); a Short mirrors. Neutral keeps the symmetric band — there
     * is no side to reason about.
     */
    private levelTouched(
        level: number,
        price: number,
        threshold: number,
        side: 'entryOrStop' | 'target',
        direction: PriceAlert['direction'],
    ): boolean {
        if (!Number.isFinite(level) || level <= 0 || !Number.isFinite(price) || price <= 0) return false;
        if (direction !== 'Long' && direction !== 'Short') {
            return Math.abs((price - level) / level) <= threshold;
        }
        // The side the level sits on relative to the market for this direction:
        // Long entry/stop below, Long targets above, Short mirrored.
        const levelSitsBelow = side === 'target' ? direction === 'Short' : direction === 'Long';
        return levelSitsBelow
            ? price <= level * (1 + threshold)
            : price >= level * (1 - threshold);
    }

    /**
     * Check if price triggers any alerts
     */
    private checkAlerts(symbol: string, currentPrice: number): void {
        // Fan out the tick to external feed subscribers (setup watches etc.)
        this.emitPriceTick(symbol, currentPrice);

        // The window may have just ended — deliver anything that queued.
        if (this.pendingQuiet.length > 0 && !isWithinQuietHours(this.quietHours)) {
            this.flushQuietQueue();
        }

        for (const alert of this.alerts.values()) {
            if (!alert.enabled || alert.symbol !== symbol) continue;

            const threshold = alert.thresholdPercent / 100;

            // Check Entry
            if (alert.entryPrice > 0 && !alert.triggeredLevels.has('ENTRY')) {
                if (this.levelTouched(alert.entryPrice, currentPrice, threshold, 'entryOrStop', alert.direction)) {
                    const percentAway = Math.abs((currentPrice - alert.entryPrice) / alert.entryPrice);
                    alert.triggeredLevels.add('ENTRY');
                    this.triggerAlert({
                        type: 'ENTRY',
                        level: alert.entryPrice,
                        currentPrice,
                        coinName: alert.coinName,
                        percentAway: percentAway * 100
                    });
                }
            }

            // Check Stop Loss
            if (alert.stopLoss > 0 && !alert.triggeredLevels.has('STOP_LOSS')) {
                if (this.levelTouched(alert.stopLoss, currentPrice, threshold, 'entryOrStop', alert.direction)) {
                    const percentAway = Math.abs((currentPrice - alert.stopLoss) / alert.stopLoss);
                    alert.triggeredLevels.add('STOP_LOSS');
                    this.triggerAlert({
                        type: 'STOP_LOSS',
                        level: alert.stopLoss,
                        currentPrice,
                        coinName: alert.coinName,
                        percentAway: percentAway * 100
                    });
                }
            }

            // Check Take Profits
            alert.takeProfits.forEach((tp, index) => {
                const tpKey = `TP_${index}`;
                if (tp > 0 && !alert.triggeredLevels.has(tpKey)) {
                    if (this.levelTouched(tp, currentPrice, threshold, 'target', alert.direction)) {
                        const percentAway = Math.abs((currentPrice - tp) / tp);
                        alert.triggeredLevels.add(tpKey);
                        this.triggerAlert({
                            type: 'TAKE_PROFIT',
                            level: tp,
                            currentPrice,
                            coinName: alert.coinName,
                            percentAway: percentAway * 100,
                            tpIndex: index + 1
                        });
                    }
                }
            });
        }
    }

    /**
     * Notify external price-feed subscribers of a fresh tick.
     */
    private emitPriceTick(symbol: string, price: number): void {
        this.priceSubscribers.forEach(callback => {
            try {
                callback(symbol, price);
            } catch (e) {
                console.error('[PriceAlertService] Price subscriber error:', e);
            }
        });
    }

    /**
     * Trigger an alert notification
     */
    private triggerAlert(trigger: AlertTrigger): void {
        console.log('[PriceAlertService] Alert triggered:', trigger);

        // Notify all subscribers
        this.subscribers.forEach(callback => {
            try {
                callback(trigger);
            } catch (e) {
                console.error('[PriceAlertService] Subscriber error:', e);
            }
        });

        // Quiet hours: queue instead of notifying — flushed when the window
        // ends (next tick or an explicit settings change). Subscribers above
        // already fired, so the in-app transcript is never silenced.
        if (isWithinQuietHours(this.quietHours)) {
            this.pendingQuiet.push(trigger);
            if (this.pendingQuiet.length > PriceAlertServiceClass.MAX_PENDING_QUIET) {
                this.pendingQuiet.splice(0, this.pendingQuiet.length - PriceAlertServiceClass.MAX_PENDING_QUIET);
            }
            return;
        }

        // Send push notification
        this.sendNotification(trigger);
    }

    /**
     * Send push notification.
     *
     * On native platforms, use @capacitor/local-notifications so the
     * alert fires even when the app is backgrounded (the Web Notifications
     * API requires a service worker push subscription to work in a WebView,
     * which this app doesn't have). On web, fall back to the Web Notifications API.
     */
    private async sendNotification(trigger: AlertTrigger): Promise<void> {
        const title = trigger.type === 'ENTRY'
            ? ` ${trigger.coinName} Entry Zone`
            : trigger.type === 'STOP_LOSS'
                ? ` ${trigger.coinName} Near Stop Loss!`
                : ` ${trigger.coinName} Near TP${trigger.tpIndex}`;

        const body = `Price: $${trigger.currentPrice.toLocaleString()} (${trigger.percentAway.toFixed(2)}% away from ${trigger.type === 'TAKE_PROFIT' ? 'TP' + trigger.tpIndex : trigger.type === 'ENTRY' ? 'Entry' : 'SL'})`;

        // Native path: local notifications fire from the system, not the WebView.
        if (Capacitor.isNativePlatform()) {
            try {
                const { LocalNotifications } = await import('@capacitor/local-notifications');
                // Request permission on first use.
                try {
                    await LocalNotifications.requestPermissions();
                } catch { /* may already be granted */ }
                await LocalNotifications.schedule({
                    notifications: [{
                        id: this.nativeNotificationIdCounter++,
                        title,
                        body,
                        smallIcon: 'ic_launcher', // resolves to the Android launcher icon
                    }],
                });
            } catch (err) {
                console.warn('[PriceAlertService] Native notification failed, falling back:', err);
                this.sendWebNotification(title, body);
            }
            // Vibration for mobile
            if ('vibrate' in navigator) {
                navigator.vibrate(trigger.type === 'STOP_LOSS' ? [300, 100, 300] : [200]);
            }
            return;
        }

        // Web path
        this.sendWebNotification(title, body);
        if ('vibrate' in navigator) {
            navigator.vibrate(trigger.type === 'STOP_LOSS' ? [300, 100, 300] : [200]);
        }
    }

    /**
     * Web Notifications API fallback (web only).
     */
    private async sendWebNotification(title: string, body: string): Promise<void> {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.png' });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                new Notification(title, { body, icon: '/favicon.png' });
            }
        }
    }

    /**
     * Parse price string to number — delegates to canonical parsePrice
     * (handles ranges, "to" ranges, and trailing annotations).
     */
    private parsePrice(priceStr: string | undefined): number {
        if (!priceStr || priceStr === 'N/A') return 0;
        return canonicalParsePrice(priceStr);
    }

    /**
     * Normalize coin symbol to Binance format
     */
    normalizeSymbol(coinName: string): string {
        const cleaned = coinName.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        return cleaned.includes('USDT') ? cleaned : `${cleaned}USDT`;
    }

    /**
     * Per-user storage key. Alerts used to live in one global blob shared by
     * every profile (audit §2.5); they now persist under the user that owns
     * them, with a one-time migration read of the legacy keys.
     */
    private alertsStorageKey(): string {
        const user = this.storageUser ?? getActiveUsername();
        return `${PREF_KEYS.PRICE_ALERTS}_v1_${user}`;
    }

    /**
     * Save alerts to storage
     */
    private saveAlerts(): void {
        try {
            const data = Array.from(this.alerts.values()).map(a => ({
                ...a,
                triggeredLevels: Array.from(a.triggeredLevels)
            }));

            // Fire and forget
            setPreferenceObject(this.alertsStorageKey(), data).catch(e =>
                console.warn('[PriceAlertService] Save error:', e)
            );
        } catch (e) {
            console.error('[PriceAlertService] Save logic error:', e);
        }
    }

    /**
     * Load alerts for the given profile. Read-only: hydration + migration
     * writes happen in init() after the staleness check. Returns null when
     * this profile has nothing persisted anywhere.
     */
    private async fetchAlerts(user: string): Promise<{ alerts: any[]; migratedFromLegacy: boolean; migratedFromGlobalKey?: boolean } | null> {
        try {
            const key = `${PREF_KEYS.PRICE_ALERTS}_v1_${user}`;
            const alerts = await getPreferenceObject<any[]>(key);
            if (Array.isArray(alerts)) {
                return { alerts, migratedFromLegacy: false };
            }

            // One-time migration: the pre-scoping global blob goes to whoever
            // loads it first (the alternative — handing the same blob to every
            // profile — is the leak this key scoping closes).
            const legacyGlobal = await getPreferenceObject<any[]>(PREF_KEYS.PRICE_ALERTS);
            if (Array.isArray(legacyGlobal)) {
                return { alerts: legacyGlobal, migratedFromLegacy: true, migratedFromGlobalKey: true };
            }

            // Older fallback: localStorage under the legacy app key.
            const legacy = localStorage.getItem('august_price_alerts');
            if (legacy) {
                try {
                    const parsed = JSON.parse(legacy);
                    if (Array.isArray(parsed)) {
                        localStorage.removeItem('august_price_alerts');
                        return { alerts: parsed, migratedFromLegacy: true };
                    }
                } catch (e) { /* intentionally ignored: alert parse failure */ }
            }
            return null;
        } catch (e) {
            console.error('[PriceAlertService] Load error:', e);
            return null;
        }
    }

    private hydrateAlerts(alertsData: any[]): void {
        if (!Array.isArray(alertsData)) return;

        alertsData.forEach((a: any) => {
            a.triggeredLevels = new Set(a.triggeredLevels || []);
            this.alerts.set(a.id, a);
        });
        if (this.alerts.size > 0) {
            this.ensureMonitoring();
        }
    }
}

// Singleton export
export const PriceAlertService = new PriceAlertServiceClass();

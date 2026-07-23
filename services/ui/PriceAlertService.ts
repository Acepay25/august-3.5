/**
 * PriceAlertService - Real-time price monitoring for trade alerts
 * 
 * Features:
 * - WebSocket connection to Binance for real-time prices
 * - Configurable alert thresholds
 * - Push notifications when price approaches Entry/TP/SL
 */

import { TradeAnalysis } from '../../types';
import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';

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
    private ws: WebSocket | null = null;
    private prices: Map<string, number> = new Map();
    private subscribers: Set<AlertCallback> = new Set();
    private pollingInterval: NodeJS.Timeout | null = null;
    private wsReconnectAttempts = 0;
    private maxReconnectAttempts = 5;

    constructor() {
        // Initialization moved to async init() method
    }

    /**
     * Initialize service (load alerts)
     */
    async init(): Promise<void> {
        await this.loadAlerts();
    }

    /**
     * Create a new price alert for a trade
     */
    createAlert(
        tradeId: string,
        analysis: TradeAnalysis,
        thresholdPercent: number = 0.5
    ): PriceAlert {
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

        // Stop monitoring if no alerts left
        if (this.alerts.size === 0) {
            this.stopMonitoring();
        }

        return deleted;
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
     * Start monitoring prices via WebSocket
     */
    private ensureMonitoring(): void {
        if (this.alerts.size === 0) return;

        // Use polling for Capacitor/mobile compatibility
        if (!this.pollingInterval) {
            this.startPolling();
        }

        // Also try WebSocket for faster updates
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
    }

    /**
     * Connect to Binance WebSocket
     */
    private connectWebSocket(): void {
        try {
            const symbols = [...new Set(Array.from(this.alerts.values()).map(a => a.symbol.toLowerCase()))];
            if (symbols.length === 0) return;

            const streams = symbols.map(s => `${s}@ticker`).join('/');
            const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

            this.ws = new WebSocket(url);

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
                        this.prices.set(symbol, price);
                        this.checkAlerts(symbol, price);
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
                // Attempt reconnect
                if (this.alerts.size > 0 && this.wsReconnectAttempts < this.maxReconnectAttempts) {
                    this.wsReconnectAttempts++;
                    setTimeout(() => this.connectWebSocket(), 5000 * this.wsReconnectAttempts);
                }
            };
        } catch (error) {
            console.error('[PriceAlertService] Failed to connect WebSocket:', error);
        }
    }

    /**
     * Start polling as fallback
     */
    private startPolling(): void {
        this.pollingInterval = setInterval(async () => {
            const symbols = [...new Set(Array.from(this.alerts.values()).map(a => a.symbol))];

            for (const symbol of symbols) {
                try {
                    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
                    const data = await response.json();
                    if (data.price) {
                        const price = parseFloat(data.price);
                        this.prices.set(symbol, price);
                        this.checkAlerts(symbol, price);
                    }
                } catch (e) {
                    console.error(`[PriceAlertService] Polling error for ${symbol}:`, e);
                }
            }
        }, 10000); // Poll every 10 seconds
    }

    /**
     * Stop all monitoring
     */
    private stopMonitoring(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Check if price triggers any alerts
     */
    private checkAlerts(symbol: string, currentPrice: number): void {
        for (const alert of this.alerts.values()) {
            if (!alert.enabled || alert.symbol !== symbol) continue;

            const threshold = alert.thresholdPercent / 100;

            // Check Entry
            if (alert.entryPrice > 0 && !alert.triggeredLevels.has('ENTRY')) {
                const percentAway = Math.abs((currentPrice - alert.entryPrice) / alert.entryPrice);
                if (percentAway <= threshold) {
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
                const percentAway = Math.abs((currentPrice - alert.stopLoss) / alert.stopLoss);
                if (percentAway <= threshold) {
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
                    const percentAway = Math.abs((currentPrice - tp) / tp);
                    if (percentAway <= threshold) {
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

        // Send push notification
        this.sendNotification(trigger);
    }

    /**
     * Send push notification
     */
    private async sendNotification(trigger: AlertTrigger): Promise<void> {
        const title = trigger.type === 'ENTRY'
            ? `📍 ${trigger.coinName} Entry Zone`
            : trigger.type === 'STOP_LOSS'
                ? `⚠️ ${trigger.coinName} Near Stop Loss!`
                : `🎯 ${trigger.coinName} Near TP${trigger.tpIndex}`;

        const body = `Price: $${trigger.currentPrice.toLocaleString()} (${trigger.percentAway.toFixed(2)}% away from ${trigger.type === 'TAKE_PROFIT' ? 'TP' + trigger.tpIndex : trigger.type === 'ENTRY' ? 'Entry' : 'SL'})`;

        // Web Notification API
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.ico' });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                new Notification(title, { body, icon: '/favicon.ico' });
            }
        }

        // Vibration for mobile
        if ('vibrate' in navigator) {
            navigator.vibrate(trigger.type === 'STOP_LOSS' ? [300, 100, 300] : [200]);
        }
    }

    /**
     * Parse price string to number
     */
    private parsePrice(priceStr: string | undefined): number {
        if (!priceStr || priceStr === 'N/A') return 0;
        const cleaned = priceStr.replace(/[$,\s]/g, '');

        // Handle ranges (e.g., "95000 - 95500")
        if (cleaned.includes('-')) {
            const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return (parts[0] + parts[1]) / 2;
            }
        }

        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Normalize coin symbol to Binance format
     */
    private normalizeSymbol(coinName: string): string {
        const cleaned = coinName.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        return cleaned.includes('USDT') ? cleaned : `${cleaned}USDT`;
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
            setPreferenceObject(PREF_KEYS.PRICE_ALERTS, data).catch(e =>
                console.warn('[PriceAlertService] Save error:', e)
            );
        } catch (e) {
            console.error('[PriceAlertService] Save logic error:', e);
        }
    }

    /**
     * Load alerts from storage
     */
    private async loadAlerts(): Promise<void> {
        try {
            const alerts = await getPreferenceObject<any[]>(PREF_KEYS.PRICE_ALERTS);

            // Fallback to localStorage if native storage empty (migration scenario)
            if (!alerts) {
                const legacy = localStorage.getItem('august_price_alerts');
                if (legacy) {
                    try {
                        const parsed = JSON.parse(legacy);
                        this.hydrateAlerts(parsed);
                        // Migrate to new storage
                        this.saveAlerts();
                        return;
                    } catch (e) { }
                }
                return;
            }

            this.hydrateAlerts(alerts);
        } catch (e) {
            console.error('[PriceAlertService] Load error:', e);
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

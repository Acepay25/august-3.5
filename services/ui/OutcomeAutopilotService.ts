/**
 * OutcomeAutopilotService — watches PENDING analyses and detects when their
 * SL/TP levels are hit, resolving outcomes automatically (user confirms).
 *
 * Detection reuses AutoCaptureService.verifyHistoricalOutcome (kline-based,
 * direction-aware crossing semantics, extended-SL-zone aware), so results are
 * authoritative and survive app restarts/time gaps. Runs a 60s loop only while
 * registrations exist; pauses with the app on native platforms.
 *
 * Flow: App registers PENDING messages → loop verifies → resolution stored +
 * listeners notified → AnalysisResult banner → user confirms → App logs via
 * the existing logTradeWithFeedback funnel (side-effects fire exactly once)
 * → markProcessed prevents re-detection.
 */

import { Capacitor } from '@capacitor/core';
import { LoggedTrade, TradeAnalysis } from '../../types';
import { TradeOutcome } from '../../types';
import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';
import { verifyHistoricalOutcome, extractSymbolFromAnalysis } from './AutoCaptureService';
import { trackSLOutcome, SLOptimizationData } from '../backtesting/StopLossOptimizerService';
import { parsePrice } from '../../utils/analysisUtils';

export interface AutopilotResolution {
    /** Resolved outcome (EXPIRED_OPEN uses expiredOpen flag with WIN/LOSS-neutral handling). */
    outcome: TradeOutcome.WIN | TradeOutcome.LOSS | TradeOutcome.ENTRY_NOT_HIT;
    /** Setup expired while still open — needs a manual decision, no direct log. */
    expiredOpen: boolean;
    /** Leveraged PnL percent from the analysis (e.g. +200 or -100). */
    pnlPercent?: number;
    /** Price level that decided the outcome. */
    hitLevel?: string;
    /** TP1 / TP2 / TP3 / SL. */
    hitTarget?: string;
    /** Human-readable summary for the banner. */
    detail: string;
    detectedAt: string;
    timeToOutcome?: string;
    slOptimizationData?: SLOptimizationData;
}

interface Registration {
    messageId: string;
    analysis: TradeAnalysis;
    leverage: number;
    registeredAt: string;
}

interface PersistedState {
    processed: string[];  // message ids confirmed/logged — never re-detect
    dismissed: string[];  // user dismissed the banner
}

type Listener = (messageId: string, resolution: AutopilotResolution) => void;

const CHECK_INTERVAL_MS = 60_000;

class OutcomeAutopilotServiceClass {
    private registrations = new Map<string, Registration>();
    private resolutions = new Map<string, AutopilotResolution>();
    private dismissed = new Set<string>();
    private processed = new Set<string>();
    private listeners = new Set<Listener>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private checking = false;
    private initialized = false;

    /** Load persisted state and register native lifecycle handling. */
    async init(): Promise<void> {
        if (this.initialized) return;
        try {
            const stored = await getPreferenceObject<PersistedState>(PREF_KEYS.OUTCOME_AUTOPILOT_STATE);
            if (stored) {
                (stored.processed || []).forEach(id => this.processed.add(id));
                (stored.dismissed || []).forEach(id => this.dismissed.add(id));
            }
        } catch (err) {
            console.warn('[OutcomeAutopilot] Failed to load state:', err);
        }
        this.registerLifecycle();
        this.initialized = true;
        console.log(`[OutcomeAutopilot] Initialized (${this.processed.size} processed, ${this.dismissed.size} dismissed)`);
    }

    /** Track a pending analysis. No-op for processed/dismissed messages. */
    register(messageId: string, analysis: TradeAnalysis, leverage: number): void {
        if (this.processed.has(messageId) || this.dismissed.has(messageId)) return;
        if (this.registrations.has(messageId)) return;
        this.registrations.set(messageId, {
            messageId,
            analysis,
            leverage: leverage || 100,
            registeredAt: new Date().toISOString(),
        });
        this.ensureLoop();
    }

    /** Stop tracking (message logged, deleted, or outcome set manually). */
    unregister(messageId: string): void {
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
    }

    /** User dismissed the banner for this message. */
    dismiss(messageId: string): void {
        this.dismissed.add(messageId);
        this.resolutions.delete(messageId);
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
        void this.persist();
    }

    /** Called after the user confirms/logs — prevents re-detection forever. */
    markProcessed(messageId: string): void {
        this.processed.add(messageId);
        this.resolutions.delete(messageId);
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
        void this.persist();
    }

    getResolution(messageId: string): AutopilotResolution | undefined {
        if (this.dismissed.has(messageId) || this.processed.has(messageId)) return undefined;
        return this.resolutions.get(messageId);
    }

    subscribe(cb: Listener): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /** Run a verification pass immediately (startup catch-up). */
    async checkNow(): Promise<void> {
        await this.runChecks();
    }

    // ── Internals ─────────────────────────────────────────────────────────

    private ensureLoop(): void {
        if (this.timer || this.registrations.size === 0) return;
        this.timer = setInterval(() => void this.runChecks(), CHECK_INTERVAL_MS);
    }

    private stopLoopIfEmpty(): void {
        if (this.registrations.size === 0 && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private registerLifecycle(): void {
        try {
            if (!Capacitor.isNativePlatform()) return;
            void (async () => {
                const { App } = await import('@capacitor/app');
                App.addListener('appStateChange', ({ isActive }) => {
                    if (isActive) {
                        this.ensureLoop();
                        void this.runChecks(); // catch up on what happened while away
                    } else {
                        if (this.timer) {
                            clearInterval(this.timer);
                            this.timer = null;
                        }
                    }
                });
            })();
        } catch (err) {
            console.warn('[OutcomeAutopilot] Native lifecycle not registered:', err);
        }
    }

    private async runChecks(): Promise<void> {
        if (this.checking || this.registrations.size === 0) return;
        this.checking = true;
        try {
            // Sequential to avoid kline-fetch bursts; snapshot ids first.
            for (const messageId of [...this.registrations.keys()]) {
                const reg = this.registrations.get(messageId);
                if (!reg) continue;
                try {
                    await this.verifyOne(reg);
                } catch (err) {
                    console.warn(`[OutcomeAutopilot] Verification failed for ${messageId}:`, err);
                }
            }
        } finally {
            this.checking = false;
        }
    }

    private async verifyOne(reg: Registration): Promise<void> {
        const { messageId, analysis } = reg;
        const symbol = extractSymbolFromAnalysis(analysis);
        const createdAt = analysis.createdAt;
        if (!symbol || !createdAt) {
            this.registrations.delete(messageId);
            return;
        }

        const result = await verifyHistoricalOutcome(analysis, symbol, createdAt);
        if (!result.verified && result.outcome === 'INSUFFICIENT_DATA') return; // try again later

        const expired = this.isExpired(analysis);

        if (result.outcome === 'TP_HIT') {
            this.resolve(messageId, this.buildWinResolution(reg, result));
        } else if (result.outcome === 'SL_HIT') {
            this.resolve(messageId, this.buildLossResolution(reg, result));
        } else if (result.outcome === 'ENTRY_NOT_TRIGGERED' && expired) {
            this.resolve(messageId, {
                outcome: TradeOutcome.ENTRY_NOT_HIT,
                expiredOpen: false,
                detail: 'Validity window expired without triggering the entry.',
                detectedAt: new Date().toISOString(),
            });
        } else if (result.outcome === 'STILL_OPEN' && expired) {
            this.resolve(messageId, {
                outcome: TradeOutcome.ENTRY_NOT_HIT, // closest loggable outcome
                expiredOpen: true,
                detail: 'Setup expired while still open — review and decide manually.',
                detectedAt: new Date().toISOString(),
            });
        }
        // Otherwise: still live — keep watching.
    }

    private isExpired(analysis: TradeAnalysis): boolean {
        if (!analysis.createdAt || !analysis.validityDurationMinutes) return false;
        const expiry = new Date(analysis.createdAt).getTime() + analysis.validityDurationMinutes * 60_000;
        return Date.now() > expiry;
    }

    private buildWinResolution(
        reg: Registration,
        result: Awaited<ReturnType<typeof verifyHistoricalOutcome>>
    ): AutopilotResolution {
        const { analysis } = reg;
        const hitTarget = result.hitTarget || 'TP1';
        // Leveraged % from the analysis TP list (fallback: first TP).
        const tpIndex = hitTarget === 'TP2' ? 1 : hitTarget === 'TP3' ? 2 : 0;
        const pctRaw = analysis.takeProfit?.[tpIndex]?.percentage || analysis.takeProfit?.[0]?.percentage || '';
        const pnlPercent = this.parsePercent(pctRaw);
        return {
            outcome: TradeOutcome.WIN,
            expiredOpen: false,
            pnlPercent,
            hitLevel: result.priceAtHit !== undefined ? String(result.priceAtHit) : undefined,
            hitTarget,
            detail: `${hitTarget} hit${result.priceAtHit !== undefined ? ` @ ${result.priceAtHit}` : ''}${result.timeToOutcome ? ` · ${result.timeToOutcome} after analysis` : ''}`,
            detectedAt: new Date().toISOString(),
            timeToOutcome: result.timeToOutcome,
            slOptimizationData: this.computeSLOptimization(reg, result),
        };
    }

    private buildLossResolution(
        reg: Registration,
        result: Awaited<ReturnType<typeof verifyHistoricalOutcome>>
    ): AutopilotResolution {
        const { analysis } = reg;
        const pnlPercent = this.parsePercent(analysis.stopLossPercentage || '');
        return {
            outcome: TradeOutcome.LOSS,
            expiredOpen: false,
            pnlPercent,
            hitLevel: result.slHit?.price !== undefined ? String(result.slHit.price) : (result.priceAtHit !== undefined ? String(result.priceAtHit) : undefined),
            hitTarget: 'SL',
            detail: `Stop loss hit${result.slHit?.price !== undefined ? ` @ ${result.slHit.price}` : ''}${result.timeToOutcome ? ` · ${result.timeToOutcome} after analysis` : ''}`,
            detectedAt: new Date().toISOString(),
            timeToOutcome: result.timeToOutcome || result.slHit?.timeAfterAnalysis,
            slOptimizationData: this.computeSLOptimization(reg, result),
        };
    }

    /** "+200.0%" / "-100%" / "45" → signed number (undefined when unparseable). */
    private parsePercent(raw: string): number | undefined {
        if (!raw) return undefined;
        const n = parseFloat(raw.replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? undefined : n;
    }

    /**
     * Feed the (previously dead) SL optimizer with the observed price range.
     * The verifier doesn't expose full min/max, so the range is approximated
     * from entry + all observed hit prices — advisory data, not exact.
     */
    private computeSLOptimization(
        reg: Registration,
        result: Awaited<ReturnType<typeof verifyHistoricalOutcome>>
    ): SLOptimizationData | undefined {
        const { analysis } = reg;
        const entry = parsePrice(analysis.entryPoints?.[0]?.price || '');
        if (isNaN(entry)) return undefined;
        const observed: number[] = [entry];
        if (result.priceAtHit !== undefined) observed.push(result.priceAtHit);
        if (result.slHit?.price !== undefined) observed.push(result.slHit.price);
        (result.tpHits || []).forEach(tp => observed.push(tp.price));
        if (observed.length < 2) return undefined;
        const pseudoTrade = { analysis } as LoggedTrade;
        try {
            return trackSLOutcome(pseudoTrade, {
                minPrice: Math.min(...observed),
                maxPrice: Math.max(...observed),
            });
        } catch {
            return undefined;
        }
    }

    private resolve(messageId: string, resolution: AutopilotResolution): void {
        this.resolutions.set(messageId, resolution);
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
        console.log(`[OutcomeAutopilot] ${messageId} → ${resolution.outcome}${resolution.expiredOpen ? ' (expired open)' : ''}: ${resolution.detail}`);
        this.listeners.forEach(cb => {
            try {
                cb(messageId, resolution);
            } catch (err) {
                console.warn('[OutcomeAutopilot] Listener error:', err);
            }
        });
    }

    private async persist(): Promise<void> {
        try {
            const state: PersistedState = {
                processed: [...this.processed].slice(-500),
                dismissed: [...this.dismissed].slice(-500),
            };
            await setPreferenceObject(PREF_KEYS.OUTCOME_AUTOPILOT_STATE, state);
        } catch (err) {
            console.warn('[OutcomeAutopilot] Failed to persist state:', err);
        }
    }
}

export const OutcomeAutopilotService = new OutcomeAutopilotServiceClass();

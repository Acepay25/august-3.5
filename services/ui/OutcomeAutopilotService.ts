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
import { parsePrice, leveragedMovePercent } from '../../utils/analysisUtils';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';
import { PriceAlertService } from './PriceAlertService';

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
    /** Win confidence tier: the SL was touched before price recovered to the TP. */
    recoveredAfterSlTouch?: boolean;
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
    lastTickPrice?: number;
}

interface PersistedState {
    processed: string[];  // message ids confirmed/logged — never re-detect
    dismissed: string[];  // user dismissed the banner
}

type Listener = (messageId: string, resolution: AutopilotResolution) => void;
type TickListener = (messageId: string, price: number, previousPrice?: number) => void;

const CHECK_INTERVAL_MS = 20_000;

// How many processed/dismissed message ids to keep. MUST match between the
// in-memory trim (pruneIdSets) and persist() — if disk kept fewer than
// memory, messages outside the disk window became re-detectable after a
// restart and produced duplicate banners/logs.
const MAX_TRACKED_IDS = 2000;

class OutcomeAutopilotServiceClass {
    private registrations = new Map<string, Registration>();
    private resolutions = new Map<string, AutopilotResolution>();
    private dismissed = new Set<string>();
    private processed = new Set<string>();
    private listeners = new Set<Listener>();
    private tickListeners = new Set<TickListener>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private checkPromise: Promise<void> | null = null;
    private initialized = false;

    /** Load persisted state and register native lifecycle handling. */
    async init(): Promise<void> {
        if (this.initialized) return;
        try {
            const stored = await getPreferenceObject<PersistedState>(PREF_KEYS.OUTCOME_AUTOPILOT_STATE);
            if (stored) {
                (stored.processed || []).forEach(id => this.processed.add(id));
                (stored.dismissed || []).forEach(id => this.dismissed.add(id));
                this.pruneIdSets();
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
        if (analysis.confidence === 'Avoid' || analysis.direction === 'Neutral') {
            return;
        }
        if (analysis.direction !== 'Long' && analysis.direction !== 'Short') return;
        this.registrations.set(messageId, {
            messageId,
            analysis,
            leverage: leverage || DEFAULT_LEVERAGE,
            registeredAt: new Date().toISOString(),
        });
        this.ensureLoop();
        void this.runChecks();
    }

    /** Stop tracking (message logged, deleted, or outcome set manually). */
    unregister(messageId: string): void {
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
    }

    /** User dismissed the banner for this message. */
    dismiss(messageId: string): void {
        this.dismissed.add(messageId);
        this.pruneIdSets();
        this.resolutions.delete(messageId);
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
        void this.persist();
    }

    /** Called after the user confirms/logs — prevents re-detection forever. */
    markProcessed(messageId: string): void {
        this.processed.add(messageId);
        this.pruneIdSets();
        this.resolutions.delete(messageId);
        this.registrations.delete(messageId);
        this.stopLoopIfEmpty();
        void this.persist();
    }

    /**
     * Cap the persisted processed/dismissed id lists — they grew unbounded
     * (one entry per resolved analysis, forever). Old entries are only used
     * to suppress re-detection of messages that no longer exist anyway, so
     * the most recent window is sufficient.
     */
    private pruneIdSets(): void {
        const trim = (set: Set<string>): void => {
            if (set.size <= MAX_TRACKED_IDS) return;
            const entries = [...set];
            set.clear();
            entries.slice(-MAX_TRACKED_IDS).forEach(id => set.add(id));
        };
        trim(this.processed);
        trim(this.dismissed);
    }

    getResolution(messageId: string): AutopilotResolution | undefined {
        if (this.dismissed.has(messageId) || this.processed.has(messageId)) return undefined;
        return this.resolutions.get(messageId);
    }

    subscribe(cb: Listener): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    subscribeTicks(cb: TickListener): () => void {
        this.tickListeners.add(cb);
        return () => this.tickListeners.delete(cb);
    }

    /** Run a verification pass immediately (startup catch-up). */
    async checkNow(): Promise<void> {
        await this.runChecks();
    }

    /**
     * Clear every registration/resolution for the previous profile and stop
     * the loop. Called on profile switch — otherwise the singleton keeps
     * kline-verifying the old user's pending analyses and the processed/
     * dismissed sets leak across profiles.
     */
    reset(): void {
        this.registrations.clear();
        this.resolutions.clear();
        this.dismissed.clear();
        this.processed.clear();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        void this.persist();
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
        if (this.checkPromise) return this.checkPromise;
        if (this.registrations.size === 0) return;
        this.checkPromise = (async () => {
            for (const messageId of [...this.registrations.keys()]) {
                const reg = this.registrations.get(messageId);
                if (!reg) continue;
                try {
                    await this.verifyOne(reg);
                } catch (err) {
                    console.warn(`[OutcomeAutopilot] Verification failed for ${messageId}:`, err);
                }
            }
        })().finally(() => {
            this.checkPromise = null;
        });
        return this.checkPromise;
    }

    private async verifyOne(reg: Registration): Promise<void> {
        const { messageId, analysis } = reg;
        const symbol = extractSymbolFromAnalysis(analysis);
        const createdAt = analysis.createdAt || reg.registeredAt;
        if (!symbol) {
            this.registrations.delete(messageId);
            return;
        }

        const result = await verifyHistoricalOutcome(analysis, symbol, createdAt, undefined, { excludeFormingCandle: false });
        if (!result.verified && result.outcome === 'INSUFFICIENT_DATA') {
            // Don't watch forever: a permanently dead kline source (delisted
            // symbol, no data yet on a fresh pair) would re-verify every 60s
            // indefinitely. Drop once the setup's validity window has expired,
            // or after a hard 7-day cap on observation.
            const watchedMs = Date.now() - new Date(reg.registeredAt).getTime();
            if (this.isExpired(analysis) || watchedMs > 7 * 24 * 60 * 60 * 1000) {
                this.registrations.delete(messageId);
                this.stopLoopIfEmpty();
                console.warn(`[OutcomeAutopilot] ${messageId} dropped after insufficient data (watched ${Math.round(watchedMs / 36e5)}h).`);
            }
            return; // try again later
        }

        const expired = this.isExpired(analysis);

        const livePrice = PriceAlertService.getCurrentPrice(symbol);
        if (livePrice && this.tickListeners.size > 0) {
            const previous = reg.lastTickPrice;
            reg.lastTickPrice = livePrice;
            this.tickListeners.forEach(cb => {
                try { cb(messageId, livePrice, previous); }
                catch (err) { console.warn('[OutcomeAutopilot] Tick listener error:', err); }
            });
        }

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

        // Otherwise: still live — keep watching. But never forever: a setup
        // without a validity window that never hits SL/TP would otherwise poll
        // Binance every 60s indefinitely (the 7-day cap below used to apply
        // only to the INSUFFICIENT_DATA branch).
        const watchedMs = Date.now() - new Date(reg.registeredAt).getTime();
        if (watchedMs > 7 * 24 * 60 * 60 * 1000) {
            this.registrations.delete(messageId);
            this.stopLoopIfEmpty();
            console.warn(`[OutcomeAutopilot] ${messageId} dropped after 7-day observation cap (setup never resolved).`);
        }
    }

    private isExpired(analysis: TradeAnalysis): boolean {
        if (!analysis.createdAt || !analysis.validityDurationMinutes) return false;
        const expiry = new Date(analysis.createdAt).getTime() + analysis.validityDurationMinutes * 60_000;
        return Date.now() > expiry;
    }

    /**
     * Realized leveraged PnL % from price levels. Recomputing from the hit
     * price and the REGISTERED leverage is authoritative — the analysis-time
     * `percentage` fields were computed at analysis time with that session's
     * leverage and can be stale. Returns undefined when prices don't parse
     * (callers fall back to the stored percentages).
     */
    private computePnLFromPrice(
        reg: Registration,
        exitPrice: number,
        scaleOutFactor: number
    ): number | undefined {
        const entry = parsePrice(reg.analysis.entryPoints?.[0]?.price || '');
        if (isNaN(entry) || entry <= 0 || isNaN(exitPrice) || exitPrice <= 0) return undefined;
        const pct = leveragedMovePercent(reg.analysis.entryPoints?.[0]?.price, String(exitPrice), reg.leverage, 'gain');
        if (!pct) return undefined;
        const leveraged = Math.abs(parseFloat(pct)) * scaleOutFactor;
        return Math.round(leveraged * 10) / 10;
    }

    /**
     * Detect a TP1 → breakeven-managed scale-out: the verifier records an
     * entry-priced stop fill (breakeven) alongside exactly one TP hit (TP1).
     * In that case only the TP1 leg realized the full move — the remainder
     * exited flat at entry, so the realized PnL is ~half of TP1%.
     */
    private isBreakevenScaleOut(
        reg: Registration,
        result: Awaited<ReturnType<typeof verifyHistoricalOutcome>>
    ): boolean {
        if (!result.slHit || result.tpHits?.length !== 1 || result.tpHits[0].level !== 'TP1') return false;
        const entry = parsePrice(reg.analysis.entryPoints?.[0]?.price || '');
        // 5 bps tolerance — tight enough that a genuine stop within 0.1% of
        // entry isn't misread as a breakeven-managed exit (which halves PnL).
        return !isNaN(entry) && entry > 0 && Math.abs((result.slHit.price ?? 0) - entry) / entry < 0.0005;
    }

    private buildWinResolution(
        reg: Registration,
        result: Awaited<ReturnType<typeof verifyHistoricalOutcome>>
    ): AutopilotResolution {
        const { analysis } = reg;
        const hitTarget = result.hitTarget || 'TP1';
        // Leveraged % recomputed from the actual hit price with the
        // REGISTERED leverage (the analysis-time percentage may carry a
        // stale leverage and ignores scale-outs).
        const scaleOutDetected = this.isBreakevenScaleOut(reg, result);
        const scaleOut = scaleOutDetected ? 0.5 : 1;
        let hitPrice = result.priceAtHit ?? NaN;
        // Multi-TP scale-out: TP1 is a partial exit (stop→breakeven), so a
        // run to TP2/TP3 did NOT capture the full entry→last-TP move — it
        // captured ~half at TP1 and the remainder at the last TP. PnL is
        // linear in price, so the blended exit = midpoint of TP1 and the
        // last TP. (Without this, the win PnL fed to calibration and the
        // SL-optimizer was overstated for every TP1→TP2/TP3 run.)
        if (!scaleOutDetected && result.tpHits && result.tpHits.length > 1) {
            const firstTp = result.tpHits[0].price;
            const lastTp = result.tpHits[result.tpHits.length - 1].price;
            if (isFinite(firstTp) && isFinite(lastTp)) {
                hitPrice = (firstTp + lastTp) / 2;
            }
        }
        const recomputed = this.computePnLFromPrice(reg, hitPrice, scaleOut);
        let pnlPercent = recomputed;
        if (pnlPercent === undefined) {
            // Fallback: analysis-time percentage.
            const tpIndex = hitTarget === 'TP2' ? 1 : hitTarget === 'TP3' ? 2 : 0;
            pnlPercent = this.parsePercent(analysis.takeProfit?.[tpIndex]?.percentage || analysis.takeProfit?.[0]?.percentage || '');
        }
        return {
            outcome: TradeOutcome.WIN,
            expiredOpen: false,
            pnlPercent,
            hitLevel: result.priceAtHit !== undefined ? String(result.priceAtHit) : undefined,
            hitTarget,
            // Confidence tier: a win where the SL was touched first is weaker
            // than a clean run to the TP — but a breakeven scale-out (TP1
            // then entry-priced stop) is NOT an SL touch; exclude it.
            recoveredAfterSlTouch: !!result.slHit && !scaleOutDetected,
            detail: `${hitTarget} hit${result.priceAtHit !== undefined ? ` @ ${result.priceAtHit}` : ''}${result.slHit ? ' · recovered after SL touch' : ' · clean'}${scaleOut < 1 ? ' · TP1 scale-out to breakeven' : ''}${!scaleOutDetected && result.tpHits && result.tpHits.length > 1 ? ' · TP1 partial scale-out, remainder to last TP' : ''}${result.timeToOutcome ? ` · ${result.timeToOutcome} after analysis` : ''}`,
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
        // Exit price: the 150% hard-stop fill when the zone was breached,
        // otherwise the touched stop level.
        const slPrice = result.slHit?.price !== undefined
            ? result.slHit.price
            : parsePrice(analysis.stopLoss || '');
        const recomputed = this.computePnLFromPrice(reg, slPrice, 1);
        const pnlPercent = recomputed !== undefined
            ? -Math.abs(recomputed)
            : this.parsePercent(analysis.stopLossPercentage || '');
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
                // Keep the same window as the in-memory trim — a narrower
                // persist window would resurrect old messages as
                // re-detectable after a restart.
                processed: [...this.processed].slice(-MAX_TRACKED_IDS),
                dismissed: [...this.dismissed].slice(-MAX_TRACKED_IDS),
            };
            await setPreferenceObject(PREF_KEYS.OUTCOME_AUTOPILOT_STATE, state);
        } catch (err) {
            console.warn('[OutcomeAutopilot] Failed to persist state:', err);
        }
    }
}

export const OutcomeAutopilotService = new OutcomeAutopilotServiceClass();

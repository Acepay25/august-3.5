/**
 * ReinforcementSignalService.ts
 * 
 * Tracks granular reinforcement learning signals for AI decisions.
 * Calculates reward scores based on trade outcome and confidence.
 */

import { AIProvider } from '../../types';
import {
    getPreferenceObject,
    setPreferenceObject,
    PREF_KEYS
} from '../infrastructure/PreferencesService';

export interface ReinforcementSignal {
    id: string;
    tradeId: string;
    provider: AIProvider;
    timestamp: string;
    decision: {
        direction: 'Long' | 'Short' | 'Neutral';
        confidence: string;
        entryPrice: number;
    };
    outcome: 'WIN' | 'LOSS';
    rewardScore: number; // -1.0 to +1.0
    metricScores: {
        directionScore: number;   // Did it go the right way?
        confidenceScore: number;  // Was confidence appropriate?
        entryQuality: number;     // Did entry get filled / was it optimal?
    };
}

interface ReinforcementSignalStorage {
    signals: ReinforcementSignal[];
    lastUpdated: string;
}

// Key for storage
const RL_STORAGE_KEY = 'rl_signals_data';

export const ReinforcementSignalService = {

    /**
     * Calculate reward score based on outcome and attributes
     */
    calculateReward(
        outcome: 'WIN' | 'LOSS',
        confidence: string,
        // Potential future params: slippage, timeToTarget, etc.
    ): number {
        const isWin = outcome === 'WIN';
        const conf = confidence.toLowerCase();

        // Reward Matrix:
        // WIN + High Confidence = +1.0 (Perfect)
        // WIN + Med Confidence  = +0.8 (Good)
        // WIN + Low Confidence  = +0.5 (Okay, but hesitant)
        // LOSS + Low Confidence = -0.2 (Forgivable)
        // LOSS + Med Confidence = -0.6 (Bad)
        // LOSS + High Confidence = -1.0 (Catastrophic failure of judgment)

        if (isWin) {
            if (conf === 'high') return 1.0;
            if (conf === 'medium') return 0.8;
            return 0.5;
        } else {
            if (conf === 'high') return -1.0;
            if (conf === 'medium') return -0.6;
            return -0.2;
        }
    },

    /**
     * Record a new signal
     */
    async recordSignal(
        tradeId: string,
        provider: AIProvider,
        outcome: 'WIN' | 'LOSS',
        decision: {
            direction: 'Long' | 'Short' | 'Neutral';
            confidence: string;
            entryPrice: number;
        }
    ): Promise<void> {
        try {
            const store = await getPreferenceObject<ReinforcementSignalStorage>(RL_STORAGE_KEY) || { signals: [], lastUpdated: '' };

            // Avoid duplicates
            if (store.signals.some(s => s.tradeId === tradeId && s.provider === provider)) {
                return;
            }

            const reward = this.calculateReward(outcome, decision.confidence);

            const signal: ReinforcementSignal = {
                id: crypto.randomUUID(),
                tradeId,
                provider,
                timestamp: new Date().toISOString(),
                decision,
                outcome,
                rewardScore: reward,
                metricScores: {
                    directionScore: outcome === 'WIN' ? 1 : -1,
                    confidenceScore: reward, // Simplified for now
                    entryQuality: 0 // Placeholder for future expansion
                }
            };

            store.signals.push(signal);

            // Keep last 1000 signals to avoid bloating storage
            if (store.signals.length > 1000) {
                store.signals = store.signals.slice(-1000);
            }

            store.lastUpdated = new Date().toISOString();

            await setPreferenceObject(RL_STORAGE_KEY, store);
            console.log(`[ReinforcementSignal] Recorded signal for ${provider}: Reward ${reward}`);

        } catch (error) {
            console.error('[ReinforcementSignal] Failed to record signal', error);
        }
    },

    /**
     * Get recent signals for a provider
     */
    async getSignals(provider: AIProvider, limit: number = 20): Promise<ReinforcementSignal[]> {
        const store = await getPreferenceObject<ReinforcementSignalStorage>(RL_STORAGE_KEY) || { signals: [], lastUpdated: '' };
        return store.signals
            .filter(s => s.provider === provider)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);
    },

    /**
     * Get average reward score (Recent Performance Indicator)
     */
    async getAverageReward(provider: AIProvider, window: number = 10): Promise<number> {
        const signals = await this.getSignals(provider, window);
        if (signals.length === 0) return 0;

        const sum = signals.reduce((acc, s) => acc + s.rewardScore, 0);
        return sum / signals.length;
    }
};

import { useState, useEffect } from 'react';
import { HybridDataPacket } from '../services/analysis/HybridIntelligenceService';
import { MonteCarloResult, LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { LiveBacktestResult } from '../services/backtesting/LiveBacktestService';
import { SLOptimization } from '../services/backtesting/StopLossOptimizerService';
import { fetchRecentLiquidations, fetchOHLCV, pingBinanceAPI } from '../services/analysis/MarketDataService';

export function useMarketData(isHybridIntelligenceEnabled: boolean) {
    const [currentHybridData, setCurrentHybridData] = useState<HybridDataPacket | null>(null);
    const [hybridConnectionStatus, setHybridConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [latestMonteCarloResult, setLatestMonteCarloResult] = useState<MonteCarloResult | null>(null);
    const [latestBacktestResult, setLatestBacktestResult] = useState<LiveBacktestResult | null>(null);
    const [perAIMonteCarloResults, setPerAIMonteCarloResults] = useState<LabeledMonteCarloResult[]>([]);
    const [currentSlOptimization, setCurrentSlOptimization] = useState<SLOptimization | null>(null);
    const [currentSuggestedEntryPrice, setCurrentSuggestedEntryPrice] = useState<number | null>(null);
    const [currentEntryTimingScore, setCurrentEntryTimingScore] = useState<{
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null>(null);

    // Live Market Conditions (fetched periodically for Global Sessions display)
    const [liveMarketConditions, setLiveMarketConditions] = useState<{
        volatility: 'High' | 'Medium' | 'Low';
        liquidation: 'High' | 'Medium' | 'Low';
        lastUpdated: string;
    } | null>(null);

    // Fetch live market conditions periodically for Global Sessions display
    useEffect(() => {
        const fetchLiveMarketConditions = async () => {
            try {
                // Fetch liquidation data
                const liquidationData = await fetchRecentLiquidations('BTCUSDT');

                // Fetch recent candles to calculate volatility (ATR approximation)
                const candles = await fetchOHLCV('BTCUSDT', '1h', 20);

                // Calculate average true range for volatility
                let volatility: 'High' | 'Medium' | 'Low' = 'Medium';
                if (candles && candles.length >= 14) {
                    const recentCandles = candles.slice(-14);
                    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
                    const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
                    const volatilityPercent = (avgRange / avgPrice) * 100;

                    // Classify volatility based on percentage range
                    if (volatilityPercent > 2) volatility = 'High';
                    else if (volatilityPercent > 0.8) volatility = 'Medium';
                    else volatility = 'Low';
                }

                // Map liquidation pressure
                const liquidation = liquidationData.liquidationPressure === 'high' ? 'High' :
                    liquidationData.liquidationPressure === 'medium' ? 'Medium' : 'Low';

                setLiveMarketConditions({
                    volatility,
                    liquidation,
                    lastUpdated: new Date().toISOString()
                });
            } catch (error) {
                console.error('[LiveMarketConditions] Failed to fetch:', error);
            }
        };

        // Fetch immediately on mount
        fetchLiveMarketConditions();

        // Then refresh every 60 seconds
        const interval = setInterval(fetchLiveMarketConditions, 60000);
        return () => clearInterval(interval);
    }, []);

    // Check Binance API connection when Hybrid Intelligence is enabled
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        let retryCount = 0;

        const checkConnection = async () => {
            if (isHybridIntelligenceEnabled) {
                // Only show "connecting" if we are currently disconnected or in error state
                // This prevents flickering "connecting..." when we are already connected
                setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));

                try {
                    const isConnected = await pingBinanceAPI();

                    if (isConnected) {
                        setHybridConnectionStatus('connected');
                        retryCount = 0; // Reset retries on success
                    } else {
                        // Soft failure handling: Don't show error immediately, retry once
                        if (retryCount < 1) {
                            retryCount++;
                            console.log('[Hybrid Intelligence] Connection check failed, retrying silently...');
                            setTimeout(checkConnection, 1000); // Quick retry
                        } else {
                            setHybridConnectionStatus('error');
                        }
                    }
                } catch {
                    setHybridConnectionStatus('error');
                }
            } else {
                setHybridConnectionStatus('disconnected');
            }
        };

        if (isHybridIntelligenceEnabled) {
            checkConnection();
            // Re-check connection every 60 seconds (less aggressive than 30s)
            intervalId = setInterval(checkConnection, 60000);
        } else {
            setHybridConnectionStatus('disconnected');
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isHybridIntelligenceEnabled]);

    return {
        currentHybridData,
        setCurrentHybridData,
        hybridConnectionStatus,
        setHybridConnectionStatus,
        latestMonteCarloResult,
        setLatestMonteCarloResult,
        latestBacktestResult,
        setLatestBacktestResult,
        perAIMonteCarloResults,
        setPerAIMonteCarloResults,
        currentSlOptimization,
        setCurrentSlOptimization,
        currentSuggestedEntryPrice,
        setCurrentSuggestedEntryPrice,
        currentEntryTimingScore,
        setCurrentEntryTimingScore,
        liveMarketConditions,
        setLiveMarketConditions,
    };
}

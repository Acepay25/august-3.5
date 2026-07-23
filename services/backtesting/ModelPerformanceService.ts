/**
 * ModelPerformanceService - Dynamic AI Model Weighting
 * Tracks per-model accuracy and adjusts ensemble weights based on performance
 */

import { AIProvider, LoggedTrade } from '../../types';
import { MarketRegime } from '../analysis/TechnicalAnalysisService';
import {
    getPreferenceObject,
    setPreferenceObject,
    PREF_KEYS
} from '../infrastructure/PreferencesService';
import { ReinforcementSignalService } from '../learning/ReinforcementSignalService';

/**
 * Performance statistics for a specific condition
 */
export interface PerformanceStats {
    wins: number;
    losses: number;
    total: number;
    winRate: number;
}

/**
 * Complete performance data for an AI model
 */
export interface ModelPerformance {
    provider: AIProvider;
    overallStats: PerformanceStats;
    byFamily: {
        familyA: PerformanceStats;
        familyB: PerformanceStats;
        familyC: PerformanceStats;
        familyOmega: PerformanceStats;
    };
    byRegime: {
        trending: PerformanceStats;
        ranging: PerformanceStats;
        volatile: PerformanceStats;
        compression: PerformanceStats;
    };
    byConfidence: {
        high: PerformanceStats;
        medium: PerformanceStats;
        low: PerformanceStats;
    };
    recentTrend: 'improving' | 'stable' | 'declining';
    lastUpdated: string;
}

/**
 * Dynamic weights for ensemble models
 */
export interface DynamicWeights {
    gemini: number;      // 0-1
    deepseek: number;    // 0-1
    zhipu: number;       // 0-1
    groq: number;        // 0-1
    groqNew: number;     // 0-1
    groqAlt2: number;    // 0-1
    totalWeight: number;
    dominantModel: AIProvider | null;
    confidence: 'high' | 'medium' | 'low';
}

// =============================================================================
// ROLLING WINDOW & COLD STREAK DETECTION
// =============================================================================

/**
 * Trade type for situational expertise tracking
 */
export type TradeType = 'reversal' | 'continuation' | 'breakout' | 'range' | 'unknown';

/**
 * Individual trade entry for rolling window tracking
 */
export interface RecentTradeEntry {
    timestamp: string;
    provider: AIProvider;
    isWin: boolean;
    tradeType: TradeType;
    family?: string;
}

/**
 * Rolling window statistics for a provider (last N trades)
 */
export interface RollingWindowStats {
    last20WinRate: number;
    last20Total: number;
    last20Wins: number;
    coldStreakCount: number;         // Consecutive losses from most recent
    hotStreakCount: number;          // Consecutive wins from most recent
    isDemoted: boolean;              // Currently demoted due to cold streak
    demotedReason?: string;
}

/**
 * Situational expertise - reversal vs continuation performance
 */
export interface SituationalExpertise {
    reversalStats: PerformanceStats;   // Family A, B patterns (reversals/traps)
    continuationStats: PerformanceStats; // Family C, Omega patterns (continuations)
    strongestSituation: 'reversal' | 'continuation' | 'balanced';
}

/**
 * Rolling window data structure for all providers
 */
interface RollingWindowData {
    entries: RecentTradeEntry[];
    lastUpdated: string;
}

// Storage keys
const STORAGE_KEY = 'model_performance_data';
const ROLLING_WINDOW_STORAGE_KEY = 'model_rolling_window';
const CONFIDENCE_CALIBRATION_STORAGE_KEY = 'model_confidence_calibration';
const PROVIDER_PAIR_STATS_STORAGE_KEY = 'provider_pair_stats';

// Configuration constants
const ROLLING_WINDOW_SIZE = 20;      // Number of recent trades to track
const COLD_STREAK_THRESHOLD = 3;     // Consecutive losses before demotion (base threshold)
const COLD_STREAK_PENALTY = 0.5;     // Weight multiplier when on cold streak (50%)
const UNDERPERFORMER_THRESHOLD = 0.15; // 15% below average to be flagged

// NEW: Recency weighting constants
const RECENCY_DECAY_FACTOR = 0.92;   // Each older trade is weighted 92% of previous
const MIN_TRADES_FOR_RECENCY = 5;    // Minimum trades needed for recency calculation

// NEW: Adaptive cold streak thresholds
const HIGH_PERFORMER_THRESHOLD = 65; // Models with >65% win rate use stricter threshold
const HIGH_PERFORMER_COLD_STREAK = 2; // Only 2 losses needed for high performers
const LOW_PERFORMER_COLD_STREAK = 4;  // 4 losses needed for sub-50% models

// NEW: Monte Carlo risk adjustment
const HIGH_DRAWDOWN_THRESHOLD = 25;  // % max drawdown considered high risk
const HIGH_DRAWDOWN_PENALTY = 0.7;   // Weight multiplier for high drawdown (30% reduction)
const LOW_WINRATE_MC_THRESHOLD = 45; // Monte Carlo win rate below this is penalized

/**
 * Confidence calibration per model - tracks if "High" confidence actually wins more
 */
export interface ConfidenceCalibrationPerModel {
    high: { wins: number; total: number; winRate: number };
    medium: { wins: number; total: number; winRate: number };
    low: { wins: number; total: number; winRate: number };
    isOverconfident: boolean; // True if High confidence wins less than overall
    calibrationWarning?: string;
}

/**
 * Recency-weighted statistics
 */
export interface RecencyWeightedStats {
    recencyWeightedWinRate: number;
    standardWinRate: number;
    tradesAnalyzed: number;
    oldestTradeWeight: number;
    trendDirection: 'improving' | 'declining' | 'stable';
}

/**
 * Provider pair correlation stats
 */
export interface ProviderPairStats {
    pairKey: string; // e.g., "gemini-deepseek"
    providerA: AIProvider;
    providerB: AIProvider;
    timesAgreed: number;
    timesDisagreed: number;
    agreementWins: number;
    agreementLosses: number;
    aWinsInDisagreement: number; // How often A was right when they disagreed
    bWinsInDisagreement: number; // How often B was right when they disagreed
    tieBreakerRecommendation: AIProvider | null;
}

/**
 * All provider pair statistics
 */
interface AllProviderPairStats {
    pairs: Record<string, ProviderPairStats>;
    lastUpdated: string;
}

/**
 * Model confidence calibration data
 */
interface ModelConfidenceCalibrationData {
    providers: Record<string, {
        high: { wins: number; total: number };
        medium: { wins: number; total: number };
        low: { wins: number; total: number };
    }>;
    lastUpdated: string;
}



/**
 * Initialize empty performance stats
 */
const initStats = (): PerformanceStats => ({
    wins: 0,
    losses: 0,
    total: 0,
    winRate: 0
});

// In-memory cache
let _performanceCache: AllModelPerformances | null = null;
let _rollingWindowCache: RollingWindowData | null = null;
let _confidenceCalibrationCache: ModelConfidenceCalibrationData | null = null;
let _providerPairStatsCache: AllProviderPairStats | null = null;
let _postMortemCache: PostMortemInsightData | null = null;

// Initialization state
let _isInitialized = false;

/**
 * Initialize service - load all data into memory
 */
export const initModelPerformanceService = async (): Promise<void> => {
    if (_isInitialized) return;

    try {
        // Load in parallel
        const [perf, rolling, conf, pairs, postMortems] = await Promise.all([
            getPreferenceObject<AllModelPerformances>(PREF_KEYS.MODEL_PERFORMANCE_DATA),
            getPreferenceObject<RollingWindowData>(PREF_KEYS.ROLLING_WINDOW_DATA),
            getPreferenceObject<ModelConfidenceCalibrationData>(PREF_KEYS.CONFIDENCE_CALIBRATION),
            getPreferenceObject<AllProviderPairStats>(PREF_KEYS.PROVIDER_PAIR_STATS),
            getPreferenceObject<PostMortemInsightData>(PREF_KEYS.POST_MORTEM_INSIGHTS)
        ]);

        _performanceCache = perf;
        _rollingWindowCache = rolling;
        _confidenceCalibrationCache = conf;
        _providerPairStatsCache = pairs;
        _postMortemCache = postMortems;

        _isInitialized = true;
        console.log('[ModelPerformance] Service initialized with cached data');
    } catch (e) {
        console.error('[ModelPerformance] Cached init failed:', e);
    }
};

/**
 * Initialize empty model performance
 */
const initModelPerformance = (provider: AIProvider): ModelPerformance => ({
    provider,
    overallStats: initStats(),
    byFamily: {
        familyA: initStats(),
        familyB: initStats(),
        familyC: initStats(),
        familyOmega: initStats()
    },
    byRegime: {
        trending: initStats(),
        ranging: initStats(),
        volatile: initStats(),
        compression: initStats()
    },
    byConfidence: {
        high: initStats(),
        medium: initStats(),
        low: initStats()
    },
    recentTrend: 'stable',
    lastUpdated: new Date().toISOString()
});

/**
 * All tracked model performances
 */
interface AllModelPerformances {
    [AIProvider.GEMINI]: ModelPerformance;
    [AIProvider.DEEPSEEK]: ModelPerformance;
    [AIProvider.ZHIPU]: ModelPerformance;
    [AIProvider.GROQ]: ModelPerformance;
    [AIProvider.GROQ_NEW]: ModelPerformance;
    [AIProvider.GROQ_ALT2]: ModelPerformance;
    [AIProvider.OPENROUTER]: ModelPerformance;
    [AIProvider.OPENAI]: ModelPerformance;
    [AIProvider.GROK]: ModelPerformance;
}

/**
 * Load performance data from localStorage
 */
/**
 * Load performance data (from cache or default)
 */
export const loadPerformanceData = (): AllModelPerformances => {
    // If not initialized, try to load synchronously from localStorage (web fallback)
    // or return cache if available
    if (_performanceCache) return _performanceCache;

    // Fallback for first run or web before async init
    try {
        const stored = localStorage.getItem(PREF_KEYS.MODEL_PERFORMANCE_DATA);
        if (stored) {
            _performanceCache = JSON.parse(stored);
            return _performanceCache!;
        }
    } catch (e) {
        // Ignore
    }

    // Return default empty performances
    const empty: AllModelPerformances = {
        [AIProvider.GEMINI]: initModelPerformance(AIProvider.GEMINI),
        [AIProvider.DEEPSEEK]: initModelPerformance(AIProvider.DEEPSEEK),
        [AIProvider.ZHIPU]: initModelPerformance(AIProvider.ZHIPU),
        [AIProvider.GROQ]: initModelPerformance(AIProvider.GROQ),
        [AIProvider.GROQ_NEW]: initModelPerformance(AIProvider.GROQ_NEW),
        [AIProvider.GROQ_ALT2]: initModelPerformance(AIProvider.GROQ_ALT2),
        [AIProvider.OPENROUTER]: initModelPerformance(AIProvider.OPENROUTER),
        [AIProvider.OPENAI]: initModelPerformance(AIProvider.OPENAI),
        [AIProvider.GROK]: initModelPerformance(AIProvider.GROK)
    };

    _performanceCache = empty;
    return empty;
};

/**
 * Save performance data to localStorage
 */
/**
 * Save performance data (to cache and async storage)
 */
export const savePerformanceData = (data: AllModelPerformances): void => {
    _performanceCache = data;
    // Fire and forget async save
    setPreferenceObject(PREF_KEYS.MODEL_PERFORMANCE_DATA, data).catch(e =>
        console.warn('[ModelPerformance] Failed to save data:', e)
    );
};

/**
 * Update stats based on win/loss
 */
const updateStats = (stats: PerformanceStats, isWin: boolean): PerformanceStats => {
    const newStats = { ...stats };
    newStats.total++;
    if (isWin) {
        newStats.wins++;
    } else {
        newStats.losses++;
    }
    newStats.winRate = newStats.total > 0 ? (newStats.wins / newStats.total) * 100 : 0;
    return newStats;
};

/**
 * Map family string to key
 */
const mapFamilyToKey = (family: string): 'familyA' | 'familyB' | 'familyC' | 'familyOmega' | null => {
    const f = family?.toLowerCase() || '';
    if (f.includes('a') || f.includes('exhaustion') || f.includes('trap')) return 'familyA';
    if (f.includes('b') || f.includes('reversal')) return 'familyB';
    if (f.includes('c') || f.includes('continuation')) return 'familyC';
    if (f.includes('omega') || f.includes('momentum')) return 'familyOmega';
    return null;
};

/**
 * Map regime to key
 */
const mapRegimeToKey = (regime: MarketRegime): 'trending' | 'ranging' | 'volatile' | 'compression' => {
    if (regime.includes('trend')) return 'trending';
    if (regime === 'ranging') return 'ranging';
    if (regime === 'volatile_chop') return 'volatile';
    if (regime === 'compression') return 'compression';
    return 'ranging';
};

/**
 * Map confidence to key
 */
const mapConfidenceToKey = (confidence: string): 'high' | 'medium' | 'low' => {
    const c = confidence?.toLowerCase() || '';
    if (c === 'high') return 'high';
    if (c === 'medium') return 'medium';
    return 'low';
};

/**
 * Track a trade outcome for a specific model
 */
export const trackTradeOutcome = (
    provider: AIProvider,
    isWin: boolean,
    family: string,
    regime: MarketRegime,
    confidence: string
): void => {
    const data = loadPerformanceData();
    const modelData = data[provider];

    // Update overall stats
    modelData.overallStats = updateStats(modelData.overallStats, isWin);

    // Update family stats
    const familyKey = mapFamilyToKey(family);
    if (familyKey) {
        modelData.byFamily[familyKey] = updateStats(modelData.byFamily[familyKey], isWin);
    }

    // Update regime stats
    const regimeKey = mapRegimeToKey(regime);
    modelData.byRegime[regimeKey] = updateStats(modelData.byRegime[regimeKey], isWin);

    // Update confidence stats
    const confKey = mapConfidenceToKey(confidence);
    modelData.byConfidence[confKey] = updateStats(modelData.byConfidence[confKey], isWin);

    // Update timestamp
    modelData.lastUpdated = new Date().toISOString();

    // Calculate recent trend (based on last 10 trades)
    // This is simplified - in a real implementation, you'd track individual trades
    const recentWinRate = modelData.overallStats.winRate;
    if (recentWinRate > 60) {
        modelData.recentTrend = 'improving';
    } else if (recentWinRate < 40) {
        modelData.recentTrend = 'declining';
    } else {
        modelData.recentTrend = 'stable';
    }

    data[provider] = modelData;
    savePerformanceData(data);

    console.log(`[ModelPerformance] Updated ${provider}: Win=${isWin}, WinRate=${modelData.overallStats.winRate.toFixed(1)}%`);

    // NEW: Record Reinforcement Learning Signal (Item 1.1)
    ReinforcementSignalService.recordSignal(
        `trade_${Date.now()}`, // Temporary trade ID generation if not passed
        provider,
        isWin ? 'WIN' : 'LOSS',
        {
            direction: 'Neutral', // Placeholder, ideally passed from caller
            confidence: confidence,
            entryPrice: 0 // Placeholder
        }
    );
};

/**
 * Get performance data for a specific model
 */
export const getModelPerformance = (provider: AIProvider): ModelPerformance => {
    const data = loadPerformanceData();
    return data[provider];
};

/**
 * Calculate dynamic weights based on current conditions
 */
export const calculateDynamicWeights = (
    currentRegime: MarketRegime,
    currentFamily: string,
    enabledProviders: AIProvider[]
): DynamicWeights => {
    const data = loadPerformanceData();
    const regimeKey = mapRegimeToKey(currentRegime);
    const familyKey = mapFamilyToKey(currentFamily);

    const weights: Record<AIProvider, number> = {
        [AIProvider.GEMINI]: 0,
        [AIProvider.DEEPSEEK]: 0,
        [AIProvider.ZHIPU]: 0,
        [AIProvider.GROQ]: 0,
        [AIProvider.GROQ_NEW]: 0,
        [AIProvider.GROQ_ALT2]: 0,
        [AIProvider.OPENROUTER]: 0,
        [AIProvider.OPENAI]: 0,
        [AIProvider.GROK]: 0
    };

    let hasEnoughData = false;
    const minTradesRequired = 5;

    // Calculate weight for each enabled provider
    for (const provider of enabledProviders) {
        const modelData = data[provider];
        let score = 50; // Base score

        // Add regime performance bonus (0-30 points)
        const regimeStats = modelData.byRegime[regimeKey];
        if (regimeStats.total >= minTradesRequired) {
            hasEnoughData = true;
            score += (regimeStats.winRate - 50) * 0.6; // Up to ±30
        }

        // Add family performance bonus (0-20 points)
        if (familyKey) {
            const familyStats = modelData.byFamily[familyKey];
            if (familyStats.total >= minTradesRequired) {
                hasEnoughData = true;
                score += (familyStats.winRate - 50) * 0.4; // Up to ±20
            }
        }

        // Add overall performance factor
        if (modelData.overallStats.total >= minTradesRequired) {
            hasEnoughData = true;
            const overallBonus = (modelData.overallStats.winRate - 50) * 0.3;
            score += overallBonus;
        }

        // Recent trend adjustment
        if (modelData.recentTrend === 'improving') {
            score += 5;
        } else if (modelData.recentTrend === 'declining') {
            score -= 5;
        }

        // Clamp score to 0-100
        score = Math.max(0, Math.min(100, score));

        // Convert to 0-1 weight
        weights[provider] = score / 100;
    }

    // If not enough data, use equal weights
    if (!hasEnoughData) {
        const equalWeight = 1 / enabledProviders.length;
        for (const provider of enabledProviders) {
            weights[provider] = equalWeight;
        }
    }

    // Normalize weights to sum to 1
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
        for (const provider of Object.keys(weights) as AIProvider[]) {
            weights[provider] = weights[provider] / totalWeight;
        }
    }

    // Find dominant model
    let dominantModel: AIProvider | null = null;
    let maxWeight = 0;
    for (const provider of enabledProviders) {
        if (weights[provider] > maxWeight) {
            maxWeight = weights[provider];
            dominantModel = provider;
        }
    }

    // Determine confidence in weighting
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (hasEnoughData) {
        const variance = enabledProviders.reduce((sum, p) => {
            const mean = 1 / enabledProviders.length;
            return sum + Math.pow(weights[p] - mean, 2);
        }, 0) / enabledProviders.length;

        if (variance > 0.05) {
            confidence = 'high'; // Clear differentiation
        } else if (variance > 0.02) {
            confidence = 'medium';
        }
    }

    return {
        gemini: Math.round(weights[AIProvider.GEMINI] * 100) / 100,
        deepseek: Math.round(weights[AIProvider.DEEPSEEK] * 100) / 100,
        zhipu: Math.round(weights[AIProvider.ZHIPU] * 100) / 100,
        groq: Math.round(weights[AIProvider.GROQ] * 100) / 100,
        groqNew: Math.round(weights[AIProvider.GROQ_NEW] * 100) / 100,
        groqAlt2: Math.round(weights[AIProvider.GROQ_ALT2] * 100) / 100,
        totalWeight: 1,
        dominantModel,
        confidence
    };
};

/**
 * Generate summary of model performances
 */
export const generatePerformanceSummary = (): string => {
    const data = loadPerformanceData();
    const providers = [
        AIProvider.GEMINI,
        AIProvider.DEEPSEEK,
        AIProvider.ZHIPU,
        AIProvider.GROQ,
        AIProvider.GROQ_NEW,
        AIProvider.GROQ_ALT2,
        AIProvider.OPENROUTER,
    ];

    let summary = '📊 **AI MODEL PERFORMANCE:**\n';

    for (const provider of providers) {
        const perf = data[provider];
        if (perf.overallStats.total > 0) {
            summary += `- ${provider.toUpperCase()}: ${perf.overallStats.winRate.toFixed(1)}% (${perf.overallStats.wins}W/${perf.overallStats.losses}L) [${perf.recentTrend}]\n`;
        } else {
            summary += `- ${provider.toUpperCase()}: No data yet\n`;
        }
    }

    return summary.trim();
};

/**
 * Generate weighted voting context for moderator prompt injection.
 * Provides historical accuracy data to inform the moderator's weighting of analyst opinions.
 */
export const generateWeightedVotingContext = (
    enabledProviders: AIProvider[],
    currentFamily?: string
): string => {
    if (enabledProviders.length === 0) return '';

    const data = loadPerformanceData();
    const providerStats: { provider: AIProvider; winRate: number; total: number; trend: string; coldStreak: number }[] = [];

    for (const provider of enabledProviders) {
        const perf = data[provider];
        const rollingStats = getRollingWindowStats(provider);
        providerStats.push({
            provider,
            winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0,
            total: perf.overallStats.total,
            trend: perf.recentTrend,
            coldStreak: rollingStats.coldStreakCount
        });
    }

    // Sort by win rate descending
    providerStats.sort((a, b) => b.winRate - a.winRate);

    // Identify best and worst performers
    const hasEnoughData = providerStats.some(s => s.total >= 5);
    if (!hasEnoughData) {
        return `
**⚖️ WEIGHTED VOTING: INSUFFICIENT DATA**
Not enough historical trades to establish accuracy rankings.
Treat all analyst opinions with equal weight until more data is available.
`;
    }

    const best = providerStats[0];
    const worst = providerStats[providerStats.length - 1];
    const spreadPct = best.winRate - worst.winRate;

    // Build ranking table
    let rankingTable = '';
    providerStats.forEach((s, idx) => {
        const rank = idx + 1;
        const streakWarning = s.coldStreak >= 3 ? `⚠️ COLD STREAK (${s.coldStreak})` : '';
        const trendIcon = s.trend === 'improving' ? '📈' : s.trend === 'declining' ? '📉' : '➡️';
        rankingTable += `${rank}. **${s.provider.toUpperCase()}**: ${s.winRate.toFixed(1)}% (${s.total} trades) ${trendIcon} ${streakWarning}\n`;
    });

    // Generate context
    let context = `
**⚖️ WEIGHTED VOTING BASED ON HISTORICAL ACCURACY**

${rankingTable}

**MODERATOR INSTRUCTIONS:**
`;

    // Add specific instructions based on spread
    if (spreadPct > 20) {
        context += `- **Strong differentiation detected**: Weight ${best.provider.toUpperCase()}'s analysis significantly higher (${spreadPct.toFixed(0)}% accuracy advantage).
- Be skeptical of ${worst.provider.toUpperCase()}'s recommendations unless strongly corroborated.
`;
    } else if (spreadPct > 10) {
        context += `- **Moderate differentiation**: Favor ${best.provider.toUpperCase()}'s analysis when opinions conflict.
`;
    } else {
        context += `- **Similar accuracy levels**: All analysts have comparable track records. Focus on argument quality.
`;
    }

    // Add cold streak warnings
    const coldStreakProviders = providerStats.filter(s => s.coldStreak >= 3);
    if (coldStreakProviders.length > 0) {
        context += `\n**⚠️ COLD STREAK WARNINGS:**\n`;
        coldStreakProviders.forEach(s => {
            context += `- ${s.provider.toUpperCase()} is on a ${s.coldStreak}-loss streak. Apply extra scrutiny to their recommendations.\n`;
        });
    }

    // Add family-specific insight if available
    if (currentFamily) {
        const familyKey = mapFamilyToKey(currentFamily);
        if (familyKey) {
            const familyBest = providerStats.reduce((best, current) => {
                const currentFamilyRate = data[current.provider].byFamily[familyKey]?.winRate || 0;
                const bestFamilyRate = data[best.provider].byFamily[familyKey]?.winRate || 0;
                return currentFamilyRate > bestFamilyRate ? current : best;
            });
            const familyWinRate = data[familyBest.provider].byFamily[familyKey]?.winRate;
            if (familyWinRate && familyWinRate > 0) {
                context += `\n**${currentFamily.toUpperCase()} SPECIALIST:** ${familyBest.provider.toUpperCase()} has the highest win rate (${familyWinRate.toFixed(1)}%) for this pattern family.\n`;
            }
        }
    }

    return context.trim();
};


/**
 * Analyze trades from trade log and update model performance
 * Call this when loading app or after trade outcomes are recorded
 */
export const syncFromTradeLog = (trades: LoggedTrade[]): void => {
    // Reset data
    const data: AllModelPerformances = {
        [AIProvider.GEMINI]: initModelPerformance(AIProvider.GEMINI),
        [AIProvider.DEEPSEEK]: initModelPerformance(AIProvider.DEEPSEEK),
        [AIProvider.ZHIPU]: initModelPerformance(AIProvider.ZHIPU),
        [AIProvider.GROQ]: initModelPerformance(AIProvider.GROQ),
        [AIProvider.GROQ_NEW]: initModelPerformance(AIProvider.GROQ_NEW),
        [AIProvider.GROQ_ALT2]: initModelPerformance(AIProvider.GROQ_ALT2),
        [AIProvider.OPENROUTER]: initModelPerformance(AIProvider.OPENROUTER),
        [AIProvider.OPENAI]: initModelPerformance(AIProvider.OPENAI),
        [AIProvider.GROK]: initModelPerformance(AIProvider.GROK)
    };

    // Process each trade
    for (const trade of trades) {
        if (trade.outcome === 'WIN' || trade.outcome === 'LOSS') {
            const isWin = trade.outcome === 'WIN';
            const family = trade.analysis?.detectedPatternFamily || '';
            const confidence = trade.analysis?.confidence || 'medium';

            // Default regime (in real implementation, this would be stored with the trade)
            const regime: MarketRegime = 'ranging';

            // Track for each model that was used
            const usedProviders: AIProvider[] = [];
            if (trade.geminiModelUsed) usedProviders.push(AIProvider.GEMINI);
            if (trade.deepseekModelUsed) usedProviders.push(AIProvider.DEEPSEEK);
            if (trade.zhipuModelUsed) usedProviders.push(AIProvider.ZHIPU);
            if (trade.groqModelUsed) usedProviders.push(AIProvider.GROQ);
            if (trade.groqNewModelUsed) usedProviders.push(AIProvider.GROQ_NEW);
            if (trade.groqAlt2ModelUsed) usedProviders.push(AIProvider.GROQ_ALT2);
            if (trade.openrouterModelUsed) usedProviders.push(AIProvider.OPENROUTER);

            for (const provider of usedProviders) {
                const modelData = data[provider];

                // Update overall
                modelData.overallStats = updateStats(modelData.overallStats, isWin);

                // Update family
                const familyKey = mapFamilyToKey(family);
                if (familyKey) {
                    modelData.byFamily[familyKey] = updateStats(modelData.byFamily[familyKey], isWin);
                }

                // Update regime
                const regimeKey = mapRegimeToKey(regime);
                modelData.byRegime[regimeKey] = updateStats(modelData.byRegime[regimeKey], isWin);

                // Update confidence
                const confKey = mapConfidenceToKey(confidence);
                modelData.byConfidence[confKey] = updateStats(modelData.byConfidence[confKey], isWin);

                modelData.lastUpdated = new Date().toISOString();
            }
        }
    }

    // Calculate trends
    for (const provider of Object.keys(data) as AIProvider[]) {
        const perf = data[provider];
        if (perf.overallStats.total >= 5) {
            if (perf.overallStats.winRate > 60) perf.recentTrend = 'improving';
            else if (perf.overallStats.winRate < 40) perf.recentTrend = 'declining';
            else perf.recentTrend = 'stable';
        }
    }

    savePerformanceData(data);
    console.log('[ModelPerformance] Synced from trade log:', trades.length, 'trades processed');
};

// =============================================================================
// ROLLING WINDOW FUNCTIONS
// =============================================================================

/**
 * Load rolling window data
 */
export const loadRollingWindowData = (): RollingWindowData => {
    if (_rollingWindowCache) return _rollingWindowCache;

    try {
        const stored = localStorage.getItem(PREF_KEYS.ROLLING_WINDOW_DATA);
        if (stored) {
            _rollingWindowCache = JSON.parse(stored);
            return _rollingWindowCache!;
        }
    } catch (e) { }

    const empty = { entries: [], lastUpdated: new Date().toISOString() };
    _rollingWindowCache = empty;
    return empty;
};

/**
 * Save rolling window data
 */
export const saveRollingWindowData = (data: RollingWindowData): void => {
    _rollingWindowCache = data;
    setPreferenceObject(PREF_KEYS.ROLLING_WINDOW_DATA, data).catch(e =>
        console.warn('[ModelPerformance] Failed to save rolling window:', e)
    );
};

/**
 * Determine trade type from family string
 */
export const mapFamilyToTradeType = (family: string): TradeType => {
    const f = family?.toLowerCase() || '';
    if (f.includes('a') || f.includes('b') || f.includes('reversal') || f.includes('trap') || f.includes('exhaustion')) {
        return 'reversal';
    }
    if (f.includes('c') || f.includes('omega') || f.includes('continuation') || f.includes('momentum')) {
        return 'continuation';
    }
    if (f.includes('breakout') || f.includes('break')) {
        return 'breakout';
    }
    if (f.includes('range') || f.includes('ranging')) {
        return 'range';
    }
    return 'unknown';
};

/**
 * Update rolling window with a new trade entry
 * Maintains max ROLLING_WINDOW_SIZE entries per provider
 */
export const updateRollingWindow = (
    provider: AIProvider,
    isWin: boolean,
    family: string
): void => {
    const data = loadRollingWindowData();

    const newEntry: RecentTradeEntry = {
        timestamp: new Date().toISOString(),
        provider,
        isWin,
        tradeType: mapFamilyToTradeType(family),
        family
    };

    // Add new entry
    data.entries.push(newEntry);

    // Keep only entries within the rolling window per provider
    const providerEntries = data.entries.filter(e => e.provider === provider);
    if (providerEntries.length > ROLLING_WINDOW_SIZE) {
        // Remove oldest entries for this provider
        const excessCount = providerEntries.length - ROLLING_WINDOW_SIZE;
        let removed = 0;
        data.entries = data.entries.filter(e => {
            if (e.provider === provider && removed < excessCount) {
                removed++;
                return false;
            }
            return true;
        });
    }

    data.lastUpdated = new Date().toISOString();
    saveRollingWindowData(data);

    console.log(`[RollingWindow] Updated ${provider}: Win=${isWin}, Total entries=${data.entries.filter(e => e.provider === provider).length}`);
};

/**
 * Get rolling window statistics for a provider
 */
export const getRollingWindowStats = (provider: AIProvider): RollingWindowStats => {
    const data = loadRollingWindowData();
    const providerEntries = data.entries
        .filter(e => e.provider === provider)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Most recent first

    const total = providerEntries.length;
    const wins = providerEntries.filter(e => e.isWin).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    // Calculate cold/hot streak from most recent trades
    let coldStreak = 0;
    let hotStreak = 0;

    for (const entry of providerEntries) {
        if (!entry.isWin) {
            if (hotStreak === 0) coldStreak++;
            else break;
        } else {
            if (coldStreak === 0) hotStreak++;
            else break;
        }
    }

    // Determine if model is demoted
    const isDemoted = coldStreak >= COLD_STREAK_THRESHOLD;
    const demotedReason = isDemoted
        ? `${coldStreak} consecutive losses (threshold: ${COLD_STREAK_THRESHOLD})`
        : undefined;

    return {
        last20WinRate: Math.round(winRate * 10) / 10,
        last20Total: total,
        last20Wins: wins,
        coldStreakCount: coldStreak,
        hotStreakCount: hotStreak,
        isDemoted,
        demotedReason
    };
};

/**
 * Detect cold streak for a provider
 */
export const detectColdStreak = (provider: AIProvider): {
    isOnColdStreak: boolean;
    consecutiveLosses: number;
    message: string;
} => {
    const stats = getRollingWindowStats(provider);

    return {
        isOnColdStreak: stats.isDemoted,
        consecutiveLosses: stats.coldStreakCount,
        message: stats.isDemoted
            ? `⚠️ ${provider.toUpperCase()} is on a cold streak (${stats.coldStreakCount} losses)`
            : ''
    };
};

/**
 * Get situational expertise for a provider (reversal vs continuation)
 */
export const getSituationalExpertise = (provider: AIProvider): SituationalExpertise => {
    const data = loadRollingWindowData();
    const providerEntries = data.entries.filter(e => e.provider === provider);

    // Separate by trade type
    const reversalTrades = providerEntries.filter(e => e.tradeType === 'reversal');
    const continuationTrades = providerEntries.filter(e =>
        e.tradeType === 'continuation' || e.tradeType === 'breakout'
    );

    const calcStats = (trades: RecentTradeEntry[]): PerformanceStats => {
        const wins = trades.filter(t => t.isWin).length;
        const total = trades.length;
        return {
            wins,
            losses: total - wins,
            total,
            winRate: total > 0 ? (wins / total) * 100 : 0
        };
    };

    const reversalStats = calcStats(reversalTrades);
    const continuationStats = calcStats(continuationTrades);

    // Determine strongest situation (need at least 3 trades to make determination)
    let strongestSituation: 'reversal' | 'continuation' | 'balanced' = 'balanced';

    if (reversalStats.total >= 3 && continuationStats.total >= 3) {
        const diff = reversalStats.winRate - continuationStats.winRate;
        if (diff > 15) strongestSituation = 'reversal';
        else if (diff < -15) strongestSituation = 'continuation';
    } else if (reversalStats.total >= 3 && reversalStats.winRate > 55) {
        strongestSituation = 'reversal';
    } else if (continuationStats.total >= 3 && continuationStats.winRate > 55) {
        strongestSituation = 'continuation';
    }

    return {
        reversalStats,
        continuationStats,
        strongestSituation
    };
};

/**
 * Identify the lowest performing model from enabled providers
 */
export const identifyLowestPerformer = (
    enabledProviders: AIProvider[]
): {
    provider: AIProvider;
    winRate: number;
    recentLosses: number;
    isSignificantlyWorse: boolean;
} | null => {
    if (enabledProviders.length === 0) return null;

    const stats = enabledProviders.map(p => ({
        provider: p,
        ...getRollingWindowStats(p)
    }));

    // Filter to providers with enough data
    const withData = stats.filter(s => s.last20Total >= 3);
    if (withData.length === 0) return null;

    // Calculate average win rate
    const avgWinRate = withData.reduce((sum, s) => sum + s.last20WinRate, 0) / withData.length;

    // Find lowest performer
    const lowest = withData.reduce((min, s) =>
        s.last20WinRate < min.last20WinRate ? s : min
    );

    const isSignificantlyWorse = (avgWinRate - lowest.last20WinRate) / 100 >= UNDERPERFORMER_THRESHOLD;

    return {
        provider: lowest.provider,
        winRate: lowest.last20WinRate,
        recentLosses: lowest.coldStreakCount,
        isSignificantlyWorse
    };
};

/**
 * Enhanced calculateDynamicWeights with rolling window priority
 */
export const calculateDynamicWeightsEnhanced = (
    currentRegime: MarketRegime,
    currentFamily: string,
    enabledProviders: AIProvider[]
): DynamicWeights => {
    const allTimeData = loadPerformanceData();
    const regimeKey = mapRegimeToKey(currentRegime);
    const familyKey = mapFamilyToKey(currentFamily);
    const tradeType = mapFamilyToTradeType(currentFamily);

    const weights: Record<AIProvider, number> = {
        [AIProvider.GEMINI]: 0,
        [AIProvider.DEEPSEEK]: 0,
        [AIProvider.ZHIPU]: 0,
        [AIProvider.GROQ]: 0,
        [AIProvider.GROQ_NEW]: 0,
        [AIProvider.GROQ_ALT2]: 0,
        [AIProvider.OPENROUTER]: 0,
        [AIProvider.OPENAI]: 0,
        [AIProvider.GROK]: 0
    };

    let hasEnoughData = false;
    const minTradesRequired = 3;

    for (const provider of enabledProviders) {
        const allTimeStats = allTimeData[provider];
        const rollingStats = getRollingWindowStats(provider);
        const expertise = getSituationalExpertise(provider);

        let score = 50; // Base score

        // PRIORITY 1: Rolling window performance (last 20 trades) - up to ±25 points
        if (rollingStats.last20Total >= minTradesRequired) {
            hasEnoughData = true;
            score += (rollingStats.last20WinRate - 50) * 0.5; // Up to ±25
        }

        // PRIORITY 2: Situational expertise bonus - up to ±15 points
        if (tradeType === 'reversal' && expertise.reversalStats.total >= minTradesRequired) {
            score += (expertise.reversalStats.winRate - 50) * 0.3;
        } else if (tradeType === 'continuation' && expertise.continuationStats.total >= minTradesRequired) {
            score += (expertise.continuationStats.winRate - 50) * 0.3;
        }

        // PRIORITY 3: All-time regime performance - up to ±10 points
        const regimeStats = allTimeStats.byRegime[regimeKey];
        if (regimeStats.total >= minTradesRequired) {
            hasEnoughData = true;
            score += (regimeStats.winRate - 50) * 0.2;
        }

        // PRIORITY 4: Hot/cold streak adjustment
        if (rollingStats.hotStreakCount >= 3) {
            score += 8; // Hot streak bonus
        }

        // COLD STREAK PENALTY - significant reduction
        if (rollingStats.isDemoted) {
            score *= COLD_STREAK_PENALTY; // 50% reduction
            console.log(`[DynamicWeights] ${provider} demoted: ${rollingStats.demotedReason}`);
        }

        // Clamp score to 0-100
        score = Math.max(0, Math.min(100, score));
        weights[provider] = score / 100;
    }

    // If not enough data, use equal weights
    if (!hasEnoughData) {
        const equalWeight = 1 / enabledProviders.length;
        for (const provider of enabledProviders) {
            weights[provider] = equalWeight;
        }
    }

    // Normalize weights to sum to 1
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
        for (const provider of Object.keys(weights) as AIProvider[]) {
            weights[provider] = weights[provider] / totalWeight;
        }
    }

    // Find dominant model
    let dominantModel: AIProvider | null = null;
    let maxWeight = 0;
    for (const provider of enabledProviders) {
        if (weights[provider] > maxWeight) {
            maxWeight = weights[provider];
            dominantModel = provider;
        }
    }

    // Determine confidence in weighting
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (hasEnoughData) {
        const variance = enabledProviders.reduce((sum, p) => {
            const mean = 1 / enabledProviders.length;
            return sum + Math.pow(weights[p] - mean, 2);
        }, 0) / enabledProviders.length;

        if (variance > 0.05) confidence = 'high';
        else if (variance > 0.02) confidence = 'medium';
    }

    return {
        gemini: Math.round(weights[AIProvider.GEMINI] * 100) / 100,
        deepseek: Math.round(weights[AIProvider.DEEPSEEK] * 100) / 100,
        zhipu: Math.round(weights[AIProvider.ZHIPU] * 100) / 100,
        groq: Math.round(weights[AIProvider.GROQ] * 100) / 100,
        groqNew: Math.round(weights[AIProvider.GROQ_NEW] * 100) / 100,
        groqAlt2: Math.round(weights[AIProvider.GROQ_ALT2] * 100) / 100,
        totalWeight: 1,
        dominantModel,
        confidence
    };
};

/**
 * Sync rolling window from trade log
 * Call this when loading app to populate rolling window from existing trades
 */
export const syncRollingWindowFromTradeLog = (trades: LoggedTrade[]): void => {
    // Clear existing rolling window
    const data: RollingWindowData = { entries: [], lastUpdated: new Date().toISOString() };

    // Sort trades by timestamp (oldest first) and take last N
    const sortedTrades = [...trades]
        .filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const trade of sortedTrades) {
        const isWin = trade.outcome === 'WIN';
        const family = trade.analysis?.detectedPatternFamily || '';
        const tradeType = mapFamilyToTradeType(family);

        // Determine which providers were used
        const usedProviders: AIProvider[] = [];
        if (trade.geminiModelUsed) usedProviders.push(AIProvider.GEMINI);
        if (trade.deepseekModelUsed) usedProviders.push(AIProvider.DEEPSEEK);
        if (trade.zhipuModelUsed) usedProviders.push(AIProvider.ZHIPU);
        if (trade.groqModelUsed) usedProviders.push(AIProvider.GROQ);
        if (trade.groqNewModelUsed) usedProviders.push(AIProvider.GROQ_NEW);
        if (trade.groqAlt2ModelUsed) usedProviders.push(AIProvider.GROQ_ALT2);
        if (trade.openrouterModelUsed) usedProviders.push(AIProvider.OPENROUTER);

        for (const provider of usedProviders) {
            data.entries.push({
                timestamp: trade.timestamp,
                provider,
                isWin,
                tradeType,
                family
            });
        }
    }

    // Trim to rolling window size per provider
    const providers = Object.values(AIProvider);
    for (const provider of providers) {
        const providerEntries = data.entries
            .filter(e => e.provider === provider)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (providerEntries.length > ROLLING_WINDOW_SIZE) {
            const toKeep = new Set(providerEntries.slice(0, ROLLING_WINDOW_SIZE).map(e => e.timestamp + e.provider));
            data.entries = data.entries.filter(e =>
                e.provider !== provider || toKeep.has(e.timestamp + e.provider)
            );
        }
    }

    saveRollingWindowData(data);
    console.log('[RollingWindow] Synced from trade log:', data.entries.length, 'entries');
};

// =============================================================================
// IMPROVEMENT 1: RECENCY-WEIGHTED WIN RATE
// =============================================================================

/**
 * Get recency-weighted win rate for a provider
 * Recent trades are weighted more heavily using exponential decay
 */
export const getRecencyWeightedWinRate = (provider: AIProvider): RecencyWeightedStats => {
    const data = loadRollingWindowData();
    const providerEntries = data.entries
        .filter(e => e.provider === provider)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (providerEntries.length < MIN_TRADES_FOR_RECENCY) {
        return {
            recencyWeightedWinRate: 0,
            standardWinRate: 0,
            tradesAnalyzed: providerEntries.length,
            oldestTradeWeight: 0,
            trendDirection: 'stable'
        };
    }

    let weightedWins = 0;
    let totalWeight = 0;
    let recentWins = 0;
    let olderWins = 0;
    const midpoint = Math.floor(providerEntries.length / 2);

    for (let i = 0; i < providerEntries.length; i++) {
        const weight = Math.pow(RECENCY_DECAY_FACTOR, i);
        totalWeight += weight;
        if (providerEntries[i].isWin) {
            weightedWins += weight;
            if (i < midpoint) recentWins++;
            else olderWins++;
        }
    }

    const recencyWeightedWinRate = totalWeight > 0 ? (weightedWins / totalWeight) * 100 : 0;
    const standardWinRate = providerEntries.filter(e => e.isWin).length / providerEntries.length * 100;
    const oldestTradeWeight = Math.pow(RECENCY_DECAY_FACTOR, providerEntries.length - 1);

    // Determine trend direction
    const recentWinRate = midpoint > 0 ? (recentWins / midpoint) * 100 : 0;
    const olderWinRate = (providerEntries.length - midpoint) > 0
        ? (olderWins / (providerEntries.length - midpoint)) * 100
        : 0;

    let trendDirection: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentWinRate > olderWinRate + 10) trendDirection = 'improving';
    else if (recentWinRate < olderWinRate - 10) trendDirection = 'declining';

    return {
        recencyWeightedWinRate: Math.round(recencyWeightedWinRate * 10) / 10,
        standardWinRate: Math.round(standardWinRate * 10) / 10,
        tradesAnalyzed: providerEntries.length,
        oldestTradeWeight: Math.round(oldestTradeWeight * 1000) / 1000,
        trendDirection
    };
};

// =============================================================================
// IMPROVEMENT 2: CONFIDENCE CALIBRATION PER MODEL
// =============================================================================

/**
 * Load confidence calibration data
 */
const loadConfidenceCalibrationData = (): ModelConfidenceCalibrationData => {
    if (_confidenceCalibrationCache) return _confidenceCalibrationCache;

    try {
        const stored = localStorage.getItem(PREF_KEYS.CONFIDENCE_CALIBRATION);
        if (stored) {
            _confidenceCalibrationCache = JSON.parse(stored);
            return _confidenceCalibrationCache!;
        }
    } catch (e) { }

    const empty = { providers: {}, lastUpdated: new Date().toISOString() };
    _confidenceCalibrationCache = empty;
    return empty;
};

/**
 * Save confidence calibration data
 */
const saveConfidenceCalibrationData = (data: ModelConfidenceCalibrationData): void => {
    _confidenceCalibrationCache = data;
    setPreferenceObject(PREF_KEYS.CONFIDENCE_CALIBRATION, data).catch(e =>
        console.warn('[Confidence] Failed to save data:', e)
    );
};

/**
 * Track a trade's confidence level for a provider
 */
export const trackConfidenceCalibration = (
    provider: AIProvider,
    confidence: 'High' | 'Medium' | 'Low' | 'Avoid',
    isWin: boolean
): void => {
    const data = loadConfidenceCalibrationData();

    if (!data.providers[provider]) {
        data.providers[provider] = {
            high: { wins: 0, total: 0 },
            medium: { wins: 0, total: 0 },
            low: { wins: 0, total: 0 }
        };
    }

    const confKey = confidence.toLowerCase() as 'high' | 'medium' | 'low';
    if (confKey === 'high' || confKey === 'medium' || confKey === 'low') {
        data.providers[provider][confKey].total++;
        if (isWin) data.providers[provider][confKey].wins++;
    }

    data.lastUpdated = new Date().toISOString();
    saveConfidenceCalibrationData(data);
};

/**
 * Get confidence calibration for a provider
 * Returns whether the model's confidence levels match actual performance
 */
export const getModelConfidenceCalibration = (provider: AIProvider): ConfidenceCalibrationPerModel => {
    const data = loadConfidenceCalibrationData();
    const providerData = data.providers[provider];

    if (!providerData) {
        return {
            high: { wins: 0, total: 0, winRate: 0 },
            medium: { wins: 0, total: 0, winRate: 0 },
            low: { wins: 0, total: 0, winRate: 0 },
            isOverconfident: false
        };
    }

    const calcWinRate = (stats: { wins: number; total: number }) =>
        stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;

    const highWinRate = calcWinRate(providerData.high);
    const mediumWinRate = calcWinRate(providerData.medium);
    const lowWinRate = calcWinRate(providerData.low);

    // Calculate overall win rate
    const totalWins = providerData.high.wins + providerData.medium.wins + providerData.low.wins;
    const totalTrades = providerData.high.total + providerData.medium.total + providerData.low.total;
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    // Model is overconfident if High confidence performs worse than overall
    const isOverconfident = providerData.high.total >= 3 && highWinRate < overallWinRate - 5;

    let calibrationWarning: string | undefined;
    if (isOverconfident) {
        calibrationWarning = `⚠️ ${provider.toUpperCase()} is overconfident: High confidence trades win only ${highWinRate.toFixed(1)}% vs ${overallWinRate.toFixed(1)}% overall`;
    } else if (providerData.high.total >= 3 && highWinRate < mediumWinRate) {
        calibrationWarning = `📊 ${provider.toUpperCase()}: "High" confidence (${highWinRate.toFixed(1)}%) underperforms "Medium" (${mediumWinRate.toFixed(1)}%)`;
    }

    return {
        high: { wins: providerData.high.wins, total: providerData.high.total, winRate: Math.round(highWinRate * 10) / 10 },
        medium: { wins: providerData.medium.wins, total: providerData.medium.total, winRate: Math.round(mediumWinRate * 10) / 10 },
        low: { wins: providerData.low.wins, total: providerData.low.total, winRate: Math.round(lowWinRate * 10) / 10 },
        isOverconfident,
        calibrationWarning
    };
};

/**
 * Sync confidence calibration from trade log
 */
export const syncConfidenceCalibrationFromTradeLog = (trades: LoggedTrade[]): void => {
    const data: ModelConfidenceCalibrationData = { providers: {}, lastUpdated: new Date().toISOString() };

    for (const trade of trades) {
        if (trade.outcome !== 'WIN' && trade.outcome !== 'LOSS') continue;

        const confidence = trade.analysis?.confidence || 'Medium';
        const isWin = trade.outcome === 'WIN';
        const confKey = confidence.toLowerCase() as 'high' | 'medium' | 'low';

        if (confKey !== 'high' && confKey !== 'medium' && confKey !== 'low') continue;

        // Determine which providers were used
        const usedProviders: AIProvider[] = [];
        if (trade.geminiModelUsed) usedProviders.push(AIProvider.GEMINI);
        if (trade.deepseekModelUsed) usedProviders.push(AIProvider.DEEPSEEK);
        if (trade.zhipuModelUsed) usedProviders.push(AIProvider.ZHIPU);
        if (trade.groqModelUsed) usedProviders.push(AIProvider.GROQ);
        if (trade.groqNewModelUsed) usedProviders.push(AIProvider.GROQ_NEW);
        if (trade.groqAlt2ModelUsed) usedProviders.push(AIProvider.GROQ_ALT2);
        if (trade.openrouterModelUsed) usedProviders.push(AIProvider.OPENROUTER);

        for (const provider of usedProviders) {
            if (!data.providers[provider]) {
                data.providers[provider] = {
                    high: { wins: 0, total: 0 },
                    medium: { wins: 0, total: 0 },
                    low: { wins: 0, total: 0 }
                };
            }
            data.providers[provider][confKey].total++;
            if (isWin) data.providers[provider][confKey].wins++;
        }
    }

    saveConfidenceCalibrationData(data);
    console.log('[ConfidenceCalibration] Synced from trade log:', Object.keys(data.providers).length, 'providers');
};

// =============================================================================
// IMPROVEMENT 3: PROVIDER PAIR CORRELATION ANALYSIS
// =============================================================================

/**
 * Generate a consistent pair key for two providers
 */
const getPairKey = (a: AIProvider, b: AIProvider): string => {
    const sorted = [a, b].sort();
    return `${sorted[0]}-${sorted[1]}`;
};

/**
 * Load provider pair stats
 */
const loadProviderPairStats = (): AllProviderPairStats => {
    if (_providerPairStatsCache) return _providerPairStatsCache;

    try {
        const stored = localStorage.getItem(PREF_KEYS.PROVIDER_PAIR_STATS);
        if (stored) {
            _providerPairStatsCache = JSON.parse(stored);
            return _providerPairStatsCache!;
        }
    } catch (e) { }

    const empty = { pairs: {}, lastUpdated: new Date().toISOString() };
    _providerPairStatsCache = empty;
    return empty;
};

/**
 * Save provider pair stats
 */
const saveProviderPairStats = (data: AllProviderPairStats): void => {
    _providerPairStatsCache = data;
    setPreferenceObject(PREF_KEYS.PROVIDER_PAIR_STATS, data).catch(e =>
        console.warn('[Pairs] Failed to save data:', e)
    );
};

/**
 * Initialize a pair stats entry
 */
const initPairStats = (a: AIProvider, b: AIProvider): ProviderPairStats => ({
    pairKey: getPairKey(a, b),
    providerA: a < b ? a : b,
    providerB: a < b ? b : a,
    timesAgreed: 0,
    timesDisagreed: 0,
    agreementWins: 0,
    agreementLosses: 0,
    aWinsInDisagreement: 0,
    bWinsInDisagreement: 0,
    tieBreakerRecommendation: null
});

/**
 * Track when two providers agree or disagree on a trade direction
 */
export const trackProviderPairAgreement = (
    providerA: AIProvider,
    providerB: AIProvider,
    directionA: 'Long' | 'Short' | 'Neutral',
    directionB: 'Long' | 'Short' | 'Neutral',
    actualOutcome: 'WIN' | 'LOSS',
    actualDirection: 'Long' | 'Short'
): void => {
    const data = loadProviderPairStats();
    const pairKey = getPairKey(providerA, providerB);

    if (!data.pairs[pairKey]) {
        data.pairs[pairKey] = initPairStats(providerA, providerB);
    }

    const pair = data.pairs[pairKey];
    const agreed = directionA === directionB;

    if (agreed) {
        pair.timesAgreed++;
        if (actualOutcome === 'WIN') pair.agreementWins++;
        else pair.agreementLosses++;
    } else {
        pair.timesDisagreed++;
        // Track which provider was correct in disagreement
        const aCorrect = directionA === actualDirection && actualOutcome === 'WIN';
        const bCorrect = directionB === actualDirection && actualOutcome === 'WIN';

        if (aCorrect) pair.aWinsInDisagreement++;
        if (bCorrect) pair.bWinsInDisagreement++;
    }

    // Update tie-breaker recommendation
    if (pair.timesDisagreed >= 3) {
        if (pair.aWinsInDisagreement > pair.bWinsInDisagreement + 1) {
            pair.tieBreakerRecommendation = pair.providerA;
        } else if (pair.bWinsInDisagreement > pair.aWinsInDisagreement + 1) {
            pair.tieBreakerRecommendation = pair.providerB;
        } else {
            pair.tieBreakerRecommendation = null;
        }
    }

    data.lastUpdated = new Date().toISOString();
    saveProviderPairStats(data);
};

/**
 * Get pair statistics for two providers
 */
export const getProviderPairStats = (providerA: AIProvider, providerB: AIProvider): ProviderPairStats | null => {
    const data = loadProviderPairStats();
    const pairKey = getPairKey(providerA, providerB);
    return data.pairs[pairKey] || null;
};

/**
 * Get all provider pair statistics
 */
export const getAllProviderPairStats = (): ProviderPairStats[] => {
    const data = loadProviderPairStats();
    return Object.values(data.pairs);
};

/**
 * Analyze provider pairs and get insights for debate context
 */
export const analyzeProviderPairs = (enabledProviders: AIProvider[]): string => {
    if (enabledProviders.length < 2) return '';

    const insights: string[] = [];
    const data = loadProviderPairStats();

    for (let i = 0; i < enabledProviders.length; i++) {
        for (let j = i + 1; j < enabledProviders.length; j++) {
            const pairKey = getPairKey(enabledProviders[i], enabledProviders[j]);
            const pair = data.pairs[pairKey];

            if (pair && pair.timesDisagreed >= 3) {
                const totalDisagreements = pair.aWinsInDisagreement + pair.bWinsInDisagreement;
                if (totalDisagreements > 0 && pair.tieBreakerRecommendation) {
                    const winRate = pair.tieBreakerRecommendation === pair.providerA
                        ? (pair.aWinsInDisagreement / totalDisagreements * 100)
                        : (pair.bWinsInDisagreement / totalDisagreements * 100);
                    insights.push(
                        `When ${pair.providerA.toUpperCase()} and ${pair.providerB.toUpperCase()} disagree, ` +
                        `trust ${pair.tieBreakerRecommendation.toUpperCase()} (${winRate.toFixed(0)}% correct)`
                    );
                }
            }
        }
    }

    if (insights.length === 0) return '';
    return `\n🔗 **PROVIDER PAIR INSIGHTS:**\n${insights.map(i => `- ${i}`).join('\n')}\n`;
};

// =============================================================================
// IMPROVEMENT 4: ADAPTIVE COLD STREAK THRESHOLD
// =============================================================================

/**
 * Calculate adaptive cold streak threshold based on model's historical performance
 * High performers get stricter thresholds (2 losses), low performers get lenient (4 losses)
 */
export const getAdaptiveColdStreakThreshold = (provider: AIProvider): number => {
    const stats = getRollingWindowStats(provider);
    const recencyStats = getRecencyWeightedWinRate(provider);

    if (recencyStats.tradesAnalyzed < MIN_TRADES_FOR_RECENCY) {
        return COLD_STREAK_THRESHOLD; // Not enough data, use default
    }

    const winRate = recencyStats.recencyWeightedWinRate;

    if (winRate >= HIGH_PERFORMER_THRESHOLD) {
        return HIGH_PERFORMER_COLD_STREAK; // Stricter for high performers
    } else if (winRate < 50) {
        return LOW_PERFORMER_COLD_STREAK; // More lenient for struggling models
    }

    return COLD_STREAK_THRESHOLD; // Default for middle performers
};

/**
 * Get rolling window stats with adaptive cold streak detection
 */
export const getRollingWindowStatsAdaptive = (provider: AIProvider): RollingWindowStats => {
    const baseStats = getRollingWindowStats(provider);
    const adaptiveThreshold = getAdaptiveColdStreakThreshold(provider);

    // Re-evaluate demotion with adaptive threshold
    const isDemoted = baseStats.coldStreakCount >= adaptiveThreshold;
    const demotedReason = isDemoted
        ? `${baseStats.coldStreakCount} consecutive losses (adaptive threshold: ${adaptiveThreshold})`
        : undefined;

    return {
        ...baseStats,
        isDemoted,
        demotedReason
    };
};

// =============================================================================
// IMPROVEMENT 6: MONTE CARLO INTEGRATION IN WEIGHTS
// =============================================================================

/**
 * Monte Carlo result type (simplified for import-free usage)
 */
interface MonteCarloResultForWeights {
    winRate: number;
    maxDrawdownAvg: number;
    expectedValue: number;
}

/**
 * Apply Monte Carlo risk adjustment to provider weights
 * High drawdown or low MC win rate reduces weights
 */
export const applyMonteCarloRiskAdjustment = (
    weights: Record<AIProvider, number>,
    monteCarloResult: MonteCarloResultForWeights | null,
    affectedProviders: AIProvider[]
): Record<AIProvider, number> => {
    if (!monteCarloResult) return weights;

    const adjustedWeights = { ...weights };
    let penaltyApplied = false;

    // Check for high drawdown
    if (monteCarloResult.maxDrawdownAvg >= HIGH_DRAWDOWN_THRESHOLD) {
        console.log(`[MonteCarloWeights] High drawdown detected (${monteCarloResult.maxDrawdownAvg.toFixed(1)}%), applying penalty`);
        penaltyApplied = true;
    }

    // Check for low MC win rate
    if (monteCarloResult.winRate < LOW_WINRATE_MC_THRESHOLD) {
        console.log(`[MonteCarloWeights] Low MC win rate (${monteCarloResult.winRate.toFixed(1)}%), applying penalty`);
        penaltyApplied = true;
    }

    if (penaltyApplied) {
        for (const provider of affectedProviders) {
            adjustedWeights[provider] *= HIGH_DRAWDOWN_PENALTY;
        }

        // Re-normalize weights
        const total = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (const provider of Object.keys(adjustedWeights) as AIProvider[]) {
                adjustedWeights[provider] = adjustedWeights[provider] / total;
            }
        }
    }

    return adjustedWeights;
};

// =============================================================================
// IMPROVEMENT 5: POST-MORTEM INSIGHT TRACKING
// =============================================================================

const POST_MORTEM_INSIGHT_STORAGE_KEY = 'post_mortem_insight_scores';

interface PostMortemInsightData {
    providers: Record<string, {
        totalScore: number;
        count: number;
        avgScore: number;
    }>;
    lastUpdated: string;
}

/**
 * Load post-mortem insight data
 */
/**
 * Load post-mortem insight data
 */
const loadPostMortemInsightData = (): PostMortemInsightData => {
    if (_postMortemCache) return _postMortemCache;

    try {
        const stored = localStorage.getItem(PREF_KEYS.POST_MORTEM_INSIGHTS);
        if (stored) {
            _postMortemCache = JSON.parse(stored);
            return _postMortemCache as PostMortemInsightData;
        }
    } catch (e) {
        console.warn('[PostMortemInsight] Failed to load:', e);
    }
    return { providers: {}, lastUpdated: new Date().toISOString() };
};

/**
 * Save post-mortem insight data
 */
const savePostMortemInsightData = (data: PostMortemInsightData): void => {
    _postMortemCache = data;
    setPreferenceObject(PREF_KEYS.POST_MORTEM_INSIGHTS, data).catch(e =>
        console.warn('[PostMortemInsight] Failed to save:', e)
    );
};

/**
 * Track insight quality for a provider's post-mortem analysis
 * Score: 0-100 based on how actionable/helpful the insight was
 */
export const trackPostMortemInsightQuality = (provider: AIProvider, score: number): void => {
    const data = loadPostMortemInsightData();

    if (!data.providers[provider]) {
        data.providers[provider] = { totalScore: 0, count: 0, avgScore: 0 };
    }

    data.providers[provider].totalScore += Math.min(100, Math.max(0, score));
    data.providers[provider].count++;
    data.providers[provider].avgScore = data.providers[provider].totalScore / data.providers[provider].count;
    data.lastUpdated = new Date().toISOString();

    savePostMortemInsightData(data);
    console.log(`[PostMortemInsight] ${provider}: score=${score}, avg=${data.providers[provider].avgScore.toFixed(1)}`);
};

/**
 * Get average post-mortem insight score for a provider
 */
export const getProviderInsightScore = (provider: AIProvider): { avgScore: number; count: number } => {
    const data = loadPostMortemInsightData();
    const providerData = data.providers[provider];

    if (!providerData || providerData.count === 0) {
        return { avgScore: 50, count: 0 }; // Default neutral score
    }

    return {
        avgScore: Math.round(providerData.avgScore * 10) / 10,
        count: providerData.count
    };
};

/**
 * Get all provider insight scores for comparison
 */
export const getAllProviderInsightScores = (): Record<AIProvider, { avgScore: number; count: number }> => {
    const data = loadPostMortemInsightData();
    const result: Record<AIProvider, { avgScore: number; count: number }> = {} as any;

    for (const provider of Object.values(AIProvider)) {
        result[provider] = getProviderInsightScore(provider);
    }

    return result;
};

// =============================================================================
// ENHANCED DYNAMIC WEIGHTS WITH ALL IMPROVEMENTS
// =============================================================================

/**
 * Calculate dynamic weights with ALL improvements applied:
 * 1. Recency-weighted win rate
 * 2. Confidence calibration awareness
 * 3. Provider pair correlation insights
 * 4. Adaptive cold streak thresholds
 * 5. Monte Carlo risk adjustment (if provided)
 */
export const calculateDynamicWeightsWithAllImprovements = (
    currentRegime: MarketRegime,
    currentFamily: string,
    enabledProviders: AIProvider[],
    monteCarloResult?: MonteCarloResultForWeights | null
): DynamicWeights => {
    const allTimeData = loadPerformanceData();
    const regimeKey = mapRegimeToKey(currentRegime);
    const tradeType = mapFamilyToTradeType(currentFamily);

    const weights: Record<AIProvider, number> = {
        [AIProvider.GEMINI]: 0,
        [AIProvider.DEEPSEEK]: 0,
        [AIProvider.ZHIPU]: 0,
        [AIProvider.GROQ]: 0,
        [AIProvider.GROQ_NEW]: 0,
        [AIProvider.GROQ_ALT2]: 0,
        [AIProvider.OPENROUTER]: 0,
        [AIProvider.OPENAI]: 0,
        [AIProvider.GROK]: 0
    };

    let hasEnoughData = false;
    const minTradesRequired = 3;

    for (const provider of enabledProviders) {
        const allTimeStats = allTimeData[provider];
        const recencyStats = getRecencyWeightedWinRate(provider);
        const adaptiveStats = getRollingWindowStatsAdaptive(provider);
        const expertise = getSituationalExpertise(provider);
        const calibration = getModelConfidenceCalibration(provider);

        let score = 50; // Base score

        // PRIORITY 1: Recency-weighted win rate (up to ±25 points)
        if (recencyStats.tradesAnalyzed >= minTradesRequired) {
            hasEnoughData = true;
            score += (recencyStats.recencyWeightedWinRate - 50) * 0.5;
        }

        // PRIORITY 2: Situational expertise (up to ±15 points)
        if (tradeType === 'reversal' && expertise.reversalStats.total >= minTradesRequired) {
            score += (expertise.reversalStats.winRate - 50) * 0.3;
        } else if (tradeType === 'continuation' && expertise.continuationStats.total >= minTradesRequired) {
            score += (expertise.continuationStats.winRate - 50) * 0.3;
        }

        // PRIORITY 3: All-time regime performance (up to ±10 points)
        const regimeStats = allTimeStats.byRegime[regimeKey];
        if (regimeStats.total >= minTradesRequired) {
            hasEnoughData = true;
            score += (regimeStats.winRate - 50) * 0.2;
        }

        // PRIORITY 4: Hot streak bonus
        if (adaptiveStats.hotStreakCount >= 3) {
            score += 8;
        }

        // PRIORITY 5: Confidence calibration penalty
        if (calibration.isOverconfident && calibration.high.total >= 3) {
            score -= 5; // Penalty for overconfident models
            console.log(`[DynamicWeights] ${provider} overconfidence penalty applied`);
        }

        // PRIORITY 6: Trend direction bonus/malus
        if (recencyStats.trendDirection === 'improving') {
            score += 5;
        } else if (recencyStats.trendDirection === 'declining') {
            score -= 5;
        }

        // COLD STREAK PENALTY with adaptive threshold
        if (adaptiveStats.isDemoted) {
            score *= COLD_STREAK_PENALTY;
            console.log(`[DynamicWeights] ${provider} demoted: ${adaptiveStats.demotedReason}`);
        }

        // Clamp score
        score = Math.max(0, Math.min(100, score));
        weights[provider] = score / 100;
    }

    // If not enough data, use equal weights
    if (!hasEnoughData) {
        const equalWeight = 1 / enabledProviders.length;
        for (const provider of enabledProviders) {
            weights[provider] = equalWeight;
        }
    }

    // Normalize weights
    let totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
        for (const provider of Object.keys(weights) as AIProvider[]) {
            weights[provider] = weights[provider] / totalWeight;
        }
    }

    // Apply Monte Carlo risk adjustment
    const mcAdjustedWeights = applyMonteCarloRiskAdjustment(weights, monteCarloResult || null, enabledProviders);

    // Find dominant model
    let dominantModel: AIProvider | null = null;
    let maxWeight = 0;
    for (const provider of enabledProviders) {
        if (mcAdjustedWeights[provider] > maxWeight) {
            maxWeight = mcAdjustedWeights[provider];
            dominantModel = provider;
        }
    }

    // Determine confidence
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (hasEnoughData) {
        const variance = enabledProviders.reduce((sum, p) => {
            const mean = 1 / enabledProviders.length;
            return sum + Math.pow(mcAdjustedWeights[p] - mean, 2);
        }, 0) / enabledProviders.length;

        if (variance > 0.05) confidence = 'high';
        else if (variance > 0.02) confidence = 'medium';
    }

    return {
        gemini: Math.round(mcAdjustedWeights[AIProvider.GEMINI] * 100) / 100,
        deepseek: Math.round(mcAdjustedWeights[AIProvider.DEEPSEEK] * 100) / 100,
        zhipu: Math.round(mcAdjustedWeights[AIProvider.ZHIPU] * 100) / 100,
        groq: Math.round(mcAdjustedWeights[AIProvider.GROQ] * 100) / 100,
        groqNew: Math.round(mcAdjustedWeights[AIProvider.GROQ_NEW] * 100) / 100,
        groqAlt2: Math.round(mcAdjustedWeights[AIProvider.GROQ_ALT2] * 100) / 100,
        totalWeight: 1,
        dominantModel,
        confidence
    };
};

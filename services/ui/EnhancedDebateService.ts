/**
 * EnhancedDebateService
 * Adds intelligence layers to ensemble debates:
 * 1. Model Performance Weighting
 * 2. Disagreement Analysis  
 * 3. Confidence Calibration per Model
 * 4. Devil's Advocate Mode
 * 5. Historical Similar Trade Recall
 * 6. Real-time Market Injection
 */

import { LoggedTrade, TradeAnalysis, TradeOutcome, AIProvider } from '../../../types';
import {
    calculateDynamicWeights,
    calculateDynamicWeightsEnhanced,
    calculateDynamicWeightsWithAllImprovements,
    generatePerformanceSummary,
    DynamicWeights,
    getModelPerformance,
    getRollingWindowStats,
    identifyLowestPerformer,
    // New imports for ensemble improvements
    getRecencyWeightedWinRate,
    getModelConfidenceCalibration,
    analyzeProviderPairs,
    getRollingWindowStatsAdaptive,
    RecencyWeightedStats,
    ConfidenceCalibrationPerModel
} from '../backtesting/ModelPerformanceService';
import { MarketRegime } from '../analysis/TechnicalAnalysisService';
import { computeLearningProfile } from '../learning/SelfLearningService';
import {
    generateModeratorUnderperformerWarning,
    getUnderperformerStatus
} from '../learning/UnderperformerFeedbackService';
import {
    backtestSimilarSetups,
    generateBacktestPromptInjection,
    LiveBacktestResult
} from '../backtesting/LiveBacktestService';
import {
    MonteCarloResult,
    generateMonteCarloPromptInjection
} from '../analysis/MonteCarloService';

/**
 * Analysis disagreement details
 */
export interface DisagreementPoint {
    aspect: 'direction' | 'entry' | 'stopLoss' | 'takeProfit' | 'confidence' | 'pattern';
    models: { model: string; value: string }[];
    severity: 'high' | 'medium' | 'low';
    description: string;
}

/**
 * Model calibration data for debate context
 */
export interface ModelCalibration {
    model: string;
    overallWinRate: number;
    contextWinRate: number | null; // Win rate for specific coin/pattern/regime
    contextDescription: string;
    calibrationNote: string;
}

/**
 * Similar historical trade
 */
export interface SimilarTrade {
    id: string;
    coin: string;
    direction: string;
    pattern: string;
    outcome: TradeOutcome;
    lesson: string;
    timestamp: string;
}

/**
 * Enhanced debate context to inject
 */
export interface EnhancedDebateContext {
    modelWeights: DynamicWeights;
    performanceSummary: string;
    disagreements: DisagreementPoint[];
    modelCalibrations: ModelCalibration[];
    similarTrades: SimilarTrade[];
    devilsAdvocateQuery: string;
    promptInjection: string;
    // New fields for advanced analytics
    backtestResult?: LiveBacktestResult;
    monteCarloResult?: MonteCarloResult;
    underperformerWarning?: string;
    lowestPerformer?: {
        provider: AIProvider;
        winRate: number;
        isSignificantlyWorse: boolean;
    } | null;
    // New fields for ensemble improvements
    recencyWeightedStats?: Record<string, RecencyWeightedStats>;
    confidenceCalibrations?: Record<string, ConfidenceCalibrationPerModel>;
    providerPairInsights?: string;
}

/**
 * Detect disagreements between model analyses
 */
export const analyzeDisagreements = (
    analyses: { model: string; analysis: TradeAnalysis }[]
): DisagreementPoint[] => {
    const disagreements: DisagreementPoint[] = [];

    if (analyses.length < 2) return disagreements;

    // Direction disagreement
    const directions = analyses.map(a => ({ model: a.model, value: a.analysis.direction || 'Unknown' }));
    const uniqueDirections = [...new Set(directions.map(d => d.value))];
    if (uniqueDirections.length > 1) {
        disagreements.push({
            aspect: 'direction',
            models: directions,
            severity: 'high',
            description: `Critical disagreement: ${directions.map(d => `${d.model}→${d.value}`).join(' vs ')}`
        });
    }

    // Confidence disagreement
    const confidences = analyses.map(a => ({ model: a.model, value: a.analysis.confidence || 'Unknown' }));
    const uniqueConf = [...new Set(confidences.map(c => c.value))];
    if (uniqueConf.includes('High') && (uniqueConf.includes('Low') || uniqueConf.includes('Avoid'))) {
        disagreements.push({
            aspect: 'confidence',
            models: confidences,
            severity: 'medium',
            description: `Confidence split: ${confidences.map(c => `${c.model}=${c.value}`).join(', ')}`
        });
    }

    // Pattern/Family disagreement
    const patterns = analyses.map(a => ({
        model: a.model,
        value: a.analysis.detectedPatternFamily || a.analysis.marketConditions?.pattern || 'Unknown'
    }));
    const uniquePatterns = [...new Set(patterns.map(p => p.value.toLowerCase()))];
    if (uniquePatterns.length > 1 && uniquePatterns.every(p => p !== 'unknown')) {
        disagreements.push({
            aspect: 'pattern',
            models: patterns,
            severity: 'medium',
            description: `Pattern classification differs: ${patterns.map(p => `${p.model}="${p.value}"`).join(', ')}`
        });
    }

    // Entry price disagreement (>1% difference)
    const entries = analyses.map(a => {
        const entryStr = a.analysis.entryPoints?.[0]?.price || '';
        const entryNum = parseFloat(entryStr.replace(/[^0-9.]/g, ''));
        return { model: a.model, value: entryStr, numeric: isNaN(entryNum) ? null : entryNum };
    }).filter(e => e.numeric !== null);

    if (entries.length >= 2) {
        const numericEntries = entries.map(e => e.numeric!);
        const max = Math.max(...numericEntries);
        const min = Math.min(...numericEntries);
        const pctDiff = ((max - min) / min) * 100;

        if (pctDiff > 1) {
            disagreements.push({
                aspect: 'entry',
                models: entries.map(e => ({ model: e.model, value: e.value })),
                severity: pctDiff > 3 ? 'high' : 'medium',
                description: `Entry prices vary by ${pctDiff.toFixed(1)}%: ${entries.map(e => `${e.model}=${e.value}`).join(', ')}`
            });
        }
    }

    return disagreements;
};

/**
 * Get calibration data for each model
 */
export const getModelCalibrations = (
    modelNames: string[],
    trades: LoggedTrade[],
    currentCoin?: string,
    currentPattern?: string
): ModelCalibration[] => {
    const profile = computeLearningProfile(trades);

    return modelNames.map(modelName => {
        // Map model name to provider for lookup
        const providerMap: Record<string, AIProvider> = {
            'gemini': AIProvider.GEMINI,
            'deepseek': AIProvider.DEEPSEEK,
            'zhipu': AIProvider.ZHIPU,
            'groq': AIProvider.GROQ,
            'groq_new': AIProvider.GROQ_NEW
        };

        const normalizedName = modelName.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
        let provider = providerMap[normalizedName];

        // Try partial match
        if (!provider) {
            if (normalizedName.includes('gemini')) provider = AIProvider.GEMINI;
            else if (normalizedName.includes('deepseek')) provider = AIProvider.DEEPSEEK;
            else if (normalizedName.includes('zhipu')) provider = AIProvider.ZHIPU;
            else if (normalizedName.includes('groq') && normalizedName.includes('alt')) provider = AIProvider.GROQ_NEW;
            else if (normalizedName.includes('groq')) provider = AIProvider.GROQ;
        }

        if (!provider) {
            return {
                model: modelName,
                overallWinRate: 0,
                contextWinRate: null,
                contextDescription: 'No data',
                calibrationNote: 'Unknown model - no calibration data'
            };
        }

        const performance = getModelPerformance(provider);
        const overallWinRate = performance.overallStats.winRate;

        // Check coin-specific performance
        let contextWinRate: number | null = null;
        let contextDescription = '';

        if (currentCoin) {
            const coinStat = profile.bestCoins.find(c =>
                c.coin.toUpperCase() === currentCoin.toUpperCase()
            );
            if (coinStat && coinStat.count >= 3) {
                contextWinRate = coinStat.winRate;
                contextDescription = `${currentCoin}: ${coinStat.winRate}% (n=${coinStat.count})`;
            }
        }

        // Generate calibration note
        let calibrationNote = '';
        if (overallWinRate >= 60) {
            calibrationNote = `✅ Reliable (${overallWinRate.toFixed(0)}% overall)`;
        } else if (overallWinRate >= 50) {
            calibrationNote = `🟡 Average (${overallWinRate.toFixed(0)}% overall)`;
        } else if (performance.overallStats.total >= 5) {
            calibrationNote = `⚠️ Underperforming (${overallWinRate.toFixed(0)}% overall)`;
        } else {
            calibrationNote = `📊 Insufficient data (n=${performance.overallStats.total})`;
        }

        return {
            model: modelName,
            overallWinRate,
            contextWinRate,
            contextDescription,
            calibrationNote
        };
    });
};

/**
 * Find similar historical trades
 */
export const findSimilarTrades = (
    trades: LoggedTrade[],
    currentCoin?: string,
    currentDirection?: string,
    currentPattern?: string,
    limit: number = 3
): SimilarTrade[] => {
    const relevantTrades = trades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    // Score each trade by similarity
    const scored = relevantTrades.map(t => {
        let score = 0;

        if (currentCoin && t.analysis?.coinName?.toUpperCase() === currentCoin.toUpperCase()) {
            score += 3;
        }
        if (currentDirection && t.analysis?.direction === currentDirection) {
            score += 2;
        }
        if (currentPattern && t.analysis?.detectedPatternFamily?.toLowerCase().includes(currentPattern.toLowerCase())) {
            score += 2;
        }

        return { trade: t, score };
    }).filter(s => s.score > 0);

    // Sort by score and recency
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.trade.timestamp).getTime() - new Date(a.trade.timestamp).getTime();
    });

    return scored.slice(0, limit).map(s => {
        const t = s.trade;
        const lesson = t.outcome === TradeOutcome.WIN
            ? `Won: ${t.analysis?.strategy || 'Strategy worked'}`
            : `Lost: ${t.correctedStopLoss ? 'Stop loss hit' : 'Setup failed'}`;

        return {
            id: t.id,
            coin: t.analysis?.coinName || 'Unknown',
            direction: t.analysis?.direction || 'Unknown',
            pattern: t.analysis?.detectedPatternFamily || t.analysis?.marketConditions?.pattern || 'Unknown',
            outcome: t.outcome,
            lesson,
            timestamp: t.timestamp
        };
    });
};

/**
 * Generate Devil's Advocate query based on analyses
 */
export const generateDevilsAdvocateQuery = (
    analyses: { model: string; analysis: TradeAnalysis }[]
): string => {
    // Find the dominant direction
    const directions = analyses.map(a => a.analysis.direction).filter(Boolean);
    const longCount = directions.filter(d => d === 'Long').length;
    const shortCount = directions.filter(d => d === 'Short').length;

    const dominantDirection = longCount > shortCount ? 'Long' : longCount < shortCount ? 'Short' : 'Mixed';
    const oppositeDirection = dominantDirection === 'Long' ? 'Short' : dominantDirection === 'Short' ? 'Long' : null;

    // Extract common concerns
    const confidences = analyses.map(a => a.analysis.confidence).filter(Boolean);
    const hasHighConfidence = confidences.some(c => c === 'High');

    let query = '🔴 **DEVIL\'S ADVOCATE CHALLENGE:**\n';

    if (dominantDirection !== 'Mixed' && oppositeDirection) {
        query += `If all models agree on ${dominantDirection}, what would make a ${oppositeDirection} trade actually correct here?\n`;
    }

    if (hasHighConfidence) {
        query += `Why might "High" confidence be overconfident? What's the hidden risk?\n`;
    }

    query += `\n**Consider:**\n`;
    query += `- Is this a liquidity trap?\n`;
    query += `- What if the current move is a fakeout?\n`;
    query += `- Where do late longs/shorts get stopped out?\n`;

    return query;
};

/**
 * Generate comprehensive enhanced debate context
 */
export const generateEnhancedDebateContext = (
    analyses: { model: string; analysis: TradeAnalysis }[],
    trades: LoggedTrade[],
    enabledProviders: AIProvider[],
    currentRegime: MarketRegime = 'ranging',
    currentCoin?: string,
    currentPattern?: string,
    monteCarloResult?: MonteCarloResult | null
): EnhancedDebateContext => {
    // 1. Calculate model weights WITH ALL IMPROVEMENTS (recency, calibration, MC, adaptive)
    const mcForWeights = monteCarloResult ? {
        winRate: monteCarloResult.winRate,
        maxDrawdownAvg: monteCarloResult.maxDrawdownAvg,
        expectedValue: monteCarloResult.expectedValue
    } : null;
    const modelWeights = calculateDynamicWeightsWithAllImprovements(
        currentRegime,
        currentPattern || '',
        enabledProviders,
        mcForWeights
    );

    // 2. Generate performance summary
    const performanceSummary = generatePerformanceSummary();

    // 3. Analyze disagreements
    const disagreements = analyzeDisagreements(analyses);

    // 4. Get model calibrations
    const modelNames = analyses.map(a => a.model);
    const modelCalibrations = getModelCalibrations(modelNames, trades, currentCoin, currentPattern);

    // 5. Find similar trades
    const dominantDirection = analyses.find(a => a.analysis.direction)?.analysis.direction;
    const similarTrades = findSimilarTrades(trades, currentCoin, dominantDirection, currentPattern);

    // 6. Generate Devil's Advocate query
    const devilsAdvocateQuery = generateDevilsAdvocateQuery(analyses);

    // 7. Run live backtesting on similar historical setups
    const firstAnalysis = analyses[0]?.analysis;
    const backtestResult = firstAnalysis
        ? backtestSimilarSetups(firstAnalysis, trades, currentRegime)
        : undefined;

    // 8. Identify underperforming models
    const lowestPerformer = identifyLowestPerformer(enabledProviders);
    const underperformerWarning = generateModeratorUnderperformerWarning(enabledProviders);

    // 9. NEW: Collect recency-weighted stats for each provider
    const recencyWeightedStats: Record<string, RecencyWeightedStats> = {};
    for (const provider of enabledProviders) {
        recencyWeightedStats[provider] = getRecencyWeightedWinRate(provider);
    }

    // 10. NEW: Collect confidence calibration for each provider
    const confidenceCalibrations: Record<string, ConfidenceCalibrationPerModel> = {};
    for (const provider of enabledProviders) {
        confidenceCalibrations[provider] = getModelConfidenceCalibration(provider);
    }

    // 11. NEW: Get provider pair insights
    const providerPairInsights = analyzeProviderPairs(enabledProviders);

    // Build prompt injection
    let promptInjection = `
═══════════════════════════════════════════════════════════════════════
🧠 ENHANCED INTELLIGENCE LAYER (Self-Learning System)
═══════════════════════════════════════════════════════════════════════

${performanceSummary}

`;

    // Add model weights
    if (modelWeights.confidence !== 'low') {
        promptInjection += `\n📊 **DYNAMIC MODEL WEIGHTS (Rolling Window):**\n`;
        if (modelWeights.gemini > 0) promptInjection += `- Gemini: ${(modelWeights.gemini * 100).toFixed(0)}%\n`;
        if (modelWeights.deepseek > 0) promptInjection += `- DeepSeek: ${(modelWeights.deepseek * 100).toFixed(0)}%\n`;
        if (modelWeights.zhipu > 0) promptInjection += `- Zhipu: ${(modelWeights.zhipu * 100).toFixed(0)}%\n`;
        if (modelWeights.groq > 0) promptInjection += `- Groq: ${(modelWeights.groq * 100).toFixed(0)}%\n`;
        if (modelWeights.groqNew > 0) promptInjection += `- Groq (Alt): ${(modelWeights.groqNew * 100).toFixed(0)}%\n`;
        if (modelWeights.dominantModel) {
            promptInjection += `⭐ **Historically strongest model for this context: ${modelWeights.dominantModel.toUpperCase()}**\n`;
        }
    }

    // Add recency trend information
    const trendingProviders = enabledProviders.filter(p =>
        recencyWeightedStats[p]?.trendDirection === 'improving' ||
        recencyWeightedStats[p]?.trendDirection === 'declining'
    );
    if (trendingProviders.length > 0) {
        promptInjection += `\n📈 **RECENT PERFORMANCE TRENDS:**\n`;
        for (const p of trendingProviders) {
            const stats = recencyWeightedStats[p];
            const icon = stats.trendDirection === 'improving' ? '↗️' : '↘️';
            promptInjection += `${icon} ${p.toUpperCase()}: ${stats.trendDirection} (recency-weighted: ${stats.recencyWeightedWinRate}%, standard: ${stats.standardWinRate}%)\n`;
        }
    }

    // Add confidence calibration warnings
    const overconfidentProviders = enabledProviders.filter(p =>
        confidenceCalibrations[p]?.isOverconfident
    );
    if (overconfidentProviders.length > 0) {
        promptInjection += `\n⚠️ **CONFIDENCE CALIBRATION WARNINGS:**\n`;
        for (const p of overconfidentProviders) {
            const cal = confidenceCalibrations[p];
            if (cal.calibrationWarning) {
                promptInjection += `${cal.calibrationWarning}\n`;
            }
        }
    }

    // Add provider pair insights
    if (providerPairInsights) {
        promptInjection += providerPairInsights;
    }

    // Add underperformer warning
    if (underperformerWarning) {
        promptInjection += `\n${underperformerWarning}`;
    }

    // Add calibrations
    promptInjection += `\n🎯 **MODEL CALIBRATION:**\n`;
    modelCalibrations.forEach(cal => {
        promptInjection += `- ${cal.model}: ${cal.calibrationNote}`;
        if (cal.contextWinRate !== null) {
            promptInjection += ` | ${cal.contextDescription}`;
        }
        promptInjection += '\n';
    });

    // Add disagreements
    if (disagreements.length > 0) {
        promptInjection += `\n⚠️ **DETECTED DISAGREEMENTS:**\n`;
        disagreements.forEach(d => {
            const icon = d.severity === 'high' ? '🔴' : d.severity === 'medium' ? '🟡' : '🟢';
            promptInjection += `${icon} ${d.description}\n`;
        });
        promptInjection += `\n**Moderator:** You MUST address these disagreements explicitly in the debate.\n`;
    }

    // Add backtest results
    if (backtestResult && backtestResult.totalMatches >= 3) {
        promptInjection += `\n${generateBacktestPromptInjection(backtestResult)}`;
    }

    // Add Monte Carlo results
    if (monteCarloResult) {
        promptInjection += `\n${generateMonteCarloPromptInjection(monteCarloResult)}`;
    }

    // Add similar trades
    if (similarTrades.length > 0) {
        promptInjection += `\n📜 **SIMILAR HISTORICAL TRADES:**\n`;
        similarTrades.forEach(t => {
            const icon = t.outcome === TradeOutcome.WIN ? '✅' : '❌';
            promptInjection += `${icon} ${t.coin} ${t.direction} (${t.pattern}): ${t.lesson}\n`;
        });
    }

    // Add Devil's Advocate
    promptInjection += `\n${devilsAdvocateQuery}`;

    promptInjection += `\n═══════════════════════════════════════════════════════════════════════\n`;

    return {
        modelWeights,
        performanceSummary,
        disagreements,
        modelCalibrations,
        similarTrades,
        devilsAdvocateQuery,
        promptInjection,
        // New fields
        backtestResult,
        monteCarloResult: monteCarloResult || undefined,
        underperformerWarning: underperformerWarning || undefined,
        lowestPerformer,
        // Ensemble improvement fields
        recencyWeightedStats,
        confidenceCalibrations,
        providerPairInsights: providerPairInsights || undefined
    };
};


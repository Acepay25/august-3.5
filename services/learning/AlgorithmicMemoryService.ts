// AlgorithmicMemoryService.ts
// Replaces AI-based Global Memory Manager with deterministic algorithmic updates
// Saves significant tokens by processing statistics and patterns locally

import { GlobalMemory, LoggedTrade, TradeOutcome, TradeInsight } from '../../types';
import { detectRecurringMistakes } from './MistakePatternService';
import { consolidateMemory } from './MemoryConsolidationService';

/**
 * Updates Global Memory algorithmically without AI.
 * 
 * @param recentTrades - New trades to merge into memory
 * @param currentMemory - Existing global memory (Layer 3)
 * @returns Updated GlobalMemory object
 */
export const updateGlobalMemoryAlgorithmically = (
    recentTrades: LoggedTrade[],
    currentMemory?: GlobalMemory
): GlobalMemory => {

    // 1. Initialize or Clone Memory
    const memory: GlobalMemory = currentMemory ? { ...currentMemory } : {
        totalTradesAnalyzed: 0,
        familyPerformance: {},
        aiPatternMemory: [],
        userPreferences: {
            leverageDefault: 0,
            favoriteAssets: [],
            preferredSetup: ''
        },
        globalCorrections: [],
        lastUpdated: new Date().toISOString()
    };

    // Ensure strict type safety for optional property (backwards compatibility)
    if (!memory.insightKnowledgeBase) {
        memory.insightKnowledgeBase = {
            insights: [],
            lastUpdated: new Date().toISOString()
        };
    }

    // 2. Update Total Trades
    memory.totalTradesAnalyzed += recentTrades.length;
    memory.lastUpdated = new Date().toISOString();

    // 3. Update Family Performance
    // We need to re-scan all history if possible, but here we just merge new data
    // Format: "Family A: 75% WR (12/16)"

    // To do this strictly incrementally is hard without raw counters.
    // For now, we will track performance of the RECENT batch and append/overwrite.
    // A more robust system would store raw W/L counts in memory.
    // Given the constraints, we will calculate stats for the recent batch and update the text.
    // Ideally, specific family stats should be tracked in a structured way (like GranularCalibration).
    // For this implementation, we will perform a "Rolling Assessment" of the recent batch.

    const familyStats: Record<string, { wins: number; total: number }> = {};
    const assetCounts: Record<string, number> = {};
    let leverageSum: number = 0;
    let leverageCount: number = 0;

    for (const trade of recentTrades) {
        // Family Stats
        const family = trade.analysis.detectedPatternFamily ||
            trade.analysis.marketConditions?.pattern || 'Unknown';

        if (!familyStats[family]) familyStats[family] = { wins: 0, total: 0 };
        familyStats[family].total++;
        if (trade.outcome === TradeOutcome.WIN) familyStats[family].wins++;

        // Asset Counts (for preferences)
        const asset = trade.analysis.coinName || 'Unknown';
        assetCounts[asset] = (assetCounts[asset] || 0) + 1;

        // Leverage
        if (trade.leverage) {
            leverageSum += trade.leverage;
            leverageCount++;
        }
    }

    // Merge Family Stats into text format
    // Note: This replaces old strings for these families with new batch stats.
    // In a real DB we'd sum them, but here we only have the string "75% WR".
    // We will prefix with [RECENT] to indicate it's the latest batch data.
    for (const [family, stats] of Object.entries(familyStats)) {
        const wr = ((stats.wins / stats.total) * 100).toFixed(0);
        memory.familyPerformance[family] = `${wr}% WR (${stats.wins}/${stats.total} recent)`;
    }

    // 4. Update AI Pattern Memory (Using MistakePatternService)
    // We analyze the recent trades for recurring mistakes
    const recurringMistakes = detectRecurringMistakes(recentTrades);

    // Convert mistakes to "AI Pattern Memory" strings
    // e.g. "Recurring timing issue: Premature entry before confirmation (3x)"
    const newPatterns = recurringMistakes.map(m =>
        `⚠️ RECURRING MISTAKE: ${m.description} (${m.occurrences} occurrences in recent batch)`
    );

    // Keep unique patterns, favor new ones
    // We keep up to 10 insights (Legacy String Memory)
    const uniquePatterns = new Set([...newPatterns, ...memory.aiPatternMemory]);
    memory.aiPatternMemory = Array.from(uniquePatterns).slice(0, 10);

    // 4b. NEW: Integrate Structured Insights (MemoryConsolidationService)
    // Convert recurring mistakes to Structured Insights
    const newInsights: TradeInsight[] = recurringMistakes.map(m => ({
        id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        category: m.type === 'risk' ? 'risk_management' :
            m.type === 'exit' ? 'exit_strategy' :
                m.type === 'timing' ? 'entry_timing' : 'general',
        insight: m.description,
        sourceTradeId: m.affectedTrades[0] || 'batch_analysis',
        createdAt: new Date().toISOString(),
        useCount: m.occurrences
    }));

    // Add to Knowledge Base
    if (newInsights.length > 0) {
        memory.insightKnowledgeBase.insights.push(...newInsights);

        // Run Consolidation (Pruning + Aggregation)
        // Note: We use a non-async wrapper or just await it if we could.
        // Since updateGlobalMemoryAlgorithmically is synchronous in current signature,
        // we might need to rely on the async nature being handled by the caller or
        // accept that we call the logic synchronously if possible.
        // Checking MemoryConsolidationService... consolidateMemory is async.
        // We cannot await here without changing signature.
        // BUT, consolidateMemory logic (prune/aggregate) is actually synchronous array ops.
        // ONLY the wrapper was async for potential future expansion.
        // For now, to keep signature compatible, I will invoke the synchronized logic if possible
        // OR changing the signature is better effectively.
        // Looking at MemoryConsolidationService.ts, the helper functions `pruneOutdatedInsights` and `aggregateSimilarInsights` ARE synchronous.
        // So I can call them directly!

        const { pruneOutdatedInsights, aggregateSimilarInsights } = require('./MemoryConsolidationService');
        const pruned = pruneOutdatedInsights(memory.insightKnowledgeBase);
        const aggregated = aggregateSimilarInsights(pruned);

        memory.insightKnowledgeBase = {
            insights: aggregated,
            lastUpdated: new Date().toISOString()
        };

        console.log(`[AlgorithmicMemory] Consolidated Memory: ${aggregated.length} insights active.`);
    }

    // 5. Update User Preferences

    // Update Favorite Assets (Top 3 by frequency in this batch + existing)
    const sortedAssets = Object.entries(assetCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);

    const mergedAssets = Array.from(new Set([...sortedAssets, ...memory.userPreferences.favoriteAssets])).slice(0, 5);
    memory.userPreferences.favoriteAssets = mergedAssets;

    // Update Average Leverage (Moving Average-ish)
    if (leverageCount > 0) {
        const recentAvg = leverageSum / leverageCount;
        const oldAvg = memory.userPreferences.leverageDefault || recentAvg;
        // Weight new data 20%
        memory.userPreferences.leverageDefault = Math.round((oldAvg * 0.8) + (recentAvg * 0.2));
    }

    // 6. Global Corrections (Extract IF/THEN rules)
    const newCorrections: string[] = [];
    for (const trade of recentTrades) {
        if (trade.postMortem && trade.postMortem.includes('IF') && trade.postMortem.includes('THEN')) {
            // Extract the sentence containing IF/THEN
            const sentences = trade.postMortem.split(/[.!?]/);
            const rule = sentences.find(s => s.includes('IF') && s.includes('THEN'));
            if (rule) newCorrections.push(rule.trim());
        }
    }

    // Merge corrections (keep latest 10)
    memory.globalCorrections = [...newCorrections, ...memory.globalCorrections].slice(0, 10);

    return memory;
};



import { InsightKnowledgeBase, TradeInsight } from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

const PRUNING_AGE_DAYS = 90; // Prune insights older than 90 days
const PRUNING_MIN_USAGE = 3; // Keep old insights only if used at least 3 times
const SIMILARITY_THRESHOLD = 0.85; // Merge if 85% similar

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate Levenshtein Distance for string similarity
 * Returns a value between 0 (completely different) and 1 (identical)
 */
const calculateSimilarity = (s1: string, s2: string): number => {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;

    if (longerLength === 0) {
        return 1.0;
    }

    const editDistance = levenshteinDistance(longer, shorter);
    return (longerLength - editDistance) / longerLength;
};

const levenshteinDistance = (s1: string, s2: string): number => {
    const costs: number[] = new Array(s2.length + 1);

    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    return costs[s2.length];
};

// =============================================================================
// CORE SERVICES
// =============================================================================

/**
 * Prune insights that are old and rarely used.
 * Safety: Never prunes items marked as "critical" or "high severity" (though Insight type currently lacks explicit severity, we assume 'risk_management' is sensitive).
 * For now, strictly follows Age + Usage logic.
 */
export const pruneOutdatedInsights = (knowledgeBase: InsightKnowledgeBase): TradeInsight[] => {
    const now = new Date();
    const millisPerDay = 24 * 60 * 60 * 1000;

    return knowledgeBase.insights.filter(insight => {
        const createdAt = new Date(insight.createdAt);
        const ageInDays = (now.getTime() - createdAt.getTime()) / millisPerDay;

        // Condition to PRUNE:
        // 1. Older than PRUNING_AGE_DAYS
        // 2. AND Used fewer than PRUNING_MIN_USAGE times
        if (ageInDays > PRUNING_AGE_DAYS && insight.useCount < PRUNING_MIN_USAGE) {
            // Check for safety exception (e.g. maybe don't delete 'risk_management' category?)
            // For now, we apply the rule strictly as per plan.
            return false; // Remove
        }

        return true; // Keep
    });
};

/**
 * Aggregate similar insights to reduce bloat.
 * Merges A and B if high similarity:
 * - Keeps the one with higher ID (newer) or higher useCount? 
 * - Strategy: Keep the one with higher usage. If equal, keep newer.
 * - Adds usage counts together.
 */
export const aggregateSimilarInsights = (insights: TradeInsight[]): TradeInsight[] => {
    if (insights.length === 0) return [];

    // Sort by usage (desc) then date (desc) so we prioritize keeping popular/new ones
    const sorted = [...insights].sort((a, b) => {
        if (b.useCount !== a.useCount) return b.useCount - a.useCount;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const merged: TradeInsight[] = [];
    const mergedIds = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
        if (mergedIds.has(sorted[i].id)) continue;

        let master = { ...sorted[i] };

        for (let j = i + 1; j < sorted.length; j++) {
            if (mergedIds.has(sorted[j].id)) continue;

            const candidate = sorted[j];
            const similarity = calculateSimilarity(master.insight.toLowerCase(), candidate.insight.toLowerCase());

            if (similarity >= SIMILARITY_THRESHOLD) {
                // Merge candidate into master
                master.useCount += candidate.useCount;
                // We consume candidate
                mergedIds.add(candidate.id);
            }
        }

        merged.push(master);
        mergedIds.add(master.id);
    }

    return merged;
};

/**
 * Main Orchestrator
 */
export const consolidateMemory = async (knowledgeBase: InsightKnowledgeBase): Promise<InsightKnowledgeBase> => {
    // 1. Prune
    const prunedInsights = pruneOutdatedInsights(knowledgeBase);

    // 2. Aggregate
    const aggregatedInsights = aggregateSimilarInsights(prunedInsights);

    return {
        ...knowledgeBase,
        insights: aggregatedInsights,
        lastUpdated: new Date().toISOString()
    };
};

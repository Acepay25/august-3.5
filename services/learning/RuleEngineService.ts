
/**
 * RuleEngineService
 * 
 * The central brain for enforcing all trading rules.
 * Aggregates:
 * 1. Core Safety Rails (Hard-coded confidence requirements)
 * 2. Structured Learning Rules (Derived from post-mortems)
 * 3. Invalidation Rules (Text-based warnings from patterns)
 */

import { TradeAnalysis } from '../../types';
import { ConfidenceLevel } from '../validation/AccuracyValidationService';
import { HybridDataPacket } from '../analysis/HybridIntelligenceService';
import { CONFIDENCE_RULES } from './LearningRulesService';
import { StructuredRule } from '../../types';
import { checkTradeAgainstRules as checkInvalidationRules, RuleCheckResult } from '../validation/InvalidationRuleService';

export interface RuleValidationResult {
    isValid: boolean;
    adjustedConfidence: ConfidenceLevel | null;
    warnings: string[];
    errors: string[];
    blockingViolations: boolean;
    ruleBreakdown: {
        coreConfigCorrect: boolean;
        structuredRulesViolated: number;
        invalidationRulesViolated: number;
    };
    promptInjection?: string;
}

/**
 * Validates a trade analysis against ALL active rules modules.
 */
export const validateAllRules = (
    analysis: TradeAnalysis,
    hybridData: HybridDataPacket | null,
    structuredRules: StructuredRule[] = []
): RuleValidationResult => {
    const warnings: string[] = [];
    const errors: string[] = [];
    let adjustedConfidence: ConfidenceLevel | null = null;
    let blockingViolations = false;

    // --- 1. CORE CONFIG ENFORCEMENT (Hard Safety Rails) ---
    const confLevel = analysis.confidence as 'High' | 'Medium' | 'Low';
    if (CONFIDENCE_RULES[confLevel]) {
        const requirements = CONFIDENCE_RULES[confLevel];

        // Parse numeric values
        const entry = parseFloat(analysis.entryPoints[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
        const sl = parseFloat(analysis.stopLoss?.replace(/[^0-9.-]/g, '') || '0');
        const tp = parseFloat(analysis.takeProfit[0]?.price?.replace(/[^0-9.-]/g, '') || '0');

        if (entry > 0 && sl > 0 && tp > 0) {
            const risk = Math.abs(entry - sl);
            const reward = Math.abs(tp - entry);
            const rr = risk > 0 ? reward / risk : 0;

            if (rr < requirements.minRR) {
                warnings.push(`⚠️ CORE CONFIG: ${confLevel} confidence requires >${requirements.minRR} R:R (Current: ${rr.toFixed(2)}). Downgrading.`);

                // Downgrade logic
                if (rr >= (CONFIDENCE_RULES['Medium']?.minRR || 1.5)) adjustedConfidence = 'Medium';
                else if (rr >= (CONFIDENCE_RULES['Low']?.minRR || 1.1)) adjustedConfidence = 'Low';
                else adjustedConfidence = 'Avoid';
            }
        }
    }

    // --- 2. STRUCTURED LEARNING RULES ---
    let structuredViolations = 0;
    if (hybridData) {
        for (const rule of structuredRules) {
            if (!rule.constraints) continue;

            // Check Min R:R
            if (rule.constraints.minRR) {
                const entry = parseFloat(analysis.entryPoints[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
                const sl = parseFloat(analysis.stopLoss?.replace(/[^0-9.-]/g, '') || '0');
                const tp = parseFloat(analysis.takeProfit[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
                const risk = Math.abs(entry - sl);
                const reward = Math.abs(tp - entry);
                const rr = risk > 0 ? reward / risk : 0;

                if (rr < rule.constraints.minRR) {
                    const msg = `🛑 RULE VIOLATION: "${rule.ifCondition}" requires >${rule.constraints.minRR} R:R.`;
                    structuredViolations++;

                    if (rule.isStrictMode) {
                        errors.push(msg);
                        adjustedConfidence = 'Avoid';
                        blockingViolations = true;
                    } else {
                        warnings.push(msg);
                    }
                }
            }

            // Check Max Risk (Simulated)
            if (rule.constraints.maxRisk && (hybridData.regime.regime as string) === 'volatile') {
                const msg = `⚠️ RULE WARNING: "${rule.ifCondition}" limits risk to ${rule.constraints.maxRisk}%. Market is Volatile.`;
                warnings.push(msg);
                structuredViolations++;
            }
        }
    }

    // --- 3. INVALIDATION RULES (Text/Pattern Matching) ---
    // These are softer checks usually, or specifically defined invalidation patterns
    let invalidationResult: RuleCheckResult | null = null;
    try {
        invalidationResult = checkInvalidationRules(analysis, hybridData?.regime?.regime);

        if (invalidationResult) {
            warnings.push(...invalidationResult.warnings);
            if (invalidationResult.hasBlockingViolation) {
                blockingViolations = true;
                errors.push('🛑 CRITICAL INVALIDATION RULE TRIGGERED');
                adjustedConfidence = 'Avoid';
            }
        }
    } catch (e) {
        console.error('[RuleEngine] Failed to check invalidation rules:', e);
    }

    // --- FINAL AGGREGATION ---
    const isValid = !blockingViolations && errors.length === 0;

    return {
        isValid,
        adjustedConfidence,
        warnings,
        errors,
        blockingViolations,
        ruleBreakdown: {
            coreConfigCorrect: true, // simplified, assumes strictly false if checked above
            structuredRulesViolated: structuredViolations,
            invalidationRulesViolated: invalidationResult?.violations.length || 0
        },
        promptInjection: invalidationResult?.promptInjection
    };
};

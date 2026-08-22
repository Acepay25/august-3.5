
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
import { StructuredRule } from '../../types';

/**
 * Core safety rails — engineering constants, NOT learned knowledge.
 * (Moved here from the retired LearningRulesService, ROUND-25b.)
 */
export const CONFIDENCE_RULES: Record<string, { minTfAlign: number; minRR: number; minConfidenceScore: number }> = {
    'High': { minTfAlign: 3, minRR: 2.0, minConfidenceScore: 80 },
    'Medium': { minTfAlign: 2, minRR: 1.5, minConfidenceScore: 65 },
    'Low': { minTfAlign: 1, minRR: 1.1, minConfidenceScore: 40 }
};
import { checkTradeAgainstRules as checkInvalidationRules, RuleCheckResult } from '../validation/InvalidationRuleService';
import { parsePrice } from '../../utils/analysisUtils';

/**
 * A post-mortem sentence is not a hard trading rule by itself.  The notebook
 * skill system needs repeated outcome evidence before it can veto a setup.
 * Keep the legacy structured-rule path aligned with that policy.
 */
const MIN_CONFIRMED_RULE_SAMPLES = 5;

const isConfirmedLossRule = (rule: StructuredRule): boolean => {
    const sample = (rule.wins ?? 0) + (rule.losses ?? 0);
    return rule.outcome === 'LOSS'
        && rule.status === 'confirmed'
        && sample >= MIN_CONFIRMED_RULE_SAMPLES;
};

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
    let coreConfigViolated = false;
    if (CONFIDENCE_RULES[confLevel]) {
        const requirements = CONFIDENCE_RULES[confLevel];

        // parsePrice (not a digit-stripping parseFloat) — comma-formatted
        // prices ("69,000") and annotations ("94500 4h") parse correctly.
        const entry = parsePrice(analysis.entryPoints[0]?.price || '');
        const sl = parsePrice(analysis.stopLoss || '');
        const tp = parsePrice(analysis.takeProfit[0]?.price || '');

        if (isFinite(entry) && isFinite(sl) && isFinite(tp) && entry > 0 && sl > 0 && tp > 0) {
            const risk = Math.abs(entry - sl);
            const reward = Math.abs(tp - entry);
            const rr = risk > 0 ? reward / risk : 0;

            if (rr < requirements.minRR) {
                coreConfigViolated = true;
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
                const entry = parsePrice(analysis.entryPoints[0]?.price || '');
                const sl = parsePrice(analysis.stopLoss || '');
                const tp = parsePrice(analysis.takeProfit[0]?.price || '');
                const risk = Math.abs(entry - sl);
                const reward = Math.abs(tp - entry);
                const rr = risk > 0 ? reward / risk : 0;

                if (rr < rule.constraints.minRR) {
                    const msg = `🛑 RULE VIOLATION: "${rule.ifCondition}" requires >${rule.constraints.minRR} R:R.`;
                    structuredViolations++;

                    if (rule.isStrictMode && isConfirmedLossRule(rule)) {
                        errors.push(msg);
                        adjustedConfidence = 'Avoid';
                        blockingViolations = true;
                    } else {
                        warnings.push(`${msg} Advisory only until this loss pattern is confirmed by ${MIN_CONFIRMED_RULE_SAMPLES}+ matching outcomes.`);
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
            // Real result of the core R:R rail — was hardcoded `true` even
            // when the confidence requirement was violated, so consumers saw
            // a false all-clear.
            coreConfigCorrect: !coreConfigViolated,
            structuredRulesViolated: structuredViolations,
            invalidationRulesViolated: invalidationResult?.violations.length || 0
        },
        promptInjection: invalidationResult?.promptInjection
    };
};

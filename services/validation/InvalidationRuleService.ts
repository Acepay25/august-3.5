/**
 * InvalidationRuleService
 * 
 * Extracts IF/THEN rules from post-mortem analyses (Regex + LLM) and checks new trades
 * against stored rules to warn about potential violations.
 */

import { LoggedTrade, TradeAnalysis, AIProvider } from '../../types';
import { getPreferenceObject, setPreferenceObject, getPreference, PREF_KEYS } from '../infrastructure/PreferencesService';
import { extractRulesWithLLM } from '../learning/LLMRuleExtractionService';

// ========================= INTERFACES =========================

export interface InvalidationRule {
    id: string;
    condition: string; // The IF part
    action: string; // The THEN part
    fullRule: string; // Original text
    sourceTradeId: string;
    sourceProvider?: AIProvider | string;
    category: 'entry' | 'exit' | 'risk' | 'pattern' | 'regime' | 'general';
    scope?: {
        coin?: string;
        pattern?: string;
        family?: string;
        regime?: string;
    };
    timesTriggered: number;
    timesFollowed: number; // Times the rule was followed and trade won
    timesViolated: number; // Times the rule was violated
    effectiveness: number; // 0-100 based on outcomes when followed vs violated
    createdAt: string;
    isActive: boolean;
}

export interface RuleViolation {
    rule: InvalidationRule;
    severity: 'high' | 'medium' | 'low';
    matchReason: string;
}

export interface RuleCheckResult {
    violations: RuleViolation[];
    warnings: string[];
    hasBlockingViolation: boolean;
    promptInjection: string;
}

// ========================= CONSTANTS =========================

// ========================= CONSTANTS =========================

const RULES_STORAGE_KEY = 'invalidation_rules';
const MAX_RULES = 50;

// In-memory cache
let _rulesCache: InvalidationRule[] | null = null;
let _isInitialized = false;

/**
 * Initialize service - load rules into memory
 */
export const initInvalidationRuleService = async (): Promise<void> => {
    if (_isInitialized) return;

    try {
        const stored = await getPreferenceObject<InvalidationRule[]>(PREF_KEYS.INVALIDATION_RULES);
        if (stored) {
            _rulesCache = stored;
        } else {
            _rulesCache = [];
        }
        _isInitialized = true;
        console.log('[InvalidationRules] Service initialized with cached rules');
    } catch (e) {
        console.error('[InvalidationRules] Cached init failed:', e);
        _rulesCache = [];
    }
};

// Patterns for extracting IF/THEN rules from text
const RULE_PATTERNS = [
    /IF\s*\[([^\]]+)\],?\s*THEN\s*\[([^\]]+)\]/gi,
    /IF\s+([^,]+),\s*THEN\s+([^.]+)/gi,
    /when\s+([^,]+),\s*(?:always|should|must)\s+([^.]+)/gi,
    /(?:rule|lesson)[:\s]+if\s+([^,]+),?\s*then\s+([^.]+)/gi,
    /never\s+([^.]+)\s+when\s+([^.]+)/gi, // Inverted pattern
];

// Keywords for categorization
const CATEGORY_KEYWORDS = {
    entry: ['entry', 'enter', 'buy', 'long', 'short', 'wait for', 'confirmation'],
    exit: ['exit', 'close', 'take profit', 'stop loss', 'tp', 'sl', 'target'],
    risk: ['risk', 'size', 'position', 'leverage', 'reduce', 'avoid'],
    pattern: ['pattern', 'breakout', 'fake', 'false', 'structure'],
    regime: ['regime', 'trending', 'ranging', 'volatile', 'market'],
};

// ========================= CORE FUNCTIONS =========================

/**
 * Load rules from memory (must be initialized first)
 */
export function loadInvalidationRules(): InvalidationRule[] {
    if (_rulesCache) return _rulesCache;

    // Fallback for non-initialized state (e.g. tests or early call)
    try {
        const stored = localStorage.getItem(PREF_KEYS.INVALIDATION_RULES);
        if (stored) {
            _rulesCache = JSON.parse(stored);
            return _rulesCache!;
        }
    } catch (e) {
        // Ignore
    }

    return [];
}

/**
 * Save rules to storage (async)
 */
function saveInvalidationRules(rules: InvalidationRule[]): void {
    try {
        // Keep only most recent/effective rules
        const sorted = [...rules]
            .sort((a, b) => b.effectiveness - a.effectiveness)
            .slice(0, MAX_RULES);

        _rulesCache = sorted;

        // Async save
        setPreferenceObject(PREF_KEYS.INVALIDATION_RULES, sorted).catch(e =>
            console.warn('[InvalidationRules] Failed to save:', e)
        );
    } catch (e) {
        console.warn('[InvalidationRules] Failed to save:', e);
    }
}

/**
 * Extract IF/THEN rules from post-mortem text
 */
export function extractRulesFromPostMortem(
    postMortemText: string,
    trade: LoggedTrade,
    sourceProvider?: AIProvider | string
): InvalidationRule[] {
    const rules: InvalidationRule[] = [];
    const seenRules = new Set<string>();

    for (const pattern of RULE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(postMortemText)) !== null) {
            let condition = match[1]?.trim();
            let action = match[2]?.trim();

            if (!condition || !action) continue;

            // Handle inverted "never X when Y" patterns
            if (pattern.source.includes('never')) {
                const temp = condition;
                condition = action;
                action = `avoid ${temp}`;
            }

            const fullRule = `IF ${condition}, THEN ${action}`;
            const normalized = fullRule.toLowerCase();

            if (seenRules.has(normalized)) continue;
            if (condition.length < 10 || action.length < 5) continue;

            seenRules.add(normalized);

            // Categorize the rule
            const category = categorizeRule(fullRule);

            // Determine scope
            const scope: InvalidationRule['scope'] = {};
            const coinName = trade.analysis?.coinName;
            const family = trade.analysis?.detectedPatternFamily;
            const regime = trade.marketRegime;

            // Check if rule is coin-specific
            if (coinName && fullRule.toLowerCase().includes(coinName.toLowerCase().replace(/usdt?$/, ''))) {
                scope.coin = coinName;
            }

            // Check if rule is family-specific
            if (family && fullRule.toLowerCase().includes(family.toLowerCase())) {
                scope.family = family;
            }

            // Check if rule is regime-specific
            if (regime && fullRule.toLowerCase().includes(regime)) {
                scope.regime = regime;
            }

            rules.push({
                id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                condition,
                action,
                fullRule,
                sourceTradeId: trade.id,
                sourceProvider,
                category,
                scope: Object.keys(scope).length > 0 ? scope : undefined,
                timesTriggered: 0,
                timesFollowed: 0,
                timesViolated: 0,
                effectiveness: 50, // Start neutral
                createdAt: new Date().toISOString(),
                isActive: true,
            });
        }
    }

    console.log(`[InvalidationRules] Extracted ${rules.length} rules from post-mortem`);
    return rules;
}

/**
 * Categorize a rule based on keywords
 */
function categorizeRule(ruleText: string): InvalidationRule['category'] {
    const lower = ruleText.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) {
            return category as InvalidationRule['category'];
        }
    }

    return 'general';
}

/**
 * Add new rules from post-mortem
 */
/**
 * Add new rules from post-mortem (Regex + LLM)
 */
export async function addRulesFromPostMortem(
    postMortemText: string,
    trade: LoggedTrade,
    sourceProvider?: AIProvider | string
): Promise<InvalidationRule[]> {
    // 1. Regex Extraction (Fast)
    const regexRules = extractRulesFromPostMortem(postMortemText, trade, sourceProvider);

    // 2. LLM Extraction (Smart)
    let llmRules: InvalidationRule[] = [];
    try {
        const tradeContext = `Coin: ${trade.analysis.coinName}, Direction: ${trade.analysis.direction}, Outcome: ${trade.outcome}`;

        let selectedProvider: AIProvider;

        // 1. Explicit Argument
        if (sourceProvider && Object.values(AIProvider).includes(sourceProvider as AIProvider)) {
            selectedProvider = sourceProvider as AIProvider;
        }
        // 2. Fallback to User Preference
        else {
            const savedProvider = await getPreference(PREF_KEYS.MEMORY_PROVIDER);
            if (savedProvider && Object.values(AIProvider).includes(savedProvider as AIProvider)) {
                selectedProvider = savedProvider as AIProvider;
            } else {
                // 3. Default
                selectedProvider = AIProvider.GEMINI;
            }
        }

        const extracted = await extractRulesWithLLM(postMortemText, tradeContext, selectedProvider);

        llmRules = extracted.map(ex => {
            const fullRule = `IF ${ex.condition}, THEN ${ex.action}`;

            // Build scope based on extracted content or trade details
            const scope: InvalidationRule['scope'] = {
                coin: trade.analysis.coinName // default scope to coin for safety unless generic
            };
            if (ex.condition.toLowerCase().includes('any coin') || ex.category === 'general') {
                delete scope.coin;
            }

            return {
                id: `rule-llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                condition: ex.condition,
                action: ex.action,
                fullRule,
                sourceTradeId: trade.id,
                sourceProvider,
                category: ex.category,
                scope: Object.keys(scope).length > 0 ? scope : undefined,
                timesTriggered: 0,
                timesFollowed: 0,
                timesViolated: 0,
                effectiveness: ex.confidence, // Use LLM confidence as initial effectiveness
                createdAt: new Date().toISOString(),
                isActive: true,
            };
        });
        console.log(`[InvalidationRules] LLM extracted ${llmRules.length} rules.`);

    } catch (e) {
        console.error('[InvalidationRules] LLM extraction failed:', e);
    }

    // 3. Merge & Deduplicate
    const newRules = [...regexRules, ...llmRules];
    if (newRules.length === 0) return [];

    const existingRules = loadInvalidationRules();
    const rulesToAdd: InvalidationRule[] = [];

    for (const newRule of newRules) {
        const isDuplicate = existingRules.some(existing =>
            // Check against existing rules
            levenshteinSimilarity(existing.fullRule, newRule.fullRule) > 0.8
        ) || rulesToAdd.some(pending =>
            // Check against other new rules (regex vs llm overlap)
            levenshteinSimilarity(pending.fullRule, newRule.fullRule) > 0.8
        );

        if (!isDuplicate) {
            rulesToAdd.push(newRule);
        }
    }

    const allRules = [...existingRules, ...rulesToAdd];
    saveInvalidationRules(allRules);

    console.log(`[InvalidationRules] Added ${rulesToAdd.length} new rules (total: ${allRules.length})`);
    return rulesToAdd;
}

/**
 * Check a trade setup against stored rules
 */
export function checkTradeAgainstRules(
    analysis: TradeAnalysis,
    regime?: string
): RuleCheckResult {
    const rules = loadInvalidationRules().filter(r => r.isActive);
    const violations: RuleViolation[] = [];
    const warnings: string[] = [];

    for (const rule of rules) {
        // Check if rule applies to this context
        const isApplicable = isRuleApplicable(rule, analysis, regime);
        if (!isApplicable) continue;

        // Check if the current setup might violate this rule
        const violation = checkRuleViolation(rule, analysis, regime);
        if (violation) {
            violations.push(violation);

            // Track that rule was triggered
            rule.timesTriggered++;
        }
    }

    // Sort by severity
    violations.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
    });

    // Generate warnings
    for (const v of violations) {
        const severityIcon = v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟠' : '🟡';
        warnings.push(`${severityIcon} RULE VIOLATION: ${v.rule.fullRule}`);
        warnings.push(`   Reason: ${v.matchReason}`);
    }

    // Generate prompt injection
    const promptInjection = generateRuleViolationPrompt(violations);

    // Determine if there's a blocking violation (high severity with high effectiveness)
    const hasBlockingViolation = violations.some(v =>
        v.severity === 'high' && v.rule.effectiveness >= 70
    );

    // Save updated trigger counts
    const allRules = loadInvalidationRules();
    for (const rule of allRules) {
        const matchingViolation = violations.find(v => v.rule.id === rule.id);
        if (matchingViolation) {
            rule.timesTriggered++;
        }
    }
    saveInvalidationRules(allRules);

    return {
        violations,
        warnings,
        hasBlockingViolation,
        promptInjection,
    };
}

/**
 * Check if a rule applies to the current context
 */
function isRuleApplicable(
    rule: InvalidationRule,
    analysis: TradeAnalysis,
    regime?: string
): boolean {
    // If rule has scope, check if current context matches
    if (rule.scope) {
        // Coin-specific rule
        if (rule.scope.coin) {
            const currentCoin = analysis.coinName?.toUpperCase().replace(/USDT?$/, '');
            const ruleCoin = rule.scope.coin.toUpperCase().replace(/USDT?$/, '');
            if (currentCoin !== ruleCoin) return false;
        }

        // Family-specific rule
        if (rule.scope.family) {
            const currentFamily = analysis.detectedPatternFamily?.toLowerCase();
            const ruleFamily = rule.scope.family.toLowerCase();
            if (!currentFamily?.includes(ruleFamily)) return false;
        }

        // Regime-specific rule  
        if (rule.scope.regime && regime) {
            if (rule.scope.regime !== regime) return false;
        }
    }

    return true;
}

/**
 * Check if the current setup violates a specific rule
 */
function checkRuleViolation(
    rule: InvalidationRule,
    analysis: TradeAnalysis,
    regime?: string
): RuleViolation | null {
    const condition = rule.condition.toLowerCase();
    const action = rule.action.toLowerCase();

    // Build context from analysis
    const context = buildAnalysisContext(analysis, regime);

    // Check if condition is met
    const conditionMet = matchCondition(condition, context);
    if (!conditionMet) return null;

    // Check if action is being violated
    const actionViolated = isActionViolated(action, context);
    if (!actionViolated.violated) return null;

    // Determine severity based on rule effectiveness and category
    let severity: RuleViolation['severity'] = 'low';
    if (rule.effectiveness >= 70) severity = 'high';
    else if (rule.effectiveness >= 50) severity = 'medium';

    // Risk/exit rules are higher severity
    if (rule.category === 'risk' || rule.category === 'exit') {
        if (severity === 'low') severity = 'medium';
        else if (severity === 'medium') severity = 'high';
    }

    return {
        rule,
        severity,
        matchReason: actionViolated.reason || 'Setup matches conditions but action is not being followed',
    };
}

/**
 * Build a context object from analysis for matching
 */
function buildAnalysisContext(analysis: TradeAnalysis, regime?: string): Record<string, string> {
    return {
        direction: analysis.direction?.toLowerCase() || '',
        coin: analysis.coinName?.toLowerCase().replace(/usdt?$/, '') || '',
        pattern: analysis.marketConditions?.pattern?.toLowerCase() || '',
        family: analysis.detectedPatternFamily?.toLowerCase() || '',
        confidence: analysis.confidence?.toLowerCase() || '',
        rsi: analysis.marketConditions?.rsi || '',
        macd: analysis.marketConditions?.macd?.toLowerCase() || '',
        regime: regime || '',
        timeframeAlignment: analysis.marketConditions?.timeframeAlignment?.toLowerCase() || '',
    };
}

/**
 * Check if a condition matches the current context
 */
function matchCondition(condition: string, context: Record<string, string>): boolean {
    const lower = condition.toLowerCase();

    // Pattern matching keywords
    const patterns = [
        { keywords: ['rsi', 'overbought'], check: () => parseFloat(context.rsi) > 70 },
        { keywords: ['rsi', 'oversold'], check: () => parseFloat(context.rsi) < 30 },
        { keywords: ['ranging', 'regime'], check: () => context.regime === 'ranging' },
        { keywords: ['trending', 'regime'], check: () => context.regime === 'trending' },
        { keywords: ['volatile'], check: () => context.regime === 'volatile' },
        { keywords: ['low confluence', 'weak alignment'], check: () => context.timeframeAlignment.includes('1 of') || context.timeframeAlignment.includes('2 of') },
        { keywords: ['high confidence'], check: () => context.confidence === 'high' },
        { keywords: ['low confidence'], check: () => context.confidence === 'low' || context.confidence === 'avoid' },
    ];

    for (const p of patterns) {
        if (p.keywords.every(kw => lower.includes(kw))) {
            return p.check();
        }
    }

    // Fallback: check if condition contains context values
    return Object.values(context).some(v => v && lower.includes(v));
}

/**
 * Check if an action is being violated
 */
function isActionViolated(
    action: string,
    context: Record<string, string>
): { violated: boolean; reason?: string } {
    const lower = action.toLowerCase();

    // Check for "avoid" or "don't" actions
    if (lower.includes('avoid') || lower.includes("don't") || lower.includes('do not')) {
        // If action says avoid X and we're doing X, it's violated
        if (lower.includes('long') && context.direction === 'long') {
            return { violated: true, reason: 'Rule says to avoid longs in this condition' };
        }
        if (lower.includes('short') && context.direction === 'short') {
            return { violated: true, reason: 'Rule says to avoid shorts in this condition' };
        }
        if (lower.includes('trade') || lower.includes('entry')) {
            return { violated: true, reason: 'Rule suggests avoiding trades in this condition' };
        }
    }

    // Check for "wait for" actions
    if (lower.includes('wait for') || lower.includes('confirm')) {
        // Can't verify if waiting, assume violated if entering now
        return { violated: true, reason: 'Rule requires waiting for confirmation' };
    }

    // Check for "reduce" size actions
    if (lower.includes('reduce') && (lower.includes('size') || lower.includes('position'))) {
        return { violated: true, reason: 'Rule suggests reducing position size' };
    }

    return { violated: false };
}

/**
 * Generate prompt injection for rule violations
 */
function generateRuleViolationPrompt(violations: RuleViolation[]): string {
    if (violations.length === 0) return '';

    const parts: string[] = [];
    parts.push('⚠️ **INVALIDATION RULE VIOLATIONS DETECTED**\n');
    parts.push('The following rules from past post-mortems are being violated by this setup:\n');

    for (let i = 0; i < Math.min(violations.length, 3); i++) {
        const v = violations[i];
        const icon = v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟠' : '🟡';
        parts.push(`${i + 1}. ${icon} **${v.rule.fullRule}**`);
        parts.push(`   Category: ${v.rule.category} | Effectiveness: ${v.rule.effectiveness}%`);
        parts.push(`   Trigger: ${v.matchReason}`);
    }

    if (violations.some(v => v.severity === 'high')) {
        parts.push('\n**⚠️ MODERATOR WARNING:** High-severity rule violation detected. Consider skipping this trade or reducing size.');
    }

    return parts.join('\n');
}

/**
 * Record outcome and update rule effectiveness
 */
export function recordRuleOutcome(
    ruleId: string,
    wasFollowed: boolean,
    outcome: 'WIN' | 'LOSS'
): void {
    const rules = loadInvalidationRules();
    const rule = rules.find(r => r.id === ruleId);

    if (!rule) return;

    if (wasFollowed) {
        rule.timesFollowed++;
    } else {
        rule.timesViolated++;
    }

    // Recalculate effectiveness
    // Higher effectiveness = following the rule leads to better outcomes
    const total = rule.timesFollowed + rule.timesViolated;
    if (total > 0) {
        // Effectiveness = % of times following the rule correlated with wins
        // (This is simplified - in practice you'd track outcomes separately)
        if (wasFollowed && outcome === 'WIN') {
            rule.effectiveness = Math.min(100, rule.effectiveness + 5);
        } else if (!wasFollowed && outcome === 'LOSS') {
            rule.effectiveness = Math.min(100, rule.effectiveness + 5);
        } else {
            rule.effectiveness = Math.max(0, rule.effectiveness - 3);
        }
    }

    saveInvalidationRules(rules);
    console.log(`[InvalidationRules] Updated rule ${ruleId}: effectiveness=${rule.effectiveness}%`);
}

/**
 * Get rule statistics summary
 */
export function getRuleStatistics(): {
    totalRules: number;
    activeRules: number;
    byCategory: Record<string, number>;
    topEffective: InvalidationRule[];
} {
    const rules = loadInvalidationRules();

    const byCategory: Record<string, number> = {};
    for (const rule of rules) {
        byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    }

    const topEffective = [...rules]
        .filter(r => r.timesTriggered >= 2) // Only rules with data
        .sort((a, b) => b.effectiveness - a.effectiveness)
        .slice(0, 5);

    return {
        totalRules: rules.length,
        activeRules: rules.filter(r => r.isActive).length,
        byCategory,
        topEffective,
    };
}

/**
 * Simple Levenshtein similarity for deduplication
 */
function levenshteinSimilarity(a: string, b: string): number {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

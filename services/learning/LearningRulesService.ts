
/**
 * LearningRulesService - Post-Mortem Learning Enhancement
 * 
 * Automatically extracts IF/THEN rules from post-mortem analyses and
 * injects relevant rules into future trade analyses to prevent repeating mistakes.
 * 
 * Features:
 * - Extract IF/THEN rules from post-mortem text
 * - Store rules with context (coin, pattern, direction)
 * - Match and inject relevant rules into future analyses
 */

import { LoggedTrade, TradeOutcome, LearningRule, StructuredRule } from '../../types';
import { storageService, StorageKey } from '../infrastructure/StorageService';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';

/**
 * Core Confidence Validation Configuration
 * Hard-coded safety rails that override any AI hallucination
 */
export const CONFIDENCE_RULES = {
    'High': { minTfAlign: 3, minRR: 2.0, minConfidenceScore: 80 },
    'Medium': { minTfAlign: 2, minRR: 1.5, minConfidenceScore: 65 },
    'Low': { minTfAlign: 1, minRR: 1.1, minConfidenceScore: 40 }
};

/**
 * Storage structure for learning rules
 */
export interface LearningRulesStorage {
    version: number;
    rules: LearningRule[];
    lastUpdated: string;
}

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Initialize empty learning rules storage
 */
export const initializeLearningRules = (): LearningRulesStorage => ({
    version: CURRENT_SCHEMA_VERSION,
    rules: [],
    lastUpdated: new Date().toISOString()
});

/**
 * Migrate legacy data to current schema version
 */
const migrateRulesStorage = (data: any): LearningRulesStorage => {
    // If no version, it's v1
    if (!data.version) {
        console.log('[LearningRules] Migrating storage from v1 to v2');
        return {
            version: 2,
            rules: Array.isArray(data.rules) ? data.rules : [],
            lastUpdated: data.lastUpdated || new Date().toISOString()
        };
    }
    return data as LearningRulesStorage;
};

/**
 * Load rules from StorageService
 */
export const loadLearningRules = (): LearningRulesStorage => {
    // 1. Try loading from Unified Storage (Phase 2)
    const data = storageService.loadLearningRules();

    // 2. Migration Check: If Unified Storage is empty, check legacy LocalStorage key
    // This handles the transition from "learning_rules" (V1) to Unified Storage (V2)
    if (!data.rules || data.rules.length === 0) {
        try {
            const legacy = localStorage.getItem('august_learning_rules');
            if (legacy) {
                const parsed = JSON.parse(legacy);
                const migrated = migrateRulesStorage(parsed);
                // Save to new system immediately
                storageService.saveLearningRules(migrated);
                return migrated;
            }
        } catch (e) {
            console.warn('[LearningRules] Failed to check legacy storage:', e);
        }
    }

    return data;
};

/**
 * Save rules to StorageService
 */
export const saveLearningRules = (storage: LearningRulesStorage): void => {
    const storageToSave = {
        ...storage,
        version: CURRENT_SCHEMA_VERSION
    };
    storageService.saveLearningRules(storageToSave);
};

/**
 * Remove every rule derived from the given trades (trade deletion cascade) —
 * rules referencing deleted trades would otherwise describe setups that no
 * longer exist in the journal.
 */
export const removeRulesForTrades = (tradeIds: string[]): void => {
    if (tradeIds.length === 0) return;
    const idSet = new Set(tradeIds);
    const storage = loadLearningRules();
    const nextRules = storage.rules.filter(r => !idSet.has(r.sourceTradeId));
    if (nextRules.length === storage.rules.length) return;
    saveLearningRules({ ...storage, rules: nextRules, lastUpdated: new Date().toISOString() });
};

/**
 * Extract IF/THEN rules from post-mortem text
 */
export const extractIfThenRules = (
    postMortem: string,
    trade: LoggedTrade
): LearningRule[] => {
    if (!postMortem || postMortem.length < 50) return [];

    const rules: LearningRule[] = [];

    // Pattern 1: Explicit IF/THEN rules
    const ifThenPattern = /IF\s+([^,]+?),?\s*THEN\s+([^.]+)/gi;
    let match;

    while ((match = ifThenPattern.exec(postMortem)) !== null) {
        const ifCondition = match[1].trim();
        const thenAction = match[2].trim();

        if (ifCondition.length > 10 && thenAction.length > 10) {
            rules.push(createRule(ifCondition, thenAction, trade));
        }
    }

    // Pattern 2: "When X, should Y" format
    const whenShouldPattern = /When\s+([^,]+?),?\s*(?:should|must|need to)\s+([^.]+)/gi;

    while ((match = whenShouldPattern.exec(postMortem)) !== null) {
        const ifCondition = match[1].trim();
        const thenAction = match[2].trim();

        if (ifCondition.length > 10 && thenAction.length > 10) {
            rules.push(createRule(ifCondition, thenAction, trade));
        }
    }

    // Pattern 3: "Similar setups" patterns
    const similarPattern = /(?:similar|same|like this)\s+(?:setup|trade|pattern)[^.]*?(?:should|must|need to)\s+([^.]+)/gi;

    while ((match = similarPattern.exec(postMortem)) !== null) {
        const thenAction = match[1].trim();
        // Use detected pattern or general setup
        const patternName = trade.analysis.detectedPatternFamily || 'setup';
        const ifCondition = `similar ${patternName} appears`;

        if (thenAction.length > 10) {
            rules.push(createRule(ifCondition, thenAction, trade));
        }
    }

    // Pattern 4: SL/Entry improvement suggestions
    const slPattern = /(?:stop.?loss|SL)\s+(?:should|must|need to)\s+(?:be|have been)\s+([^.]+)/gi;

    while ((match = slPattern.exec(postMortem)) !== null) {
        const thenAction = `adjust stop loss to ${match[1].trim()}`;
        const ifCondition = `taking similar ${trade.analysis.direction} trade`;

        rules.push(createRule(ifCondition, thenAction, trade));
    }

    return rules;
};

/**
 * Extract Structured Rules with Regex Parsing
 * Attempts to convert text rules into machine-enforceable constraints
 */
export const extractStructuredRules = (
    postMortem: string,
    trade: LoggedTrade
): StructuredRule[] => {
    const rules = extractIfThenRules(postMortem, trade);

    return rules.map(rule => {
        const constraints: StructuredRule['constraints'] = {};
        let isStrictMode = false;

        // Parse Min R:R
        const rrMatch = rule.thenAction.match(/(?:min|minimum|at least|>)[\s\w]*(\d+(?:\.\d+)?)\s*(?:R|RR|R:R)/i);
        if (rrMatch) {
            constraints.minRR = parseFloat(rrMatch[1]);
        }

        // Parse Max Risk
        const riskMatch = rule.thenAction.match(/(?:max|maximum|risk|>)[\s\w]*(\d+(?:\.\d+)?)\s*%/i);
        if (riskMatch) {
            constraints.maxRisk = parseFloat(riskMatch[1]);
        }

        // Parse Stop Loss Type
        if (rule.thenAction.toLowerCase().includes('wide stop')) constraints.stopLossType = 'Wide';
        if (rule.thenAction.toLowerCase().includes('tight stop')) constraints.stopLossType = 'Tight';
        if (rule.thenAction.toLowerCase().includes('atr')) constraints.stopLossType = 'ATR';

        // Detect Strict Mode (imperative language)
        if (rule.thenAction.match(/must|never|always|forbidden|prohibited/i)) {
            isStrictMode = true;
        }

        return {
            ...rule,
            constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
            isStrictMode
        };
    });
};

/**
 * Helper to create a rule object
 */
const createRule = (
    ifCondition: string,
    thenAction: string,
    trade: LoggedTrade
): LearningRule => ({
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ifCondition,
    thenAction,
    sourceTradeId: trade.id,
    outcome: trade.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
    coin: trade.analysis.coinName,
    pattern: trade.analysis.detectedPatternFamily,
    direction: trade.analysis.direction === 'Neutral' ? undefined : trade.analysis.direction,
    createdAt: new Date().toISOString(),
    useCount: 0
});

/**
 * Store a new learning rule
 */
export const storeRule = (
    storage: LearningRulesStorage,
    rule: LearningRule
): LearningRulesStorage => {
    // Avoid duplicates - check if similar rule exists. The OUTCOME is part of
    // the identity: an identical IF/THEN from a WIN must not block storing the
    // +2-scored LOSS variant (the stronger rule), or vice versa.
    const isDuplicate = storage.rules.some(existing =>
        existing.ifCondition.toLowerCase() === rule.ifCondition.toLowerCase() &&
        existing.thenAction.toLowerCase() === rule.thenAction.toLowerCase() &&
        existing.outcome === rule.outcome
    );

    if (isDuplicate) {
        return storage;
    }

    // Limit total rules to prevent bloat. Evict by VALUE, not insertion order:
    // pruning the newest-100 discarded old mistake (LOSS) rules, which are the
    // most valuable — unused rules (useCount 0, PENDING/blank outcome) go first.
    // Ascending sort + slice(-maxRules) keeps the HIGHEST-priority rules.
    const maxRules = 100;
    const rules = [...storage.rules, rule];
    const prunedRules = rules.length > maxRules
        ? rules
            .map((r, index) => ({ r, index }))
            .sort((a, b) => rulePriority(a.r) - rulePriority(b.r))
            .slice(-maxRules)
            .sort((a, b) => a.index - b.index)
            .map(x => x.r)
        : rules;

    return {
        version: storage.version || CURRENT_SCHEMA_VERSION,
        rules: prunedRules,
        lastUpdated: new Date().toISOString()
    };
};

/**
 * Eviction priority (higher = keep longer): resolved mistake rules with real
 * usage beat unused PENDING/blank-outcome entries.
 */
const rulePriority = (rule: LearningRule): number => {
    let score = rule.useCount || 0;
    if (rule.outcome === 'LOSS') score += 10;
    else if (rule.outcome === 'WIN') score += 5;
    return score;
};

/**
 * Find relevant rules for a given trading context
 */
export const getRelevantRules = (
    storage: LearningRulesStorage,
    context: {
        coin?: string;
        pattern?: string;
        direction?: 'Long' | 'Short';
    },
    maxRules: number = 5
): LearningRule[] => {
    if (!storage.rules || storage.rules.length === 0) return [];

    // Score each rule by relevance
    const scoredRules = storage.rules.map(rule => {
        if (rule.status === 'retired') {
            return { rule, score: 0 };
        }

        let score = 0;

        // LOSS rules are more important (learn from mistakes)
        if (rule.outcome === 'LOSS') score += 2;

        // Coin match
        if (context.coin && rule.coin &&
            context.coin.toUpperCase().includes(rule.coin.toUpperCase())) {
            score += 3;
        }

        // Pattern match
        if (context.pattern && rule.pattern &&
            context.pattern.toLowerCase().includes(rule.pattern.toLowerCase())) {
            score += 3;
        }

        // Direction match
        if (context.direction && rule.direction === context.direction) {
            score += 2;
        }

        // Recency bonus (rules from last 30 days)
        const ruleAge = Date.now() - new Date(rule.createdAt).getTime();
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        if (ruleAge < thirtyDays) {
            score += 1;
        }

        return { rule, score };
    });

    // Sort by score and return top N
    return scoredRules
        .filter(sr => sr.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxRules)
        .map(sr => sr.rule);
};

/**
 * Generate a prompt injection with relevant learning rules
 */
export const generateLearningRulesPrompt = (
    storage: LearningRulesStorage,
    context: {
        coin?: string;
        pattern?: string;
        direction?: 'Long' | 'Short';
    }
): string => {
    const relevantRules = getRelevantRules(storage, context);

    if (relevantRules.length === 0) return '';

    const rulesText = relevantRules.map((rule, i) => {
        const source = rule.outcome === 'LOSS' ? '❌ From past LOSS' : '✅ From past WIN';
        // Unvalidated rules (never used) must not ride as MANDATORY mandates —
        // a single loss used to create a permanent "MUST" that could veto
        // unrelated setups forever.
        const validated = (rule.useCount ?? 0) > 0;
        return `${i + 1}. **IF** ${rule.ifCondition} **THEN** ${rule.thenAction}\n   (${source}${rule.coin ? ` on ${rule.coin}` : ''}${validated ? '' : ' — unvalidated: advisory only'})`;
    }).join('\n\n');

    // Track usage so rules can be validated against later outcomes (decay
    // and retirement depend on useCount). markRuleAsUsed was dead code.
    for (const rule of relevantRules) {
        try { markRuleAsUsed(storage, rule.id); } catch { /* non-fatal */ }
    }

    return `
📚 **LEARNING RULES FROM PATTERN MEMORY**

The following rules were extracted from your post-mortem analyses.
**INSTRUCTION:** Apply these rules when evaluating this trade:

${rulesText}

**INSTRUCTION:** If ANY of these IF conditions match the current setup, you MUST apply the corresponding THEN action. Reference the specific rule number in your analysis.
`;
};

/**
 * Mark a rule as used (for tracking)
 */
export const markRuleAsUsed = (
    storage: LearningRulesStorage,
    ruleId: string
): LearningRulesStorage => {
    const updatedRules = storage.rules.map(rule => {
        if (rule.id === ruleId) {
            return {
                ...rule,
                useCount: rule.useCount + 1,
                lastUsed: new Date().toISOString()
            };
        }
        return rule;
    });

    return {
        ...storage,
        rules: updatedRules,
        lastUpdated: new Date().toISOString()
    };
};

/**
 * Get statistics about learning rules
 */
export const getRulesStats = (storage: LearningRulesStorage): {
    totalRules: number;
    fromLosses: number;
    fromWins: number;
    mostUsedRule: LearningRule | null;
} => {
    if (!storage.rules || storage.rules.length === 0) {
        return { totalRules: 0, fromLosses: 0, fromWins: 0, mostUsedRule: null };
    }

    const fromLosses = storage.rules.filter(r => r.outcome === 'LOSS').length;
    const fromWins = storage.rules.filter(r => r.outcome === 'WIN').length;

    const mostUsedRule = storage.rules.reduce((max, rule) =>
        rule.useCount > (max?.useCount || 0) ? rule : max,
        storage.rules[0]
    );

    return {
        totalRules: storage.rules.length,
        fromLosses,
        fromWins,
        mostUsedRule: mostUsedRule.useCount > 0 ? mostUsedRule : null
    };
};

/**
 * Process a trade's post-mortem and extract/store rules
 */
export const processPostMortemForLearning = (
    storage: LearningRulesStorage,
    trade: LoggedTrade
): LearningRulesStorage => {
    if (!trade.postMortem) return storage;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) {
        console.log(`[LearningRules] Skip technical rules for ${trade.id} (${trade.rootCauseClass || 'classified'})`);
        return storage;
    }

    const extractedRules = extractIfThenRules(trade.postMortem, trade);

    let updatedStorage = storage;
    for (const rule of extractedRules) {
        updatedStorage = storeRule(updatedStorage, rule);
    }

    console.log(`[LearningRules] Extracted ${extractedRules.length} rules from trade ${trade.id}`);

    // Also log if we found any structured constraints
    const structured = extractStructuredRules(trade.postMortem, trade);
    const constraintCount = structured.filter(r => r.constraints).length;
    if (constraintCount > 0) {
        console.log(`[LearningRules] Parsed ${constraintCount} structured constraints from text rules.`);
    }

    return updatedStorage;
};

/**
 * After a closed WIN/LOSS, score every matching rule. Retire advice that
 * later outcomes contradict (repeat-rules that keep losing, avoid-rules
 * that keep winning).
 */
export const applyOutcomeToRules = (trade: LoggedTrade): void => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    const storage = loadLearningRules();
    if (!storage.rules?.length) return;
    const coin = trade.analysis?.coinName;
    const pattern = trade.analysis?.detectedPatternFamily;
    const direction = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : undefined;
    let changed = false;
    const next = storage.rules.map(rule => {
        if (rule.status === 'retired') return rule;
        const coinHit = !rule.coin || !coin || coin.toUpperCase().includes(rule.coin.toUpperCase());
        const patternHit = !rule.pattern || !pattern || pattern.toLowerCase().includes(rule.pattern.toLowerCase());
        const dirHit = !rule.direction || !direction || rule.direction === direction;
        if (!(coinHit && patternHit && dirHit)) return rule;
        // Need at least one actual overlap (not "all fields empty" matching everything)
        if (!rule.coin && !rule.pattern && !rule.direction) return rule;
        changed = true;
        const wins = (rule.wins ?? 0) + (trade.outcome === TradeOutcome.WIN ? 1 : 0);
        const losses = (rule.losses ?? 0) + (trade.outcome === TradeOutcome.LOSS ? 1 : 0);
        const sample = wins + losses;
        let status: LearningRule['status'] = rule.status ?? 'candidate';
        if (sample >= 6) {
            const wr = wins / sample;
            if (rule.outcome === 'WIN' && wr < 0.4) status = 'retired';
            else if (rule.outcome === 'LOSS' && wr > 0.6) status = 'retired';
            else if (sample >= 5) status = 'confirmed';
        }
        return { ...rule, wins, losses, status };
    });
    if (!changed) return;
    saveLearningRules({ ...storage, rules: next, lastUpdated: new Date().toISOString() });
};

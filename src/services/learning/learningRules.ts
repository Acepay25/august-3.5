/**
 * learningRules — the writer for the journal's when/action rule store.
 *
 * The reader (`utils/learningRulesIndex.ts`) was wired in both homes, but
 * nothing on the live settlement path constructed a `LearningRule`: the store
 * only carried legacy rows, so a new trader's prompt block was always empty.
 * The clause is already parsed from the post-mortem that becomes a skill
 * draft; this records the SAME lesson as a rule (`when` + `action`), so the
 * two views of one journal lesson cannot disagree about what was learned.
 *
 * The store is per-user (`learning_rules_v2_<user>`) and is read back by the
 * prompt index. It is bounded: a rule repeated by a later trade bumps its
 * recurrence count, and the newest 200 rules survive.
 */

import type { LearningRule } from '../../types/learning';
import type { LoggedTrade } from '../../types/trade';
import { TradeOutcome } from '../../types/enums';
import type { LessonClause } from '../../utils/lessonClause';
import { storageService } from '../infrastructure/StorageService';

const MAX_LEARNING_RULES = 200;

export const recordLearningRulesFromPostMortem = (
    trade: LoggedTrade,
    clauses: readonly LessonClause[],
): number => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return 0;
    if (clauses.length === 0) return 0;
    try {
        const now = new Date().toISOString();
        const store = storageService.loadLearningRules();
        const rules = [...store.rules];
        let written = 0;
        for (const clause of clauses.slice(0, 3)) {
            const when = clause.when.trim();
            const action = clause.action.trim();
            if (!when || !action) continue;
            const same = rules.find(r =>
                r.when.trim().toLowerCase() === when.toLowerCase()
                && r.action.trim().toLowerCase() === action.toLowerCase());
            if (same) {
                // Re-ingesting the same trade is idempotent; a different trade
                // reaching the same rule is the recurrence the count records.
                if (same.sourceTradeId === trade.id) continue;
                same.useCount = (same.useCount || 1) + 1;
                written += 1;
                continue;
            }
            rules.push({
                id: `lr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                when,
                action,
                sourceTradeId: trade.id,
                outcome: trade.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
                ...(trade.analysis?.coinName ? { coin: trade.analysis.coinName } : {}),
                ...(trade.analysis?.detectedPatternFamily ? { pattern: trade.analysis.detectedPatternFamily } : {}),
                ...(trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
                    ? { direction: trade.analysis.direction }
                    : {}),
                createdAt: now,
                useCount: 1,
                status: 'candidate',
            });
            written += 1;
        }
        if (written > 0) {
            storageService.saveLearningRules({
                rules: rules.slice(-MAX_LEARNING_RULES),
                lastUpdated: now,
                version: 2,
            });
        }
        return written;
    } catch (e) {
        // A rule write must never take down the settlement that produced it.
        console.warn('[LearningRules] could not record the journal rule:', e);
        return 0;
    }
};

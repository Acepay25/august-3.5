/**
 * Progressive verdict — parse a binding trade plan out of the moderator's
 * stream WHILE it is still being written. The authoritative parse runs once
 * the debate concludes (useAnalysisPipeline); this helper only decides
 * whether enough of the plan has arrived to render a provisional card.
 */

import { TradeAnalysis } from '../types';
import {
    parseMarkdownTradePlan,
    isBindingMarkdownPlan,
    tradePlanToAnalysis,
    sanitizeTradeAnalysis,
    stripPlanTags,
} from './analysisUtils';

/** Labeled plan fields as they appear in the moderator's stream — used to
 *  skeleton-fill the signal card line by line before the plan is binding. */
export interface VerdictPlanFields {
    coin?: string;
    direction?: string;
    entry?: string;
    stopLoss?: string;
    takeProfits?: string[];
    confidence?: string;
}

/** Pick the plan candidate the same way the binding parser does. */
const planCandidate = (fullResponseText: string, moderatorTurnText: string): string => {
    const debateEnd = fullResponseText.match(/<\/?DEBATE_END>/i);
    return debateEnd && debateEnd.index !== undefined
        ? fullResponseText.slice(debateEnd.index + debateEnd[0].length)
        : moderatorTurnText;
};

/**
 * Extract whatever labeled fields have arrived so far (direction, entry,
 * stop, TPs, confidence) — even when the plan is not yet binding. Returns
 * null until at least one field exists.
 */
export const parsePartialVerdictFields = (
    fullResponseText: string,
    moderatorTurnText: string,
): VerdictPlanFields | null => {
    const candidate = planCandidate(fullResponseText, moderatorTurnText);
    if (!candidate.trim()) return null;
    try {
        const plan = parseMarkdownTradePlan(candidate);
        if (!plan) return null;
        const fields: VerdictPlanFields = {};
        if (plan.coinName) fields.coin = plan.coinName;
        if (plan.direction) fields.direction = plan.direction;
        if (plan.entry) fields.entry = plan.entry;
        if (plan.stopLoss) fields.stopLoss = plan.stopLoss;
        const tps = plan.takeProfits?.length
            ? plan.takeProfits
            : plan.takeProfit ? [plan.takeProfit] : undefined;
        if (tps && tps.length > 0) {
            fields.takeProfits = tps.map(tp =>
                typeof tp === 'string' ? tp : `${tp.price}${tp.percentage ? ` (${tp.percentage})` : ''}`
            );
        }
        if (plan.confidence) fields.confidence = plan.confidence;
        return Object.keys(fields).length > 0 ? fields : null;
    } catch {
        return null;
    }
};

/**
 * Attempt to parse a provisional verdict from the moderator's accumulated
 * stream text. Prefers the text after a `</DEBATE_END>` marker (the plan
 * block); falls back to the moderator's current turn text. Returns null
 * until the plan is binding (direction + entry + stop + ≥1 TP, or Avoid).
 */
export const parseProvisionalVerdict = (
    fullResponseText: string,
    moderatorTurnText: string,
): TradeAnalysis | null => {
    if (!fullResponseText.trim() && !moderatorTurnText.trim()) return null;
    try {
        const candidate = planCandidate(fullResponseText, moderatorTurnText);
        if (!candidate.trim()) return null;
        const plan = parseMarkdownTradePlan(candidate);
        if (!plan || !isBindingMarkdownPlan(plan)) return null;
        return sanitizeTradeAnalysis({
            ...tradePlanToAnalysis(plan),
            strategy: stripPlanTags(candidate).slice(0, 3000),
        });
    } catch {
        // Partial plan — keep waiting for more tokens.
        return null;
    }
};

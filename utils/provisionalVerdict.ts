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
        const debateEnd = fullResponseText.match(/<\/?DEBATE_END>/i);
        const candidate = debateEnd && debateEnd.index !== undefined
            ? fullResponseText.slice(debateEnd.index + debateEnd[0].length)
            : moderatorTurnText;
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

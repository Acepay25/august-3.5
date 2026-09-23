/**
 * Pipeline stage module — trader-notebook memory context assembly.
 *
 * Extracted verbatim from useAnalysisPipeline's send path: everything the
 * analysts and moderator see from the notebook for THIS setup (matched
 * skills/doctrine under per-stage budgets, bot memory, similar-setups track
 * record, regime weighting, loss-priming rows). Pure given its inputs, so it
 * is unit-testable without mounting the hook.
 */

import { extractLessonFromPostMortem } from '../../services/learning/MemoryFilesService';
import { mineCoinFromPrompt, mineDirectionFromPrompt, minePatternFromPrompt } from '../../utils/patternMining';
import { getMemoryFilesContext } from '../../services/learning/MemoryRetrievalService';
import { buildProfileMemoryIndex } from '../../services/learning/profileMemory';
import { listRetrievedMemorySources, type MemoryRetrievalQuery, type RetrievedMemorySource } from '../../services/learning/MemoryRetrievalService';
import { getBotMemoryContext } from '../../services/bots/BotMemoryService';
import type { BotMemoryScope } from '../../types/bot';
import { buildSimilarSetupsContext, buildRegimeWeightingContext } from '../../services/learning/SetupMemoryService';
import type { HybridDataPacket } from '../../services/analysis/HybridIntelligenceService';
import { getActiveUsername } from '../../utils/activeUser';
import type { LoggedTrade } from '../../types';

// Merged cap across ALL bots' memory context — the notebook
// opening budget is 900 chars; bot memory should not dwarf it.
const BOT_MEMORY_TOTAL_CAP = 1800;

// Pattern-family + coin + direction mining lives in utils/patternMining.ts so
// the bots (services/agents/botLearning.ts) mine the SAME query — this is a
// hook module the agents layer must not import. Re-exported here because that
// is where its tests and prompt-side callers look.
export { minePatternFromPrompt };

export interface PipelineMemoryContext {
    /** Setup query that drove retrieval (also reused by verdict-stage calls). */
    memoryQuery: MemoryRetrievalQuery;
    detectedLearningCoin?: string;
    pendingDirection: 'Long' | 'Short' | 'Neutral';
    pendingPattern?: string;
    botMemoryContext: string;
    /** Analyst-audience notebook slice (stage budget: opening). */
    memoryFilesContext: string;
    /** Moderator-audience notebook slice. */
    moderatorMemoryContext: string;
    /** Analyst-audience notebook slice for the rebuttal rounds (stage budget:
     *  rebuttal). Built under the same runId as the opening slice. */
    rebuttalMemoryContext: string;
    memoryRetrieved: RetrievedMemorySource[];
    similarSetupsContext: string;
    regimeWeightingContext: string;
    lossPrimingRows: Array<{
        outcome: string | undefined;
        keyLesson: string;
        coin?: string;
        direction?: string;
        timestamp?: string;
    }>;
    /** The point-in-time cutoff this context was assembled under, if any —
     *  mirrored onto runStats.asOfMs so a simulated run records its own
     *  leak-prevention posture. Absent on live runs. */
    asOfMs?: number;
}

export const assemblePipelineMemoryContext = (
    effectiveInput: string,
    loggedTrades: LoggedTrade[],
    freshHybridData: HybridDataPacket | null | undefined,
    runId?: string,
    /** Point-in-time replay cutoff (epoch ms). When set, every journal-derived
     *  slice below (skills, similar setups/trades, loss priming) sees only
     *  what was KNOWN by that moment. Omitted ⇒ live behavior, unchanged. */
    asOfMs?: number,
    /** Model context window (tokens) — threads to the notebook slice's stage
     *  budgets. Omitted ⇒ default window, unchanged. */
    contextWindowTokens?: number,
): PipelineMemoryContext => {
    const detectedLearningCoin = mineCoinFromPrompt(effectiveInput);
    const pendingDirection = mineDirectionFromPrompt(effectiveInput);
    const pendingPattern = minePatternFromPrompt(effectiveInput);

    // TRADER NOTEBOOK: retrieve matching files, skills, similar trades
    // and rules for THIS setup — never dump the whole notebook.
    const memoryQuery: MemoryRetrievalQuery = {
        coin: detectedLearningCoin,
        direction: pendingDirection,
        family: pendingPattern,
        pattern: pendingPattern,
        regime: freshHybridData?.regime?.regime,
    };
    const botMemoryContext = (() => {
        try {
            const userKey = getActiveUsername();
            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`bots_v1_${userKey}`) : null;
            const data = raw ? JSON.parse(raw) as { bots?: Array<{ id: string; memoryScope?: BotMemoryScope }> } : null;
            if (!data?.bots?.length) return '';
            // Merge memory from EVERY enabled bot rather than
            // whichever entry happened to sort first — the debate roster may
            // not include bots[0] at all. Deduped, query-filtered per bot,
            // and capped to a merged total so N bots cannot balloon the
            // analyst prompt outside the stage-budget discipline.
            const seen = new Set<string>();
            const contexts: string[] = [];
            let used = 0;
            for (const bot of data.bots) {
                if (!bot?.id || seen.has(bot.id)) continue;
                seen.add(bot.id);
                const ctx = getBotMemoryContext(bot.id, memoryQuery, bot.memoryScope || 'global');
                if (!ctx) continue;
                if (used >= BOT_MEMORY_TOTAL_CAP) break;
                const room = BOT_MEMORY_TOTAL_CAP - used;
                const clipped = ctx.length > room ? `${ctx.slice(0, room).trimEnd()}\n…` : ctx;
                contexts.push(clipped);
                used += clipped.length;
            }
            return contexts.join('\n\n---\n\n');
        } catch { return ''; }
    })();
    // Analysts get the opening slice (independent read); the MODERATOR gets
    // the verdict slice (full skill bodies, conflict flags, runner-up skills,
    // similar trades) — the arbiter binds the decision, so it needs verdict
    // depth even though its context bundle is assembled at send time. The
    // collaboration-memory index (who the user is / how they want output) is
    // prepended to BOTH — always loaded, like the notebook slice, so the
    // seats tailor to the trader, not just the tape.
    const profileMemoryIndex = buildProfileMemoryIndex();
    const withProfile = (ctx: string): string => [profileMemoryIndex, ctx].filter(Boolean).join('\n\n---\n\n');
    const memoryFilesContext = withProfile([getMemoryFilesContext(memoryQuery, loggedTrades, 'analyst', 'opening', { runId, asOfMs, contextWindowTokens }), botMemoryContext].filter(Boolean).join('\n\n---\n\n'));
    const moderatorMemoryContext = withProfile([getMemoryFilesContext(memoryQuery, loggedTrades, 'moderator', 'verdict', { runId, asOfMs, contextWindowTokens }), botMemoryContext].filter(Boolean).join('\n\n---\n\n'));
    // Rebuttal rounds re-enter the same seats, and until now they argued with
    // ZERO retrieved memory — the 400-char rebuttal budget existed with no
    // caller. Same runId as the opening slice on purpose: the ε-holdout is
    // seeded per run, so a control run must be withheld here too or the holdout
    // group would quietly receive treatment in round 2. Deliberately lean: no
    // profile prefix and no bot memory, since the persona and openings are
    // already on the seat's context and this budget is a third of the opening's.
    const rebuttalMemoryContext = getMemoryFilesContext(memoryQuery, loggedTrades, 'analyst', 'rebuttal', { runId, asOfMs, contextWindowTokens });
    const memoryRetrieved = listRetrievedMemorySources(memoryQuery, loggedTrades, 'analyst');

    // JOURNAL-DRIVEN ACCURACY (SetupMemoryService): before the analysts
    // answer, they see their own logged track record on setups like this one.
    const similarSetupsContext = buildSimilarSetupsContext(
        { coinName: detectedLearningCoin, direction: pendingDirection, detectedPatternFamily: pendingPattern },
        loggedTrades,
        freshHybridData?.regime?.regime,
        asOfMs
    );
    const regimeWeightingContext = buildRegimeWeightingContext(
        loggedTrades,
        freshHybridData?.regime?.regime
    );

    // Loss priming rows (B4): this setup's recent closed trades, compact —
    // the debate seats recall their own losses on setups like this first.
    // Under a point-in-time cutoff, a lesson counts only once it was KNOWN
    // (post-mortem written), not merely once the trade was logged.
    const lossPrimingRows = loggedTrades
        .filter(t => (t.outcome === 'WIN' || t.outcome === 'LOSS')
            && (!detectedLearningCoin || t.analysis?.coinName?.toLowerCase() === detectedLearningCoin.toLowerCase())
            && (pendingDirection === 'Neutral' || t.analysis?.direction === pendingDirection)
            && (asOfMs === undefined || Date.parse(t.postMortemCreatedAt ?? t.timestamp) <= asOfMs))
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, 6)
        .map(t => {
            let lesson = '';
            try { lesson = extractLessonFromPostMortem(t.postMortem || ''); } catch { /* optional */ }
            return {
                outcome: t.outcome as string | undefined,
                keyLesson: lesson,
                coin: t.analysis?.coinName,
                direction: t.analysis?.direction,
                timestamp: t.timestamp,
            };
        });

    return {
        memoryQuery,
        detectedLearningCoin,
        pendingDirection,
        pendingPattern,
        botMemoryContext,
        memoryFilesContext,
        moderatorMemoryContext,
        rebuttalMemoryContext,
        memoryRetrieved,
        similarSetupsContext,
        regimeWeightingContext,
        lossPrimingRows,
        asOfMs,
    };
};

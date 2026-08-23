/**
 * Pipeline stage module — trader-notebook memory context assembly.
 *
 * Extracted verbatim from useAnalysisPipeline's send path: everything the
 * analysts and moderator see from the notebook for THIS setup (matched
 * skills/doctrine under per-stage budgets, bot memory, similar-setups track
 * record, regime weighting, loss-priming rows). Pure given its inputs, so it
 * is unit-testable without mounting the hook.
 */

import { COMMON_WORDS } from '../../constants/commonWords';
import { getMemoryFilesContext, extractLessonFromPostMortem } from '../../services/learning/MemoryFilesService';
import { listRetrievedMemorySources, type MemoryRetrievalQuery, type RetrievedMemorySource } from '../../services/learning/MemoryRetrievalService';
import { getBotMemoryContext } from '../../services/bots/BotMemoryService';
import type { BotMemoryScope } from '../../types/bot';
import { buildSimilarSetupsContext, buildRegimeWeightingContext } from '../../services/learning/SetupMemoryService';
import type { HybridDataPacket } from '../../services/analysis/HybridIntelligenceService';
import { getActiveUsername } from '../../utils/activeUser';
import type { LoggedTrade } from '../../types';

// Pattern-family keyword mining — runs at SEND time so retrieval has a family
// before the AI analysis completes (there is no analysis yet at send time).
// Falls back to undefined when no keyword matches.
export const minePatternFromPrompt = (prompt: string): string | undefined => {
    const p = prompt.toUpperCase();
    if (p.includes('FAMILY A') || p.includes('EXHAUSTION') || p.includes('TRAP') || p.includes('FAKEOUT')) return 'Family A';
    if (p.includes('FAMILY B') || p.includes('REVERSAL')) return 'Family B';
    if (p.includes('FAMILY C') || p.includes('CONTINUATION')) return 'Family C';
    if (p.includes('OMEGA') || p.includes('MOMENTUM')) return 'Family Omega';
    return undefined;
};

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
}

export const assemblePipelineMemoryContext = (
    effectiveInput: string,
    loggedTrades: LoggedTrade[],
    freshHybridData: HybridDataPacket | null | undefined,
): PipelineMemoryContext => {
    const detectedCoinRaw = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?)?/)?.[1]?.toUpperCase();
    const detectedLearningCoin = detectedCoinRaw && !COMMON_WORDS.includes(detectedCoinRaw) ? detectedCoinRaw : undefined;
    const pendingDirection = effectiveInput.toLowerCase().includes('long') ? 'Long' :
        effectiveInput.toLowerCase().includes('short') ? 'Short' : 'Neutral';
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
            const first = data?.bots?.[0];
            return first ? getBotMemoryContext(first.id, memoryQuery, first.memoryScope || 'global') : '';
        } catch { return ''; }
    })();
    // Analysts get the opening slice (independent read); the MODERATOR gets
    // the verdict slice (full skill bodies, conflict flags, runner-up skills,
    // similar trades) — the arbiter binds the decision, so it needs verdict
    // depth even though its context bundle is assembled at send time.
    const memoryFilesContext = [getMemoryFilesContext(memoryQuery, loggedTrades, 'analyst', 'opening'), botMemoryContext].filter(Boolean).join('\n\n---\n\n');
    const moderatorMemoryContext = [getMemoryFilesContext(memoryQuery, loggedTrades, 'moderator', 'verdict'), botMemoryContext].filter(Boolean).join('\n\n---\n\n');
    const memoryRetrieved = listRetrievedMemorySources(memoryQuery, loggedTrades, 'analyst');

    // JOURNAL-DRIVEN ACCURACY (SetupMemoryService): before the analysts
    // answer, they see their own logged track record on setups like this one.
    const similarSetupsContext = buildSimilarSetupsContext(
        { coinName: detectedLearningCoin, direction: pendingDirection, detectedPatternFamily: pendingPattern },
        loggedTrades,
        freshHybridData?.regime?.regime
    );
    const regimeWeightingContext = buildRegimeWeightingContext(
        loggedTrades,
        freshHybridData?.regime?.regime
    );

    // Loss priming rows (B4): this setup's recent closed trades, compact —
    // the debate seats recall their own losses on setups like this first.
    const lossPrimingRows = loggedTrades
        .filter(t => (t.outcome === 'WIN' || t.outcome === 'LOSS')
            && (!detectedLearningCoin || t.analysis?.coinName?.toLowerCase() === detectedLearningCoin.toLowerCase())
            && (pendingDirection === 'Neutral' || t.analysis?.direction === pendingDirection))
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
        memoryRetrieved,
        similarSetupsContext,
        regimeWeightingContext,
        lossPrimingRows,
    };
};

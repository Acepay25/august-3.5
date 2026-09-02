
import { Message, GlobalMemory, LoggedTrade } from '../types';

/**
 * Index-layer memory injection (Batch 5, plan §4.7 — the ZCode memory
 * pattern): a tiny always-loaded INDEX instead of the whole GlobalMemory
 * JSON dump. One line per entry with status; full content is fetched
 * on demand through the desk `recall` tool (handleRecallTool). Tokens
 * saved scale with library size; salience goes UP because each seat
 * sees a menu, not a wall.
 *
 * Migration constraint (§4.7): `familyPerformance` is genuinely read by
 * the model — it stays injected verbatim as computed stats, never demoted
 * to "call recall".
 */
const INDEX_LINE_CAP = 5;      // newest N lines per list section
const INDEX_TOTAL_CAP = 900;   // chars — snapshot-cap discipline (§2)

export const buildGlobalMemoryIndex = (globalMemory: GlobalMemory): string => {
    const lines: string[] = [];

    // familyPerformance: verbatim stats block — MUST stay injected.
    const fams = Object.entries(globalMemory.familyPerformance || {});
    if (fams.length > 0) {
        lines.push('FAMILY PERFORMANCE (win rates by setup family):');
        for (const [family, stat] of fams.slice(0, 8)) lines.push(`- ${family}: ${stat}`);
    }

    if (Array.isArray(globalMemory.aiPatternMemory) && globalMemory.aiPatternMemory.length > 0) {
        const total = globalMemory.aiPatternMemory.length;
        lines.push(`PATTERN MEMORY (newest ${Math.min(total, INDEX_LINE_CAP)} of ${total}):`);
        for (const p of globalMemory.aiPatternMemory.slice(0, INDEX_LINE_CAP)) lines.push(`- ${p}`);
    }

    if (Array.isArray(globalMemory.globalCorrections) && globalMemory.globalCorrections.length > 0) {
        const total = globalMemory.globalCorrections.length;
        lines.push(`CORRECTIONS (newest ${Math.min(total, INDEX_LINE_CAP)} of ${total}):`);
        for (const c of globalMemory.globalCorrections.slice(0, INDEX_LINE_CAP)) lines.push(`- ${c}`);
    }

    const prefs = globalMemory.userPreferences;
    if (prefs && (prefs.leverageDefault > 0 || (prefs.favoriteAssets || []).length > 0 || prefs.preferredSetup)) {
        const favs = (prefs.favoriteAssets || []).slice(0, 5).join(', ');
        lines.push(`PREFERENCES: leverage default ${prefs.leverageDefault}x${favs ? ` · favorites: ${favs}` : ''}${prefs.preferredSetup ? ` · preferred setup: ${prefs.preferredSetup}` : ''}`);
    }

    // The insight knowledge base is the wall (up to 100 full JSON records).
    // Index it: top-5 by use count, one line each — the text IS the detail
    // for a one-sentence insight. (This GlobalMemory block is maintained by
    // AlgorithmicMemoryService — the §8.1 batch folded the separate
    // InsightExtractionService/attributed-insight stores into the notebook.)
    const insights = globalMemory.insightKnowledgeBase?.insights ?? [];
    if (insights.length > 0) {
        const top = [...insights]
            .sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0))
            .slice(0, INDEX_LINE_CAP);
        lines.push(`INSIGHTS (top ${top.length} of ${insights.length} by use):`);
        for (const i of top) {
            const tags = [i.category, i.coin, i.direction].filter(Boolean).join(' · ');
            const text = i.insight.length > 120 ? `${i.insight.slice(0, 120).trimEnd()}…` : i.insight;
            lines.push(`- [${tags || 'general'}] ${text}`);
        }
    }

    if (lines.length === 0) return 'INDEX: empty (no journal history distilled yet).';
    const body = lines.join('\n');
    return body.length > INDEX_TOTAL_CAP ? `${body.slice(0, INDEX_TOTAL_CAP).trimEnd()}\n…` : body;
};

export const constructOptimizedContext = (
    recentMessages: Message[],
    threadSummary: string | undefined,
    globalMemory: GlobalMemory | undefined
): string => {
    let context = "";

    // Layer 3: Global Long-Term Memory — INDEX only (§4.7). The old
    // JSON.stringify dump scaled with library size and buried the signal;
    // seats pull detail via the recall desk tool when a setup matches.
    if (globalMemory) {
        context += `\n\n**🧠 LAYER 3: GLOBAL MEMORY INDEX (LONG-TERM — detail via the recall tool):**\nMacro-context only; one line per entry. Need the full text of any line? Call recall with its topic.\n${buildGlobalMemoryIndex(globalMemory)}\n`;
    } else {
        context += `\n\n**🧠 LAYER 3: GLOBAL MEMORY:** No global memory initialized yet.\n`;
    }

    // Layer 2: Compressed Conversation Summary - DISABLED to save tokens
    // if (threadSummary) {
    //     context += `\n\n**LAYER 2: CURRENT CONVERSATION SUMMARY**\n${threadSummary}\n`;
    // }

    // Layer 1 is implicitly handled by the message history passed to the API, 
    // but we ensure the prompt knows this is the immediate context.
    context += `\n\n**LAYER 1: IMMEDIATE CONTEXT (Recent Messages)**\nThe messages below are the most recent interactions.\n`;

    return context;
};

export const prepareTradeSummariesForGlobalMemory = (trades: LoggedTrade[]): string => {
    // Convert logged trades to the specific format for the Global Memory Manager
    return trades.map(t => {
        return JSON.stringify({
            tradeId: t.id,
            asset: t.analysis.coinName,
            direction: t.analysis.direction,
            outcome: t.outcome,
            leverage: t.leverage,
            family: t.analysis.detectedPatternFamily || t.analysis.marketConditions.pattern,
            postMortemReason: t.postMortem ? t.postMortem.substring(0, 100) + "..." : "N/A",
            timestamp: t.timestamp,
            // 150% Extended SL Zone tracking for Pattern Memory reference
            extendedSLZoneBreach: t.extendedSLZoneBreach || false,
            slZoneAlert: t.extendedSLZoneBreach
                ? "⚠️ HIT 150% EXTENDED SL ZONE - REAL LOSS IN LIVE TRADING"
                : null
        });
    }).join('\n');
};

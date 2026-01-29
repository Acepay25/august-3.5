
import { Message, GlobalMemory, LoggedTrade } from '../types';

export const constructOptimizedContext = (
    recentMessages: Message[],
    threadSummary: string | undefined,
    globalMemory: GlobalMemory | undefined
): string => {
    let context = "";

    // Layer 3: Global Long-Term Memory
    if (globalMemory) {
        context += `\n\n**🧠 LAYER 3: GLOBAL MEMORY (LONG-TERM):**\nHistorical insights from thousands of trades. Use this for macro-context only:\n${JSON.stringify(globalMemory, null, 2)}\n`;
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

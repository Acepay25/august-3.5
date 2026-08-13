import { LoggedTrade } from '../types';

const MAX_POST_MORTEM_CHARS = 2500;

/**
 * Compact, image-free trade facts for win/loss insight generation.
 * The old path JSON.stringified the full LoggedTrade (debate turns, thought
 * processes, screenshot data URLs) and routinely blew the model context.
 */
export function buildTradeInsightBrief(trade: LoggedTrade): string {
    const analysis = trade.analysis;
    const entries = (analysis?.entryPoints || [])
        .map(e => e?.price)
        .filter(Boolean)
        .join(', ') || 'N/A';
    const tps = (analysis?.takeProfit || [])
        .map(t => t?.price)
        .filter(Boolean)
        .join(', ') || 'N/A';
    const patterns = (analysis?.detectedPatterns || [])
        .map(p => p?.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
    const postMortem = (trade.postMortem || '').replace(/\s+/g, ' ').trim();
    const truncatedPm = postMortem.length > MAX_POST_MORTEM_CHARS
        ? `${postMortem.slice(0, MAX_POST_MORTEM_CHARS)}…`
        : postMortem;

    const lines = [
        `Outcome: ${trade.outcome || 'UNKNOWN'}`,
        `Asset: ${analysis?.coinName || 'Unknown'}`,
        `Direction: ${analysis?.direction || 'N/A'}`,
        `Confidence: ${analysis?.confidence || 'N/A'}`,
        `Strategy: ${analysis?.strategy || analysis?.activeStrategies?.[0] || 'N/A'}`,
        `Pattern family: ${analysis?.detectedPatternFamily || analysis?.marketConditions?.pattern || 'N/A'}`,
        patterns ? `Patterns: ${patterns}` : null,
        `Entry: ${trade.correctedEntry || entries}`,
        `Stop loss: ${trade.correctedStopLoss || analysis?.stopLoss || 'N/A'}`,
        `Take profit: ${trade.correctedTakeProfit || tps}`,
        analysis?.rrRatio != null ? `R:R: 1:${analysis.rrRatio}` : null,
        trade.leverage ? `Leverage: ${trade.leverage}x` : null,
        trade.marketRegime ? `Regime: ${trade.marketRegime}` : null,
        trade.extendedSLZoneBreach ? 'Extended SL zone: BREACHED' : null,
        trade.slOptimizationData?.missedWinDueToTightSL ? 'Missed win (tight SL): YES' : null,
        trade.pnlAmount != null ? `PnL: ${trade.pnlAmount}` : null,
        trade.pnlPercent != null ? `PnL %: ${trade.pnlPercent}` : null,
        truncatedPm ? `Post-mortem / debate findings:\n${truncatedPm}` : 'Post-mortem: not yet generated — diagnose from the setup vs outcome only.',
    ];

    return lines.filter((line): line is string => Boolean(line)).join('\n');
}

/** Recent Insights store the moderator post-mortem when it exists. */
export function insightTextForTrade(trade: LoggedTrade, fallback = ''): string {
    const postMortem = (trade.postMortem || '').trim();
    if (postMortem) return postMortem;
    return fallback.trim();
}

/** Pattern Memory must not ingest full debate reports (100 × markdown blows the window). */
export function compactInsightForPatternMemory(text: string, maxChars = 480): string {
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, maxChars).trim()}…`;
}


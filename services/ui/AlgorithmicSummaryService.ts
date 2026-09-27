// AlgorithmicSummaryService.ts
// Generates trade summaries algorithmically without AI to save tokens

import { LoggedTrade } from '../../types';
import { detectTradingSession } from '../validation/ConfidenceCalibrationService';

/**
 * Generates a structured trade summary string algorithmically.
 * Enhanced format matching post-mortem structure.
 */
export const generateAlgorithmicTradeSummary = (trade: LoggedTrade): string => {
    const lines: string[] = [];
    const analysis = trade.analysis;
    const pm = trade.postMortem || '';

    // === LINE 1: HEADER (Asset, Date, Type) ===
    const tradeTypeIcon = trade.tradeType === 'scalp' ? '⚡' : trade.tradeType === 'swing' ? '🔄' : '📊';
    const asset = analysis?.coinName || 'Unknown';
    const date = trade.timestamp
        ? new Date(trade.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
    const tradeTypeLabel = trade.tradeType ? trade.tradeType.toUpperCase() : 'TRADE';

    lines.push(`${tradeTypeIcon} ${asset} (${date}) [${tradeTypeLabel}]`);

    // === LINE 2: SETUP DETAILS (Direction, Family, Pattern) ===
    const direction = analysis?.direction?.toUpperCase() || 'N/A';
    const confidence = analysis?.confidence || 'N/A';
    const family = analysis?.detectedPatternFamily || analysis?.marketConditions?.pattern || 'Unknown Family';
    const pattern = truncateText(analysis?.activeStrategies?.[0] || analysis?.strategy || 'Unknown Pattern', 30);

    lines.push(`${direction} (${confidence}) | ${family} | ${pattern}`);

    // === LINE 3: EXECUTION (Entry, SL, TP, R:R) ===
    const entry = trade.correctedEntry || analysis?.entryPoints?.[0]?.price || 'N/A';
    const sl = trade.correctedStopLoss || analysis?.stopLoss || 'N/A';
    const tp = trade.correctedTakeProfit || analysis?.takeProfit?.[0]?.price || 'N/A';
    const rr = analysis?.rrRatio ? `1:${analysis.rrRatio}` : 'N/A';

    lines.push(`Entry: ${entry}, SL: ${sl}, TP: ${tp} | R:R ${rr}`);

    // === LINE 4: CONTEXT (Leverage, Session, Regime, Duration) ===
    const leverage = trade.leverage ? `${trade.leverage}x` : '1x';
    const session = trade.timestamp ? detectTradingSession(trade.timestamp)?.replace('_', ' ').toUpperCase() : 'UNKNOWN';
    const regime = trade.marketRegime?.toUpperCase() || 'UNKNOWN REGIME';

    // Calculate Duration
    let durStr = 'N/A';
    if (trade.timestamp && trade.postMortemCreatedAt) {
        const diffMs = new Date(trade.postMortemCreatedAt).getTime() - new Date(trade.timestamp).getTime();
        const diffMins = Math.round(diffMs / 60000);
        durStr = diffMins < 60 ? `${diffMins}m` : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
    }

    lines.push(`${leverage} | ${session || 'SESSION'} | ${regime} | Dur: ${durStr}`);

    // === LINE 5+: POST-MORTEM DETAILS ===
    if (pm) {
        // Outcome Summary
        const outcomeSummaryMatch = pm.match(/Outcome Summary:([^\n•]+)/i);
        if (outcomeSummaryMatch) {
            lines.push(`- Outcome Summary: ${outcomeSummaryMatch[1].trim()}`);
        } else {
            lines.push(`- Outcome Summary: ${trade.outcome || 'Completed'}`);
        }

        // Missed Win Flag
        const missedWinMatch = pm.match(/Missed Win Flag:([^\n•]+)/i);
        const isMissedWin = missedWinMatch
            ? missedWinMatch[1].trim()
            : (trade.slOptimizationData?.missedWinDueToTightSL ? 'YES' : 'NO');
        lines.push(`- Missed Win Flag: ${isMissedWin}`);

        // Primary Driver
        const driverMatch = pm.match(/Primary (?:Failure\/Success )?Driver:([^\n•]+)/i);
        if (driverMatch) {
            lines.push(`- Primary Driver: ${truncateText(driverMatch[1].trim(), 60)}`);
        }

        // Confidence Impact
        const impactMatch = pm.match(/Pattern Confidence Impact:([^\n•]+)/i) || pm.match(/Confidence Impact:([^\n•]+)/i);
        if (impactMatch) {
            lines.push(`- Confidence Impact: ${truncateText(impactMatch[1].trim(), 60)}`);
        } else {
            lines.push(`- Confidence Impact: N/A`);
        }

        // SL Analysis
        const originalSLMatch = pm.match(/Original SL:([^\n•-]+)/i);
        const correctedSLMatch = pm.match(/Corrected SL:([^\n•-]+)/i);
        const optimalSLMatch = pm.match(/Optimal SL:([^\n•-]+)/i);
        const rationaleMatch = pm.match(/Rationale:([^\n•]+)/i);

        lines.push(`- SL Analysis:`);
        lines.push(`  - Original SL: ${originalSLMatch ? originalSLMatch[1].trim() : (analysis?.stopLoss || 'N/A')}`);
        lines.push(`  - Corrected SL: ${correctedSLMatch ? correctedSLMatch[1].trim() : (trade.correctedStopLoss || 'N/A')}`);
        lines.push(`  - Optimal SL: ${optimalSLMatch ? optimalSLMatch[1].trim() : 'N/A'}`);
        if (rationaleMatch) {
            lines.push(`  - Rationale: ${truncateText(rationaleMatch[1].trim(), 80)}`);
        }

        // IF/THEN Rule
        const ifThenMatch = pm.match(/(?:New )?IF\/THEN Rule:([^\n]+)/i) ||
            pm.match(/IF\s*\[.+?\]\s*THEN\s*\[.+?\]/i) ||
            pm.match(/📌 Rule:([^\n]+)/i);

        let ruleText = ifThenMatch ? ifThenMatch[0].replace(/^(?:New )?IF\/THEN Rule:|📌 Rule:/i, '').trim() : '';
        // If not found, try generic search
        if (!ruleText) {
            const genericRule = pm.match(/IF .+ THEN .+/i);
            if (genericRule) ruleText = genericRule[0];
        }

        if (ruleText) {
            // Clean up bold markers
            ruleText = ruleText.replace(/^\*\*|\*\*$/g, '').trim();

            // Ensure it has the emoji
            if (!ruleText.startsWith('📌')) lines.push(`- 📌 Rule: ${truncateText(ruleText, 250)}`);
            else lines.push(`- ${truncateText(ruleText, 250)}`);
        }

    } else {
        // Fallback if no Post-Mortem data
        lines.push(`- Outcome Summary: ${trade.outcome || 'Pending'}`);
        lines.push(`- Missed Win Flag: ${trade.slOptimizationData?.missedWinDueToTightSL ? 'YES' : 'NO'}`);
        lines.push(`- Confidence Impact: N/A`);
        lines.push(`- SL Analysis:`);
        lines.push(`  - Original SL: ${analysis?.stopLoss || 'N/A'}`);
        lines.push(`  - Corrected SL: ${trade.correctedStopLoss || 'N/A'}`);
    }

    return lines.join('\n');
};

/**
 * Helper to truncate text with ellipsis, respecting word boundaries
 */
const truncateText = (text: string, maxLength: number): string => {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;

    // Cut at maxLength
    let truncated = cleaned.substring(0, maxLength);

    // Backtrack to the last space to avoid cutting words
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) { // Only backtrack if we don't lose too much text
        truncated = truncated.substring(0, lastSpace);
    }

    return truncated + '...';
};

// AlgorithmicSummaryService.ts
// Generates trade summaries algorithmically without AI to save tokens

import { LoggedTrade, TradeOutcome } from '../../types';
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

/**
 * Generates a batch of summaries for multiple trades
 */
export const generateBatchSummaries = (trades: LoggedTrade[]): Map<string, string> => {
    const summaries = new Map<string, string>();
    for (const trade of trades) {
        summaries.set(trade.id, generateAlgorithmicTradeSummary(trade));
    }
    return summaries;
};

/**
 * Generates a formatted "Recent Insights" string from multiple trades
 */
export const generateRecentInsightsContext = (trades: LoggedTrade[], maxTrades: number = 10): string => {
    if (!trades.length) return '';

    const recentTrades = trades.slice(-maxTrades);

    const summaries = recentTrades.map((trade, index) => {
        const summary = generateAlgorithmicTradeSummary(trade);
        return `═══ Trade ${index + 1} ═══\n${summary}`;
    });

    return summaries.join('\n\n');
};

/**
 * Generates Pattern Memory (Synthesis) from trade history
 * ENHANCED VERSION - Replaces AI-based generateFinalSummary
 * Includes: Executive Summary, Missed Win Analysis, Confidence Calibration, Actionable Rules
 */
export const generatePatternMemorySynthesis = (trades: LoggedTrade[]): string => {
    if (!trades.length) return '';

    // === BASIC STATS ===
    const completedTrades = trades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );
    const stats = {
        total: trades.length,
        completed: completedTrades.length,
        wins: trades.filter(t => t.outcome === TradeOutcome.WIN).length,
        losses: trades.filter(t => t.outcome === TradeOutcome.LOSS).length,
        entryNotHit: trades.filter(t => t.outcome === TradeOutcome.ENTRY_NOT_HIT).length,
        skipped: trades.filter(t => t.outcome === TradeOutcome.SKIPPED).length,
        pending: trades.filter(t => t.outcome === TradeOutcome.PENDING).length,
        missedWins: trades.filter(t => t.slOptimizationData?.missedWinDueToTightSL).length,
        extendedZoneBreaches: trades.filter(t => t.extendedSLZoneBreach).length,
    };

    const winRate = stats.completed > 0
        ? ((stats.wins / stats.completed) * 100).toFixed(1)
        : '0';

    // === PATTERN FAMILY STATS ===
    const familyStats: Record<string, { wins: number; losses: number; missedWins: number }> = {};
    for (const trade of trades) {
        const family = trade.analysis?.detectedPatternFamily || 'Unknown';
        if (!familyStats[family]) familyStats[family] = { wins: 0, losses: 0, missedWins: 0 };
        if (trade.outcome === TradeOutcome.WIN) familyStats[family].wins++;
        if (trade.outcome === TradeOutcome.LOSS) familyStats[family].losses++;
        if (trade.slOptimizationData?.missedWinDueToTightSL) familyStats[family].missedWins++;
    }

    // === CONFIDENCE CALIBRATION ===
    const confidenceStats: Record<string, { wins: number; losses: number }> = {
        High: { wins: 0, losses: 0 },
        Medium: { wins: 0, losses: 0 },
        Low: { wins: 0, losses: 0 },
        Avoid: { wins: 0, losses: 0 }
    };
    for (const trade of completedTrades) {
        const conf = trade.analysis?.confidence || 'Medium';
        if (confidenceStats[conf]) {
            if (trade.outcome === TradeOutcome.WIN) confidenceStats[conf].wins++;
            else confidenceStats[conf].losses++;
        }
    }

    // === ASSET STATS ===
    const assetStats: Record<string, { wins: number; losses: number }> = {};
    for (const trade of trades) {
        const asset = trade.analysis?.coinName || 'Unknown';
        if (!assetStats[asset]) assetStats[asset] = { wins: 0, losses: 0 };
        if (trade.outcome === TradeOutcome.WIN) assetStats[asset].wins++;
        if (trade.outcome === TradeOutcome.LOSS) assetStats[asset].losses++;
    }

    // === DIRECTION STATS ===
    const directionStats = { longWins: 0, longLosses: 0, shortWins: 0, shortLosses: 0 };
    for (const trade of completedTrades) {
        const dir = trade.analysis?.direction;
        if (dir === 'Long') {
            if (trade.outcome === TradeOutcome.WIN) directionStats.longWins++;
            else directionStats.longLosses++;
        } else if (dir === 'Short') {
            if (trade.outcome === TradeOutcome.WIN) directionStats.shortWins++;
            else directionStats.shortLosses++;
        }
    }

    // === RULE EXTRACTION & DEDUPLICATION ===
    const extractedRules = new Set<string>();

    // 1. Extract from Post-Mortems
    trades.forEach(trade => {
        if (trade.postMortem) {
            const ruleMatch = trade.postMortem.match(/(?:New )?IF\/THEN Rule:([^\n]+)/i) ||
                trade.postMortem.match(/IF\s*\[.+?\]\s*THEN\s*\[.+?\]/i) ||
                trade.postMortem.match(/📌 Rule:([^\n]+)/i);

            if (ruleMatch) {
                let ruleText = ruleMatch[1] || ruleMatch[0];
                ruleText = ruleText.replace(/^(?:New )?IF\/THEN Rule:|📌 Rule:/i, '').trim();
                // Basic cleanup
                ruleText = ruleText.replace(/^IF\s+/i, 'IF ').replace(/\s+THEN\s+/i, ', THEN ');
                if (ruleText.length > 10 && ruleText.length < 200) {
                    extractedRules.add(ruleText);
                }
            }
        }
    });

    // 2. Generate Data-Derived Rules
    const sortedFamilies = Object.entries(familyStats)
        .sort((a, b) => {
            const wrA = (a[1].wins + a[1].losses) > 0 ? a[1].wins / (a[1].wins + a[1].losses) : 0;
            const wrB = (b[1].wins + b[1].losses) > 0 ? b[1].wins / (b[1].wins + b[1].losses) : 0;
            return wrB - wrA;
        });

    // Best family rule
    if (sortedFamilies.length > 0 && (sortedFamilies[0][1].wins + sortedFamilies[0][1].losses) >= 3) {
        const best = sortedFamilies[0];
        const wr = (best[1].wins / (best[1].wins + best[1].losses) * 100).toFixed(0);
        extractedRules.add(`IF ${best[0]} setup, THEN increase confidence (${wr}% WIN RATE)`);
    }

    // Worst family rule
    if (sortedFamilies.length > 1) {
        const worst = sortedFamilies[sortedFamilies.length - 1];
        const total = worst[1].wins + worst[1].losses;
        if (total >= 3) {
            const wr = (worst[1].wins / total * 100).toFixed(0);
            if (parseInt(wr) < 45) {
                extractedRules.add(`IF ${worst[0]} setup, THEN require extra confirmation (${wr}% WIN RATE)`);
            }
        }
    }

    // Tight SL rule
    if (stats.missedWins >= 3) {
        extractedRules.add(`IF trade has tight SL (< 1.5x ATR), THEN widen to avoid missed wins`);
    }

    // Direction rule
    const longTotal = directionStats.longWins + directionStats.longLosses;
    const shortTotal = directionStats.shortWins + directionStats.shortLosses;
    if (longTotal >= 5 && shortTotal >= 5) {
        const longWR = directionStats.longWins / longTotal;
        const shortWR = directionStats.shortWins / shortTotal;
        if (longWR > shortWR + 0.15) {
            extractedRules.add(`IF market unclear, THEN prefer LONG setups (better WR)`);
        } else if (shortWR > longWR + 0.15) {
            extractedRules.add(`IF market unclear, THEN prefer SHORT setups (better WR)`);
        }
    }

    // === BUILD OUTPUT ===
    const lines: string[] = [];

    // 1. EXECUTIVE SUMMARY
    lines.push(`       📊 TRADE PERFORMANCE SYNTHESIS`);
    lines.push(``);
    lines.push(`📈 **EXECUTIVE SUMMARY**`);
    lines.push(`Total Trades: ${stats.total} | Completed: ${stats.completed}`);
    lines.push(`Win Rate: ${winRate}% (${stats.wins}W / ${stats.losses}L)`);
    lines.push(`Entry Not Hit: ${stats.entryNotHit} | Skipped: ${stats.skipped} | Pending: ${stats.pending}`);
    lines.push(``);

    // 2. MISSED WIN ANALYSIS
    const missedWinPct = stats.losses > 0
        ? ((stats.missedWins / stats.losses) * 100).toFixed(1)
        : '0';
    lines.push(`⚠️ **MISSED WIN ANALYSIS**`);
    lines.push(`Missed Wins (Tight SL): ${stats.missedWins} (${missedWinPct}% of losses)`);
    if (stats.missedWins > 0) {
        // Find which family had most missed wins
        const worstFamily = Object.entries(familyStats)
            .filter(([_, data]) => data.missedWins > 0)
            .sort((a, b) => b[1].missedWins - a[1].missedWins)[0];
        if (worstFamily) {
            lines.push(`Most Affected: ${worstFamily[0]} (${worstFamily[1].missedWins} missed)`);
        }
        lines.push(`Recommendation: Consider widening SL by 10-20%`);
    }
    lines.push(``);

    // 3. 150% ZONE BREACH ANALYSIS
    lines.push(`🚨 **150% ZONE BREACH ANALYSIS**`);
    lines.push(`Extended SL Breaches: ${stats.extendedZoneBreaches}`);
    lines.push(``);

    // 4. PATTERN FAMILY PERFORMANCE
    lines.push(`🎯 **PATTERN FAMILY PERFORMANCE**`);
    for (const [family, data] of sortedFamilies) {
        const total = data.wins + data.losses;
        if (total === 0) continue;
        const wr = ((data.wins / total) * 100).toFixed(0);
        const indicator = parseInt(wr) >= 60 ? '✅' : parseInt(wr) >= 45 ? '⚠️' : '❌';
        lines.push(`${indicator} ${family}: ${data.wins}W/${data.losses}L (${wr}%)`);
    }

    if (sortedFamilies.length > 0) {
        const best = sortedFamilies[0];
        const worst = sortedFamilies[sortedFamilies.length - 1];
        lines.push(`Best: ${best[0]} | Worst: ${worst[0]}`);
    }
    lines.push(``);

    // 5. CONFIDENCE CALIBRATION
    lines.push(`🎚️ **CONFIDENCE CALIBRATION**`);
    const sortedCalibration = Object.entries(confidenceStats).sort((a, b) => {
        // Keep customized order High -> Med -> Low -> Avoid if possible, otherwise sort by WR
        const order = { 'High': 3, 'Medium': 2, 'Low': 1, 'Avoid': 0 };
        return (order[b[0] as keyof typeof order] || 0) - (order[a[0] as keyof typeof order] || 0);
    });

    for (const [level, data] of sortedCalibration) {
        const total = data.wins + data.losses;
        if (total === 0) continue;
        const wr = ((data.wins / total) * 100).toFixed(0);
        const indicator = parseInt(wr) >= 60 ? '✅' : parseInt(wr) >= 45 ? '⚠️' : '❌';
        lines.push(`${indicator} ${level}: ${data.wins}W/${data.losses}L (${wr}%)`);
    }
    lines.push(``);

    // 6. DIRECTION BREAKDOWN
    lines.push(`📐 **DIRECTION BREAKDOWN**`);
    if (longTotal > 0) {
        const longWR = ((directionStats.longWins / longTotal) * 100).toFixed(0);
        lines.push(`LONG: ${directionStats.longWins}W/${directionStats.longLosses}L (${longWR}%)`);
    }
    if (shortTotal > 0) {
        const shortWR = ((directionStats.shortWins / shortTotal) * 100).toFixed(0);
        lines.push(`SHORT: ${directionStats.shortWins}W/${directionStats.shortLosses}L (${shortWR}%)`);
    }
    lines.push(``);

    // 7. TOP ASSETS
    lines.push(`💰 **TOP ASSETS**`);
    const sortedAssets = Object.entries(assetStats)
        .filter(([_, data]) => data.wins + data.losses > 0)
        .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
        .slice(0, 5);

    for (const [asset, data] of sortedAssets) {
        const total = data.wins + data.losses;
        const wr = ((data.wins / total) * 100).toFixed(0);
        const indicator = parseInt(wr) >= 60 ? '✅' : parseInt(wr) >= 45 ? '⚠️' : '❌';
        lines.push(`${indicator} ${asset}: ${data.wins}W/${data.losses}L (${wr}%)`);
    }
    lines.push(``);

    // 8. ACTIONABLE RULES
    lines.push(`📌 **ACTIONABLE RULES**`);
    const rulesArray = Array.from(extractedRules);
    rulesArray.forEach((rule, index) => {
        // Prevent extremely long rule lists
        if (index < 8) {
            lines.push(`${index + 1}. ${rule}`);
        }
    });
    if (rulesArray.length === 0) {
        lines.push(`(No rules extracted yet - log more trades with post-mortems)`);
    }
    lines.push(``);

    // 9. CRITICAL ADJUSTMENT
    lines.push(`🔴 **CRITICAL ADJUSTMENT**`);
    if (stats.missedWins >= 3 && stats.missedWins / stats.losses > 0.25) {
        lines.push(`PRIORITY: ${missedWinPct}% of losses were missed wins. Widen SL immediately.`);
    } else if (sortedFamilies.length > 0) {
        const worst = sortedFamilies[sortedFamilies.length - 1];
        const total = worst[1].wins + worst[1].losses;
        if (total >= 3 && worst[1].wins / total < 0.4) {
            lines.push(`PRIORITY: Avoid or require extra confirmation for ${worst[0]} setups.`);
        } else {
            lines.push(`PRIORITY: Maintain current strategy, no critical issues detected.`);
        }
    }

    return lines.join('\n');
};

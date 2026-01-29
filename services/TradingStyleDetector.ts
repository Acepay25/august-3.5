/**
 * TradingStyleDetector.ts
 * 
 * Automatically detects optimal trading style (Swing vs Scalp) based on
 * real-time market data from Hybrid Intelligence.
 */

import { HybridDataPacket } from './HybridIntelligenceService';
import { TradingStyle } from '../types';

export interface StyleDetectionResult {
    recommendedStyle: 'swing' | 'scalp';
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
    score: {
        scalp: number;
        swing: number;
    };
}

/**
 * Detect optimal trading style from Hybrid Intelligence data
 * 
 * Scalp conditions:
 * - ADX < 15 (ranging market = scalp bounces)
 * - Compression regime (breakout scalps)
 * - Near volume POC (mean reversion scalp)
 * - London/NY open sessions (high volatility windows)
 * 
 * Swing conditions:
 * - ADX > 25 (strong trending market)
 * - Clear directional structure
 * - Away from POC (trending away)
 */
export function detectTradingStyle(data: HybridDataPacket): StyleDetectionResult {
    const reasons: string[] = [];
    let scalpScore = 0;
    let swingScore = 0;

    // 1. ADX-based regime detection (most important factor)
    if (data.regime.adx < 15) {
        scalpScore += 3;
        reasons.push(`Ranging market (ADX ${data.regime.adx.toFixed(1)} < 15) → Scalp bounces`);
    } else if (data.regime.adx >= 15 && data.regime.adx < 25) {
        // Weak/transitional trend
        scalpScore += 1;
        swingScore += 1;
        reasons.push(`Weak trend (ADX ${data.regime.adx.toFixed(1)}) → Either style viable`);
    } else if (data.regime.adx >= 25) {
        swingScore += 3;
        reasons.push(`Strong trend (ADX ${data.regime.adx.toFixed(1)} > 25) → Swing with trend`);
    }

    // 2. Regime classification
    if (data.regime.regime === 'compression') {
        scalpScore += 2;
        reasons.push('Compression pattern → Breakout scalp opportunity');
    } else if (data.regime.regime === 'volatile_chop') {
        scalpScore += 1;
        reasons.push('Volatile chop → Quick scalps only');
    } else if (data.regime.regime.includes('trend_up') || data.regime.regime.includes('trend_down')) {
        swingScore += 2;
        reasons.push(`Clear ${data.regime.trendDirection} trend → Swing trade`);
    }

    // 3. Volume analysis
    if (data.advancedVolume.trend === 'high') {
        scalpScore += 1;
        reasons.push('High volume → Active scalping conditions');
    } else if (data.advancedVolume.trend === 'low') {
        swingScore += 1;
        reasons.push('Low volume → Wait for swing setup');
    }

    // 4. Session timing (kill zones indicate high volatility = scalp opportunities)
    if (data.session.isKillZone && data.session.killZoneType) {
        scalpScore += 2;
        reasons.push(`Kill zone active (${data.session.killZoneType}) → Prime scalp window`);
    } else if (data.session.volatilityExpectation === 'low') {
        swingScore += 1;
        reasons.push(`${data.session.sessionName} low volatility → Swing preferred`);
    } else if (data.session.volatilityExpectation === 'high') {
        scalpScore += 1;
        reasons.push(`High volatility session → Scalp opportunity`);
    }

    // 5. Distance to POC (Point of Control)
    const priceVsPOC = data.advancedVolume.volumeProfile.priceVsPOC;
    if (priceVsPOC === 'at') {
        scalpScore += 1;
        reasons.push('At volume POC → Mean reversion scalp');
    } else if (priceVsPOC === 'above' || priceVsPOC === 'below') {
        swingScore += 1;
        reasons.push('Away from POC → Continuation swing');
    }

    // 6. Confluence score
    if (data.confluence.score >= 70 || data.confluence.score <= 30) {
        swingScore += 1;
        reasons.push(`Strong MTF confluence (${data.confluence.score}/100) → Swing confidence`);
    } else if (data.confluence.score >= 40 && data.confluence.score <= 60) {
        scalpScore += 1;
        reasons.push('Mixed confluence → Quick scalps safer');
    }

    // Calculate final recommendation
    const recommendedStyle: 'swing' | 'scalp' = scalpScore > swingScore ? 'scalp' : 'swing';
    const diff = Math.abs(scalpScore - swingScore);
    const confidence: 'high' | 'medium' | 'low' = diff >= 4 ? 'high' : diff >= 2 ? 'medium' : 'low';

    return {
        recommendedStyle,
        confidence,
        reasons,
        score: {
            scalp: scalpScore,
            swing: swingScore
        }
    };
}

/**
 * Get effective trading style
 * If 'auto', uses Hybrid Intelligence to detect
 * Otherwise, returns the user-selected style
 */
export function getEffectiveStyle(
    configStyle: TradingStyle,
    hybridData?: HybridDataPacket
): { style: 'swing' | 'scalp'; detection?: StyleDetectionResult } {
    if (configStyle === 'auto' && hybridData) {
        const detection = detectTradingStyle(hybridData);
        return { style: detection.recommendedStyle, detection };
    }

    // User selected style directly
    return { style: configStyle === 'scalp' ? 'scalp' : 'swing' };
}

/**
 * Generate prompt injection explaining the detected trading style
 */
export function generateStyleContextPrompt(detection: StyleDetectionResult): string {
    return `
═══════════════════════════════════════════════════════════════
🎯 TRADING STYLE: ${detection.recommendedStyle.toUpperCase()} MODE (${detection.confidence.toUpperCase()} confidence)
═══════════════════════════════════════════════════════════════

**Auto-Detection Summary:**
Score: Scalp ${detection.score.scalp} vs Swing ${detection.score.swing}

**Detection Reasons:**
${detection.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Style Implications:**
${detection.recommendedStyle === 'scalp' ? `
- Focus on 1m/5m/15m timeframes
- Quick entries and exits
- Minimum R:R = 1:1.5
- Tighter stop losses (0.5-1.0× ATR)
- Target quick moves, not extended trends
` : `
- Focus on 15m/1H/4H timeframes  
- Let trades develop over hours/days
- Minimum R:R = 1:1.2
- Standard stop losses (1.0-2.0× ATR)
- Target swing moves with the trend
`}
═══════════════════════════════════════════════════════════════
`;
}

/**
 * Generate a compact style injection for the Master Prompt (non-Lens mode)
 * This is a simpler injection that gives timeframe guidance
 */
export function generateMasterPromptStyleInjection(style: 'swing' | 'scalp'): string {
    if (style === 'scalp') {
        return `
⚡ **SCALP MODE ACTIVE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIMEFRAMES: Focus on 1m, 5m, 15m (LTF priority)
ENTRIES: Quick setups, immediate execution
STOP LOSS: Tight (0.5-1.0× ATR)
MIN R:R: 1:1.5 (higher ratio for quick trades)
TARGETS: Quick moves, don't overstay
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }

    return `
🔄 **SWING MODE ACTIVE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIMEFRAMES: Focus on 15m, 1H, 4H, Daily (HTF priority)
ENTRIES: Wait for confirmation, let setup develop
STOP LOSS: Standard (1.0-2.0× ATR)
MIN R:R: 1:1.2 (standard risk/reward)
TARGETS: Swing moves with the trend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

/**
 * SchemaGenerator.ts
 * Algorithmic JSON schema generation for AI prompts.
 * This avoids hardcoded template strings and adapts to the specific trade context.
 */

import { TakeProfitTarget } from '../../../types';

interface SchemaOptions {
    includeProbabilities?: boolean;
    takeProfitCount?: number;  // How many TP levels to include
    includeReasoning?: boolean;
}

/**
 * Generates probability reasoning schema for a single level
 */
function generateReasoningSchema(level: string): object {
    return {
        indicatorBasis: `Indicator analysis for ${level}`,
        volatilityFactor: 'ATR-based volatility assessment',
        patternMemoryInfluence: 'Historical win rate for similar setups',
        aiAdjustments: 'Any manual AI corrections'
    };
}

/**
 * Generates level probabilities schema dynamically
 */
function generateProbabilitiesSchema(tpCount: number, includeReasoning: boolean): object {
    const schema: Record<string, any> = {
        slProbability: 35,
        tp1Probability: 55
    };

    // Only add TP2/TP3 if they exist in the trade
    if (tpCount >= 2) schema.tp2Probability = 40;
    if (tpCount >= 3) schema.tp3Probability = 25;

    if (includeReasoning) {
        schema.reasoning = {
            sl: generateReasoningSchema('SL'),
            tp1: generateReasoningSchema('TP1'),
            ...(tpCount >= 2 && { tp2: generateReasoningSchema('TP2') }),
            ...(tpCount >= 3 && { tp3: generateReasoningSchema('TP3') })
        };
    }

    return schema;
}

/**
 * Generates complete trade plan JSON schema algorithmically
 * Matches the structure of MASTER_TRADE_PLAN_JSON_SCHEMA but dynamically generated.
 */
export function generateTradePlanSchema(options: SchemaOptions = {}): string {
    const { includeProbabilities = true, takeProfitCount = 2, includeReasoning = true } = options;

    const baseSchema: Record<string, any> = {
        coinName: 'BTCUSDT',
        direction: 'Long/Short',
        entryPoints: [{ price: '95000', description: 'Support retest' }],
        stopLoss: '94500',
        takeProfit: Array.from({ length: takeProfitCount }, (_, i) => ({
            price: `${96000 + i * 1000}`,
            percentage: `${2 + i * 2}%`
        })),
        confidence: 'Medium',
        probability: 65,
        strategy: 'Trend continuation on pullback',
        historicalCorrelation: 'Similar to past winning setups',
        marketConditions: {
            pattern: 'Bull Flag',
            candleBehavior: 'Higher lows forming',
            timeframeAlignment: '3 of 4 bullish',
            rsi: '55',
            macd: 'Bullish crossover',
            sentiment: 'Neutral',
            prices: { '5m': '95100', '15m': '95050', '1h': '95000', '4h': '94800' }
        },
        detectedPatterns: [
            { name: 'Bull Flag', timeframe: '1h', type: 'Bullish', confidence: 'High', description: 'Consolidating above support' }
        ],
        keyLevels: {
            support: ['94500 (4h)', '94000 (1h)'],
            resistance: ['96000 (4h)', '97000 (1h)']
        },
        detectedPatternFamily: 'Family C'
    };

    // Conditionally add probabilities
    if (includeProbabilities) {
        baseSchema.levelProbabilities = generateProbabilitiesSchema(takeProfitCount, includeReasoning);
    }

    return JSON.stringify(baseSchema, null, 2);
}

/**
 * Context-aware schema generator for runtime use.
 * Examines current trade targets to generate matching schema.
 */
export function generateContextAwareSchema(takeProfit: TakeProfitTarget[]): string {
    return generateTradePlanSchema({
        includeProbabilities: true,
        takeProfitCount: takeProfit.length || 1, // Default to at least 1 TP
        includeReasoning: true
    });
}

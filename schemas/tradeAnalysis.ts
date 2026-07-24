/**
 * Zod schemas for runtime validation at provider → pipeline boundaries.
 *
 * Usage:
 *   import { TradeAnalysisSchema } from '../schemas/tradeAnalysis';
 *   const result = TradeAnalysisSchema.safeParse(aiResponse);
 *   if (!result.success) { ... handle validation errors ... }
 */

import { z } from 'zod';

// =============================================================================
// PRIMITIVE SCHEMAS
// =============================================================================

export const EntryPointSchema = z.object({
  description: z.string(),
  price: z.string(),
});

export const TakeProfitTargetSchema = z.object({
  price: z.string(),
  percentage: z.string().optional(),
  originalPercentage: z.string().optional(),
});

export const MarketConditionsSchema = z.object({
  pattern: z.string(),
  candleBehavior: z.string(),
  timeframeAlignment: z.string(),
  rsi: z.string(),
  macd: z.string(),
  sentiment: z.string(),
  prices: z.record(z.string()).optional(),
});

export const PatternDetailSchema = z.object({
  name: z.string(),
  timeframe: z.string(),
  type: z.enum(['Bullish', 'Bearish', 'Neutral']),
  confidence: z.string().optional(),
  description: z.string().optional(),
});

export const KeyLevelsSchema = z.object({
  support: z.array(z.string()),
  resistance: z.array(z.string()),
});

// =============================================================================
// DEVIL'S ADVOCATE
// =============================================================================

export const DevilsAdvocateSchema = z.object({
  bearCaseReasons: z.array(z.string()),
  failureScenarios: z.array(z.string()),
  crowdedTradeWarning: z.string().nullable(),
  riskScore: z.number().min(0).max(100),
});

// =============================================================================
// DUAL SCENARIO
// =============================================================================

export const ScenarioDefinitionSchema = z.object({
  trigger: z.string(),
  confirmation: z.string(),
  target: z.string(),
  invalidation: z.string(),
});

export const DualScenarioAnalysisSchema = z.object({
  bullish: ScenarioDefinitionSchema,
  bearish: ScenarioDefinitionSchema,
  selectedScenario: z.enum(['bullish', 'bearish', 'neutral']),
  selectionReasoning: z.string(),
  confidenceInSelection: z.number().min(0).max(100),
});

// =============================================================================
// PROBABILITY ESTIMATION
// =============================================================================

export const ProbabilityReasoningSchema = z.object({
  indicatorBasis: z.string(),
  volatilityFactor: z.string(),
  patternMemoryInfluence: z.string(),
  aiAdjustments: z.string(),
});

export const TPProbabilitySchema = z.object({
  level: z.number(),
  probability: z.number().min(0).max(100),
  reasoning: ProbabilityReasoningSchema,
});

export const LevelProbabilitiesSchema = z.object({
  slProbability: z.number().min(0).max(100),
  slReasoning: ProbabilityReasoningSchema,
  tpProbabilities: z.array(TPProbabilitySchema),
  // Legacy fields
  tp1Probability: z.number().optional(),
  tp2Probability: z.number().optional(),
  tp3Probability: z.number().optional(),
  calculationMode: z.enum(['AI', 'Algo']).optional(),
});

// =============================================================================
// GATE KEEPER RESULT
// =============================================================================

export const GateResultSchema = z.object({
  passed: z.boolean(),
  confidenceCap: z.number(),
  penalties: z.object({
    dataIntegrity: z.number(),
    patternMemory: z.number(),
    htfConflict: z.number(),
    volumeContext: z.number(),
    rawTotal: z.number(),
    effectiveTotal: z.number(),
  }),
  familyBias: z.object({
    A: z.number(),
    B: z.number(),
    C: z.number(),
    Omega: z.number(),
    reasoning: z.array(z.string()),
  }),
  suggestedDirection: z.enum(['Long', 'Short', 'Neutral']).optional(),
  warnings: z.array(z.string()),
  insights: z.array(z.string()),
});

// =============================================================================
// MAIN TRADE ANALYSIS SCHEMA
// =============================================================================

export const TradeAnalysisSchema = z.object({
  coinName: z.string().optional(),
  direction: z.enum(['Long', 'Short', 'Neutral']),
  tradeType: z.enum(['scalp', 'swing']).optional(),
  tradeTypeManualOverride: z.boolean().optional(),
  confidence: z.enum(['High', 'Medium', 'Low', 'Avoid']),
  probability: z.number().min(0).max(100),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
  strategy: z.string(),
  activeStrategies: z.array(z.string()).default([]),
  entryPoints: z.array(EntryPointSchema).min(1),
  stopLoss: z.string(),
  stopLossPercentage: z.string().optional(),
  originalStopLossPercentage: z.string().optional(),
  takeProfit: z.array(TakeProfitTargetSchema).min(1),
  marketConditions: MarketConditionsSchema,
  historicalCorrelation: z.string().default(''),
  createdAt: z.string().optional(),
  rrRatio: z.number().optional(),
  detectedPatternFamily: z.string().optional(),
  detectedPatterns: z.array(PatternDetailSchema).optional(),
  keyLevels: KeyLevelsSchema.optional(),
  isUpdate: z.boolean().optional(),
  updateInterval: z.string().optional(),
  devilsAdvocate: DevilsAdvocateSchema.optional(),
  validationWarnings: z.array(z.string()).optional(),
  originalConfidence: z.enum(['High', 'Medium', 'Low', 'Avoid']).optional(),
  entryTimingScore: z.object({
    score: z.number(),
    timingQuality: z.string(),
    suggestedEntry: z.object({
      price: z.number(),
      reason: z.string(),
    }).nullable().optional(),
  }).optional(),
  validityDurationMinutes: z.number().optional(),
  gateResult: GateResultSchema.optional(),
  dualScenarioAnalysis: DualScenarioAnalysisSchema.optional(),
  levelProbabilities: LevelProbabilitiesSchema.optional(),
  marketSnapshot: z.unknown().optional(),
});

// Inferred type from schema (should match TradeAnalysis interface)
export type ValidatedTradeAnalysis = z.infer<typeof TradeAnalysisSchema>;

// =============================================================================
// MODERATOR JSON PLAN (embedded in debate stream)
// =============================================================================

export const ModeratorPlanSchema = z.object({
  analysis: TradeAnalysisSchema,
  thoughtProcess: z.string().optional(),
});

// =============================================================================
// HELPER: Validate with friendly error messages
// =============================================================================

export function validateTradeAnalysis(data: unknown): {
  success: boolean;
  data?: ValidatedTradeAnalysis;
  errors?: string[];
} {
  const result = TradeAnalysisSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
  return { success: false, errors };
}

/**
 * Zod schemas for runtime validation at provider → pipeline boundaries.
 *
 * Two layers:
 *  - STRICT schema (TradeAnalysisSchema): exact shape, used by the lenient
 *    pipeline below as the final normalization target.
 *  - LENIENT pipeline (SanitizedTradeAnalysisSchema): accepts messy AI output
 *    (synonyms, "75%", objects-where-strings-belong) and normalizes it into a
 *    valid TradeAnalysis. This is the live boundary used by
 *    sanitizeTradeAnalysis — safeParse + semantic fixups, defaults on failure.
 */

import { z } from 'zod';
import { cleanPriceField, sanitizeJSONString } from '../utils/sanitizers';
import type { TradeAnalysis, MarketConditions, LevelProbabilities, ProbabilityReasoning } from '../types';

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
  prices: z.record(z.string(), z.string()).optional(),
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
  reasoning: z.object({
    sl: ProbabilityReasoningSchema.optional(),
    tp1: ProbabilityReasoningSchema.optional(),
    tp2: ProbabilityReasoningSchema.optional(),
    tp3: ProbabilityReasoningSchema.optional(),
  }).optional(),
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
// EVIDENCE & INVALIDATION (structured AI accountability)
// =============================================================================

export const EvidenceClaimSchema = z.object({
  claim: z.string(),
  sources: z.array(z.string()),
  state: z.enum(['observed', 'partial', 'unobserved']),
  note: z.string().optional(),
});

export const InvalidationCriterionSchema = z.object({
  level: z.string(),
  condition: z.string(),
  category: z.enum(['price', 'time', 'structure', 'signal']).optional(),
  note: z.string().optional(),
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
  evidence: z.array(EvidenceClaimSchema).optional(),
  invalidationCriteria: z.array(InvalidationCriterionSchema).optional(),
});

// =============================================================================
// LENIENT AI-BOUNDARY PIPELINE
// Accepts messy AI output and normalizes it into a valid TradeAnalysis.
// Shape coercion lives in the schema; cross-field business rules live in
// applySemanticFixups (both unit-tested in tests/tradeAnalysisSchema.test.ts).
// =============================================================================

/** ensureString semantics: null→'', string→sanitized, number/boolean→String,
 *  object→best-effort text extraction (AI often nests objects in string slots). */
export const coerceToString = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return sanitizeJSONString(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const extracted = obj.text || obj.message || obj.description || obj.value || obj.price || obj.name;
    return typeof extracted === 'string' ? sanitizeJSONString(extracted) : JSON.stringify(val);
  }
  return String(val);
};

const coercedString = (fallback = ''): z.ZodType<string> =>
  z.any().optional().transform((val) => {
    const s = coerceToString(val);
    return s || fallback;
  });

const coercedStringArray = (): z.ZodType<string[]> =>
  z.any().optional().transform((val) =>
    Array.isArray(val) ? val.map(coerceToString).filter((s) => s.length > 0) : []
  );

/**
 * Case-insensitive confidence coercion: models write "high", "HIGH",
 * "High (85%)", "MED" — normalize to the canonical union before the strict
 * match, so a legitimately confident answer isn't silently downgraded to
 * Medium/65 (the old `['High','Medium','Low','Avoid'].includes(raw.confidence)`
 * rejected every variant).
 */
export const normalizeConfidence = (s: string): 'High' | 'Medium' | 'Low' | 'Avoid' | undefined => {
  const lower = (s || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (lower.includes('avoid')) return 'Avoid';
  if (lower.includes('high')) return 'High';
  if (lower.includes('med')) return 'Medium';
  if (lower.includes('low')) return 'Low';
  return undefined;
};

/** Price extraction for entry/TP objects: a nested {value|level|price} object
 *  used to stringify to "[object Object]" and pass validation as a price. */
const cleanNestedPrice = (val: unknown): string => {
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const extracted = obj.price ?? obj.value ?? obj.level ?? obj.text;
    return cleanPriceField(extracted);
  }
  return cleanPriceField(val);
};

/** Direction synonym mapping: bull/buy→Long, bear/sell→Short, else Neutral. */
export const CoercedDirectionSchema = z.any().optional().transform((val): 'Long' | 'Short' | 'Neutral' => {
  const d = coerceToString(val).toLowerCase();
  if (d.includes('bull') || d === 'long' || d.includes('buy')) return 'Long';
  if (d.includes('bear') || d === 'short' || d.includes('sell')) return 'Short';
  return 'Neutral';
});

const CoercedEntryPointSchema = z.any().optional().transform((ep) => {
  if (typeof ep === 'string' || typeof ep === 'number') {
    return { price: cleanPriceField(String(ep)), description: '' };
  }
  const obj = (ep ?? {}) as Record<string, unknown>;
  return { price: cleanNestedPrice(obj.price), description: coerceToString(obj.description) };
});

const CoercedTakeProfitSchema = z.any().optional().transform((tp) => {
  if (typeof tp === 'string' || typeof tp === 'number') {
    return { price: cleanPriceField(String(tp)), percentage: '' };
  }
  const obj = (tp ?? {}) as Record<string, unknown>;
  return {
    price: cleanNestedPrice(obj.price),
    percentage: coerceToString(obj.percentage),
    originalPercentage: coerceToString(obj.originalPercentage),
  };
});

const CoercedPatternDetailSchema = z.any().optional().transform((p) => {
  const obj = (p ?? {}) as Record<string, unknown>;
  return {
    name: coerceToString(obj.name),
    timeframe: coerceToString(obj.timeframe),
    type: (['Bullish', 'Bearish', 'Neutral'].includes(obj.type as string) ? obj.type : 'Neutral') as 'Bullish' | 'Bearish' | 'Neutral',
    confidence: coerceToString(obj.confidence),
    description: coerceToString(obj.description),
  };
});

const DEFAULT_MARKET_CONDITIONS: MarketConditions = {
  pattern: 'N/A',
  candleBehavior: 'N/A',
  timeframeAlignment: 'N/A',
  rsi: 'N/A',
  macd: 'N/A',
  sentiment: 'N/A',
  prices: { '5m': 'N/A', '15m': 'N/A', '1h': 'N/A', '4h': 'N/A' },
};

const CoercedMarketConditionsSchema = z.any().optional().transform((val): MarketConditions => {
  if (!val || typeof val !== 'object') return { ...DEFAULT_MARKET_CONDITIONS, prices: { ...DEFAULT_MARKET_CONDITIONS.prices } };
  const mc = val as Record<string, unknown>;
  const prices = mc.prices && typeof mc.prices === 'object'
    ? Object.fromEntries(Object.entries(mc.prices as Record<string, unknown>).map(([k, v]) => [k, coerceToString(v)]))
    : { ...DEFAULT_MARKET_CONDITIONS.prices };
  return {
    pattern: coerceToString(mc.pattern) || 'N/A',
    candleBehavior: coerceToString(mc.candleBehavior) || 'N/A',
    timeframeAlignment: coerceToString(mc.timeframeAlignment) || 'N/A',
    rsi: coerceToString(mc.rsi) || 'N/A',
    macd: coerceToString(mc.macd) || 'N/A',
    sentiment: coerceToString(mc.sentiment) || 'N/A',
    prices,
  };
});

/**
 * Lenient shape coercion for raw AI analysis output. Cross-field business
 * rules (probability↔confidence coupling, family fallback, legacy bridging)
 * are applied afterwards by applySemanticFixups.
 */
export const CoercedTradeAnalysisSchema = z.object({
  coinName: z.any().optional().transform((v) => coerceToString(v ?? 'Unknown Asset') || 'Unknown Asset'),
  direction: CoercedDirectionSchema,
  tradeType: z.any().optional().transform((v) => (v === 'scalp' || v === 'swing' ? v : undefined)),
  tradeTypeManualOverride: z.any().optional().transform((v) => (typeof v === 'boolean' ? v : undefined)),
  confidence: coercedString(),
  probability: z.any().optional(),
  grade: z.any().optional().transform((v) =>
    typeof v === 'string' && ['A', 'B', 'C', 'D', 'F'].includes(v.toUpperCase())
      ? (v.toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'F')
      : undefined
  ),
  strategy: coercedString(),
  activeStrategies: coercedStringArray(),
  entryPoints: z.any().optional().transform((v) => {
    if (Array.isArray(v)) {
      return v.map((ep) => CoercedEntryPointSchema.parse(ep)).filter((ep) => ep.price !== '');
    }
    // A bare price ("95000") or object ({ price: 95000 }) — wrap into a
    // single entry instead of silently dropping the value to [].
    if (v !== undefined && v !== null && v !== '') {
      return [CoercedEntryPointSchema.parse({ price: v })].filter((ep) => ep.price !== '');
    }
    return [];
  }),
  stopLoss: z.any().optional().transform((v): string => {
    // Objects ("{level: 94500}") used to become the literal string
    // "[object Object]" — extract the level/price field before cleaning.
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const extracted = obj.level ?? obj.price ?? obj.value ?? obj.text;
      if (typeof extracted === 'number' || typeof extracted === 'string') {
        return cleanPriceField(extracted);
      }
    }
    return cleanPriceField(v);
  }),
  stopLossPercentage: coercedString(),
  originalStopLossPercentage: coercedString(),
  takeProfit: z.any().optional().transform((v) => {
    if (Array.isArray(v)) {
      return v.map((tp) => CoercedTakeProfitSchema.parse(tp)).filter((tp) => tp.price !== '');
    }
    // A bare price ("96000") — wrap into a single TP.
    if (v !== undefined && v !== null && v !== '') {
      return [CoercedTakeProfitSchema.parse({ price: v })].filter((tp) => tp.price !== '');
    }
    return [];
  }),
  marketConditions: CoercedMarketConditionsSchema,
  historicalCorrelation: coercedString(),
  createdAt: z.any().optional().transform((v) => (typeof v === 'string' && v ? v : new Date().toISOString())),
  rrRatio: z.any().optional().transform((v): number | undefined => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const parsed = parseFloat(v);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }),
  detectedPatternFamily: coercedString(),
  detectedPatterns: z.any().optional().transform((v) =>
    Array.isArray(v) ? v.map((p) => CoercedPatternDetailSchema.parse(p)) : []
  ),
  keyLevels: z.any().optional().transform((v) => {
    if (!v || typeof v !== 'object') return { support: [] as string[], resistance: [] as string[] };
    const kl = v as Record<string, unknown>;
    return {
      support: Array.isArray(kl.support) ? kl.support.map(coerceToString) : [],
      resistance: Array.isArray(kl.resistance) ? kl.resistance.map(coerceToString) : [],
    };
  }),
  isUpdate: z.any().optional().transform((v) => v === true || v === 'true'),
  updateInterval: z.any().optional().transform((v) => (v ? coerceToString(v) || undefined : undefined)),
  validityDurationMinutes: z.any().optional().transform((v): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return !isNaN(n) && n > 0 ? Math.round(n) : undefined;
  }),
  // Complex sub-objects pass through raw; applySemanticFixups validates them.
  devilsAdvocate: z.any().optional(),
  validationWarnings: z.any().optional().transform((v) =>
    Array.isArray(v) ? v.map(coerceToString) : undefined
  ),
  originalConfidence: z.any().optional().transform((v) =>
    typeof v === 'string' ? normalizeConfidence(v) : undefined
  ),
  entryTimingScore: z.any().optional(),
  gateResult: z.any().optional(),
  dualScenarioAnalysis: z.any().optional(),
  levelProbabilities: z.any().optional(),
  marketSnapshot: z.any().optional(),
  evidence: z.any().optional(),
  invalidationCriteria: z.any().optional(),
  analystConsensus: z.any().optional(),
});

export type CoercedTradeAnalysis = z.infer<typeof CoercedTradeAnalysisSchema>;

/** Safe defaults returned when parsing fails entirely. */
export const createDefaultTradeAnalysis = (): TradeAnalysis => ({
  coinName: 'Unknown Asset',
  direction: 'Neutral',
  confidence: 'Medium',
  probability: 65, // Default to Medium/65 to prevent the "always 15%" bug
  strategy: 'Analysis unavailable',
  activeStrategies: [],
  entryPoints: [],
  stopLoss: '',
  takeProfit: [],
  marketConditions: { ...DEFAULT_MARKET_CONDITIONS, prices: { ...DEFAULT_MARKET_CONDITIONS.prices } },
  historicalCorrelation: 'N/A',
  createdAt: new Date().toISOString(),
  detectedPatternFamily: undefined,
  detectedPatterns: [],
  keyLevels: { support: [], resistance: [] },
  isUpdate: false,
  updateInterval: undefined,
});

const DEFAULT_PROBABILITY_REASONING: ProbabilityReasoning = {
  indicatorBasis: '',
  volatilityFactor: '',
  patternMemoryInfluence: '',
  aiAdjustments: '',
};

/**
 * Validate + normalize SL/TP probability estimates, bridging the legacy
 * tp1/tp2/tp3 fields with the tpProbabilities array in both directions.
 * Returns undefined when the input is not a usable object.
 */
export const normalizeLevelProbabilities = (rawLp: unknown): LevelProbabilities | undefined => {
  if (!rawLp || typeof rawLp !== 'object') return undefined;
  const lp = rawLp as Record<string, any>;
  const tpProbabilities: LevelProbabilities['tpProbabilities'] = Array.isArray(lp.tpProbabilities)
    ? lp.tpProbabilities.map((p: any) => ({
        level: typeof p.level === 'number' ? p.level : 0,
        probability: typeof p.probability === 'number' ? p.probability : 0,
        reasoning: p.reasoning || { ...DEFAULT_PROBABILITY_REASONING },
      }))
    : [];
  return {
    slProbability: typeof lp.slProbability === 'number' ? lp.slProbability : 0,
    slReasoning: lp.slReasoning || lp.reasoning?.sl || { ...DEFAULT_PROBABILITY_REASONING },
    tpProbabilities,
    // Legacy fields for backward compatibility
    tp1Probability: typeof lp.tp1Probability === 'number' ? lp.tp1Probability
      : (typeof tpProbabilities[0]?.probability === 'number' ? tpProbabilities[0].probability : undefined),
    tp2Probability: typeof lp.tp2Probability === 'number' ? lp.tp2Probability
      : (typeof tpProbabilities[1]?.probability === 'number' ? tpProbabilities[1].probability : undefined),
    tp3Probability: typeof lp.tp3Probability === 'number' ? lp.tp3Probability
      : (typeof tpProbabilities[2]?.probability === 'number' ? tpProbabilities[2].probability : undefined),
    reasoning: lp.reasoning && typeof lp.reasoning === 'object' ? {
      sl: lp.reasoning.sl || lp.slReasoning || { ...DEFAULT_PROBABILITY_REASONING },
      tp1: lp.reasoning.tp1 || tpProbabilities[0]?.reasoning || { ...DEFAULT_PROBABILITY_REASONING },
      tp2: lp.reasoning.tp2 || tpProbabilities[1]?.reasoning || undefined,
      tp3: lp.reasoning.tp3 || tpProbabilities[2]?.reasoning || undefined,
    } : {
      sl: lp.slReasoning || { ...DEFAULT_PROBABILITY_REASONING },
      tp1: tpProbabilities[0]?.reasoning || { ...DEFAULT_PROBABILITY_REASONING },
    },
  };
};

/**
 * Parse on-demand AI probability output: accepts either a wrapped
 * `{ levelProbabilities: ... }` object or a bare probabilities object.
 * Returns null when nothing usable was produced.
 */
export const parseLevelProbabilities = (raw: unknown): LevelProbabilities | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const candidate = obj.levelProbabilities && typeof obj.levelProbabilities === 'object'
    ? obj.levelProbabilities
    : raw;
  const normalized = normalizeLevelProbabilities(candidate);
  if (!normalized) return null;
  const hasContent = typeof (candidate as Record<string, unknown>).slProbability === 'number'
    || normalized.tpProbabilities.length > 0;
  return hasContent ? normalized : null;
};

/**
 * Cross-field business rules applied after shape coercion. Ported 1:1 from
 * the legacy hand-rolled sanitizer — see tests/tradeAnalysisSchema.test.ts.
 */
export const applySemanticFixups = (raw: CoercedTradeAnalysis): TradeAnalysis => {
  const analysis: TradeAnalysis = {
    coinName: raw.coinName,
    direction: raw.direction,
    tradeType: raw.tradeType,
    tradeTypeManualOverride: raw.tradeTypeManualOverride,
    confidence: 'Medium',
    probability: 65,
    grade: raw.grade,
    strategy: raw.strategy,
    activeStrategies: raw.activeStrategies,
    entryPoints: raw.entryPoints,
    stopLoss: raw.stopLoss,
    stopLossPercentage: raw.stopLossPercentage || undefined,
    originalStopLossPercentage: raw.originalStopLossPercentage || undefined,
    takeProfit: raw.takeProfit,
    marketConditions: raw.marketConditions,
    historicalCorrelation: raw.historicalCorrelation || 'N/A',
    createdAt: raw.createdAt,
    rrRatio: raw.rrRatio,
    detectedPatternFamily: raw.detectedPatternFamily || undefined,
    detectedPatterns: raw.detectedPatterns,
    keyLevels: raw.keyLevels,
    isUpdate: raw.isUpdate,
    updateInterval: raw.updateInterval,
    validationWarnings: raw.validationWarnings,
    originalConfidence: raw.originalConfidence,
    validityDurationMinutes: raw.validityDurationMinutes,
  };

  // ── Probability normalization + confidence derivation (coupled) ──
  let probValue = NaN;
  if (typeof raw.probability === 'number') {
    probValue = raw.probability;
  } else if (typeof raw.probability === 'string') {
    const cleanProb = raw.probability.replace(/[^0-9.]/g, '');
    if (cleanProb.length > 0) probValue = parseFloat(cleanProb);
  }

  // Treat 0 or negative as missing/invalid to avoid the "always 15%" bug.
  if (!isNaN(probValue) && probValue > 0) {
    // Normalize decimals (0.85 → 85). STRICT less-than: a bare "1" means 1%
    // on the 0-100 scale (100% would be written 100) — the old `<= 1` rule
    // turned every "probability: 1" into 100%.
    if (probValue < 1) probValue = probValue * 100;
    if (probValue > 100) probValue = 100;
    analysis.probability = Math.round(probValue);

    // An EXPLICIT 'Avoid' from the model stays an Avoid — the old code
    // force-fitted any number under 40 into Avoid/15, discarding genuine
    // low-confidence signals (e.g. a real 35% estimate). Comparison is
    // case-insensitive so "avoid"/"AVOID" (and "High (85%)" variants) land
    // on the right branch.
    if (normalizeConfidence(raw.confidence) === 'Avoid') {
      analysis.confidence = 'Avoid';
    } else if (analysis.probability >= 80) analysis.confidence = 'High';
    else if (analysis.probability >= 60) analysis.confidence = 'Medium';
    else if (analysis.probability >= 40) analysis.confidence = 'Low';
    else analysis.confidence = 'Low'; // genuine 1-39% → Low, not Avoid
  } else {
    // Fallback: derive probability from the confidence string. Normalized
    // case-insensitively ("high", "High (85%)") — previously any variant
    // silently collapsed to Medium/65.
    const conf = normalizeConfidence(raw.confidence) ?? 'Medium';
    analysis.confidence = conf;
    analysis.probability = conf === 'High' ? 85 : conf === 'Low' ? 45 : conf === 'Avoid' ? 15 : 65;
  }

  // ── Pattern family fallback mined from marketConditions.pattern ──
  if (!analysis.detectedPatternFamily && analysis.marketConditions?.pattern) {
    const pat = analysis.marketConditions.pattern.toUpperCase();
    if (pat.includes('FAMILY A')) analysis.detectedPatternFamily = 'Family A';
    else if (pat.includes('FAMILY B')) analysis.detectedPatternFamily = 'Family B';
    else if (pat.includes('FAMILY C')) analysis.detectedPatternFamily = 'Family C';
    else if (pat.includes('OMEGA')) analysis.detectedPatternFamily = 'Family Omega';
  }

  // ── Gate result: sanitize string arrays, pass the rest through ──
  if (raw.gateResult && typeof raw.gateResult === 'object') {
    const gr = raw.gateResult as Record<string, unknown>;
    analysis.gateResult = {
      ...(gr as TradeAnalysis['gateResult']),
      warnings: Array.isArray(gr.warnings) ? gr.warnings.map(coerceToString) : [],
      insights: Array.isArray(gr.insights) ? gr.insights.map(coerceToString) : [],
    } as TradeAnalysis['gateResult'];
  }

  // ── Level probabilities: validate + legacy tp1/2/3 ↔ tpProbabilities bridge ──
  const normalizedProbs = normalizeLevelProbabilities(raw.levelProbabilities);
  if (normalizedProbs) {
    analysis.levelProbabilities = normalizedProbs;
  }

  // ── Dual scenario analysis (previously dropped silently by the sanitizer) ──
  if (raw.dualScenarioAnalysis && typeof raw.dualScenarioAnalysis === 'object') {
    const dsa = raw.dualScenarioAnalysis as Record<string, any>;
    const cleanScenario = (s: any) => {
      if (!s || typeof s !== 'object') return undefined;
      return {
        trigger: coerceToString(s.trigger),
        confirmation: coerceToString(s.confirmation),
        target: coerceToString(s.target),
        invalidation: coerceToString(s.invalidation),
      };
    };
    const bullish = cleanScenario(dsa.bullish);
    const bearish = cleanScenario(dsa.bearish);
    if (bullish && bearish) {
      analysis.dualScenarioAnalysis = {
        bullish,
        bearish,
        selectedScenario: ['bullish', 'bearish', 'neutral'].includes(dsa.selectedScenario) ? dsa.selectedScenario : 'bullish',
        selectionReasoning: coerceToString(dsa.selectionReasoning),
        confidenceInSelection: typeof dsa.confidenceInSelection === 'number'
          ? Math.max(0, Math.min(100, dsa.confidenceInSelection))
          : 50,
      };
    }
  }

  // ── Evidence-bound claims: caps + state coercion ──
  if (Array.isArray(raw.evidence)) {
    const VALID_STATES = ['observed', 'partial', 'unobserved'];
    const claims: NonNullable<TradeAnalysis['evidence']> = [];
    for (const item of (raw.evidence as any[]).slice(0, 8)) {
      if (!item || typeof item !== 'object' || typeof item.claim !== 'string') continue;
      const claim = sanitizeJSONString(item.claim).slice(0, 300);
      if (!claim) continue;
      const sources = Array.isArray(item.sources)
        ? item.sources.filter((s: unknown) => typeof s === 'string').map((s: string) => sanitizeJSONString(s).slice(0, 120)).slice(0, 6)
        : [];
      const state = VALID_STATES.includes(item.state) ? item.state : (sources.length > 0 ? 'partial' : 'unobserved');
      const note = typeof item.note === 'string' ? sanitizeJSONString(item.note).slice(0, 200) : undefined;
      claims.push({ claim, sources, state, ...(note ? { note } : {}) });
    }
    if (claims.length > 0) analysis.evidence = claims;
  }

  // ── Invalidation contract: caps + category coercion ──
  if (Array.isArray(raw.invalidationCriteria)) {
    const VALID_CATEGORIES = ['price', 'time', 'structure', 'signal'];
    const criteria: NonNullable<TradeAnalysis['invalidationCriteria']> = [];
    for (const item of (raw.invalidationCriteria as any[]).slice(0, 5)) {
      if (!item || typeof item !== 'object') continue;
      const level = typeof item.level === 'string' ? sanitizeJSONString(item.level).slice(0, 60)
        : (typeof item.level === 'number' ? String(item.level) : '');
      const condition = typeof item.condition === 'string' ? sanitizeJSONString(item.condition).slice(0, 200) : '';
      if (!level || !condition) continue;
      const category = VALID_CATEGORIES.includes(item.category) ? item.category : undefined;
      const note = typeof item.note === 'string' ? sanitizeJSONString(item.note).slice(0, 200) : undefined;
      criteria.push({ level, condition, ...(category ? { category } : {}), ...(note ? { note } : {}) });
    }
    if (criteria.length > 0) analysis.invalidationCriteria = criteria;
  }

  // ── Pass-through fields (app-computed or free-form) ──
  if (raw.devilsAdvocate && typeof raw.devilsAdvocate === 'object') {
    analysis.devilsAdvocate = raw.devilsAdvocate as TradeAnalysis['devilsAdvocate'];
  }
  if (raw.entryTimingScore && typeof raw.entryTimingScore === 'object') {
    analysis.entryTimingScore = raw.entryTimingScore as TradeAnalysis['entryTimingScore'];
  }
  if (raw.marketSnapshot !== undefined) {
    analysis.marketSnapshot = raw.marketSnapshot;
  }
  if (raw.analystConsensus && typeof raw.analystConsensus === 'object') {
    analysis.analystConsensus = raw.analystConsensus as TradeAnalysis['analystConsensus'];
  }

  return analysis;
};

/**
 * The live AI-boundary parser: lenient coercion + semantic fixups.
 * Total parse failure yields safe defaults instead of throwing.
 */
export const SanitizedTradeAnalysisSchema = CoercedTradeAnalysisSchema.transform(applySemanticFixups);

export const parseTradeAnalysis = (raw: unknown): TradeAnalysis => {
  if (!raw || typeof raw !== 'object') return createDefaultTradeAnalysis();
  // Some providers name the asset "symbol" or "asset" instead of "coinName".
  const obj = raw as Record<string, unknown>;
  const withCoin = obj.coinName ? obj : { ...obj, coinName: obj.symbol ?? obj.asset ?? 'Unknown Asset' };
  const result = SanitizedTradeAnalysisSchema.safeParse(withCoin);
  if (!result.success) return createDefaultTradeAnalysis();
  const data = result.data;
  // A parsed-but-empty payload (garbage / declined output) is NOT a real
  // analysis — the lenient schema can't reject it (all defaults), so it used
  // to fabricate a plausible "Medium 65%" trade that got logged, calibrated
  // and counted in thinking records as if the model had spoken. Mark it
  // instead. A genuine "Avoid"/no-trade verdict still has substance via its
  // direction/confidence, so it is preserved.
  const hasSubstance =
    data.entryPoints.length > 0 || data.stopLoss !== '' || data.takeProfit.length > 0 ||
    data.strategy !== '' || data.direction !== 'Neutral' || data.confidence !== 'Medium';
  if (!hasSubstance) {
    return { ...createDefaultTradeAnalysis(), validationWarnings: ['No trade plan extracted from the AI response.'] };
  }
  return data;
};

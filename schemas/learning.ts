/**
 * Zod schemas for secondary AI boundaries: global memory synthesis,
 * LLM rule extraction, and strategy search results.
 * Lenient by design — malformed items are dropped, not fatal.
 */

import { z } from 'zod';
import type { GlobalMemory, LearningRule } from '../types';

// =============================================================================
// GLOBAL MEMORY (updateGlobalMemory — previously zero validation)
// =============================================================================

const coercedStringArray = z.array(z.unknown()).transform((arr) =>
  arr.map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v)))
);

const coercedStringRecord = z.record(z.string(), z.unknown()).transform((rec) =>
  Object.fromEntries(
    Object.entries(rec).map(([k, v]) => [k, typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v)])
  )
);

export const GlobalMemorySchema = z.object({
  totalTradesAnalyzed: z.number().default(0),
  familyPerformance: coercedStringRecord.default({}),
  aiPatternMemory: coercedStringArray.default([]),
  userPreferences: z.object({
    leverageDefault: z.number().default(100),
    favoriteAssets: coercedStringArray.default([]),
    preferredSetup: z.string().default(''),
  }).default({ leverageDefault: 100, favoriteAssets: [], preferredSetup: '' }),
  globalCorrections: coercedStringArray.default([]),
  // Structured insight knowledge base — shape validated by its own consumers.
  insightKnowledgeBase: z.any().optional(),
  lastUpdated: z.string().default(() => new Date().toISOString()),
});

export const parseGlobalMemory = (raw: unknown): GlobalMemory | null => {
  const result = GlobalMemorySchema.safeParse(raw);
  return result.success ? (result.data as GlobalMemory) : null;
};

// =============================================================================
// LLM RULE EXTRACTION
// =============================================================================

const RULE_CATEGORIES = ['entry', 'exit', 'risk', 'pattern', 'regime', 'general'] as const;

export const ExtractedRuleSchema = z.object({
  condition: z.string().min(1),
  action: z.string().min(1),
  category: z.enum(RULE_CATEGORIES).catch('general'),
  confidence: z.number().min(0).max(100).catch(80),
});

export type ValidatedExtractedRule = z.infer<typeof ExtractedRuleSchema>;

/** Parse an array of raw extracted rules, dropping malformed items. */
export const parseExtractedRules = (raw: unknown): ValidatedExtractedRule[] => {
  if (!Array.isArray(raw)) return [];
  const rules: ValidatedExtractedRule[] = [];
  for (const item of raw) {
    const result = ExtractedRuleSchema.safeParse(item);
    if (result.success) rules.push(result.data);
  }
  return rules;
};

// Re-export for consumers that construct LearningRule objects from these.
export type { LearningRule };

// =============================================================================
// STRATEGY SEARCH RESULTS
// =============================================================================

export const StrategySearchResultSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  rationale: z.string().optional(),
  backtestData: z.string().optional(),
  pitfalls: z.string().optional(),
  implementationSteps: z.array(z.string()).optional(),
});

export type ValidatedStrategySearchResult = z.infer<typeof StrategySearchResultSchema>;

/**
 * Parse strategy search output: accepts a bare array or a wrapped
 * `{ results | strategies: [...] }` object, dropping malformed items.
 */
export const parseStrategySearchResults = (raw: unknown): ValidatedStrategySearchResult[] => {
  let items: unknown = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    items = obj.results || obj.strategies || [];
  }
  if (!Array.isArray(items)) return [];
  const results: ValidatedStrategySearchResult[] = [];
  for (const item of items) {
    const result = StrategySearchResultSchema.safeParse(item);
    if (result.success) results.push(result.data);
  }
  return results;
};

export const CraftedSkillSchema = z.object({
  name: z.string().min(2).max(80),
  kind: z.enum(['repeat', 'avoid']).catch('avoid'),
  when: z.string().min(8),
  inputs: z.array(z.string()).default([]),
  steps: z.array(z.string()).min(1),
  validate: z.string().min(4),
  output: z.string().min(4),
  approval: z.string().min(4),
  ifCondition: z.string().min(8),
  thenAction: z.string().min(8),
});

export type CraftedSkill = z.infer<typeof CraftedSkillSchema>;

export const parseCraftedSkill = (raw: unknown): CraftedSkill | null => {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).skill ?? raw
    : raw;
  const result = CraftedSkillSchema.safeParse(obj);
  return result.success ? result.data : null;
};


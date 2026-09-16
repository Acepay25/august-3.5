import { describe, it, expect } from 'vitest';
import {
  parseTradeAnalysis,
  applySemanticFixups,
  CoercedTradeAnalysisSchema,
  createDefaultTradeAnalysis,
  normalizeLevelProbabilities,
  parseLevelProbabilities,
} from '../schemas/tradeAnalysis';
import {
  parseGlobalMemory,
  parseExtractedRules,
  parseStrategySearchResults,
} from '../schemas/learning';
import { cleanPriceField } from '../utils/sanitizers';
import { parsePrice } from '../utils/analysisUtils';

/** Minimal valid-ish raw analysis; override fields per test. */
const rawAnalysis = (overrides: Record<string, unknown> = {}) => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'Medium',
  probability: 65,
  strategy: 'Breakout',
  entryPoints: [{ price: '95000', description: 'retest' }],
  stopLoss: '94500',
  takeProfit: [{ price: '96000', percentage: '+10%' }],
  ...overrides,
});

describe('parseTradeAnalysis — direction synonyms', () => {
  it.each([
    ['bullish', 'Long'],
    ['BUY', 'Long'],
    ['long', 'Long'],
    ['bearish', 'Short'],
    ['sell', 'Short'],
    ['sideways', 'Neutral'],
    ['', 'Neutral'],
  ])('maps %s → %s', (input, expected) => {
    expect(parseTradeAnalysis(rawAnalysis({ direction: input })).direction).toBe(expected);
  });
});

describe('parseTradeAnalysis — probability/confidence coupling', () => {
  it('keeps a valid probability and derives confidence', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 85 }));
    expect(r.probability).toBe(85);
    expect(r.confidence).toBe('High');
  });

  it('marks a model-stated probability as stated', () => {
    expect(parseTradeAnalysis(rawAnalysis({ probability: 85 })).probabilitySource).toBe('stated');
    expect(parseTradeAnalysis(rawAnalysis({ probability: '75%' })).probabilitySource).toBe('stated');
  });

  it('flags confidence-word→probability defaults as inferred (not model-stated)', () => {
    // 85/65/45/15 are OUR fabrication from a word; ledgers must be able to
    // exclude them from calibration.
    expect(parseTradeAnalysis(rawAnalysis({ probability: 0, confidence: 'Low' })).probabilitySource).toBe('inferred');
    expect(parseTradeAnalysis(rawAnalysis({ probability: undefined, confidence: undefined })).probabilitySource).toBe('inferred');
    expect(createDefaultTradeAnalysis().probabilitySource).toBe('inferred');
  });

  it('parses percent strings ("75%")', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: '75%' }));
    expect(r.probability).toBe(75);
    expect(r.confidence).toBe('Medium');
  });

  it('normalizes decimals (0.85 → 85)', () => {
    expect(parseTradeAnalysis(rawAnalysis({ probability: 0.85 })).probability).toBe(85);
  });

  it('caps at 100', () => {
    expect(parseTradeAnalysis(rawAnalysis({ probability: 150 })).probability).toBe(100);
  });

  it('treats a bare 1 as 1% (not 100%)', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 1 }));
    expect(r.probability).toBe(1);
    expect(r.confidence).toBe('Low');
  });

  it('keeps genuine low probabilities as Low instead of discarding into Avoid', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 30 }));
    expect(r.confidence).toBe('Low');
    expect(r.probability).toBe(30);
  });

  it('honors an explicit Avoid from the model', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 20, confidence: 'Avoid' }));
    expect(r.confidence).toBe('Avoid');
    expect(r.direction).toBe('Neutral');
  });

  it('never keeps Long or Short when confidence is Avoid', () => {
    const long = parseTradeAnalysis(rawAnalysis({ direction: 'Long', confidence: 'Avoid', probability: 35 }));
    const short = parseTradeAnalysis(rawAnalysis({ direction: 'Short', confidence: 'Avoid', probability: 35 }));
    expect(long.direction).toBe('Neutral');
    expect(short.direction).toBe('Neutral');
    expect(long.confidence).toBe('Avoid');
    expect(short.confidence).toBe('Avoid');
  });

  it('falls back to the confidence string when probability is missing/zero', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 0, confidence: 'Low' }));
    expect(r.confidence).toBe('Low');
    expect(r.probability).toBe(45);
  });

  it('defaults to Medium/65 when both are missing', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: undefined, confidence: undefined }));
    expect(r.confidence).toBe('Medium');
    expect(r.probability).toBe(65);
  });
});

describe('parseTradeAnalysis — price cleaning', () => {
  it('strips options jargon and parenthesized asides', () => {
    expect(cleanPriceField('94,500 (call spread)')).toBe('94,500');
    expect(cleanPriceField('1.23 straddle')).toBe('1.23');
  });

  it('cleans entry/SL/TP prices from AI output', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      entryPoints: [{ price: '95000 (buy limit)', description: 'entry' }],
      stopLoss: '94500 (stop)',
      takeProfit: [{ price: '96000 call', percentage: '+10%' }],
    }));
    expect(r.entryPoints[0].price).toBe('95000');
    expect(r.stopLoss).toBe('94500');
    expect(r.takeProfit[0].price).toBe('96000');
  });

  it('drops entries with empty prices after cleaning', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      entryPoints: [{ price: '(call)', description: 'junk' }, { price: '100', description: 'ok' }],
    }));
    expect(r.entryPoints).toHaveLength(1);
    expect(r.entryPoints[0].price).toBe('100');
  });
});

describe('parseTradeAnalysis — pattern family fallback', () => {
  it('mines the family from marketConditions.pattern when missing', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      detectedPatternFamily: '',
      marketConditions: { pattern: 'Strong FAMILY A trap setup', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    }));
    expect(r.detectedPatternFamily).toBe('Family A');
  });

  it('detects Omega', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      detectedPatternFamily: '',
      marketConditions: { pattern: 'OMEGA continuation', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    }));
    expect(r.detectedPatternFamily).toBe('Family Omega');
  });
});

describe('parseTradeAnalysis — evidence caps', () => {
  it('caps at 8 claims and drops malformed items', () => {
    const evidence: any[] = Array.from({ length: 10 }, (_, i) => ({ claim: `c${i}`, sources: ['s'], state: 'observed' }));
    evidence.push({ claim: 42, sources: [], state: 'observed' }); // malformed
    const r = parseTradeAnalysis(rawAnalysis({ evidence }));
    expect(r.evidence).toHaveLength(8);
  });

  it('coerces unknown state to partial/unobserved', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      evidence: [
        { claim: 'with sources', sources: ['RSI'], state: 'banana' },
        { claim: 'no sources', sources: [], state: 'banana' },
      ],
    }));
    expect(r.evidence?.[0].state).toBe('partial');
    expect(r.evidence?.[1].state).toBe('unobserved');
  });
});

describe('parseTradeAnalysis — invalidation contract', () => {
  it('caps at 5 criteria and requires level + condition', () => {
    const criteria: any[] = Array.from({ length: 7 }, (_, i) => ({ level: `L${i}`, condition: `C${i}`, category: 'price' }));
    criteria.push({ level: 'only-level', condition: '' }); // dropped
    const r = parseTradeAnalysis(rawAnalysis({ invalidationCriteria: criteria }));
    expect(r.invalidationCriteria).toHaveLength(5);
  });

  it('accepts numeric levels and drops unknown categories', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      invalidationCriteria: [{ level: 94500, condition: 'close below', category: 'banana' }],
    }));
    expect(r.invalidationCriteria?.[0].level).toBe('94500');
    expect(r.invalidationCriteria?.[0].category).toBeUndefined();
  });
});

describe('parseTradeAnalysis — levelProbabilities bridging', () => {
  it('backfills legacy tp1/2/3 from tpProbabilities', () => {
    const lp = normalizeLevelProbabilities({
      slProbability: 25,
      tpProbabilities: [
        { level: 1, probability: 70, reasoning: { indicatorBasis: 'a', volatilityFactor: 'b', patternMemoryInfluence: 'c', aiAdjustments: 'd' } },
        { level: 2, probability: 40 },
      ],
    });
    expect(lp?.tp1Probability).toBe(70);
    expect(lp?.tp2Probability).toBe(40);
    expect(lp?.tpProbabilities[1].reasoning.indicatorBasis).toBe('');
  });

  it('keeps explicit legacy fields when present', () => {
    const lp = normalizeLevelProbabilities({ slProbability: 10, tp1Probability: 99, tpProbabilities: [] });
    expect(lp?.tp1Probability).toBe(99);
  });
});

describe('parseLevelProbabilities', () => {
  it('accepts a wrapped { levelProbabilities } object', () => {
    const r = parseLevelProbabilities({ levelProbabilities: { slProbability: 20, tpProbabilities: [] } });
    expect(r?.slProbability).toBe(20);
  });

  it('accepts a bare probabilities object', () => {
    const r = parseLevelProbabilities({ slProbability: 33, tpProbabilities: [] });
    expect(r?.slProbability).toBe(33);
  });

  it('returns null for unusable input', () => {
    expect(parseLevelProbabilities(null)).toBeNull();
    expect(parseLevelProbabilities({ foo: 1 })).toBeNull();
  });
});

describe('parseTradeAnalysis — robustness', () => {
  it('returns safe defaults for garbage input', () => {
    for (const garbage of [null, undefined, 'string', 42, []]) {
      const r = parseTradeAnalysis(garbage);
      expect(r.coinName).toBe('Unknown Asset');
      expect(r.direction).toBe('Neutral');
      expect(r.probability).toBe(65);
    }
  });

  it('falls back to symbol/asset for coinName', () => {
    expect(parseTradeAnalysis(rawAnalysis({ coinName: undefined, symbol: 'ETH' })).coinName).toBe('ETH');
    // A bare {asset} has no setup/strategy — parseTradeAnalysis marks empty
    // payloads as unavailable; give it substance so the coinName fallback
    // is what's under test.
    expect(parseTradeAnalysis({ asset: 'SOL', direction: 'Long', strategy: 'test', probability: 60 }).coinName).toBe('SOL');
  });

  it('copies dualScenarioAnalysis and grade through (previously dropped)', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      grade: 'a',
      dualScenarioAnalysis: {
        bullish: { trigger: '95500', confirmation: '4H close', target: '97000', invalidation: '94500' },
        bearish: { trigger: '94000', confirmation: '4H close', target: '92000', invalidation: '95500' },
        selectedScenario: 'bullish',
        selectionReasoning: 'trend',
        confidenceInSelection: 75,
      },
    }));
    expect(r.grade).toBe('A');
    expect(r.dualScenarioAnalysis?.bullish.trigger).toBe('95500');
    expect(r.dualScenarioAnalysis?.confidenceInSelection).toBe(75);
  });

  it('handles objects where strings belong (Error #31 class)', () => {
    const r = parseTradeAnalysis(rawAnalysis({ strategy: { text: 'nested strategy' } }));
    expect(r.strategy).toBe('nested strategy');
  });

  it('produces a complete default object', () => {
    const d = createDefaultTradeAnalysis();
    expect(d.keyLevels).toEqual({ support: [], resistance: [] });
    expect(d.marketConditions.prices).toHaveProperty('1h');
  });
});

describe('parseTradeAnalysis — verdictReview quarantine stamp (REVIEW sentinel)', () => {
  it('preserves a well-formed stamp through coercion', () => {
    const parsed = parseTradeAnalysis(rawAnalysis({ verdictReview: { reason: 'uncited', from: 'Long' } }));
    expect(parsed.verdictReview).toEqual({ reason: 'uncited', from: 'Long' });
  });

  it('drops an unknown reason instead of fabricating a state', () => {
    const parsed = parseTradeAnalysis(rawAnalysis({ verdictReview: { reason: 'bogus', from: 'Long' } }));
    expect(parsed.verdictReview).toBeUndefined();
  });

  it('coerces a bogus "from" to undefined but keeps a valid reason', () => {
    const parsed = parseTradeAnalysis(rawAnalysis({ verdictReview: { reason: 'ungrounded', from: 'Neutral' } }));
    expect(parsed.verdictReview).toEqual({ reason: 'ungrounded', from: undefined });
  });

  it('is absent on a normal parse', () => {
    expect(parseTradeAnalysis(rawAnalysis()).verdictReview).toBeUndefined();
  });
});

describe('parseTradeAnalysis — direction-aware level ordering gate (Tier-0 #7)', () => {
  it('repairs a Long with the stop ABOVE entry and flags the correction', () => {
    const r = parseTradeAnalysis(rawAnalysis({ stopLoss: '95500' }));
    expect(r.stopLoss).toBe('94500'); // mirrored across the 95000 entry
    expect(r.levelsCorrected).toBe(true);
    expect(r.levelFixes).toHaveLength(1);
    expect(r.levelFixes?.[0]).toMatch(/wrong side of the 95000 entry/i);
    expect(r.takeProfit[0].price).toBe('96000'); // untouched — already valid
  });

  it('mirrors a fully inverted Short plan (stop below entry, target above)', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      direction: 'Short',
      stopLoss: '94500',
      takeProfit: [{ price: '96000', percentage: '-10%' }],
    }));
    expect(r.stopLoss).toBe('95500');
    expect(r.takeProfit[0].price).toBe('94000');
    expect(r.levelsCorrected).toBe(true);
    expect(r.levelFixes).toHaveLength(2);
  });

  it('re-sorts a scrambled TP ladder so TP1..TP3 ascend from entry', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      takeProfit: [{ price: '97000' }, { price: '96000' }],
    }));
    expect(r.takeProfit.map((t) => t.price)).toEqual(['96000', '97000']);
    expect(r.levelFixes?.[0]).toMatch(/re-sorted/i);
  });

  it('leaves a correctly ordered plan unflagged (no phantom corrections)', () => {
    const r = parseTradeAnalysis(rawAnalysis());
    expect(r.levelsCorrected).toBeUndefined();
    expect(r.levelFixes).toBeUndefined();
    expect(r.stopLoss).toBe('94500');
    expect(r.takeProfit[0].price).toBe('96000');
  });

  it('tolerates missing legs instead of rejecting the plan', () => {
    const r = parseTradeAnalysis(rawAnalysis({ stopLoss: '', takeProfit: [{ price: '96000' }] }));
    expect(r.levelsCorrected).toBeUndefined();
    expect(r.takeProfit[0].price).toBe('96000');
  });

  it('skips the gate once Avoid has neutralized the direction', () => {
    const r = parseTradeAnalysis(rawAnalysis({ direction: 'Long', confidence: 'Avoid', probability: 20, stopLoss: '95500' }));
    expect(r.direction).toBe('Neutral');
    expect(r.levelsCorrected).toBeUndefined();
    expect(r.stopLoss).toBe('95500'); // no direction → nothing to mirror against
  });

  it('preserves percentage labels while replacing repaired prices', () => {
    const r = parseTradeAnalysis(rawAnalysis({ stopLoss: '95500', takeProfit: [{ price: '94000', percentage: '+5%' }] }));
    expect(r.takeProfit[0].price).toBe('96000');
    expect(r.takeProfit[0].percentage).toBe('+5%');
    expect(r.levelsCorrected).toBe(true);
  });

  it('is pure — the coerced input keeps its inverted values', () => {
    const coerced = CoercedTradeAnalysisSchema.parse(rawAnalysis({ stopLoss: '95500' }));
    const out = applySemanticFixups(coerced);
    expect(out.stopLoss).toBe('94500');
    expect(coerced.stopLoss).toBe('95500');
  });

  // Regression (parser corruption): the gate's price parser used to strip to
  // [0-9.eE+-], gluing timeframe annotations onto the number — "94500 4h"
  // became 945004, a phantom entry the gate then "mirror-repaired" into
  // fabricated levels persisted with ok. It must parse like the desk path
  // (canonical parsePrice), where the whitespace keeps the digits separate.
  it('parses annotated level strings like the desk path — no phantom mirror-repair', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      entryPoints: [{ price: '95000 4h', description: 'retest' }],
      stopLoss: '94500 - 4h',
      takeProfit: [{ price: '96000 4h', percentage: '+10%' }],
    }));
    expect(r.levelsCorrected).toBeUndefined();
    expect(r.levelFixes).toBeUndefined();
    expect(r.entryPoints[0].price).toBe('95000 4h'); // untouched — ordering valid at 95000
    expect(r.stopLoss).toBe('94500 - 4h');
    expect(r.takeProfit[0].price).toBe('96000 4h');
    // Same numbers the desk (canonical parsePrice) would see.
    expect(parsePrice('95000 4h')).toBe(95000);
    expect(parsePrice('94500 - 4h')).toBe(94500);
    expect(parsePrice('96000 4h')).toBe(96000);
  });

  it('mirrors an annotated Long stop against the TRUE entry, not a glued phantom', () => {
    const r = parseTradeAnalysis(rawAnalysis({
      entryPoints: [{ price: '95000 4h', description: 'retest' }],
      stopLoss: '95500',
    }));
    expect(r.stopLoss).toBe('94500'); // 95500 mirrored across 95000 (was: 950004 phantom)
    expect(r.levelsCorrected).toBe(true);
  });
});

describe('parseTradeAnalysis — dualScenario coercion', () => {
  const dual = (selectedScenario: unknown) => rawAnalysis({
    dualScenarioAnalysis: {
      bullish: { trigger: '95500', confirmation: '4H close', target: '97000', invalidation: '94500' },
      bearish: { trigger: '94000', confirmation: '4H close', target: '92000', invalidation: '95500' },
      selectedScenario,
      selectionReasoning: 'trend',
      confidenceInSelection: 75,
    },
  });

  it('coerces an unrecognized selection to neutral (not a fabricated bullish call)', () => {
    expect(parseTradeAnalysis(dual('bullish_leak')).dualScenarioAnalysis?.selectedScenario).toBe('neutral');
    expect(parseTradeAnalysis(dual(undefined)).dualScenarioAnalysis?.selectedScenario).toBe('neutral');
    expect(parseTradeAnalysis(dual('sideways')).dualScenarioAnalysis?.selectedScenario).toBe('neutral');
  });

  it('keeps recognized scenarios verbatim', () => {
    expect(parseTradeAnalysis(dual('bearish')).dualScenarioAnalysis?.selectedScenario).toBe('bearish');
    expect(parseTradeAnalysis(dual('neutral')).dualScenarioAnalysis?.selectedScenario).toBe('neutral');
  });
});

describe('secondary boundaries', () => {
  it('parseGlobalMemory validates and defaults', () => {
    const mem = parseGlobalMemory({ totalTradesAnalyzed: 5, aiPatternMemory: ['a'], lastUpdated: 'now' });
    expect(mem?.totalTradesAnalyzed).toBe(5);
    expect(mem?.userPreferences.leverageDefault).toBe(100);
    expect(parseGlobalMemory('garbage')).toBeNull();
  });

  it('parseExtractedRules drops malformed rules and defaults fields', () => {
    const rules = parseExtractedRules([
      { condition: 'c1', action: 'a1' },
      { condition: 'c2', action: 'a2', category: 'bogus', confidence: 55 },
      { condition: '', action: 'no condition' },
      'junk',
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[0].category).toBe('general');
    expect(rules[0].confidence).toBe(80);
    expect(rules[1].category).toBe('general'); // 'bogus' caught → default
    expect(rules[1].confidence).toBe(55);
  });

  it('parseStrategySearchResults accepts bare and wrapped arrays', () => {
    const bare = parseStrategySearchResults([{ name: 'Momentum Trading', description: 'd' }]);
    const wrapped = parseStrategySearchResults({ results: [{ name: 'Gap Trading' }] });
    expect(bare[0].name).toBe('Momentum Trading');
    expect(wrapped[0].description).toBe('');
    expect(parseStrategySearchResults({ nope: 1 })).toEqual([]);
  });
});

describe('applySemanticFixups is pure', () => {
  it('does not mutate its coerced input', () => {
    const coerced = CoercedTradeAnalysisSchema.parse(rawAnalysis({ probability: 30 }));
    const snapshot = JSON.stringify(coerced);
    applySemanticFixups(coerced);
    expect(JSON.stringify(coerced)).toBe(snapshot);
  });
});

describe('CoercedTradeAnalysisSchema — object/bare price coercion (B9)', () => {  it('extracts a number from an object-shaped stopLoss instead of "[object Object]"', () => {
    const result = CoercedTradeAnalysisSchema.parse(rawAnalysis({ stopLoss: { level: 94500 } }));
    expect(result.stopLoss).toBe('94500');
  });

  it('extracts from stopLoss objects with a price key', () => {
    const result = CoercedTradeAnalysisSchema.parse(rawAnalysis({ stopLoss: { price: '94000' } }));
    expect(result.stopLoss).toBe('94000');
  });

  it('wraps a bare-string entryPoints into a single entry', () => {
    const result = CoercedTradeAnalysisSchema.parse(rawAnalysis({ entryPoints: '95000' }));
    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].price).toBe('95000');
  });

  it('wraps a bare-number takeProfit into a single TP', () => {
    const result = CoercedTradeAnalysisSchema.parse(rawAnalysis({ takeProfit: 96000 }));
    expect(result.takeProfit).toHaveLength(1);
    expect(result.takeProfit[0].price).toBe('96000');
  });

  it('still returns [] for empty/undefined price fields', () => {
    const result = CoercedTradeAnalysisSchema.parse(rawAnalysis({ entryPoints: undefined, takeProfit: undefined }));
    expect(result.entryPoints).toEqual([]);
    expect(result.takeProfit).toEqual([]);
  });
});

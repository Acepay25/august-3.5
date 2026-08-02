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

  it('forces Avoid → 15 (the documented 15% bug fix)', () => {
    const r = parseTradeAnalysis(rawAnalysis({ probability: 30 }));
    expect(r.confidence).toBe('Avoid');
    expect(r.probability).toBe(15);
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
    expect(parseTradeAnalysis({ asset: 'SOL' }).coinName).toBe('SOL');
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

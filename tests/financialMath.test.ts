import { describe, it, expect } from 'vitest';
import {
  recalculateAnalysisMetrics,
  parsePrice,
  clampProbabilityToGate,
} from '../utils/analysisUtils';
import { runSimulation, computeKellyFraction, deriveSetupSeed } from '../services/analysis/MonteCarloService';
import { calculateMetrics, findHistoricalMatches, generateSuggestions, runScenarioMonteCarlo, isZeroDistanceTarget } from '../services/backtesting/ScenarioSimulatorService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import { computeContractSize } from '../utils/ticketSize';
import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';

const baseAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  tradeType: 'swing',
  confidence: 'Medium',
  probability: 65,
  strategy: 'Test',
  activeStrategies: [],
  entryPoints: [{ description: 'Entry', price: '100' }],
  stopLoss: '90',
  takeProfit: [
    { price: '110', percentage: '10' },
    { price: '120', percentage: '20' },
  ],
  marketConditions: {
    pattern: 'N/A',
    candleBehavior: 'N/A',
    timeframeAlignment: 'N/A',
    rsi: 'N/A',
    macd: 'N/A',
    sentiment: 'N/A',
  },
  historicalCorrelation: 'N/A',
  ...overrides,
});

describe('parsePrice', () => {
  it('handles comma-separated and decimal prices', () => {
    expect(parsePrice('69,000')).toBe(69000);
    expect(parsePrice('94,500.50')).toBe(94500.5);
    expect(parsePrice('$1200')).toBe(1200);
  });

  it('returns NaN for non-numeric input', () => {
    expect(Number.isNaN(parsePrice('n/a'))).toBe(true);
    expect(Number.isNaN(parsePrice(''))).toBe(true);
  });
});

describe('recalculateAnalysisMetrics — leverage math', () => {
  it('computes leveraged SL/TP percentages and R:R for a LONG', () => {
    const result = recalculateAnalysisMetrics(baseAnalysis(), 10);
    expect(result.stopLossPercentage).toBe('-100.0%'); // (10/100)*10*100
    expect(result.takeProfit?.[0]?.percentage).toBe('+100.0%'); // (10/100)*10*100
    expect(result.takeProfit?.[1]?.percentage).toBe('+200.0%'); // (20/100)*10*100
    expect(result.rrRatio).toBe(1.0); // reward 10 / risk 10
  });

  it('computes leveraged figures correctly for a SHORT (SL above entry)', () => {
    const result = recalculateAnalysisMetrics({
      ...baseAnalysis({ direction: 'Short' }),
      entryPoints: [{ description: 'Entry', price: '100' }],
      stopLoss: '105', // SL above entry for a short
      takeProfit: [{ price: '95' }],
    }, 5);
    expect(result.stopLossPercentage).toBe('-25.0%'); // (5/100)*5*100
    expect(result.takeProfit?.[0]?.percentage).toBe('+25.0%');
    expect(result.rrRatio).toBe(1.0);
  });

  it('recovers leverage from the original (unleveraged) stop-loss percent', () => {
    const result = recalculateAnalysisMetrics(
      baseAnalysis({
        stopLoss: 'non-price', // NaN price -> falls back to original percent
        originalStopLossPercentage: '1.5',
      }),
      20
    );
    expect(result.stopLossPercentage).toBe('-30.0%'); // 1.5 * 20
  });

  it('leaves the analysis untouched when entry data is unusable', () => {
    const out = recalculateAnalysisMetrics(baseAnalysis({ entryPoints: [], stopLoss: '', takeProfit: [] }), 10);
    expect(out.stopLossPercentage).toBeUndefined();
    expect(out.rrRatio).toBeUndefined();
  });
});

describe('clampProbabilityToGate', () => {
  it('clamps to the gate cap', () => {
    const r = clampProbabilityToGate(90, 0.65);
    expect(r.probability).toBe(65);
    expect(r.wasClamped).toBe(true);
  });

  it('does not clamp below the cap', () => {
    const r = clampProbabilityToGate(50, 0.9);
    expect(r.probability).toBe(50);
    expect(r.wasClamped).toBe(false);
  });

  it('applies the R:R<1.2 (54%) and R:R<1.5 (69%) thresholds', () => {
    expect(clampProbabilityToGate(80, 1, 1.1).probability).toBe(54);
    expect(clampProbabilityToGate(80, 1, 1.3).probability).toBe(69);
    expect(clampProbabilityToGate(60, 1, 1.3).probability).toBe(60); // below threshold — untouched
  });

  it('floors negative and non-finite inputs to 0 instead of passing them through', () => {
    const neg = clampProbabilityToGate(-12, 0.9);
    expect(neg.probability).toBe(0);
    expect(neg.wasClamped).toBe(true);
    expect(neg.reason).toMatch(/negative/);
    expect(clampProbabilityToGate(Number.NaN, 0.9).probability).toBe(0);
    // a negative input with a gate cap still lands at 0, not the cap
    expect(clampProbabilityToGate(-5, 0.65).probability).toBe(0);
  });

  it('caps inputs above 100', () => {
    const over = clampProbabilityToGate(140, 1);
    expect(over.probability).toBe(100);
    expect(over.wasClamped).toBe(true);
  });
});

// =============================================================================
// Wave-2 (deep-dive 2026-09-15) financial/math regressions
// =============================================================================

describe('recalculateAnalysisMetrics — leverage double-compounding guard (item 12)', () => {
  it('stashes originalPercentage in the price-parsed branch so a later fallback scales the RAW move once', () => {
    const first = recalculateAnalysisMetrics(baseAnalysis(), 10);
    // Price-parsed pass must record the UNLEVERAGED move.
    expect(first.takeProfit?.[0]?.originalPercentage).toBe('10.0');
    expect(first.originalStopLossPercentage).toBe('10.0');

    // Second pass: the TP price has become unparseable (user edit / legacy
    // row) — the fallback leg now scales from the stashed RAW 10%, not from
    // the already-leveraged '+100.0%' percentage (which produced +1000%).
    const legacyStyle: TradeAnalysis = JSON.parse(JSON.stringify(first));
    legacyStyle.takeProfit = (legacyStyle.takeProfit || []).map(tp => ({ ...tp, price: 'n/a' }));
    const second = recalculateAnalysisMetrics(legacyStyle, 10);
    expect(second.takeProfit?.[0]?.percentage).toBe('+100.0%'); // 10 × 10, NOT 100 × 10
  });
});

describe('MonteCarloService — seeded determinism + true sample stats (item 6)', () => {
  const cfg = {
    entry: 100, stopLoss: 97, takeProfits: [104, 110, 120],
    direction: 'Long' as const, atr: 2, timeframe: '1h', numSimulations: 300,
  };

  it('produces identical results for the same setup (seeded RNG, stable Simulated Win Rate)', () => {
    const a = runSimulation(cfg);
    const b = runSimulation(cfg);
    expect(a).toEqual(b);
    expect(a.seedUsed).toBe(deriveSetupSeed(cfg));
  });

  it('different setups get different seeds', () => {
    expect(deriveSetupSeed(cfg)).not.toBe(deriveSetupSeed({ ...cfg, stopLoss: 96.5 }));
  });

  it('excludes TIMEOUT runs from the expected value', () => {
    // Levels 900% away and one single step: essentially nothing resolves.
    const r = runSimulation({
      ...cfg, numSimulations: 100, maxSteps: 1,
      stopLoss: 1, takeProfits: [1000, 1100, 1200],
    });
    expect(r.probabilities.timeout).toBe(100);
    expect(r.expectedValue).toBe(0);
    expect(r.winRate).toBe(0);
  });

  it('avgWinPercent is the mean of the POSITIVE sample — greater than the EV/winRate proxy', () => {
    const r = runSimulation({ ...cfg, numSimulations: 500 });
    expect(r.winRate).toBeGreaterThan(0);          // some TP hits
    expect(r.probabilities.slHit).toBeGreaterThan(0); // some losses
    const legacyProxy = r.expectedValue / (r.winRate / 100);
    expect(r.avgWinPercent!).toBeGreaterThan(legacyProxy);
    expect(r.avgLossPercent!).toBeGreaterThan(0);
  });

  it('computeKellyFraction consumes the true average win when supplied', () => {
    const legacy = computeKellyFraction(50, 2, 50, -3);            // proxy avgWin = 4
    const trueWin = computeKellyFraction(50, 2, 50, -3, 10);       // avgWin = 10
    // b = 10/3 → f* = 0.5 − 0.5/(10/3) = 0.35
    expect(trueWin).toBeCloseTo(0.35, 6);
    expect(trueWin).toBeGreaterThan(legacy);
  });
});

describe('ScenarioSimulatorService — riskUSD semantics + match gating (item 10)', () => {
  const cfg = {
    entry: 100, stopLoss: 99, takeProfits: [102],
    direction: 'Long' as const, leverage: 100, positionSizeUSD: 1000, coinName: 'BTCUSDT',
  };

  it('treats Position ($) as the notional: a 1% stop on $1000 risks $10, not $1000', () => {
    const m = calculateMetrics(cfg);
    expect(m.riskUSD).toBe(10);      // 1% price move × $1000 notional
    expect(m.rewardUSD).toBe(20);    // 2% × $1000
    // The MARGIN-relative (ROE) view keeps the leverage factor.
    expect(m.leveragedRiskPercent).toBe(100);
  });

  const trade = (over: Partial<LoggedTrade>): LoggedTrade => ({
    id: 'x', outcome: TradeOutcome.WIN, timestamp: new Date().toISOString(),
    analysis: { coinName: 'ZZZUSDT', direction: 'Long', rrRatio: 2 } as TradeAnalysis,
    ...over,
  } as LoggedTrade);

  it('requires ≥2 matching dimensions — a direction-only match is not a "similar setup"', () => {
    const directionOnly = [trade({ analysis: { coinName: 'ZZZUSDT', direction: 'Long' } as TradeAnalysis })];
    expect(findHistoricalMatches(cfg, directionOnly)).toHaveLength(0);

    const twoDimensions = [trade({})]; // same direction + similar R:R (3 vs 3)
    expect(findHistoricalMatches(cfg, twoDimensions)).toHaveLength(1);

    const sameCoinOnly = [trade({ analysis: { coinName: 'BTCUSDT', direction: 'Short' } as TradeAnalysis })];
    expect(findHistoricalMatches(cfg, sameCoinOnly)).toHaveLength(0);
  });

  it('similar leverage is a TIE-BREAKER score weight, not a match dimension', () => {
    // Same direction (+25 clears the numeric half of the gate) + leverage
    // inside the <20 band (+5): this used to pass as 2 dimensions and re-open
    // the direction-inflation hole. Only ONE setup property matches → no hit.
    const directionPlusLeverage = [trade({
      leverage: 100,
      analysis: { coinName: 'ZZZUSDT', direction: 'Long' } as TradeAnalysis,
    })];
    expect(findHistoricalMatches(cfg, directionPlusLeverage)).toHaveLength(0);

    // With a genuine second dimension the same trade matches, and leverage
    // still contributes as a scoring nudge.
    const coinDirectionLeverage = [trade({
      leverage: 100,
      analysis: { coinName: 'BTCUSDT', direction: 'Long' } as TradeAnalysis,
    })];
    const hits = findHistoricalMatches(cfg, coinDirectionLeverage);
    expect(hits).toHaveLength(1);
    expect(hits[0].matchReasons).toContain('Similar leverage');
  });

  it('drops a zero-distance TP from the MC ladder instead of crediting fake 0% wins', async () => {
    expect(isZeroDistanceTarget(100, 100)).toBe(true);
    expect(isZeroDistanceTarget(100.000000001, 100)).toBe(true); // float dust
    expect(isZeroDistanceTarget(102, 100)).toBe(false);
    expect(isZeroDistanceTarget(90, 100)).toBe(false); // inverted → levelOrder mirrors it

    // TP1 exactly on entry, SL far below. Pre-fix, EVERY sim resolved as an
    // instant TP1 win at step 1 (the intra-step high always touches the
    // entry) → winRate ≈ 100%. Post-fix the TP is dropped from the ladder.
    const degenerate = { ...cfg, stopLoss: 90, takeProfits: [100] };
    const result = await runScenarioMonteCarlo(degenerate, 300);
    expect(result).not.toBeNull();
    expect(result!.winRate).toBeLessThan(95);

    // The drop is ANNOUNCED, not silent — the scenario result says the sim
    // ran without the zero-distance target.
    const suggestions = generateSuggestions(degenerate, calculateMetrics(degenerate), []);
    expect(suggestions.some(s => /zero reward distance/i.test(s))).toBe(true);
  });
});

describe('LiveBacktestService — single-unit PnL + regime join (item 9)', () => {
  const current = { coinName: 'BTCUSDT', direction: 'Long' } as TradeAnalysis;
  const trade = (over: Partial<LoggedTrade>): LoggedTrade => ({
    id: 'x', outcome: TradeOutcome.WIN, timestamp: new Date().toISOString(),
    analysis: {
      coinName: 'BTCUSDT', direction: 'Long',
      entryPoints: [{ price: '100' }], takeProfit: [{ price: '105' }], stopLoss: '98',
    } as TradeAnalysis,
    ...over,
  } as LoggedTrade);
  // Legacy rows persisted RAW regime labels ('strong_trend_up') despite the
  // narrow union — the whole point of the join regression, so cast them in.
  const legacyRegime = (r: string): LoggedTrade['marketRegime'] =>
    r as unknown as LoggedTrade['marketRegime'];

  it('expresses the level-based estimate as leveraged ROE (price % × leverage), matching pnlPercent units', () => {
    const result = backtestSimilarSetups(current, [
      trade({ outcome: TradeOutcome.WIN, pnlPercent: 200 }),                       // verified ROE
      trade({ id: 'y', outcome: TradeOutcome.WIN, leverage: 50 }),                  // 5% × 50 = 250 ROE (old: raw 5)
      trade({ id: 'z', outcome: TradeOutcome.LOSS, leverage: 100, analysis: {
        coinName: 'BTCUSDT', direction: 'Long',
        entryPoints: [{ price: '100' }], stopLoss: '99', takeProfit: [{ price: '102' }],
      } as TradeAnalysis }),                                             // −1% × 100 = −100 ROE
    ]);
    expect(result.avgWinPercent).toBeCloseTo(225, 6);   // (200 + 250)/2 — one unit
    expect(result.avgLossPercent).toBeCloseTo(100, 6);  // ROE, not the raw 1%
    expect(result.expectedValue).toBeCloseTo((2 / 3) * 225 - (1 / 3) * 100, 1);
  });

  it('drops the fabricated ±2/−1 defaults: unmeasurable trades never pollute the averages', () => {
    const noEvidence = [
      trade({ analysis: { coinName: 'BTCUSDT', direction: 'Long' } as TradeAnalysis }),
      trade({ id: 'b', outcome: TradeOutcome.LOSS, analysis: { coinName: 'BTCUSDT', direction: 'Long' } as TradeAnalysis }),
      trade({ id: 'c', outcome: TradeOutcome.LOSS, analysis: { coinName: 'BTCUSDT', direction: 'Long' } as TradeAnalysis }),
    ];
    const result = backtestSimilarSetups(current, noEvidence);
    expect(result.totalMatches).toBe(3);
    expect(result.winRate).toBeCloseTo(100 / 3, 1); // outcomes still count
    expect(result.avgWinPercent).toBe(0);           // but no invented magnitudes
    expect(result.avgLossPercent).toBe(0);
    expect(result.warning).toMatch(/PnL/);
    // The match rows carry NULL, not a fabricated 0 — downstream journal
    // renderers must never see "WIN (0.0%)" for an unmeasured trade.
    expect(result.matchedTrades).toHaveLength(3);
    expect(result.matchedTrades.every(m => m.pnlPercent === null)).toBe(true);
  });

  it('joins regime stats: raw legacy marketRegime values bucket-match the current regime', () => {
    const result = backtestSimilarSetups(current, [
      trade({ marketRegime: legacyRegime('strong_trend_up') }),
      trade({ id: 'b', marketRegime: legacyRegime('strong_trend_up') }),
      trade({ id: 'c', outcome: TradeOutcome.LOSS, marketRegime: legacyRegime('volatile_chop') }),
    ], 'strong_trend_up');
    // 'strong_trend_up' must land in the same bucket the breakdown uses.
    expect(result.currentRegimeStats).toBeDefined();
    expect(result.currentRegimeStats!.regime).toBe('trending');
    expect(result.currentRegimeStats!.count).toBe(2);
  });
});

describe('ticketSize.computeContractSize — exchange leverage cap (item 13)', () => {
  const tightStopTrade = {
    coinName: 'BTCUSDT', direction: 'Long', confidence: 'Medium',
    entryPoints: [{ price: '100' }], stopLoss: '99.9',
  } as unknown as TradeAnalysis;

  it('caps notional at equity × leverage and reports the effective risk', () => {
    // Risk-based size wants $10,000 notional (1% price risk, $10 risk);
    // $1,000 equity at 5x can only carry $5,000.
    const sized = computeContractSize(tightStopTrade, 1_000, 5, 1);
    expect(sized.notionalUsd).toBe(5_000);
    expect(sized.qty).toBeCloseTo(50, 6);
    expect(sized.riskUsd).toBeCloseTo(5, 4); // 5000 × ~0.1% stop (float stopDist)
    expect(sized.adjustments.some(a => /Leverage cap/.test(a.label))).toBe(true);
  });

  it('leaves affordable sizes untouched', () => {
    // $100k at 200x carries $20M notional — the $1M wanted by a 0.1% stop
    // against 1% risk fits with no clamp.
    const sized = computeContractSize(tightStopTrade, 100_000, 200, 1);
    expect(sized.notionalUsd).toBeCloseTo(1_000_000, 1);
    expect(sized.riskUsd).toBe(1_000);
    expect(sized.adjustments.some(a => /Leverage cap/.test(a.label))).toBe(false);
  });
});
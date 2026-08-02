import { describe, it, expect } from 'vitest';
import {
  recalculateAnalysisMetrics,
  parsePrice,
  clampProbabilityToGate,
} from '../utils/analysisUtils';
import { TradeAnalysis } from '../types';

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
});
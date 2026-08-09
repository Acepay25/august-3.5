import { describe, it, expect } from 'vitest';
import { TradeAnalysis } from '../types';
import { buildAnalystConsensus } from '../services/providers/ensembleService';
import { sanitizeTradeAnalysis } from '../utils/analysisUtils';

// Consensus explainability: the panel data is app-computed (never AI output),
// so it must (a) derive the right divergence flags from analyst results and
// (b) survive the sanitizeTradeAnalysis boundary so historical cards and the
// journal keep the breakdown.

const baseAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'Medium',
  probability: 65,
  strategy: 'test',
  activeStrategies: [],
  entryPoints: [{ description: 'Entry 1', price: '95000' }],
  stopLoss: '93000',
  takeProfit: [{ price: '98000' }],
  marketConditions: {
    pattern: 'range',
    candleBehavior: 'steady',
    timeframeAlignment: 'aligned',
    rsi: 'neutral',
    macd: 'neutral',
    sentiment: 'neutral',
  },
  historicalCorrelation: 'N/A',
  createdAt: new Date().toISOString(),
  ...overrides,
});

const analyst = (providerId: string, name: string, analysis: TradeAnalysis) => ({
  provider: { config: { id: providerId }, name },
  result: { thoughtProcess: '', finalOutput: '', analysis },
});

describe('buildAnalystConsensus', () => {
  it('returns undefined with no analysts', () => {
    expect(buildAnalystConsensus([])).toBeUndefined();
  });

  it('flags an echo chamber when analysts fully agree', () => {
    const consensus = buildAnalystConsensus([
      analyst('p1', 'Alpha', baseAnalysis({ probability: 62 })),
      analyst('p2', 'Beta', baseAnalysis({ probability: 64 })),
      analyst('p3', 'Gamma', baseAnalysis({ probability: 63 })),
    ])!;

    expect(consensus.entries).toHaveLength(3);
    expect(consensus.divergence.isEchoChamber).toBe(true);
    expect(consensus.divergence.score).toBeLessThan(15);
    expect(consensus.divergence.divergenceType).toBe('none');
    // Each entry carries the structured call for the panel table.
    expect(consensus.entries[0]).toMatchObject({
      providerId: 'p1',
      displayName: 'Alpha',
      direction: 'Long',
      entry: '95000',
      stopLoss: '93000',
      takeProfit: '98000',
      confidence: 'Medium',
      probability: 62,
    });
  });

  it('scores direction divergence when analysts split', () => {
    const consensus = buildAnalystConsensus([
      analyst('p1', 'Alpha', baseAnalysis({ direction: 'Long' as const })),
      analyst('p2', 'Beta', baseAnalysis({ direction: 'Short' as const })),
    ])!;

    expect(consensus.divergence.score).toBeGreaterThanOrEqual(40);
    expect(consensus.divergence.divergenceType).toBe('direction');
    expect(consensus.divergence.isEchoChamber).toBe(false);
    expect(consensus.divergence.details.join(' ')).toMatch(/Direction disagreement/i);
  });

  it('tolerates analysts with missing structured fields', () => {
    const sparse = baseAnalysis();
    sparse.entryPoints = [];
    sparse.takeProfit = [];
    sparse.stopLoss = '';
    const consensus = buildAnalystConsensus([
      analyst('p1', 'Alpha', sparse),
      analyst('p2', 'Beta', sparse),
    ])!;

    expect(consensus.entries[0].entry).toBeUndefined();
    expect(consensus.entries[0].takeProfit).toBeUndefined();
    expect(consensus.entries[0].stopLoss).toBeUndefined();
    expect(consensus.divergence.score).toBeGreaterThanOrEqual(0);
  });
});

describe('analystConsensus survives sanitization', () => {
  it('preserves the app-computed consensus through parseTradeAnalysis', () => {
    const consensus = buildAnalystConsensus([
      analyst('p1', 'Alpha', baseAnalysis()),
      analyst('p2', 'Beta', baseAnalysis()),
    ])!;
    const withConsensus = { ...baseAnalysis(), analystConsensus: consensus };

    const sanitized = sanitizeTradeAnalysis(withConsensus);
    expect(sanitized.analystConsensus).toBeDefined();
    expect(sanitized.analystConsensus!.entries).toHaveLength(2);
    expect(sanitized.analystConsensus!.divergence.score).toBe(consensus.divergence.score);
  });
});

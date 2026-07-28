import { describe, it, expect } from 'vitest';
import { recalculateAnalysisMetrics } from '../utils/analysisUtils';

describe('analysisUtils', () => {
  describe('recalculateAnalysisMetrics', () => {
    it('returns a safe default TradeAnalysis shape when given null', () => {
      const result = recalculateAnalysisMetrics(null as any, 10);
      expect(result).toBeTypeOf('object');
      expect(result.coinName).toBe('Unknown Asset');
      expect(result.direction).toBe('Neutral');
      expect(result.confidence).toBe('Medium');
      expect(result.probability).toBe(65);
      expect(result.entryPoints).toEqual([]);
      expect(result.takeProfit).toEqual([]);
      expect(result.detectedPatterns).toEqual([]);
      expect(result.keyLevels).toEqual({ support: [], resistance: [] });
    });

    it('returns an object with the expected shape for minimal input', () => {
      const result = recalculateAnalysisMetrics(
        { coinName: 'BTC', direction: 'bullish' } as any,
        5
      );
      expect(result.coinName).toBe('BTC');
      expect(result.direction).toBe('Long'); // 'bullish' maps to Long
      expect(Array.isArray(result.entryPoints)).toBe(true);
      expect(Array.isArray(result.takeProfit)).toBe(true);
      expect(result.marketConditions).toBeTypeOf('object');
      expect(result.marketConditions.prices).toBeTypeOf('object');
      expect(typeof result.createdAt).toBe('string');
    });

    it('recalculates leveraged SL/TP percentages and R:R ratio', () => {
      const analysis = {
        coinName: 'ETH',
        direction: 'Long',
        probability: 80,
        entryPoints: [{ price: '100', description: 'entry' }],
        stopLoss: '90',
        takeProfit: [{ price: '120', percentage: '' }],
      } as any;

      const result = recalculateAnalysisMetrics(analysis, 10);

      // SL: |100-90|/100 = 10% raw -> x10 leverage = 100%
      expect(result.stopLossPercentage).toBe('-100.0%');
      // TP: |120-100|/100 = 20% raw -> x10 leverage = 200%
      expect(result.takeProfit[0].percentage).toBe('+200.0%');
      // R:R = reward(20) / risk(10) = 2
      expect(result.rrRatio).toBe(2);
    });

    it('scales percentages with the leverage parameter', () => {
      const analysis = {
        direction: 'Long',
        entryPoints: [{ price: '100' }],
        stopLoss: '90',
        takeProfit: [{ price: '120' }],
      } as any;

      const result = recalculateAnalysisMetrics(analysis, 1);
      expect(result.stopLossPercentage).toBe('-10.0%');
      expect(result.takeProfit[0].percentage).toBe('+20.0%');
    });

    it('does not mutate the input analysis object', () => {
      const analysis = {
        direction: 'Long',
        entryPoints: [{ price: '100', description: '' }],
        stopLoss: '90',
        takeProfit: [{ price: '120', percentage: '' }],
      } as any;
      const snapshot = JSON.parse(JSON.stringify(analysis));

      recalculateAnalysisMetrics(analysis, 10);
      expect(analysis).toEqual(snapshot);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { LoggedTrade, TradeOutcome } from '../types';
import {
  summarizeSimilarSetups,
  buildSimilarSetupsContext,
  buildRegimeWeightingContext,
  computeRegimeProviderStats,
  COLD_START_MIN,
} from '../services/learning/SetupMemoryService';

const makeTrade = (overrides: Partial<LoggedTrade> & { id: string }): LoggedTrade => ({
  analysis: {
    coinName: 'BTCUSDT',
    direction: 'Short',
    detectedPatternFamily: 'Family C',
    entryPoints: [{ price: '65000' }],
    stopLoss: '65500',
    takeProfit: [{ price: '64000' }],
  } as any,
  outcome: TradeOutcome.WIN,
  timestamp: '2026-08-09T12:00:00.000Z',
  pnlPercent: 3.2,
  marketRegime: 'trending',
  modelsUsed: { gemini: 'gemini-2.5-flash' },
  ...overrides,
});

describe('SetupMemoryService', () => {
  describe('summarizeSimilarSetups', () => {
    it('returns null with fewer than 3 closed trades', () => {
      const trades = [makeTrade({ id: '1' }), makeTrade({ id: '2' })];
      expect(summarizeSimilarSetups({ coinName: 'BTCUSDT', direction: 'Short' }, trades)).toBeNull();
    });

    it('returns null when the journal has no similar matches', () => {
      const trades = [
        makeTrade({ id: '1' }),
        makeTrade({ id: '2' }),
        makeTrade({ id: '3', analysis: { coinName: 'ETHUSDT', direction: 'Long' } as any }),
      ];
      expect(summarizeSimilarSetups({ coinName: 'BTCUSDT', direction: 'Long' }, trades)).toBeNull();
    });

    it('summarizes matching setups with win rate, EV and recent outcomes', () => {
      const trades = [
        makeTrade({ id: '1' }), // BTCUSDT Short WIN +3.2
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, pnlPercent: -2.1 }),
        makeTrade({ id: '3', outcome: TradeOutcome.WIN, pnlPercent: 1.4 }),
        makeTrade({ id: '4', analysis: { coinName: 'ETHUSDT', direction: 'Long' } as any }), // no match
      ];
      const s = summarizeSimilarSetups({ coinName: 'BTCUSDT', direction: 'Short' }, trades, 'trending');
      expect(s).not.toBeNull();
      expect(s!.total).toBe(3);
      expect(s!.winRate).toBeCloseTo(66.7, 0);
      expect(s!.recent).toHaveLength(3);
      expect(s!.recent[0].coin).toBe('BTCUSDT');
      expect(s!.sameCoinCount).toBe(3);
      expect(s!.sameCoinWinRate).toBeCloseTo(66.7, 0);
    });
  });

  describe('buildSimilarSetupsContext', () => {
    it('renders the block with recent outcomes and overall coin line (warm pool)', () => {
      const trades = [
        makeTrade({ id: '1' }),
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, pnlPercent: -2.1 }),
        makeTrade({ id: '3', outcome: TradeOutcome.WIN, pnlPercent: 1.4 }),
        makeTrade({ id: '4', outcome: TradeOutcome.WIN, pnlPercent: 2.0 }),
        makeTrade({ id: '5', outcome: TradeOutcome.LOSS, pnlPercent: -1.2 }),
        makeTrade({ id: '6', outcome: TradeOutcome.WIN, pnlPercent: 0.8 }),
      ];
      const block = buildSimilarSetupsContext({ coinName: 'BTCUSDT', direction: 'Short' }, trades);
      expect(block).toContain('SIMILAR SETUPS FROM YOUR JOURNAL');
      expect(block).toContain('67% win (4W/2L)');
      expect(block).toContain('Recent:');
      expect(block).toContain('BTCUSDT overall: 6 closed trades');
      expect(block).toContain('not a veto');
      expect(block).not.toContain('COLD START');
    });

    it('returns empty for an empty journal', () => {
      expect(buildSimilarSetupsContext({ coinName: 'BTCUSDT' }, [])).toBe('');
    });
  });

  describe('cold start (②)', () => {
    it('flags summaries below COLD_START_MIN matches', () => {
      const trades = [
        makeTrade({ id: '1' }),
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, pnlPercent: -2.1 }),
        makeTrade({ id: '3', outcome: TradeOutcome.WIN, pnlPercent: 1.4 }),
      ];
      const s = summarizeSimilarSetups({ coinName: 'BTCUSDT', direction: 'Short' }, trades);
      expect(s).not.toBeNull();
      expect(s!.total).toBeLessThan(COLD_START_MIN);
      expect(s!.isColdStart).toBe(true);
    });

    it('does not flag a warm pool', () => {
      const trades = Array.from({ length: COLD_START_MIN + 2 }, (_, i) =>
        makeTrade({ id: `t${i}`, outcome: i % 2 === 0 ? TradeOutcome.WIN : TradeOutcome.LOSS, pnlPercent: i % 2 === 0 ? 2 : -1 })
      );
      const s = summarizeSimilarSetups({ coinName: 'BTCUSDT', direction: 'Short' }, trades);
      expect(s).not.toBeNull();
      expect(s!.isColdStart).toBe(false);
    });

    it('injects the COLD START caution line that scales confidence down', () => {
      const trades = [
        makeTrade({ id: '1' }),
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, pnlPercent: -2.1 }),
        makeTrade({ id: '3', outcome: TradeOutcome.WIN, pnlPercent: 1.4 }),
      ];
      const block = buildSimilarSetupsContext({ coinName: 'BTCUSDT', direction: 'Short' }, trades);
      expect(block).toContain('COLD START');
      expect(block).toContain('Do NOT raise confidence above Medium');
    });
  });

  describe('computeRegimeProviderStats (③)', () => {
    it('aggregates wins/losses per provider in the current regime only', () => {
      const trades = [
        makeTrade({ id: '1', marketRegime: 'ranging', modelsUsed: { gemini: 'g' } }),
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, marketRegime: 'ranging', modelsUsed: { gemini: 'g' } }),
        makeTrade({ id: '3', outcome: TradeOutcome.WIN, marketRegime: 'ranging', modelsUsed: { deepseek: 'd' } }),
        // Trending trades must NOT leak into the ranging stats.
        makeTrade({ id: '4', outcome: TradeOutcome.LOSS, marketRegime: 'trending', modelsUsed: { gemini: 'g' } }),
        makeTrade({ id: '5', outcome: TradeOutcome.LOSS, marketRegime: 'ranging', modelsUsed: { gemini: 'g' } }),
      ];
      const stats = computeRegimeProviderStats(trades, 'weak_trend_down');
      // 'weak_trend_down' normalizes to 'trending' — only trade 4 counts, and
      // it has 1 trade < minTrades(3), so gemini is absent from the map.
      expect(stats.has('gemini')).toBe(false);

      const ranging = computeRegimeProviderStats(trades, 'ranging');
      expect(ranging.get('gemini')).toEqual({ wr: 33.33333333333333, n: 3 });
      // deepseek has only 1 trade in the regime — below the 3-trade minimum,
      // so it is excluded (thin data must not drive routing).
      expect(ranging.get('deepseek')).toBeUndefined();
    });

    it('returns an empty map when no provider meets the regime minimum', () => {
      const trades = [
        makeTrade({ id: '1', marketRegime: 'ranging', modelsUsed: { gemini: 'g' } }),
        makeTrade({ id: '2', outcome: TradeOutcome.LOSS, marketRegime: 'ranging', modelsUsed: { gemini: 'g' } }),
      ];
      expect(computeRegimeProviderStats(trades, 'ranging').size).toBe(0);
    });
  });

  describe('buildRegimeWeightingContext', () => {
    const mk = (id: string, outcome: TradeOutcome, regime: string, model: string, pnl?: number) =>
      makeTrade({ id, outcome, marketRegime: regime as any, modelsUsed: { gemini: model }, pnlPercent: pnl });

    it('groups models by current regime with overall fallback', () => {
      const trades = [
        mk('1', TradeOutcome.WIN, 'ranging', 'model-a'),
        mk('2', TradeOutcome.WIN, 'ranging', 'model-a'),
        mk('3', TradeOutcome.LOSS, 'ranging', 'model-a'),
        mk('4', TradeOutcome.WIN, 'trending', 'model-a'),
        mk('5', TradeOutcome.LOSS, 'ranging', 'model-b'),
        mk('6', TradeOutcome.LOSS, 'ranging', 'model-b'),
        mk('7', TradeOutcome.LOSS, 'ranging', 'model-b'),
      ];
      const block = buildRegimeWeightingContext(trades, 'weak_trend_down');
      // normalized current regime from the raw hybrid label:
      expect(block).toContain('current regime: trending');
      expect(block).toContain('model-a');
      expect(block).toContain('trending: 100% (1, thin)'); // <3 regime trades → thin marker
      expect(block).toContain('overall');
      expect(block).toContain('INSTRUCTION');
    });

    it('returns empty below the minimum trade count', () => {
      const trades = [mk('1', TradeOutcome.WIN, 'ranging', 'model-a')];
      expect(buildRegimeWeightingContext(trades, 'ranging')).toBe('');
    });

    it('hides models below minTrades even when others qualify', () => {
      const trades = [
        mk('1', TradeOutcome.WIN, 'ranging', 'model-a'),
        mk('2', TradeOutcome.WIN, 'ranging', 'model-a'),
        mk('3', TradeOutcome.WIN, 'ranging', 'model-a'),
        mk('4', TradeOutcome.WIN, 'ranging', 'model-z'), // only 1 trade → excluded
      ];
      const block = buildRegimeWeightingContext(trades, 'ranging');
      expect(block).toContain('model-a');
      expect(block).not.toContain('model-z');
    });
  });
});

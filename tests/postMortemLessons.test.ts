import { describe, it, expect } from 'vitest';
import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';
import { buildCoinLessonsBlock, collectCoinLessons } from '../utils/postMortemLessons';

const analysis = (coinName: string, direction: TradeAnalysis['direction'] = 'Long'): TradeAnalysis => ({
    coinName,
    direction,
    confidence: 'Medium',
    probability: 55,
    strategy: '',
    activeStrategies: [],
    entryPoints: [{ price: '100', description: '' }],
    stopLoss: '95',
    takeProfit: [{ price: '110' }],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
});

const trade = (
    id: string,
    coinName: string,
    outcome: TradeOutcome,
    postMortem: string,
    timestamp: string,
): LoggedTrade => ({
    id,
    analysis: analysis(coinName),
    outcome,
    timestamp,
    postMortem,
});

describe('collectCoinLessons', () => {
    it('returns only lessons for the same coin, newest first', () => {
        const trades = [
            trade('1', 'BTC', TradeOutcome.LOSS, 'Lesson: Never chase a breakout without volume confirmation here.', '2026-08-01T00:00:00Z'),
            trade('2', 'ETH', TradeOutcome.LOSS, 'Lesson: ETH lesson should be excluded.', '2026-08-02T00:00:00Z'),
            trade('3', 'BTCUSDT', TradeOutcome.WIN, 'Lesson: Scale out at the first resistance on BTC.', '2026-08-03T00:00:00Z'),
        ];
        const rows = collectCoinLessons(trades, 'BTC');
        expect(rows).toHaveLength(2);
        expect(rows[0].lesson).toContain('Scale out');
        expect(rows[1].lesson).toContain('Never chase');
        expect(rows.every(r => r.lesson.length > 0)).toBe(true);
    });

    it('normalizes USDT suffixes on both sides', () => {
        const trades = [trade('1', 'BTCUSDT', TradeOutcome.LOSS, 'Lesson: Respect the higher-timeframe trend.', '2026-08-01T00:00:00Z')];
        expect(collectCoinLessons(trades, 'BTC')).toHaveLength(1);
        expect(collectCoinLessons(trades, 'btc')).toHaveLength(1);
    });

    it('skips pending trades and post-mortems without an extractable lesson', () => {
        const trades = [
            trade('1', 'BTC', TradeOutcome.PENDING, 'Lesson: pending should not count.', '2026-08-01T00:00:00Z'),
            trade('2', 'BTC', TradeOutcome.LOSS, '', '2026-08-02T00:00:00Z'),
        ];
        expect(collectCoinLessons(trades, 'BTC')).toHaveLength(0);
    });

    it('returns [] when no coin is given', () => {
        const trades = [trade('1', 'BTC', TradeOutcome.LOSS, 'Lesson: something.', '2026-08-01T00:00:00Z')];
        expect(collectCoinLessons(trades, undefined)).toHaveLength(0);
    });

    it('caps at the requested max', () => {
        const trades = Array.from({ length: 6 }, (_, i) =>
            trade(String(i), 'BTC', TradeOutcome.LOSS, `Lesson: lesson number ${i} for the cap test.`, `2026-08-0${i + 1}T00:00:00Z`),
        );
        expect(collectCoinLessons(trades, 'BTC', 3)).toHaveLength(3);
    });
});

describe('buildCoinLessonsBlock', () => {
    it('builds a prompt block with outcome + direction lines', () => {
        const trades = [trade('1', 'BTC', TradeOutcome.LOSS, 'Lesson: Wait for the retest before entering.', '2026-08-01T00:00:00Z')];
        const block = buildCoinLessonsBlock(trades, 'BTC');
        expect(block).toContain('POST-MORTEM LESSONS FOR BTC');
        expect(block).toContain('LOSS');
        expect(block).toContain('Wait for the retest');
        expect(block).toContain('do not repeat a mistake');
    });

    it('returns empty string when there are no lessons', () => {
        expect(buildCoinLessonsBlock([], 'BTC')).toBe('');
    });
});

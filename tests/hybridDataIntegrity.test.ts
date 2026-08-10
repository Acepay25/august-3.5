import { describe, it, expect } from 'vitest';
import { Kline } from '../services/analysis/MarketDataService';
import {
    calculateADX,
    calculateRegime,
    calculateEnhancedKeyLevels
} from '../services/analysis/TechnicalAnalysisService';
import {
    formatLiquidationsBlock,
    formatFibLadder,
    formatCandleHistoryInsight
} from '../services/analysis/HybridIntelligenceService';
import { LiquidationData } from '../services/analysis/MarketDataService';

/**
 * Regression tests for the hybrid-data pipeline integrity.
 *
 * History: ADX was inflated ~14x because Wilder's smoothing added the
 * incoming value without dividing by period (TR/DM cancelled the error in
 * the DI ratio, but ADX = smoothed DX was amplified — real output showed
 * ADX 411.1 with +DI 19.1 / -DI 16.3, i.e. true ADX ~29). The regime
 * classifier then labeled that "STRONG TREND DOWN" off a NEUTRAL DI gap.
 */

/** Steady single-direction series with constant wicks. */
const makeTrend = (n: number, step: number, wickUp = 25, wickDown = 15, start = 60000): Kline[] => {
    const klines: Kline[] = [];
    let close = start;
    for (let i = 0; i < n; i++) {
        const open = close;
        close = open + step;
        klines.push({
            time: i,
            open,
            high: Math.max(open, close) + wickUp,
            low: Math.min(open, close) - wickDown,
            close,
            volume: 1000
        });
    }
    return klines;
};

/** Symmetric zigzag: every up candle is mirrored by an equal down candle. */
const makeZigzag = (n: number, amplitude = 50, start = 60000): Kline[] => {
    const klines: Kline[] = [];
    let close = start;
    for (let i = 0; i < n; i++) {
        const open = close;
        const dir = i % 2 === 0 ? 1 : -1;
        close = open + dir * amplitude;
        klines.push({
            time: i,
            open,
            high: Math.max(open, close) + 25,
            low: Math.min(open, close) - 25,
            close,
            volume: 1000
        });
    }
    return klines;
};

describe('ADX calculation (Wilder smoothing)', () => {
    it('keeps ADX within its mathematical 0-100 bound on a steady uptrend', () => {
        const klines = makeTrend(200, 50);
        const { adx, plusDI, minusDI } = calculateADX(klines);
        expect(adx).toBeGreaterThanOrEqual(0);
        expect(adx).toBeLessThanOrEqual(100);
        // Pure up-moves: +DI dominates, DX = 100, ADX should be strong.
        expect(plusDI).toBeGreaterThan(minusDI);
        expect(adx).toBeGreaterThan(25);
    });

    it('keeps ADX within its mathematical 0-100 bound on a steady downtrend', () => {
        const klines = makeTrend(200, -50);
        const { adx, plusDI, minusDI } = calculateADX(klines);
        expect(adx).toBeGreaterThanOrEqual(0);
        expect(adx).toBeLessThanOrEqual(100);
        expect(minusDI).toBeGreaterThan(plusDI);
        expect(adx).toBeGreaterThan(25);
    });

    it('produces neutral reading on a symmetric zigzag (no directional claim)', () => {
        const klines = makeZigzag(200);
        const regime = calculateRegime(klines);
        expect(regime.adx).toBeGreaterThanOrEqual(0);
        expect(regime.adx).toBeLessThanOrEqual(100);
        expect(regime.trendDirection).toBe('neutral');
        // A neutral DI gap must never be labeled a directional regime.
        expect(regime.regime).toBe('ranging');
        expect(regime.regime.includes('trend')).toBe(false);
    });

    it('regime direction always agrees with the DI spread', () => {
        for (const klines of [makeTrend(200, 50), makeTrend(200, -50), makeZigzag(200)]) {
            const regime = calculateRegime(klines);
            if (regime.regime.includes('trend_up')) {
                expect(regime.plusDI).toBeGreaterThan(regime.minusDI);
            }
            if (regime.regime.includes('trend_down')) {
                expect(regime.minusDI).toBeGreaterThan(regime.plusDI);
            }
            expect(regime.adx).toBeLessThanOrEqual(100);
        }
    });

    it('ADX value matches the classic hand-computed case', () => {
        // 50-up / 50-down alternating with symmetric wicks yields zero
        // directional movement on both sides: +DI == -DI and ADX ~ 0.
        const klines = makeZigzag(120, 40);
        const { adx } = calculateADX(klines);
        expect(adx).toBeLessThan(5);
    });
});

describe('Liquidations block (unavailable source honesty)', () => {
    const unavailable: LiquidationData = {
        recentLongLiquidations: 0,
        recentShortLiquidations: 0,
        totalRecentLiquidations: 0,
        recentEvents: [],
        dominantLiquidations: 'balanced',
        liquidationPressure: 'low',
        sentiment: 'No liquidation data available',
        available: false
    };

    const real: LiquidationData = {
        recentLongLiquidations: 2_500_000,
        recentShortLiquidations: 750_000,
        totalRecentLiquidations: 3_250_000,
        recentEvents: [],
        dominantLiquidations: 'longs',
        liquidationPressure: 'medium',
        sentiment: 'Moderate long liquidations — bearish lean',
        available: true
    };

    it('emits N/A instead of fake $0.00 / BALANCED / LOW pressure when unavailable', () => {
        const block = formatLiquidationsBlock(unavailable);
        expect(block).toContain('N/A');
        expect(block).not.toContain('$0.00');
        expect(block).not.toContain('BALANCED');
        expect(block).not.toContain('LOW pressure');
        expect(block).not.toContain('Dominant');
    });

    it('still renders real values when the source responded', () => {
        const block = formatLiquidationsBlock(real);
        expect(block).toContain('$2.50M');
        expect(block).toContain('$0.75M');
        expect(block).toContain('MEDIUM pressure');
        expect(block).toContain('Dominant: LONGS');
    });
});

describe('Candle History Insight (per-TF skew honesty)', () => {
    const tf = (bullish: number, bearish: number, dominantTrend: 'bullish' | 'bearish' | 'neutral') => ({
        sequence: [...Array(bullish).fill('🟢'), ...Array(bearish).fill('🔴')],
        bullishCount: bullish,
        bearishCount: bearish,
        summary: `${bullish} Bullish, ${bearish} Bearish`,
        dominantTrend
    });

    const history = (overrides: Record<string, ReturnType<typeof tf>> = {}) => ({
        '4h': tf(15, 15, 'neutral'),
        '1h': tf(16, 14, 'neutral'),
        '15m': tf(14, 16, 'neutral'),
        '5m': tf(11, 19, 'bearish'),
        ...overrides
    });

    it('surfaces a skewed 5m instead of blanket LTF NEUTRAL (regression: dump case)', () => {
        const insight = formatCandleHistoryInsight(history());
        expect(insight).toContain('↔ HTF NEUTRAL');
        expect(insight).toContain('LTF SKEW: 15m neutral, 5m bearish-skewed (11 Bullish, 19 Bearish)');
        expect(insight).not.toContain('LTF NEUTRAL');
    });

    it('both LTF timeframes aligned bearish → ENTRY FAVORABLE', () => {
        const insight = formatCandleHistoryInsight(history({
            '15m': tf(9, 21, 'bearish'),
            '5m': tf(11, 19, 'bearish')
        }));
        expect(insight).toContain('LTF ENTRY FAVORABLE: 15m structure and 5m confirmation both bearish.');
    });

    it('15m and 5m opposing → LTF MIXED', () => {
        const insight = formatCandleHistoryInsight(history({
            '15m': tf(22, 8, 'bullish'),
            '5m': tf(11, 19, 'bearish')
        }));
        expect(insight).toContain('LTF MIXED: 15m and 5m disagree.');
    });

    it('all four timeframes neutral → both NEUTRAL lines', () => {
        const insight = formatCandleHistoryInsight(history({
            '5m': tf(15, 15, 'neutral')
        }));
        expect(insight).toContain('↔ HTF NEUTRAL');
        expect(insight).toContain('↔ LTF NEUTRAL');
    });

    it('surfaces HTF skew when only one HTF timeframe is skewed', () => {
        const insight = formatCandleHistoryInsight(history({
            '4h': tf(24, 6, 'bullish')
        }));
        expect(insight).toContain('HTF SKEW: 4h bullish-skewed (24 Bullish, 6 Bearish), 1h neutral');
        expect(insight).not.toContain('HTF NEUTRAL');
    });

    it('both HTF timeframes bullish → HTF BULLISH', () => {
        const insight = formatCandleHistoryInsight(history({
            '4h': tf(24, 6, 'bullish'),
            '1h': tf(25, 5, 'bullish')
        }));
        expect(insight).toContain('HTF BULLISH: Both 4H and 1H show strong bullish candle dominance.');
    });
});

describe('Fibonacci ladder consistency', () => {
    it('every (fibonacci) support/resistance level exists in the displayed ladder', () => {
        const klines = makeTrend(150, 30, 40, 40);
        const levels = calculateEnhancedKeyLevels(klines, '1h');
        const fibPrices = new Set(levels.fibLevels.levels.map(l => l.price));

        for (const level of [...levels.support, ...levels.resistance]) {
            if (level.source === 'fibonacci') {
                expect(fibPrices.has(level.price)).toBe(true);
            }
        }
    });

    it('ladder shows the full ratio set so labels match', () => {
        const klines = makeTrend(150, 30, 40, 40);
        const levels = calculateEnhancedKeyLevels(klines, '1h');
        const ladder = formatFibLadder(levels.fibLevels);

        for (const level of levels.fibLevels.levels) {
            expect(ladder).toContain(`- ${level.ratio}: $${level.price}`);
        }
        // Ratios that previously appeared only as (fibonacci) source labels.
        expect(ladder).toContain('- 0:');
        expect(ladder).toContain('- 0.236:');
        expect(ladder).toContain('- 0.786:');
        expect(ladder).toContain('- 1:');
    });
});

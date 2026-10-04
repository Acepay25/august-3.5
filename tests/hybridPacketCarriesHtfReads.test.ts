import { describe, it, expect } from 'vitest';

// Round trip: the three new detectors must reach the FINISHED injection, not
// just their own modules. The audit lesson here is that a built-but-uncalled
// detector passes the whole suite green, so this drives the real packet
// formatter and asserts the lines are in its output — and that they land inside
// the region the 2400-char head-slice keeps.

import {
    generateHybridPromptInjection,
    HybridDataPacket,
} from '../services/analysis/HybridIntelligenceService';
import { htfPhaseAgreement, classifyBar } from '../utils/htfPhase';
import { Kline } from '../types';

const bar = (i: number, o: Partial<Kline> = {}): Kline => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 105, high: 110, low: 100, close: 105, volume: 100,
    ...o,
});

/** Ascending harness frames, all expanding up against their previous bar.
 *  The live high starts at 101, one tick over the previous bar's 100 — an
 *  equal high is a tie, and a tie does not take liquidity. */
const bullFrames = (): { timeframe: string; bars: Kline[] }[] => ([
    '15m', '1h', '4h', '1d',
]).map((timeframe, i) => ({
    timeframe,
    bars: [
        bar(0, { open: 95, high: 100, low: 90, close: 98 }),
        bar(1, { open: 98, high: 101 + i, low: 92, close: 104 + i }),
    ],
}));

const indicators = {
    currentPrice: 104,
    rsi: { rsi14: 58 },
    rsiTrend: 'neutral',
    macd: { value: 10, signal: 5, histogram: 5, trend: 'bullish' },
    ema: { ema20: 102, ema50: 100, ema200: 98 },
    atr: 3, atrPercent: 2.9,
    trendStrength: 'strong_up',
};

const packet = (overrides: Record<string, unknown> = {}): HybridDataPacket => ({
    symbol: 'BTCUSDT',
    dataTimestamp: new Date().toISOString(),
    fundingRate: 0.0001,
    fundingRateSentiment: 'neutral',
    marketData: {
        symbol: 'BTCUSDT', currentPrice: 104, price: 104, price24hHigh: 110, price24hLow: 90,
        priceChange24h: 4, priceChangePercent: 4, priceChangePercent24h: 4,
        volume: 1e9, volume24h: 1e9,
    },
    indicators: { '15m': indicators, '1h': indicators, '4h': indicators, '1d': indicators },
    keyLevels: { support: [], resistance: [] },
    confluence: { score: 60, direction: 'bullish', alignment: [], conflicts: [], strength: 'strong' },
    derivatives: {
        openInterestValue: 1e9, oiChange: 1e7, oiChange24h: 1, oiChangePct: 1, oiHistory: [],
        fundingStreak: 0, basisRateNow: 0,
        longShortRatio: { ratio: 1, sentiment: 'balanced' },
        topTraderRatio: { ratio: 1, sentiment: 'balanced' },
        takerBuySell: { ratio: 1, pressure: 'balanced' },
        overallSentiment: 'neutral', sentimentScore: 0,
    },
    advancedVolume: {
        volumeProfile: { poc: 100, valueAreaHigh: 105, valueAreaLow: 95, valueAreaPercentage: 70 },
        obvTrend: 'up', obvDivergence: null, cvdTrend: 'rising',
        relativeVolume: { current: 1, average: 1, ratio: 1 },
    },
    regime: {
        regime: 'trending_up', adx: 30, plusDI: 25, minusDI: 12,
        trendDirection: 'up', trendStrength: 'strong', tradingBias: 'trend_following',
    },
    enhancedKeyLevels: {
        pivotPoints: { daily: { pp: 100, r1: 110, r2: 120, r3: 130, s1: 90, s2: 80, s3: 70 } },
        fibLevels: { trend: 'up', levels: [] },
        support: [{ price: 90, source: 'pivot', touchCount: 2 }],
        resistance: [{ price: 110, source: 'pivot', touchCount: 2 }],
    },
    vwap: {
        '1h': { vwap: 100, pricePosition: 'above_vwap', lowerBand2: 90, lowerBand1: 95, upperBand1: 105, upperBand2: 110 },
        '4h': { vwap: 100, pricePosition: 'above_vwap' },
    },
    ichimoku: {
        '1h': { tenkan: 100, kijun: 98 },
        '4h': { signal: 'bullish_cross', cloudColor: 'green', priceVsCloud: 'above', tkCross: 'bullish', cloudTop: 102, cloudBottom: 96 },
    },
    momentum: {
        '1h': { roc5: 1, roc10: 2, roc20: 4, momentum: 'bullish', momentumScore: 60, rsiDivergence: null, macdDivergence: null },
        '4h': { roc5: 1, roc10: 2, roc20: 3, momentum: 'bullish', momentumScore: 55, rsiDivergence: null, macdDivergence: null },
    },
    session: {
        sessionName: 'London', suggestedAction: 'normal', warnings: [],
        sessionStart: '07:00', sessionEnd: '16:00', minutesIntoSession: 60,
        minutesToSessionEnd: 480, isWeekend: false, isKillZone: false, killZoneType: '',
        dayOfWeek: 'Thu', volatilityExpectation: 'normal',
    },
    orderBook: {
        dominantSide: 'bid', depthImbalance: 1, bids: [], asks: [],
        bidDepth: 100, askDepth: 90, buyWalls: [], sellWalls: [], spread: 0.5, spreadPercent: 0.005,
    },
    liquidations: {
        liquidationPressure: 'LOW', totalLiquidations: 0, sentiment: 'balanced',
        recentLongLiquidations: 1e6, recentShortLiquidations: 2e6,
        totalRecentLiquidations: 3e6, dominantLiquidations: 'short',
    },
    patternClassification: { family: 'trend', confidence: 0.5, scores: { familyA: 0.5, familyB: 0.4 } },
    candleHistory: {
        '15m': { dominantTrend: 'neutral', summary: 'balanced tape', sequence: [] },
        '1h': { dominantTrend: 'neutral', summary: 'balanced tape', sequence: [] },
        '4h': { dominantTrend: 'neutral', summary: 'balanced tape', sequence: [] },
        '1d': { dominantTrend: 'neutral', summary: 'balanced tape', sequence: [] },
    },
    detectedPatterns: {},
    chartPatterns: { '15m': [], '1h': [], '4h': [], '1d': [] },
    liquiditySweeps: [],
    marketContext: { week: null, month: null, prevWeek: null, prevMonth: null },
    ...overrides,
} as unknown as HybridDataPacket);

describe('the packet carries the new reads', () => {
    it('emits the HTF bar-state bias line', () => {
        const out = generateHybridPromptInjection(packet({
            htfBarState: htfPhaseAgreement(bullFrames()),
        }));
        expect(out).toContain('HTF bar state:');
        expect(out).toContain('Expansion ▲(w1)');
        expect(out).toContain('net BULLISH');
    });

    it('emits the MTF premium/discount line with one position per frame', () => {
        const out = generateHybridPromptInjection(packet({
            mtfPremiumDiscount: {
                rows: [
                    { timeframe: '15m', pd: { rangeHigh: 110, rangeLow: 100, equilibrium: 105, zone: 'premium', positionPct: 90 } },
                    { timeframe: '1h', pd: { rangeHigh: 120, rangeLow: 100, equilibrium: 110, zone: 'discount', positionPct: 20 } },
                ],
                premium: ['15m'], discount: ['1h'], equilibrium: [], outside: [],
                consensus: 'mixed', averagePositionPct: 55,
            },
        }));
        expect(out).toContain('MTF premium/discount: 15m 90% PREMIUM · 1h 20% DISCOUNT');
        expect(out).toContain('MIXED (1 premium / 1 discount / 0 eq)');
    });

    it('emits the sweep-reversal line from the SMC read', () => {
        const out = generateHybridPromptInjection(packet({
            smcStructure: {
                equalLevels: { equalHighs: [], equalLows: [], lines: [] },
                fvg: [], orderBlocks: [], premiumDiscount: null,
                dolTargets: [], cvd: null, measuredMove: null,
                seasonality: { lines: [] },
                sweepReversals: [{
                    side: 'bearish', levelLabel: 'EQH ×2', level: 100, extreme: 104,
                    status: 'confirmed', sweepIndex: 4, confirmIndex: 5, barsElapsed: 2,
                    reclaimed: true, structureBroken: true, confirmationLevel: 91,
                    zone: { top: 104, bottom: 100 },
                    text: 'BEARISH sweep-reversal: took EQH ×2 $100.00 to $104.00 — reversal zone $100.00–$104.00',
                }],
            },
        }));
        expect(out).toContain('Sweep reversals: BEARISH sweep-reversal');
    });

    it('keeps the two frame filters inside the region the 2400-char head-slice keeps', () => {
        // The cap is a HEAD slice (hooks/useAnalysisPipeline.ts:2469), so this
        // asserts by offset rather than by presence: a line that exists at char
        // 5000 is a line no seat ever receives, and that is the defect here.
        const full = generateHybridPromptInjection(packet({
            htfBarState: htfPhaseAgreement(bullFrames()),
            mtfPremiumDiscount: {
                rows: [{ timeframe: '15m', pd: { rangeHigh: 110, rangeLow: 100, equilibrium: 105, zone: 'premium', positionPct: 90 } }],
                premium: ['15m'], discount: [], equilibrium: [], outside: [],
                consensus: 'all-premium', averagePositionPct: 90,
            },
            smcStructure: {
                equalLevels: { equalHighs: [{ level: 100, touches: 2 }], equalLows: [], lines: ['EQ HIGHS $100.00 ×2'] },
                fvg: [], orderBlocks: [], premiumDiscount: null,
                dolTargets: [], cvd: null, measuredMove: null, seasonality: { lines: [] },
                sweepReversals: [],
            },
        }));
        const head = full.slice(0, 2400);
        expect(head).toContain('HTF bar state:');
        expect(head).toContain('MTF premium/discount:');
        expect(full.indexOf('HTF bar state:')).toBeLessThan(full.indexOf('### SMC structure'));
    });

    it('the sweep-reversal detail rides with the SMC block, not ahead of it', () => {
        // Deliberate: the head slice is zero-sum, and a conditional per-level
        // event line is detail a seat pulls with get_market_packet (6000-char
        // budget) when it is working a level. Only the two gating filters were
        // promoted, so this line stays where the pools/FVGs/OBs already live.
        const full = generateHybridPromptInjection(packet({
            smcStructure: {
                equalLevels: { equalHighs: [{ level: 100, touches: 2 }], equalLows: [], lines: ['EQ HIGHS $100.00 ×2'] },
                fvg: [], orderBlocks: [], premiumDiscount: null,
                dolTargets: [], cvd: null, measuredMove: null, seasonality: { lines: [] },
                sweepReversals: [],
            },
        }));
        expect(full).toContain('Sweep reversals: none');
        expect(full.indexOf('Sweep reversals:')).toBeGreaterThan(full.indexOf('### SMC structure'));
    });

    it('a packet that never computed them prints neither line and does not throw', () => {
        const out = generateHybridPromptInjection(packet());
        expect(out).not.toContain('HTF bar state:');
        expect(out).not.toContain('MTF premium/discount:');
    });

    it('an unusable bar-state read discloses itself rather than printing a bias', () => {
        const out = generateHybridPromptInjection(packet({
            htfBarState: htfPhaseAgreement([{ timeframe: '1d', bars: [bar(0)] }]),
        }));
        expect(out).toContain('BIAS UNUSABLE');
        expect(out).not.toContain('net NEUTRAL');
    });
});

describe('the study catalogue reaches bar state', () => {
    it('taLibrary exposes it under the trend group a seat can ask for', async () => {
        const { TA_STUDIES } = await import('../services/analysis/taLibrary');
        const run = TA_STUDIES.trend.run([
            bar(0, { high: 100, low: 90, close: 98 }),
            bar(1, { high: 105, low: 92, close: 101 }),
        ]) as Record<string, unknown>;
        expect(run.barState).toEqual(classifyBar([
            bar(0, { high: 100, low: 90, close: 98 }),
            bar(1, { high: 105, low: 92, close: 101 }),
        ]));
        expect(TA_STUDIES.trend.covers).toMatch(/bar state/i);
    });

    it('the desk tool advertises it, so the model can ask', async () => {
        const { DESK_TOOL_DEFINITIONS } = await import('../services/analysis/DeskToolsService');
        const tool = DESK_TOOL_DEFINITIONS.find(t => t.function.name === 'get_indicators');
        const studies = tool?.function.parameters?.properties?.studies as { description: string };
        expect(studies.description).toContain('bar state');
    });
});

import { describe, it, expect } from 'vitest';
import { TradeOutcome } from '../types';
import { LoggedTrade } from '../types/trade';
import { buildTradeInsightBrief, insightTextForTrade, compactInsightForPatternMemory } from '../utils/tradeInsightBrief';

const trade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    outcome: TradeOutcome.WIN,
    timestamp: new Date().toISOString(),
    analysis: {
        coinName: 'BTC',
        direction: 'Long',
        confidence: 'High',
        probability: 70,
        strategy: 'Momentum Breakout',
        activeStrategies: ['Momentum Breakout'],
        entryPoints: [{ description: 'entry', price: '94500' }],
        stopLoss: '93200',
        takeProfit: [{ price: '96800' }],
        marketConditions: {
            pattern: 'Breakout',
            candleBehavior: '',
            timeframeAlignment: '',
            rsi: '',
            macd: '',
            sentiment: '',
        },
        historicalCorrelation: '',
        detectedPatternFamily: 'Family A',
    },
    ...overrides,
});

describe('buildTradeInsightBrief', () => {
    it('includes outcome, levels, and omits screenshot payloads', () => {
        const brief = buildTradeInsightBrief(trade({
            postMortemImages: ['data:image/png;base64,AAAA'],
            thoughtProcesses: { gemini: 'x'.repeat(5000) },
            postMortem: 'Price held the 1H EMA and followed through to TP1.',
        }));

        expect(brief).toContain('Outcome: WIN');
        expect(brief).toContain('Asset: BTC');
        expect(brief).toContain('94500');
        expect(brief).toContain('93200');
        expect(brief).toContain('held the 1H EMA');
        expect(brief).not.toContain('data:image/png');
        expect(brief).not.toContain('AAAA');
    });

    it('truncates a very long post-mortem instead of dumping the full debate', () => {
        const brief = buildTradeInsightBrief(trade({
            outcome: TradeOutcome.LOSS,
            postMortem: 'LOSS diagnosis. '.repeat(400),
        }));
        expect(brief.length).toBeLessThan(4000);
        expect(brief).toContain('Outcome: LOSS');
    });
});

describe('insightTextForTrade', () => {
    it('prefers the post-mortem over a fallback summary', () => {
        expect(insightTextForTrade(trade({ postMortem: '## Outcome\nWIN' }), 'short')).toContain('## Outcome');
    });

    it('uses the fallback when no post-mortem exists', () => {
        expect(insightTextForTrade(trade(), 'short lesson')).toBe('short lesson');
    });
});

describe('compactInsightForPatternMemory', () => {
    it('truncates long reports for pattern-memory synthesis', () => {
        const compact = compactInsightForPatternMemory('word '.repeat(200), 40);
        expect(compact.length).toBeLessThanOrEqual(41);
        expect(compact.endsWith('…')).toBe(true);
    });
});

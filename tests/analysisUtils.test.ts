import { describe, it, expect } from 'vitest';
import { recalculateAnalysisMetrics, parseProseTradePlan, parseMarkdownTradePlan, tradePlanToAnalysis, stripPlanTags } from '../utils/analysisUtils';

describe('analysisUtils', () => {
  describe('parseMarkdownTradePlan (the ONLY moderator output contract — no JSON)', () => {
    it('extracts every labeled field from the markdown plan block', () => {
      const planMd = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Short
- **Entry:** 64500 — Sweep-reclaim retest
- **Stop Loss:** 65100
- **Take Profit 1:** 63800 (2%)
- **Take Profit 2:** 63000 (4%)
- **Confidence:** High
- **Probability:** 68%
- **Grade:** B
- **Strategy:** Range-break continuation
- **Pattern Family:** Family C
- **Support:** 64577 (pivot), 64261 (fib)
- **Resistance:** 65316 (pivot), 65474 (swing)
- **Validity Window:** 4h
- **Invalidation:** 4H close below 64261`;
      const plan = parseMarkdownTradePlan(planMd);
      expect(plan).not.toBeNull();
      expect(plan!.coinName).toBe('BTCUSDT');
      expect(plan!.direction).toBe('Short');
      expect(plan!.entry).toBe('64500');
      expect(plan!.stopLoss).toBe('65100');
      expect(plan!.takeProfit).toBe('63800');
      expect(plan!.probability).toBe(68);
      expect(plan!.confidence).toBe('High');
      expect(plan!.grade).toBe('B');
      expect(plan!.patternFamily).toBe('Family C');
      expect(plan!.validityWindow).toBe('4h');
      expect(plan!.support).toEqual(['64577 (pivot)', '64261 (fib)']);
      expect(plan!.resistance).toEqual(['65316 (pivot)', '65474 (swing)']);
    });

    it('extracts the FULL organized field set (the old JSON schema, in markdown)', () => {
      const full = `**FINAL TRADE PLAN**

**Setup**
- **Coin:** ETHUSDT
- **Direction:** Long
- **Grade:** A
- **Pattern Family:** Family B
- **Validity Window:** 5h30m

**Levels**
- **Entry:** 3200 — Key support retest
- **Stop Loss:** 3150
- **Take Profit 1:** 3260 (2%)
- **Take Profit 2:** 3320 (4%)

**Odds**
- **Confidence:** High
- **Probability:** 72%
- **SL Probability:** 22%
- **TP1 Probability:** 70%
- **TP2 Probability:** 52%

**Strategy**
- **Strategy:** Reversal after sweep
- **Historical Correlation:** Similar to past winning setups

**Market Conditions**
- **Pattern:** Bull Flag
- **Candle Behavior:** Higher lows forming
- **Timeframe Alignment:** 3 of 4 bullish
- **RSI:** 55
- **MACD:** Bullish crossover
- **Sentiment:** Neutral
- **Prices:** 5m 3210 · 1h 3200 · 4h 3180

**Detected Patterns**
- **Pattern 1:** Bull Flag (1h, Bullish, high confidence) — Consolidating above support

**Key Levels**
- **Support:** 3150 (4h), 3100 (1h)
- **Resistance:** 3260 (4h), 3320 (1h)

**Dual Scenario**
- **Bullish Trigger:** 3220 — 4H close above with volume
- **Bullish Target:** 3300
- **Bullish Invalidation:** 3140
- **Bearish Trigger:** 3120 — 4H close below
- **Bearish Target:** 3050
- **Bearish Invalidation:** 3180
- **Selected Scenario:** Bullish — HTF trend bullish
- **Scenario Confidence:** 78%

**Invalidation Criteria**
- **Invalidation 1:** 3150 (price) — 4H close below support — Bullish thesis dead
- **Invalidation 2:** 5h30m (time) — No breakout before expiry

**Devil's Advocate**
- **Bear Case:** Liquidity sweep below entry
- **Failure Scenarios:** Wick through 3150 before reversal
- **Crowded Trade Warning:** Funding elevated
- **Risk Score:** 42

**Evidence**
- **Evidence 1:** 1H structure bullish (HH/HL) — observed — sources: 1H EMA20/50, RSI(14) 58
- **Evidence 2:** Volume confirms breakout — partial — sources: Volume 1.8x`;
      const plan = parseMarkdownTradePlan(full)!;
      expect(plan.grade).toBe('A');
      expect(plan.marketConditions).toEqual({
        pattern: 'Bull Flag',
        candleBehavior: 'Higher lows forming',
        timeframeAlignment: '3 of 4 bullish',
        rsi: '55',
        macd: 'Bullish crossover',
        sentiment: 'Neutral',
        prices: { '5m': '3210', '1h': '3200', '4h': '3180' },
      });
      expect(plan.detectedPatterns).toEqual([
        { name: 'Bull Flag', timeframe: '1h', type: 'Bullish', confidence: 'high confidence', description: 'Consolidating above support' },
      ]);
      expect(plan.support).toEqual(['3150 (4h)', '3100 (1h)']);
      expect(plan.dualScenario).toMatchObject({
        bullish: { trigger: '3220', confirmation: '4H close above with volume', target: '3300', invalidation: '3140' },
        bearish: { trigger: '3120', confirmation: '4H close below', target: '3050', invalidation: '3180' },
        selected: 'Bullish',
        reasoning: 'HTF trend bullish',
        confidence: 78,
      });
      expect(plan.invalidations).toEqual([
        { level: '3150', category: 'price', condition: '4H close below support', note: 'Bullish thesis dead' },
        { level: '5h30m', category: 'time', condition: 'No breakout before expiry', note: undefined },
      ]);
      expect(plan.devilsAdvocate).toMatchObject({
        bearCaseReasons: ['Liquidity sweep below entry'],
        failureScenarios: ['Wick through 3150 before reversal'],
        crowdedTradeWarning: 'Funding elevated',
        riskScore: 42,
      });
      expect(plan.slProbability).toBe(22);
      expect(plan.tpProbabilities).toEqual([{ level: 1, probability: 70 }, { level: 2, probability: 52 }]);
      expect(plan.evidence).toEqual([
        { claim: '1H structure bullish (HH/HL)', state: 'observed', sources: ['1H EMA20/50', 'RSI(14) 58'] },
        { claim: 'Volume confirms breakout', state: 'partial', sources: ['Volume 1.8x'] },
      ]);
    });

    it('tradePlanToAnalysis maps the full plan onto TradeAnalysis-shaped fields', () => {
      const plan = parseMarkdownTradePlan(`**FINAL TRADE PLAN**
- **Coin:** ETHUSDT
- **Direction:** Long
- **Grade:** A
- **Validity Window:** 5h30m
- **Entry:** 3200
- **Stop Loss:** 3150
- **Take Profit 1:** 3260
- **Confidence:** High
- **Probability:** 72%
- **Pattern Family:** Family B
- **Support:** 3150 (4h), 3100 (1h)
- **Resistance:** 3260 (4h)` )!;
      const a = tradePlanToAnalysis(plan);
      expect(a.validityDurationMinutes).toBe(330);
      expect(a.detectedPatternFamily).toBe('Family B');
      expect(a.keyLevels).toEqual({ support: ['3150 (4h)', '3100 (1h)'], resistance: ['3260 (4h)'] });
      expect(a.grade).toBe('A');
    });

    it('accepts the plain-label variant (no bullets or bold)', () => {
      const planMd = `**FINAL TRADE PLAN**
Coin: ETHUSDT
Direction: Long
Entry: 3200.50
Stop Loss: 3150
Take Profit 1: 3300
Confidence: Medium
Probability: 60%`;
      const plan = parseMarkdownTradePlan(planMd);
      expect(plan!.coinName).toBe('ETHUSDT');
      expect(plan!.direction).toBe('Long');
      expect(plan!.entry).toBe('3200.50');
      expect(plan!.probability).toBe(60);
    });

    it('falls back to free-form prose when no labels are present', () => {
      const prose = 'The verdict is SHORT BTCUSDT with entry near 64000 and SL at 65000.';
      const plan = parseMarkdownTradePlan(prose);
      expect(plan).not.toBeNull();
      expect(plan!.coinName).toBe('BTCUSDT');
      expect(plan!.direction).toBe('Short');
    });

    it('normalizes USD/PERP suffixes to the USDT quote', () => {
      const plan = parseMarkdownTradePlan('**FINAL TRADE PLAN**\n- **Coin:** SOLUSD\n- **Direction:** Long\n- **Entry:** 150');
      expect(plan!.coinName).toBe('SOLUSDT');
    });

    it('returns null for empty input', () => {
      expect(parseMarkdownTradePlan('')).toBeNull();
    });
  });

  describe('parseProseTradePlan (moderator markdown verdict rescue)', () => {
    it('extracts coin, direction, levels, probability and confidence from verdict prose', () => {
      const prose = `**MODERATOR VERDICT** — SHORT BTCUSDT.
The 4h range break failed; entry zone 64,500-64,600 with SL at 65,100. First target 63,800, probability 68%.
Confidence: High. The sweep-reclaim pattern aligns across 15m and 1h.`;
      const plan = parseProseTradePlan(prose);
      expect(plan).not.toBeNull();
      expect(plan!.coinName).toBe('BTCUSDT');
      expect(plan!.direction).toBe('Short');
      expect(plan!.entry).toBe('64,500');
      expect(plan!.stopLoss).toBe('65,100');
      expect(plan!.takeProfit).toBe('63,800');
      expect(plan!.probability).toBe(68);
      expect(plan!.confidence).toBe('High');
    });

    it('returns null for prose with no plan information', () => {
      expect(parseProseTradePlan('The debate was inconclusive, no trade.')).toBeNull();
      expect(parseProseTradePlan('')).toBeNull();
    });

    it('returns null when long/short appear only as analyst discussion', () => {
      const prose = 'Macro argued long but technical saw a short setup forming. Verdict: AVOID.';
      const plan = parseProseTradePlan(prose);
      // No labeled verdict direction, no levels, no probability — no plan.
      expect(plan).toBeNull();
    });

    it('clamps probability to 0-100', () => {
      const plan = parseProseTradePlan('probability 140% long BTCUSDT entry 64000');
      expect(plan!.probability).toBe(100);
    });
  });

  describe('stripPlanTags (the JSON schema never renders in chat)', () => {
    it('removes the JSON plan, debate-end and marker tags, keeping the prose', () => {
      const text = `**MODERATOR VERDICT** — SHORT BTCUSDT.
</DEBATE_END>
<JSON_PLAN>{"coinName":"BTCUSDT","direction":"Short"}</JSON_PLAN>`;
      const cleaned = stripPlanTags(text);
      expect(cleaned).toContain('MODERATOR VERDICT');
      expect(cleaned).not.toContain('<JSON_PLAN>');
      expect(cleaned).not.toContain('</DEBATE_END>');
      expect(cleaned).not.toContain('{"coinName"');
    });
  });

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

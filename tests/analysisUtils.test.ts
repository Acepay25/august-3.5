import { describe, it, expect } from 'vitest';
import { recalculateAnalysisMetrics, leveragedMovePercent, parseProseTradePlan, parseMarkdownTradePlan, tradePlanToAnalysis, stripPlanTags, buildAnalysisMarkdown, buildSupplementMarkdown, buildTradingSignalMarkdown, resolveLevelHitOdds, extractSignalStrategyText, looksLikeModeratorVerdictDump, explainSignalConfidence, signalDirectionLabel, explainNoTrade, isBindingMarkdownPlan, extractModeratorThinking } from '../utils/analysisUtils';
import { MASTER_TRADE_PLAN_MARKDOWN } from '../constants/schemas';

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

    it('is binding only when Long/Short has entry, stop, and a take-profit', () => {
      expect(isBindingMarkdownPlan({
        direction: 'Short',
        entry: '64500',
        stopLoss: '65100',
        takeProfit: '63800',
      })).toBe(true);
      expect(isBindingMarkdownPlan({
        direction: 'Long',
        entry: '64500',
        stopLoss: '65100',
      })).toBe(false);
      expect(isBindingMarkdownPlan({
        direction: 'Long',
        confidence: 'Avoid',
        entry: '64500',
        stopLoss: '65100',
        takeProfit: '63800',
      })).toBe(false);
    });

    it('treats Avoid as binding without levels, and rejects mixed Long+Avoid', () => {
      expect(isBindingMarkdownPlan({ confidence: 'Avoid' })).toBe(true);
      expect(isBindingMarkdownPlan({ direction: 'Long' })).toBe(false);
      expect(isBindingMarkdownPlan(null)).toBe(false);
      expect(isBindingMarkdownPlan(parseMarkdownTradePlan(
        '- **Direction:** Neutral\n- **Confidence:** Avoid',
      ))).toBe(true);
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
- **Take Profit 3:** 3400 (6%)

**Odds**
- **Confidence:** High
- **Probability:** 72%
- **SL Probability:** 22%
- **TP1 Probability:** 70%
- **TP2 Probability:** 52%
- **TP3 Probability:** 34%

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
      expect(plan.takeProfits).toEqual([
        { price: '3260', percentage: '2%' },
        { price: '3320', percentage: '4%' },
        { price: '3400', percentage: '6%' },
      ]);
      expect(plan.tpProbabilities).toEqual([
        { level: 1, probability: 70 },
        { level: 2, probability: 52 },
        { level: 3, probability: 34 },
      ]);
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
- **Take Profit 2:** 3320
- **Take Profit 3:** 3400
- **Confidence:** High
- **Probability:** 72%
- **Pattern Family:** Family B
- **Support:** 3150 (4h), 3100 (1h)
- **Resistance:** 3260 (4h)` )!;
      const a = tradePlanToAnalysis(plan);
      expect(a.validityDurationMinutes).toBe(330);
      expect((a.takeProfit as { price: string }[]).map(t => t.price)).toEqual(['3260', '3320', '3400']);
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

  describe('MASTER_TRADE_PLAN_MARKDOWN ↔ parseMarkdownTradePlan (the moderator contract)', () => {
    it('parses EVERY section of the full template back out', () => {
      const plan = parseMarkdownTradePlan(MASTER_TRADE_PLAN_MARKDOWN);
      expect(plan).not.toBeNull();
      // Setup
      expect(plan!.coinName).toBe('BTCUSDT');
      expect(plan!.direction).toBe('Long');
      expect(plan!.grade).toBe('B');
      expect(plan!.patternFamily).toBe('Family C');
      expect(plan!.validityWindow).toBe('4h');
      // Levels
      expect(plan!.entry).toBe('95000');
      expect(plan!.stopLoss).toBe('94500');
      expect(plan!.takeProfit).toBe('96000');
      expect(plan!.takeProfits?.map(t => t.price)).toEqual(['96000', '97000', '98500']);
      expect(plan!.tpProbabilities).toEqual([
        { level: 1, probability: 70 },
        { level: 2, probability: 55 },
        { level: 3, probability: 35 },
      ]);
      // Odds
      expect(plan!.confidence).toBe('Medium');
      expect(plan!.probability).toBe(65);
      expect(plan!.slProbability).toBe(25);
      expect(plan!.tpProbabilities?.length).toBeGreaterThanOrEqual(2);
      // Strategy
      expect(plan!.strategy).toContain('Trend continuation');
      expect(plan!.historicalCorrelation).toBeTruthy();
      // Market Conditions
      expect(plan!.marketConditions?.pattern).toBe('Bull Flag');
      expect(plan!.marketConditions?.rsi).toBeTruthy();
      expect(plan!.marketConditions?.prices?.['1h']).toBe('95000');
      // Detected Patterns
      expect(plan!.detectedPatterns?.[0]?.name).toBe('Bull Flag');
      expect(plan!.detectedPatterns?.[0]?.timeframe).toBe('1h');
      // Key Levels
      expect(plan!.support?.[0]).toContain('94500');
      expect(plan!.resistance?.[0]).toContain('96000');
      // Dual Scenario
      expect(plan!.dualScenario?.bullish?.target).toBe('97000');
      expect(plan!.dualScenario?.bearish?.trigger).toBe('94000');
      expect(plan!.dualScenario?.selected).toBe('Bullish');
      expect(plan!.dualScenario?.reasoning).toBeTruthy();
      // Invalidation
      expect(plan!.invalidations?.length).toBeGreaterThanOrEqual(2);
      // Devil's Advocate
      expect(plan!.devilsAdvocate?.riskScore).toBe(45);
      expect(plan!.devilsAdvocate?.bearCaseReasons?.length).toBeGreaterThan(0);
      // Evidence
      expect(plan!.evidence?.length).toBeGreaterThanOrEqual(2);
      expect(plan!.evidence?.[0]?.state).toBe('observed');
      expect(plan!.evidence?.[0]?.sources?.length).toBeGreaterThan(0);
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

    it('computes a leveraged move percent from prices', () => {
      expect(leveragedMovePercent('100', '90', 10, 'loss')).toBe('-100.0%');
      expect(leveragedMovePercent('100', '120', 10, 'gain')).toBe('+200.0%');
      expect(leveragedMovePercent('100', '90', 1, 'loss')).toBe('-10.0%');
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

  describe('buildAnalysisMarkdown (guaranteed plan fallback from parsed fields)', () => {
    it('renders every JSON field as organized markdown sections', () => {
      const analysis: any = {
        coinName: 'BTCUSDT',
        direction: 'Short',
        confidence: 'Low',
        probability: 58,
        grade: 'C',
        detectedPatternFamily: 'Family B',
        tradeType: 'swing',
        validityDurationMinutes: 330,
        createdAt: '2026-08-12T00:00:00.000Z',
        entryPoints: [{ price: '75.55', description: '' }],
        stopLoss: '75.95',
        stopLossPercentage: '-52.9%',
        takeProfit: [{ price: '75.00', percentage: '+72.8%' }],
        rrRatio: 1.37,
        levelProbabilities: { slProbability: 30, tpProbabilities: [{ level: 1, probability: 55 }] },
        marketConditions: { pattern: 'Breakdown', rsi: '37.8', macd: 'bearish', candleBehavior: '', timeframeAlignment: '', sentiment: '', prices: { '1h': '75.40' } },
        detectedPatterns: [{ name: 'Bearish BOS Continuation', timeframe: '1H', confidence: 'low' }],
        keyLevels: { support: ['75.34'], resistance: ['75.95'] },
        dualScenarioAnalysis: { bullish: { trigger: '75.95' }, bearish: { trigger: '75.55', target: '74.22' }, selectedScenario: 'bearish', confidenceInSelection: 58 },
        invalidationCriteria: [{ level: '75.95', condition: '15m close above OB' }],
        evidence: [{ claim: '1H BOS confirmed', state: 'observed', sources: ['1H structure'] }],
        devilsAdvocate: { riskScore: 20, bearCaseReasons: ['Liquidity grab'], failureScenarios: ['Stop hunt'], crowdedTradeWarning: '' },
      };
      const md = buildAnalysisMarkdown(analysis);
      expect(md).toContain('**Setup**');
      expect(md).toContain('**Levels**');
      expect(md).toContain('Entry: **75.55**');
      expect(md).toContain('Stop Loss: **75.95** (-52.9%)');
      expect(md).toContain('TP1: **75.00** (+72.8%)');
      expect(md).toContain('Risk/Reward: **1.37:1**');
      expect(md).toContain('**Odds**');
      expect(md).toContain('SL hit: **30%**');
      expect(md).toContain('**Market Conditions**');
      expect(md).toContain('**Detected Patterns**');
      expect(md).toContain('**Key Levels**');
      expect(md).toContain('**Dual Scenario Analysis**');
      expect(md).toContain('**Invalidation**');
      expect(md).toContain('**Evidence**');
      expect(md).toContain("**Devil's Advocate**");
      // No raw JSON anywhere
      expect(md).not.toContain('{');
    });

    it('includes the family nickname and always shows the gate verdict', () => {
      const analysis: any = {
        coinName: 'BTCUSDT',
        direction: 'Short',
        confidence: 'Low',
        probability: 58,
        detectedPatternFamily: 'Family B',
        gateResult: { passed: true, confidenceCap: 1, penalties: { dataIntegrity: 0, patternMemory: 0, htfConflict: 0, volumeContext: 0, rawTotal: 0, effectiveTotal: 0 }, familyBias: { A: 0, B: 0, C: 0, Omega: 0 }, warnings: [], insights: [] },
      };
      const md = buildAnalysisMarkdown(analysis);
      expect(md).toContain('Pattern Family: **Family B** — "Directional Flip Family"');
      // The gate verdict lives in the supplement builder and always renders.
      const sup = buildSupplementMarkdown(analysis);
      expect(sup).toContain('**Validation gate**');
      expect(sup).toContain('| Verdict | PASS |');
    });

    it('omits empty sections', () => {
      const md = buildAnalysisMarkdown({ direction: 'Neutral', confidence: 'Medium' } as any);
      expect(md).toContain('**Setup**');
      expect(md).not.toContain('**Levels**');
      expect(md).not.toContain('**Odds**');
    });
  });

  describe('buildTradingSignalMarkdown (verdict + plan, no clarification dump)', () => {
    const analysis: any = {
      coinName: 'BTCUSDT',
      direction: 'Short',
      confidence: 'Medium',
      probability: 62,
      entryPoints: [{ price: '63710' }],
      stopLoss: '64200',
      takeProfit: [{ price: '62800' }],
      strategy: 'Macro: You cite 1H HH/HL at $64,010 but 4H bearish. What exact 1H BOS/CHoCH price confirms Family B long, and what level invalidates?\n\nTechnical: You claim 15m LH/LL and 4H early uptrend. Cite exact prices?\n\nRisk: You demand exact entry/SL/TP. What are your proposed short levels?',
    };

    it('renders a compact ticket: levels, odds, no moderator recap', () => {
      const md = buildTradingSignalMarkdown(analysis);
      expect(md).toContain('**Trading signal**');
      expect(md).toContain('**Sell**');
      expect(md).toContain('**Levels**');
      expect(md).toContain('| Level | Price | Hit |');
      expect(md).toContain('| Entry | **63710** |');
      expect(md).toContain('| Stop Loss | **64200** |');
      expect(md).not.toContain('What exact 1H BOS');
      expect(md).not.toContain('**Setup**');
      expect(md).not.toContain('**Market Conditions**');
    });

    it('does not prepend a moderator verdict recap onto the plan', () => {
      const md = buildTradingSignalMarkdown(analysis, [
        { speaker: 'Moderator', round: 4, text: 'Macro: What exact 1H BOS?\nTechnical: Cite 15m highs?\nRisk: What SL?' },
        { speaker: 'Moderator', round: 6, text: '**MODERATOR VERDICT** Direction: Long, based on the Technical Analyst and the Risk & Execution Specialist. The Macro & Volatility Analyst stayed neutral.\n\n**FINAL TRADE PLAN**\n- Direction: Long' },
      ]);
      expect(md).not.toContain('MODERATOR VERDICT');
      expect(md).not.toContain('Technical Analyst');
      expect(md).toContain('**Levels**');
      expect(md).toContain('| Entry | **63710** |');
    });

    it('keeps a short strategy line without a verdict dump', () => {
      const md = buildTradingSignalMarkdown({
        ...analysis,
        strategy: 'Fade the 4H rejection if 15m stays below 63710.',
      });
      expect(md).toContain('Fade the 4H rejection');
      expect(md).toContain('**Why**');
      expect(md).toContain('**Levels**');
    });

    it('includes invalidation when the plan has it', () => {
      const md = buildTradingSignalMarkdown({
        ...analysis,
        invalidationCriteria: [{ level: '64200', condition: '1H close above rejection' }],
      });
      expect(md).toContain('**Invalidation**');
      expect(md).toContain('1H close above rejection');
    });

    it('explains why confidence is Medium / Avoid / High', () => {
      const medium = buildTradingSignalMarkdown(analysis);
      expect(medium).toContain('**Confidence**');
      expect(medium).toContain('Medium because');
      expect(medium).toContain('62% probability maps to Medium');

      const avoid = buildTradingSignalMarkdown({
        ...analysis,
        confidence: 'Avoid',
        probability: 38,
        riskVeto: 'Missing stop loss on the final plan',
      });
      expect(avoid).toContain('Avoid because');
      expect(avoid).toContain('Missing stop loss');
    });
  });

  describe('explainSignalConfidence', () => {
    it('cites the gate cap and a confidence downgrade', () => {
      const text = explainSignalConfidence({
        direction: 'Short',
        confidence: 'Low',
        originalConfidence: 'High',
        probability: 48,
        gateResult: {
          passed: false,
          confidenceCap: 0.55,
          penalties: { dataIntegrity: 0, patternMemory: 0.12, htfConflict: 0, volumeContext: 0, rawTotal: 0.12, effectiveTotal: 0.12 },
          familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: [] },
          warnings: [],
          insights: [],
        },
      } as any);
      expect(text).toContain('Low because');
      expect(text).toContain('downgraded from High');
      expect(text).toContain('capped conviction at 55%');
      expect(text).toContain('pattern memory');
    });
  });

  describe('extractSignalStrategyText', () => {
    it('drops moderator verdict recaps', () => {
      const text = extractSignalStrategyText({
        direction: 'Long',
        confidence: 'Avoid',
        strategy: '**MODERATOR VERDICT** Direction: Long, based on the Technical Analyst’s sweep and the Risk & Execution Specialist’s mean-reversion read.',
      } as any);
      expect(text).toBe('');
      expect(looksLikeModeratorVerdictDump('**MODERATOR VERDICT** Long BTC')).toBe(true);
    });
  });

  describe('resolveLevelHitOdds', () => {
    it('reads stored levelProbabilities first', () => {
      const odds = resolveLevelHitOdds({
        direction: 'Long',
        confidence: 'High',
        levelProbabilities: {
          slProbability: 22.4,
          tpProbabilities: [
            { level: 1, probability: 71 },
            { level: 2, probability: 50 },
            { level: 3, probability: 33 },
          ],
        },
      } as any);
      expect(odds).toEqual({ sl: 22, tp: [71, 50, 33] });
    });

    it('falls back to labeled plan markdown on strategy', () => {
      const odds = resolveLevelHitOdds({
        direction: 'Short',
        confidence: 'Low',
        strategy: '- **SL Probability:** 31%\n- **TP1 Probability:** 68%\n- **TP2 Probability:** 49%\n- **TP3 Probability:** 22%',
      } as any);
      expect(odds).toEqual({ sl: 31, tp: [68, 49, 22] });
    });
  });

  describe('signalDirectionLabel', () => {
    it('maps Long/Short and treats Avoid as no trade', () => {
      expect(signalDirectionLabel('Long', 'High')).toBe('Buy');
      expect(signalDirectionLabel('Short', 'Medium')).toBe('Sell');
      expect(signalDirectionLabel('Short', 'Avoid')).toBe('No trade');
      expect(signalDirectionLabel('Neutral', 'Medium')).toBe('No trade');
    });

    it('explains No trade as skip, not a Buy/Sell', () => {
      expect(explainNoTrade({ confidence: 'Avoid' })).toMatch(/no trade to take/i);
      expect(explainNoTrade({ direction: 'Neutral', confidence: 'Medium' })).toMatch(/no directional edge/i);
    });
  });

  describe('extractModeratorThinking (bubble Thinking row for ensemble messages)', () => {
    it('merges the moderator reasoning lanes regardless of key casing', () => {
      const merged = extractModeratorThinking(
        { moderator: 'Weighing the sweep.' },
        { Moderator: 'Checked the funding.' },
      );
      expect(merged).toContain('Weighing the sweep.');
      expect(merged).toContain('Checked the funding.');
    });

    it('dedupes identical lanes so the trace is not repeated', () => {
      const merged = extractModeratorThinking(
        { moderator: 'Same trace.' },
        { Moderator: 'Same trace.' },
      );
      expect(merged).toBe('Same trace.');
    });

    it('returns empty when no moderator lane exists', () => {
      expect(extractModeratorThinking({ 'analyst-a': 'not the moderator' }, {})).toBe('');
      expect(extractModeratorThinking(undefined, undefined)).toBe('');
    });
  });
});

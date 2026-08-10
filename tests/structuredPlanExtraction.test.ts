import { describe, it, expect } from 'vitest';
import { extractStructuredPlanFromProse } from '../services/providers/GenericAnalysisService';

/**
 * The analysts write readable prose (the prompts forbid JSON), but the
 * pipeline's structured consumers — per-analyst Monte Carlo, the consensus
 * panel, pre-debate divergence, Bayesian calibration, the Gate's
 * confidence-conflict challenge — all key on
 * analysis.entryPoints/stopLoss/takeProfit/probability. This parser mines
 * those fields out of the prose. These tests pin the parser against the
 * output shapes the prompts mandate (master-prompt Section 8, the lens role
 * tables, and the machine-readable TRADE PLAN BLOCK).
 */
describe('extractStructuredPlanFromProse', () => {
    it('extracts the master-prompt Section 8 labeled fields', () => {
        const plan = extractStructuredPlanFromProse(`
The 1h structure is bullish with a clean break of the last swing high.

Section 8 — FULL TRADE SETUP:
Direction: Long
Entry Zone: 94,500 - 94,800
Stop Loss: 94,000
Take Profit 1: 96,000
Take Profit 2: 97,500
Long Probability %: 65%
Confidence: Medium
`);
        expect(plan.direction).toBe('Long');
        expect(plan.entryPoints).toEqual(['94,500 - 94,800']);
        expect(plan.stopLoss).toBe('94,000');
        expect(plan.takeProfit).toEqual(['96,000', '97,500']);
        expect(plan.probability).toBe(65);
        expect(plan.confidence).toBe('Medium');
    });

    it('extracts the machine-readable TRADE PLAN BLOCK', () => {
        const plan = extractStructuredPlanFromProse(`
Bearish momentum with a sweep of the liquidity pool below the range.

TRADE PLAN BLOCK:
Direction: Short
Entry: 100.5
Stop Loss: 102.0
Take Profit 1: 98.0
Take Profit 2: N/A
Probability: 55%
`);
        expect(plan.direction).toBe('Short');
        expect(plan.entryPoints).toEqual(['100.5']);
        expect(plan.stopLoss).toBe('102.0');
        expect(plan.takeProfit).toEqual(['98.0']);
        expect(plan.probability).toBe(55);
    });

    it('reads lens-role bias lines (MACRO BIAS / TECHNICAL BIAS)', () => {
        expect(extractStructuredPlanFromProse('**MACRO BIAS:**\nSTRONG LONG\n**MACRO CONFIDENCE:**\n7').direction).toBe('Long');
        expect(extractStructuredPlanFromProse('**TECHNICAL BIAS:**\nSHORT').direction).toBe('Short');
    });

    it('sees through markdown-bolded labels and Bullish/Bearish verdicts', () => {
        // The lens prompts mandate **MACRO VERDICT:** / **TECHNICAL BIAS:**
        // — the parser must see past the asterisks, and "Bullish"/"Bearish"
        // verdicts map to Long/Short.
        expect(extractStructuredPlanFromProse('**MACRO VERDICT:** Bullish').direction).toBe('Long');
        expect(extractStructuredPlanFromProse('**MACRO VERDICT:** Bearish').direction).toBe('Short');
        expect(extractStructuredPlanFromProse('**TECHNICAL BIAS:**\nLONG').direction).toBe('Long');
        expect(extractStructuredPlanFromProse('**TECHNICAL BIAS:**\nNO TRADE').direction).toBe('Neutral');
    });

    it('does NOT treat a 1-10 role scale as a probability', () => {
        const plan = extractStructuredPlanFromProse('**MACRO CONFIDENCE:**\n7');
        expect(plan.probability).toBeUndefined();
    });

    it('ignores a template echo listing every direction option', () => {
        const plan = extractStructuredPlanFromProse('**TECHNICAL BIAS:**\nLONG / SHORT / NO TRADE');
        expect(plan.direction).toBeUndefined();
    });

    it('ignores the "<0-100>%" range placeholder as a probability', () => {
        const plan = extractStructuredPlanFromProse('Probability: <0-100>%\nDirection: Long');
        expect(plan.probability).toBeUndefined();
        expect(plan.direction).toBe('Long');
    });

    it('never fabricates fields from prose without labeled levels', () => {
        const plan = extractStructuredPlanFromProse(
            'Buyers absorbed the dip at 93,800 and price is coiling above value. RSI is healthy at 58.'
        );
        expect(plan.direction).toBeUndefined();
        expect(plan.entryPoints).toBeUndefined();
        expect(plan.stopLoss).toBeUndefined();
        expect(plan.takeProfit).toBeUndefined();
        expect(plan.probability).toBeUndefined();
    });

    it('handles TP labels with and without numbers and SL vs SL%', () => {
        const plan = extractStructuredPlanFromProse(`
Direction: Long
Entry: 95000
Stop Loss: 94500
Stop Loss Percentage: -1.5%
Take Profit: 96000
TP2: 97000
`);
        expect(plan.stopLoss).toBe('94500'); // "Stop Loss Percentage" must NOT match
        expect(plan.takeProfit).toEqual(['96000', '97000']);
    });

    it('is case-insensitive and tolerates parenthetical annotations', () => {
        const plan = extractStructuredPlanFromProse(`
direction: SHORT
entry zone: 94,000 (limit)
stop loss: 94,800
take profit 1: 93,200 (50% of position)
probability: 60%
`);
        expect(plan.direction).toBe('Short');
        expect(plan.entryPoints).toEqual(['94,000']);
        expect(plan.stopLoss).toBe('94,800');
        expect(plan.takeProfit).toEqual(['93,200']);
        expect(plan.probability).toBe(60);
    });
});

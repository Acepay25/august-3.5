import { describe, it, expect } from 'vitest';
import { extractStructuredSummary } from '../services/providers/GenericAnalysisService';
import { sanitizeAIResponse } from '../utils/sanitizers';

describe('extractStructuredSummary (pattern-memory CoT stripping)', () => {
    it('strips the leading chain of thought and keeps only the drafted summary', () => {
        // Mirrors the real leak: the model plans the answer in its thinking
        // (mentioning headings inline), then drafts the full structured
        // summary with standalone heading lines at the end of the response.
        const leaked = `We need answer summary exactly headings. Need analyze one trade.
Need maybe "Executive Summary" include one losing trade, no missed wins.
Need "Missed Win Analysis": count 0, % avoidable losses 0%.
Need "Extended SL Zone Breach Analysis": Count 0.
Need "Pattern Family Performance": Family C 0/1.
Need "Confidence Calibration": Medium 0/1.
Need "Winning Patterns": none. "Failure Patterns": one.
Need "Behavioral Biases": single trade. "Statistical Tendencies": one trade.
Need "Actionable Rules": wait for more data. "Conclusion": one loss.
Let's craft. Let's draft:

Executive Summary
The dataset contains one historical SOLUSDT trade on Aug 6. It was a LONG entered at 74.55, SL 73.95, TP 76.20, R:R 1:2.75, 100x. The trade resulted in a full LOSS.

Missed Win Analysis
[MISSED WIN - TIGHT SL] trades: 0. The single loss was not flagged as a missed win, so 0% of losses were avoidable by SL adjustment.

Extended SL Zone Breach Analysis
[150% ZONE BREACH] trades: 0. No extended SL zone event was recorded.

Pattern Family Performance
Family C: 0 wins / 1 loss = 0%. Family A, B, Omega: no trades. Best not determinable; worst is Family C by default.

Confidence Calibration
Medium: 0/1 = 0%. High/Low: no trades. Confidence ratings not calibrated from one sample.

Winning Patterns
No winning patterns. No trade reached TP 76.20.

Failure Patterns
Family C range breakout long, 100x London trending, hit SL 73.95 (-0.60).

Behavioral Biases
Small-sample overinterpretation; possible premature entry before 4H confirmation.

Statistical Tendencies
Total trades 1, win rate 0%, average loss -0.60 (1R). R:R 1:2.75 implies a breakeven win rate of ~26.7%.

Actionable Rules
Do not adjust SL from one non-flagged loss. Wait for confirmed 4H breakout. Reduce 100x leverage until more data.

Conclusion
This single long was a clean one-sided loss. Sample size one: no reliable conclusion. Collect more data before changing rules.`;

        const result = extractStructuredSummary(sanitizeAIResponse(leaked));
        expect(result).not.toBeNull();
        // The thinking is gone — the answer starts at the real heading.
        expect(result).not.toContain('We need answer summary exactly headings');
        expect(result).not.toContain("Let's craft");
        expect(result?.startsWith('Executive Summary')).toBe(true);
        // And the full draft is intact.
        expect(result).toContain('Missed Win Analysis');
        expect(result).toContain('Conclusion');
        expect(result).toContain('The dataset contains one historical SOLUSDT trade');
    });

    it('passes a clean response through unchanged', () => {
        const clean = `Executive Summary
One trade, one loss, no missed wins.

Missed Win Analysis
Count 0.

Extended SL Zone Breach Analysis
Count 0.

Pattern Family Performance
Family C 0/1.

Confidence Calibration
Medium 0/1.

Winning Patterns
None.

Failure Patterns
One loss.

Behavioral Biases
Small sample.

Statistical Tendencies
One trade.

Actionable Rules
Wait for data.

Conclusion
No conclusion from one sample.`;

        const result = extractStructuredSummary(sanitizeAIResponse(clean));
        expect(result).toBe(clean.trim());
    });

    it('returns null for pure chain-of-thought with no standalone headings', () => {
        const pureCoT = `We need answer summary exactly headings. Need analyze one trade.
Need output one continuous text block ~4000 chars.
Need include all headings. Need compute stats from one trade.
Trade: SOLUSDT LONG Medium Family C Range breakout. Outcome LOSS.`;
        expect(extractStructuredSummary(sanitizeAIResponse(pureCoT))).toBeNull();
    });

    it('handles markdown-decorated headings', () => {
        const decorated = `Some planning text without heading line starts.
### Executive Summary
The dataset has one losing trade.
### Missed Win Analysis
Count 0.
### Extended SL Zone Breach Analysis
Count 0.
### Pattern Family Performance
Family C 0/1.
### Confidence Calibration
Medium 0/1.
### Winning Patterns
None.
### Failure Patterns
One.
### Behavioral Biases
Small sample.
### Statistical Tendencies
One trade.
### Actionable Rules
Wait.
### Conclusion
One loss.`;

        const result = extractStructuredSummary(sanitizeAIResponse(decorated));
        expect(result).not.toBeNull();
        expect(result).not.toContain('Some planning text');
        expect(result).toContain('Executive Summary');
        expect(result).toContain('The dataset has one losing trade');
    });

    it('prefers the LAST heading candidate (real answer) over an earlier false positive', () => {
        // A CoT fragment that itself starts a line with "Executive Summary"
        // must lose to the real draft that follows it.
        const tricky = `Executive Summary heading should include one losing trade.
Missed Win Analysis: count 0.
Extended SL Zone Breach Analysis: count 0.
Pattern Family Performance: Family C 0/1.
Confidence Calibration: Medium 0/1.
Winning Patterns: none.
Failure Patterns: one.
Behavioral Biases: small sample.
Statistical Tendencies: one trade.
Actionable Rules: wait.
Conclusion: one loss.
Now writing the actual summary:

Executive Summary
The real summary content starts here.
Missed Win Analysis
0 missed wins.
Extended SL Zone Breach Analysis
0 breaches.
Pattern Family Performance
Family C 0/1.
Confidence Calibration
Medium 0/1.
Winning Patterns
None.
Failure Patterns
One.
Behavioral Biases
Small sample.
Statistical Tendencies
One trade.
Actionable Rules
Wait.
Conclusion
One loss, no conclusion.`;

        const result = extractStructuredSummary(sanitizeAIResponse(tricky));
        expect(result).not.toBeNull();
        expect(result).toContain('The real summary content starts here');
        expect(result).not.toContain('heading should include');
    });

    it('rejects a candidate whose tail lacks the heading quorum', () => {
        const sparse = `Some thinking.
Executive Summary
Only two headings follow — not a real structured answer.
Missed Win Analysis
Count 0.
Conclusion
Done.`;
        expect(extractStructuredSummary(sanitizeAIResponse(sparse))).toBeNull();
    });

    it('handles numbered headings ("1. Executive Summary")', () => {
        const numbered = `1. Executive Summary
The dataset has one losing trade.
2. Missed Win Analysis
Count 0.
3. Extended SL Zone Breach Analysis
Count 0.
4. Pattern Family Performance
Family C 0/1.
5. Confidence Calibration
Medium 0/1.
6. Winning Patterns
None.
7. Failure Patterns
One.
8. Behavioral Biases
Small sample.
9. Statistical Tendencies
One trade.
10. Actionable Rules
Wait.
11. Conclusion
One loss, no conclusion.`;

        const result = extractStructuredSummary(sanitizeAIResponse(numbered));
        expect(result).not.toBeNull();
        // The answer is preserved verbatim — including the model's numbering.
        expect(result?.startsWith('1. Executive Summary')).toBe(true);
        expect(result).toContain('The dataset has one losing trade');
        expect(result).toContain('One loss, no conclusion');
    });

    it('rejects a reasoning-only checklist that trails off at "Conclusion:"', () => {
        // A bare CoT checklist in heading form must NOT be stored as the
        // summary — it has no content after the Conclusion heading.
        const checklist = `Executive Summary: count trades
Missed Win Analysis: count 0
Extended SL Zone Breach Analysis: count 0
Pattern Family Performance: compare
Confidence Calibration: compare
Winning Patterns: none
Failure Patterns: one
Behavioral Biases: small sample
Statistical Tendencies: one trade
Actionable Rules: wait
Conclusion: one loss`;
        expect(extractStructuredSummary(sanitizeAIResponse(checklist))).toBeNull();
    });

    it('rejects same-line-colon answers without content after Conclusion (retry path)', () => {
        // Colon-form headings are recognized as the anchor, but an answer
        // that ends AT the Conclusion heading has no trailing content — it
        // fails the final check and is left for the hardened retry instead
        // of being stored as-is.
        const sameLine = `Executive Summary: The dataset has one losing trade.
Missed Win Analysis: Count 0.
Extended SL Zone Breach Analysis: Count 0.
Pattern Family Performance: Family C 0/1.
Confidence Calibration: Medium 0/1.
Winning Patterns: None.
Failure Patterns: One.
Behavioral Biases: Small sample.
Statistical Tendencies: One trade.
Actionable Rules: Wait.
Conclusion: One loss, no conclusion.`;
        expect(extractStructuredSummary(sanitizeAIResponse(sameLine))).toBeNull();
    });

    it('accepts a same-line-colon answer whose Conclusion section has content', () => {
        const withContent = `Executive Summary: The dataset has one losing trade.
Missed Win Analysis: Count 0.
Extended SL Zone Breach Analysis: Count 0.
Pattern Family Performance: Family C 0/1.
Confidence Calibration: Medium 0/1.
Winning Patterns: None.
Failure Patterns: One.
Behavioral Biases: Small sample.
Statistical Tendencies: One trade.
Actionable Rules: Wait.
Conclusion: One loss, no conclusion.

The pattern is not statistically significant yet.`;
        const result = extractStructuredSummary(sanitizeAIResponse(withContent));
        expect(result).not.toBeNull();
        expect(result).toContain('The dataset has one losing trade');
        expect(result).toContain('not statistically significant');
    });
});

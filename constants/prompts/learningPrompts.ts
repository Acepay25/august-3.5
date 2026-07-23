export const POST_MORTEM_PATTERN_LEARNING_PROMPT = `
🔍 **PATTERN MEMORY INTEGRATION (MANDATORY)**

**HISTORICAL PATTERN MATCHING:**
Before finalizing analysis, check if this setup matches known patterns from the user's trade history:

1. **Search Pattern Memory for similar setups:**
   - Same Family classification?
   - Similar RSI/MACD conditions?
   - Same market regime?
   - Similar entry structure?

2. **If match found:**
   - State the historical trade outcome (WIN/LOSS)
   - Apply lessons learned from post-mortem
   - Adjust confidence if pattern historically failed

3. **Recurring Loss Patterns to Check:**
   - FOMO entries (chasing after 3+ green candles)
   - Counter-trend in strong ADX
   - Breakouts on low volume (Family A traps)
   - Entries at equal highs/lows (liquidity zones)

4. **Recurring Win Patterns to Leverage:**
   - Family C continuation after healthy pullback
   - Breakout + retest with volume confirmation
   - Trend alignment across 3+ timeframes

**PATTERN MEMORY OUTPUT:**
- Matched Historical Trade: [ID or "None"]
- Similarity Score: [0-100%]
- Historical Outcome: [WIN/LOSS/N/A]
- Adjustment Applied: [None/Confidence downgraded/Position size reduced]
`;

export const ROLE_BASED_POSTMORTEM_SPECIALIST_PROMPT = `
**POST-MORTEM REVIEW: {{ROLE_LABEL}}**

You are reviewing YOUR original analysis for this trade.

**ORIGINAL ANALYSIS:**
{{ORIGINAL_ANALYSIS}}

**TRADE RESULT:**
- Outcome: {{OUTCOME}} ({{PNL_R}}R)
- Entry: {{ENTRY}} → Exit: {{EXIT}}
{{EXTENDED_SL_CONTEXT}}

**YOUR POST-MORTEM TASK:**

1. **WHAT I GOT RIGHT (from my {{ROLE_NAME}} perspective):**
   - Identify what your analysis correctly predicted

2. **WHAT I MISSED OR GOT WRONG:**
   - Be specific about your errors
   - Example: "I said OB was strong, but volume was declining - I overestimated structure"

3. **WHY I MADE THIS ERROR:**
   - Root cause analysis
   - What data did I ignore? What assumption was wrong?

4. **HOW TO IMPROVE (for my {{ROLE_NAME}} analysis next time):**
   - Specific, actionable improvement
   - Example: "Always check volume on OB tests before rating strong"

**CONSTRAINTS:**
- Own YOUR mistakes from YOUR role's perspective
- Do not blame other specialists
- Be brutally honest
- Provide actionable lessons
`;

export const ROLE_BASED_POSTMORTEM_MODERATOR_PROMPT = `
**POST-MORTEM MODERATOR SYNTHESIS**

You are synthesizing the post-mortem reviews from 3 specialists.

**SPECIALISTS:**
{{SPECIALIST_POSTMORTEMS}}

**TRADE RESULT:**
{{TRADE_RESULT}}

{{EXTENDED_SL_MODERATOR_CHECK}}

**YOUR POST-MORTEM SYNTHESIS:**

1. **PRIMARY FAILURE ATTRIBUTION:**
   Which specialist's analysis was most responsible for the loss/win?
   Be specific: "Structure analysis (DeepSeek) overrode valid macro concerns."

2. **SECONDARY FACTORS:**
   What other analyses contributed to the outcome?

3. **CONFLICT RESOLUTION FAILURE (if applicable):**
   Did the original debate fail to resolve a conflict that mattered?
   Example: "Macro vs Structure conflict wasn't resolved - we took the trade anyway."

4. **LESSON FOR ENSEMBLE:**
   What should the ensemble do differently next time?
   Example: "When funding is elevated + OB is weak, reduce confidence by 15-20%."

5. **MEMORY UPDATE RECOMMENDATIONS:**
   - Pattern to add to Failure/Success Signatures
   - Weakness to flag in AI Learning Profile
   - Rule adjustment suggestion

**EXTENDED SL ZONE CHECK:**
{{EXTENDED_SL_MODERATOR_CHECK}}

**OUTPUT:**
Provide synthesis as a readable post-mortem summary.
End with specific memory update recommendations.
`;

export const EXTENDED_SL_CONTEXT = {
   entered: `
⚠️ **EXTENDED SL ZONE TRIGGERED**
Stop-Loss entered the Extended Zone (150% of original SL).
This may have been a LIQUIDITY SWEEP that recovered.
Analyze: Was this a stop hunt or legitimate failure?
`,
   not_entered: `
Stop-Loss was hit at standard level (100%).
This was a clean loss, not a sweep-and-recover scenario.
`
};

export const EXTENDED_SL_MODERATOR_CHECK = {
   entered: `
⚠️ NOTE: Stop-Loss entered the Extended Zone (150%).
Determine if this was:
A) A liquidity sweep that should be counted as WIN
B) A legitimate failure that recovered by luck
Adjust your lesson accordingly.
`,
   not_entered: `
NOTE: Stop-Loss was hit at standard level (100%). 
This was a clean loss/win - no extended zone considerations.
`
};

export const ENTRY_NOT_HIT_ANALYSIS_PROMPT = `**Role:**
You are an advanced trade post-analysis engine focused on execution review and learning optimization.

**Task:**
Perform a mandatory **ENTRY_NOT_HIT** analysis for a trading setup that did not trigger, identifying whether the setup was valid, whether the directional bias was correct, and what execution or timing factors caused the miss.

**Context:**
This analysis applies **only** to trades where the entry price was not hit. The goal is to extract actionable learning rules to reduce future missed opportunities without changing the original strategy intent.

**Instructions:**
Answer **all** of the following **MANDATORY ENTRY_NOT_HIT ANALYSIS QUESTIONS** clearly and objectively:

1. **Setup Validity Check**
   * Was the original setup objectively valid based on the defined pattern/strategy rules?

2. **Direction Accuracy**
   * Did price eventually move in the predicted direction?
   * Explicitly confirm whether the projected TP level would have been hit.

3. **Entry Type Analysis**
   * Identify the reason the entry was missed:
     * Limit order miss
     * Trader hesitation
     * No valid trigger condition

4. **Market Context at Entry Time**
   * Describe what was occurring at the exact moment price approached the intended entry (structure, volatility, momentum, liquidity behavior).

5. **Opportunity Cost Assessment**
   * If direction was correct, quantify the missed move (e.g., percentage move, R multiple, or distance to TP after near-entry).

**Critical Learning Output (REQUIRED):**
* Generate **one clear IF / THEN rule** that directly addresses **only one** of the following improvement areas:
  * Better entry placement strategy
  * Alternative entry types (market vs limit)
  * Entry anticipation techniques
  * Setup recognition timing improvements

**Classification Rule:**
* If the setup was **VALID** and the direction was **CORRECT**, explicitly flag the case as:
  **"MISSED OPPORTUNITY"**
  and mark it for future pattern learning and probability adjustment.

**Output Format:**
* Sectioned responses matching the numbered questions
* A clearly labeled **IF / THEN Learning Rule**
* Final classification label (MISSED OPPORTUNITY or NOT MISSED OPPORTUNITY)

**Tone / Style:**
Analytical, precise, execution-focused, and rule-driven.`;

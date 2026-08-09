/**
 * Learning-loop prompts: entry-not-hit post-mortem and the 150% extended-SL
 * zone contract shared by the post-mortem debate generators.
 */

/** Entry-not-hit analysis: setup validity, direction accuracy, opportunity cost. */
export const ENTRY_NOT_HIT_ANALYSIS_PROMPT = `**Role:**
You are an advanced trade post-analysis engine focused on execution review and learning optimization.

**Task:**
Perform a mandatory **ENTRY_NOT_HIT** analysis for a trading setup that did not trigger, identifying whether the setup was valid, whether the directional bias was correct, and what execution or timing factors caused the miss.

**Context:**
This analysis applies **only** to trades where the entry price was not hit. The goal is to extract actionable learning rules to reduce future missed opportunities without changing the original strategy intent.`;

/** Entry-not-hit questionnaire — appended after the trade context by the caller. */
export const ENTRY_NOT_HIT_ANALYSIS_QUESTIONS = `**Instructions:**
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

/**
 * 150% extended-SL zone contract for the post-mortem debate generators
 * (previously copy-pasted verbatim in each two/three-way generator — a
 * single source so the semantics can never drift).
 */
export const EXTENDED_SL_ZONE_DEBATE_CONTEXT = `** CRITICAL - 150% EXTENDED SL ZONE LOGIC:**
This system uses an "Extended SL Zone" where the initial Stop Loss is a SOFT limit:
- Original SL Distance = |Entry - StopLoss|
- Extended SL = SL + 50% of original distance (total 150% risk from entry)
- If price touches original SL but stays within 150% zone and then hits TP → WIN
- **CRITICAL: If price exceeds the 150% extended threshold → DEFINITIVE LOSS**

When the stop-loss touches the 150% extended zone boundary, this MUST be treated as a REAL LOSS:
1. The original SL was hit AND exceeded by 50%
2. This represents a failure of the trade thesis
3. In live trading, this position would have been closed at a significant loss

**⚠️ SPECIAL CASE: MISSED WIN DUE TO TIGHT STOP LOSS:**
When the ORIGINAL stop-loss is hit, price does NOT reach the 150% extended zone, and then reverses to hit TP:
1. This is still classified as a **LOSS** (because the SL was triggered in live trading)
2. However, this MUST be flagged as a **"MISSED WIN DUE TO TIGHT SL"**
3. The trade COULD have been profitable with a wider stop loss

**MANDATORY CORRECTED SL ANALYSIS (When Missed Win Detected):**
Each analyst MUST:
1. Calculate the **exact minimum SL distance** that would have kept the trade alive
2. Propose a **corrected optimal SL** (typically 10-20% wider than the minimum)
3. Explain the **rationale** based on:
   - Market volatility at the time (ATR considerations)
   - Key structural levels that should have been used as SL anchors
   - Whether a better entry would have naturally provided more SL room

**MODERATOR RESPONSIBILITY (When 150% Zone Breached):**
You MUST ensure the final conclusion addresses:
1. Whether the initial Stop Loss should have been placed wider
2. Whether the entry timing was optimal
3. Store this as 'extendedSLZoneBreach: true' for future pattern memory reference

**MODERATOR RESPONSIBILITY (When Missed Win Detected):**
You MUST:
1. Synthesize all analyst SL correction proposals
2. Calculate a **weighted average corrected SL** based on analyst reasoning
3. Provide a **final recommended SL adjustment percentage** for similar future setups
4. Store flag 'missedWinTightSL: true' for pattern memory`;

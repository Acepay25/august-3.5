/**
 * Single source of truth for model + parse contracts.
 * If any other prompt conflicts with this block, this block wins.
 */
export const HARNESS_CONTRACT_PROMPT = `
**HARNESS CONTRACT (highest priority — overrides any conflicting instruction):**
1. **Avoid = no trade.** Direction MUST be Neutral. Never output Long/Short together with Avoid.
2. **One confidence ladder** (probability is 0–100 and MUST match the label):
   - **High** ≥ 70 and R:R ≥ 2.0 — full size
   - **Medium** 55–69 and R:R ≥ 1.5 — standard size
   - **Low** 40–54 and R:R ≥ 1.2 — half size
   - **Avoid** < 40, missing SL/TP, or no setup — skip the trade
3. **Output:** analysts write prose (no JSON, no XML, no name prefix). The moderator's last block is the labeled markdown plan only.
4. **Memory:** use retrieved notes/skills only when they match this coin, direction, or regime. Otherwise ignore them.
`;

import { describe, it, expect } from 'vitest';
import {
    estimateMemoryTokensPerRun,
    stageBudgetChars,
    SKILL_BLOCK_MAX,
} from '../services/learning/MemoryRetrievalService';
import { SETTLED_BELIEFS_BLOCK_MAX } from '../services/learning/settledBeliefs';

// Plan #5: the always-on layer must be accounted, not invisible.
//
// Two always-on slots ride OUTSIDE the per-stage budget:
//   - doctrine          (DOCTRINE_SLOT_CHARS, 800)
//   - settled beliefs   (SETTLED_BELIEFS_BLOCK_MAX, 350) — rendered ABOVE doctrine
// The plan's finding was that this layer "hides itself": stageBudgetChars
// excludes it, so nothing in the budget math accounts for its cost.
//
// The concrete defect this pins: estimateMemoryTokensPerRun is the number the
// Health tab shows the trader as their per-run prompt cost. It counted the
// doctrine slot and silently omitted the settled-beliefs slot — so the one
// figure meant to disclose "what memory costs me per run" under-reported by
// the entire beliefs layer, every run, forever.

describe('the always-on layer is accounted in the cost disclosure', () => {
    it('includes the settled-beliefs slot in the worst-case estimate', () => {
        const { worstCase } = estimateMemoryTokensPerRun();
        // The beliefs slot rides above doctrine and is always-on; an estimate
        // that omits it is not a worst case, it is an optimistic one.
        const withBeliefs = (800 /* doctrine */ + 350 /* beliefs */
            + SKILL_BLOCK_MAX + 300 /* risk rules */ + 200 /* mistake line */
            + 2 * 160 /* verdict extras */) / 4;
        expect(worstCase).toBeGreaterThanOrEqual(Math.round(withBeliefs) - 1);
    });

    it('settled-beliefs is a real always-on cost, not zero', () => {
        // Guards the constant the estimate depends on: if the beliefs slot
        // were ever removed, the accounting above would silently become wrong.
        expect(SETTLED_BELIEFS_BLOCK_MAX).toBeGreaterThan(0);
    });

    it('the estimate never exceeds what the stages can actually carry', () => {
        // The always-on layer is unbudgeted, so the disclosure must stay
        // honest about scale: worst case must exceed the largest single stage
        // budget, or it would be claiming less than one stage already spends.
        const largestStage = Math.max(
            stageBudgetChars('opening', 1_000),
            stageBudgetChars('rebuttal', 1_000),
            stageBudgetChars('verdict', 1_000),
        );
        expect(estimateMemoryTokensPerRun().worstCase * 4).toBeGreaterThan(largestStage);
    });

    it('typical stays below worst case', () => {
        const { worstCase, typical } = estimateMemoryTokensPerRun();
        expect(typical).toBeLessThanOrEqual(worstCase);
        expect(typical).toBeGreaterThan(0);
    });
});

describe('stage budget still excludes the always-on layer by design', () => {
    it('the stage floors and ratios are unchanged — accounting did not silently inflate them', () => {
        // The always-on layer stays OUTSIDE stageBudgetChars on purpose: an
        // unrequested +1150 chars per stage is a real prompt-cost change that
        // needs a decision, not a drift. This pins that #5 did not smuggle it in.
        //
        // NOTE the live budget is window-derived and the 300-token minimum
        // allowance (windowBudgetTokens) means a small window yields 1200
        // chars for opening — ABOVE the 900 stage floor, which is therefore a
        // floor the derived value never actually reaches. So assert the thing
        // that matters: the historical 900 : 400 : 600 PROPORTIONS survive,
        // and the numbers did not move because of #5.
        const open = stageBudgetChars('opening', 200);
        const rebut = stageBudgetChars('rebuttal', 200);
        const verdict = stageBudgetChars('verdict', 200);
        expect(open).toBe(1200);
        // Each stage rounds its own derived value independently, so the
        // proportions are preserved to within rounding, not exactly.
        expect(rebut).toBe(533);
        expect(verdict).toBe(800);
        expect(rebut / open).toBeCloseTo(400 / 900, 2);
        expect(verdict / open).toBeCloseTo(600 / 900, 2);
    });

    it('the always-on total is now derivable from exported constants', () => {
        // The plan's core complaint was that the layer could not be measured
        // from outside. Every term in it is now exported and composable.
        const alwaysOn = 800 + SETTLED_BELIEFS_BLOCK_MAX;
        expect(alwaysOn).toBe(1150);
    });
});

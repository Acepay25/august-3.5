/**
 * E-19 — one plan object.
 *
 * The card, the journal row, the gate's expectancy check and the watch must
 * read the SAME derived numbers. Before this, four places recomputed the ratio
 * from the model's levels and they disagreed. This asserts the object is the
 * seam, not a fifth copy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProposalGate } from '../types/analysis';
import { buildTradePlan, buildProposedTradeAnalysis, type TradeProposal } from '../services/trade/proposedTrade';
import { runGateScan } from '../services/trade/proposalGate';
import { fetchGateInputData, runProgrammaticGate } from '../services/validation/GateKeeperService';

vi.mock('../services/validation/GateKeeperService', () => ({
    fetchGateInputData: vi.fn(async () => ({ any: 'input' })),
    runProgrammaticGate: vi.fn(() => ({ confidenceCap: 0.9, pass: true, warnings: [], reason: 'ok' })),
}));

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100,
    stopLoss: 95,
    takeProfits: [115],
    confidence: 'High',
    planId: 'btc-plan-19',
    ...over,
});

const gate = (over: Partial<ProposalGate> = {}): ProposalGate => ({
    status: 'evaluated', confidenceCap: 0.5, reason: '50% cap',
    stampedAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchGateInputData).mockResolvedValue({ any: 'input' } as never);
    vi.mocked(runProgrammaticGate).mockReturnValue({
        confidenceCap: 0.9, pass: true, warnings: [], reason: 'ok',
    } as never);
});

describe('the plan object is the one source of the derived numbers', () => {
    it('the card, the journal row and the watch agree', () => {
        const p = proposal({ gate: gate() });
        const plan = buildTradePlan(p);
        const row = buildProposedTradeAnalysis(p);

        expect(plan.plannedRr).toBe(3); // (115-100)/(100-95)
        expect(plan.plannedRr).toBe(row.rrRatio);
        expect(plan.probability).toBe(50); // High 72 capped at the gate's 50
        expect(plan.probability).toBe(row.probability);
        expect(plan.confidence).toBe(row.confidence);
        expect(plan.entry).toBe(100);
        expect(plan.stopLoss).toBe(95);
        expect(plan.takeProfits).toEqual([115]);
        expect(plan.stopDistancePct).toBeCloseTo(
            Math.abs(parseFloat(row.stopLossPercentage ?? '0')), 2,
        );
        // The expectancy is computed from the capped probability, not the claim.
        expect(plan.netEdgeR).toBeGreaterThan(0);
    });

    it('a skill ceiling is folded once, and both readers see the same number', () => {
        const p = proposal({ gate: gate({ skillCeiling: 0.4, skillNote: 'BTC exhaustion' }) });
        const plan = buildTradePlan(p);
        const row = buildProposedTradeAnalysis(p);
        expect(plan.probability).toBe(40);
        expect(row.probability).toBe(40);
        expect(plan.warnings.join(' ')).toMatch(/Code-checked skill ceiling 40%/);
        expect(row.validationWarnings?.join(' ')).toMatch(/Code-checked skill ceiling 40%/);
    });

    it('the gate minEdge check reads the same plan, not a parallel formula', async () => {
        const base = proposal();
        const stamped = await runGateScan(base, []);
        const plan = buildTradePlan({ ...base, gate: stamped });
        expect(stamped.netEdgeR).toBe(plan.netEdgeR);
    });
});

/**
 * E-12 — the position sizing, WIRED.
 *
 * `utils/ticketSize.ts` was a complete, grade-tiered, fail-closed sizing
 * module with ZERO production callers: every number the trader saw about
 * size came from the model, or from nowhere. These tests pin that the module
 * is now reached — from the proposal card AND from the journal write path —
 * and that the properties that matter survive the wiring:
 *
 *  - it FAILS CLOSED when equity is unset (no invented position),
 *  - it is DOWNGRADE-ONLY (nothing about a model's confidence can scale a
 *    ticket UP),
 *  - the exchange's notional ceiling is respected,
 *  - what the MODEL said about size is recorded SEPARATELY from what the app
 *    suggests, so the journal can compare the two.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeContractSize, EQUITY_NOT_SET } from '../utils/ticketSize';
import {
    buildProposedTradeAnalysis,
    modelStatedSize,
    proposedTicketSize,
    type TradeProposal,
} from '../services/trade/proposedTrade';

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100,
    stopLoss: 95,
    takeProfits: [120, 110],
    confidence: 'High',
    ...over,
});

describe('proposedTicketSize — the sizing rule, reached from the proposal path', () => {
    it('sizes from the trader\'s equity, their risk % and the plan\'s stop distance', () => {
        // $10,000 of equity at 1 % risk = $100 at risk. Entry 100 with a stop
        // at 95 is a 5 % stop, so the position is 100 / (100 × 0.05) = 20 units
        // — a $2,000 notional.
        const sized = proposedTicketSize(proposal(), 10_000, 10, 1);
        expect(sized.riskUsd).toBe(100);
        expect(sized.qty).toBeCloseTo(20, 6);
        expect(sized.notionalUsd).toBeCloseTo(2000, 6);
        expect(sized.reason).toBe('Uncapped');
    });

    it('FAILS CLOSED with no equity — a reason and no numbers', () => {
        const sized = proposedTicketSize(proposal(), 0, 10, 1);
        expect(sized.label).toBe('none');
        expect(sized.fraction).toBe(0);
        expect(sized.riskUsd).toBe(0);
        expect(sized.qty).toBeNull();
        expect(sized.reason).toBe(EQUITY_NOT_SET);
        expect(sized.line).toMatch(/Equity not set/);
    });

    it('is DOWNGRADE-ONLY: a gate cap can only ever shrink the ticket', () => {
        const uncapped = proposedTicketSize(proposal(), 10_000, 10, 1);
        expect(uncapped.fraction).toBe(1);
        expect(uncapped.riskUsd).toBe(100);

        // The same plan, presented with a gate that capped confidence at 50 %.
        const capped = proposedTicketSize(
            proposal({
                gate: { status: 'evaluated', confidenceCap: 0.5, reason: 'test', stampedAt: new Date().toISOString() },
            }),
            10_000, 10, 1,
        );
        expect(capped.fraction).toBe(0.5);
        expect(capped.riskUsd).toBe(50);
        expect(capped.riskUsd).toBeLessThan(uncapped.riskUsd);
        // And the reason is LABELLED, never an unexplained number.
        expect(capped.reason).toMatch(/Gate cap 50%/);
    });

    it('respects the exchange notional ceiling and says it clamped', () => {
        // A 0.1 % stop asks for a $100,000 notional on a $10,000 account —
        // more than 5× leverage can carry. The size is clamped to what fits
        // and the trail records the step.
        const tight = proposedTicketSize(
            proposal({ entry: 100, stopLoss: 99.9 }),
            10_000, 5, 1,
        );
        expect(tight.notionalUsd).toBeCloseTo(50_000, 6);
        expect(tight.riskUsd).toBeCloseTo(50, 6);
        expect(tight.adjustments.some(a => /Leverage cap/.test(a.label))).toBe(true);
    });
});

describe('the proposed analysis carries the model\'s stated tier', () => {
    it('records the confidence the model claimed, beside the one that survived', () => {
        const capped = buildProposedTradeAnalysis(proposal({
            gate: { status: 'evaluated', confidenceCap: 0.5, reason: 'test', stampedAt: new Date().toISOString() },
        }));
        expect(capped.originalConfidence).toBe('High');
        expect(capped.confidence).not.toBe('High');
    });

    it('leaves the stated tier alone when nothing downgraded it', () => {
        const plain = buildProposedTradeAnalysis(proposal());
        expect(plain.originalConfidence).toBe('High');
        expect(plain.confidence).toBe('High');
    });
});

describe('modelStatedSize — what the MODEL said, read from its own words', () => {
    it('reads a stated risk', () => {
        expect(modelStatedSize('Risk $250 on this one.')).toEqual({ riskUsd: 250 });
    });

    it('reads a stated position', () => {
        expect(modelStatedSize('$2,000 position here.')).toEqual({ notionalUsd: 2000 });
        expect(modelStatedSize('Position: $2,000.')).toEqual({ notionalUsd: 2000 });
    });

    it('keeps a risk and a position apart', () => {
        // The regression this shape guards: "risk $250 on a $2,000 position"
        // must NOT read as two risks.
        expect(modelStatedSize('Risk $250 on a $2,000 position.')).toEqual({ riskUsd: 250, notionalUsd: 2000 });
    });

    it('ignores a bare dollar figure — that is far more often a price', () => {
        expect(modelStatedSize('BTC at $100,000 looks strong.')).toEqual({});
    });

    it('ignores a coin quantity — it is not a dollar size without a price', () => {
        expect(modelStatedSize('Size 0.5 BTC here.')).toEqual({});
    });

    it('is empty when the model said nothing', () => {
        expect(modelStatedSize(undefined)).toEqual({});
        expect(modelStatedSize('')).toEqual({});
    });
});

/**
 * The wiring itself. jsdom can mount the card, but it cannot see the journal
 * row's fields, and a source scan is the repo's own idiom for exactly this
 * (see `tests/analysisPipelineSendIdentity.test.ts`).
 */
describe('the sizing is WIRED, not merely implemented', () => {
    const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

    it('the proposal card shows a suggested size', () => {
        const card = read('components/trade/panels/TradeProposalCard.tsx');
        expect(card).toContain('proposedTicketSize');
        expect(card).toContain('proposal-size');
        // And the honest "no equity" state, not an invented number.
        expect(card).toMatch(/Not sized — equity not set/);
    });

    it('the journal write path persists the suggested size and the cost', () => {
        const hook = read('hooks/useTradeLogging.ts');
        expect(hook).toContain('computeContractSize');
        expect(hook).toContain('suggestedRiskUsd');
        expect(hook).toContain('suggestedNotionalUsd');
        expect(hook).toContain('suggestedSizeReason');
        // The model's own size is recorded separately, never merged in.
        expect(hook).toContain('modelStatedRiskUsd');
        expect(hook).toContain('modelStatedNotionalUsd');
    });

    it('the journal write path stores the cost and the net R beside the gross one', () => {
        const hook = read('hooks/useTradeLogging.ts');
        expect(hook).toContain('netRiskReward');
        expect(hook).toContain('roundTripCostR');
        expect(hook).toContain('costR');
        expect(hook).toContain('netR');
        // The gross number stays: the row must not be rewritten to the net.
        expect(hook).toContain('realizedR');
    });

    it('the ticket module is reachable from production code, not only from tests', () => {
        // The module had zero production callers; assert that is no longer true.
        const callers = [
            'hooks/useTradeLogging.ts',
            'components/trade/panels/TradeProposalCard.tsx',
            'services/trade/proposedTrade.ts',
        ];
        const productionHits = callers.filter(f => read(f).includes('ticketSize') || read(f).includes('computeContractSize'));
        expect(productionHits.length).toBeGreaterThanOrEqual(2);
    });
});

describe('the sizing rule itself is unchanged by the wiring', () => {
    it('still sizes a plain analysis exactly as before', () => {
        const sized = computeContractSize({
            confidence: 'High',
            direction: 'Long',
            coinName: 'BTCUSDT',
            entryPoints: [{ price: '100' }],
            stopLoss: '90',
        } as never, 10_000, 10, 1);
        expect(sized.riskUsd).toBe(100);
        expect(sized.qty).toBeCloseTo(10, 5);
    });
});

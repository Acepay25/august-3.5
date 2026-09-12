/**
 * proposedTrade — the model's present_trade proposal → a valid PENDING journal
 * trade the outcome autopilot can score. Pure functions, no React/network.
 */

import { describe, it, expect } from 'vitest';
import { parseTradeProposal, buildProposedTradeAnalysis, buildProposedTradeMessage, computeRrRatio } from '../services/trade/proposedTrade';
import { TradeOutcome } from '../types/enums';

describe('parseTradeProposal', () => {
    it('accepts a well-formed Long', () => {
        const { proposal, error } = parseTradeProposal({ direction: 'Long', entry: 100, stopLoss: 95, takeProfits: [110, 120], symbol: 'btcusdt', confidence: 'High' });
        expect(error).toBeUndefined();
        expect(proposal).toMatchObject({ symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 95, confidence: 'High' });
        expect(proposal?.takeProfits).toEqual([110, 120]);
    });

    it('rejects a backwards Long (stop above entry)', () => {
        expect(parseTradeProposal({ direction: 'Long', entry: 100, stopLoss: 105, takeProfits: [110] }).error).toMatch(/stop must sit below/);
    });

    it('rejects a Short whose target is above entry', () => {
        expect(parseTradeProposal({ direction: 'Short', entry: 100, stopLoss: 105, takeProfits: [110] }).error).toMatch(/target below/);
    });

    it('requires direction, entry, stop and a target', () => {
        expect(parseTradeProposal({ entry: 100, stopLoss: 95, takeProfits: [110] }).error).toMatch(/direction/);
        expect(parseTradeProposal({ direction: 'Long', stopLoss: 95, takeProfits: [110] }).error).toMatch(/entry/);
        expect(parseTradeProposal({ direction: 'Long', entry: 100, takeProfits: [110] }).error).toMatch(/stopLoss/);
        expect(parseTradeProposal({ direction: 'Long', entry: 100, stopLoss: 95 }).error).toMatch(/takeProfits/);
    });
});

describe('buildProposedTradeAnalysis', () => {
    it('produces an analysis the autopilot will track (Long, entry, stop)', () => {
        const a = buildProposedTradeAnalysis({ symbol: 'ETHUSDT', direction: 'Long', entry: 3000, stopLoss: 2900, takeProfits: [3200], confidence: 'Medium' });
        expect(a.coinName).toBe('ETHUSDT');
        expect(a.direction).toBe('Long');
        expect(a.confidence).not.toBe('Avoid');
        expect(a.entryPoints.length).toBeGreaterThan(0);
        expect(a.stopLoss).toBe('2900');
        expect(a.takeProfit.map(t => t.price)).toEqual(['3200']);
        expect(a.rrRatio).toBe(2); // (3200-3000)/(3000-2900)
    });
});

describe('buildProposedTradeMessage', () => {
    it('is a PENDING AI message carrying the analysis', () => {
        const m = buildProposedTradeMessage({ symbol: 'BTCUSDT', direction: 'Short', entry: 100, stopLoss: 105, takeProfits: [90] }, 'proposed-1');
        expect(m.id).toBe('proposed-1');
        expect(m.outcome).toBe(TradeOutcome.PENDING);
        expect(m.analysis?.direction).toBe('Short');
    });
    it('carries the plan id onto the logged text (proposal ↔ watch ↔ journal)', () => {
        const m = buildProposedTradeMessage({ symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110], planId: 'btc-abc' }, 'proposed-2');
        expect(m.text).toContain('plan btc-abc');
    });
});

describe('computeRrRatio', () => {
    it('is sign-correct and zero-risk-safe', () => {
        expect(computeRrRatio({ direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [120] })).toBe(2);
        expect(computeRrRatio({ direction: 'Long', entry: 100, stopLoss: 100, takeProfits: [120] })).toBe(0);
    });
});

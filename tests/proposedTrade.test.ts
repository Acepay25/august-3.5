/**
 * proposedTrade — the model's present_trade proposal → a valid PENDING journal
 * trade the outcome autopilot can score. Pure functions, no React/network.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseTradeProposal, buildProposedTradeAnalysis, buildProposedTradeMessage, computeRrRatio } from '../services/trade/proposedTrade';
import { TradeOutcome } from '../types/enums';
import * as levelWatch from '../services/trade/levelWatchService';
import type { LevelHit, WatchPlan } from '../services/trade/tradePlanLevels';

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

    it('normalizes a model bare-base symbol to the canonical futures form', () => {
        // 'BTC' verbatim → the level-watch armed under 'BTC', never matched a
        // 'BTCUSDT' tick, 400'd its mark-price poll forever, and could not be
        // disarmed by full symbol (plans have no expiry). Canonical now.
        const mk = (symbol: unknown) => parseTradeProposal({ direction: 'Long', entry: 100, stopLoss: 95, takeProfits: [110], symbol });
        expect(mk('BTC').proposal?.symbol).toBe('BTCUSDT');
        expect(mk('btc / usdt').proposal?.symbol).toBe('BTCUSDT');
        expect(mk('ethusdc').proposal?.symbol).toBe('ETHUSDC');
        expect(mk('BTCUSDT').proposal?.symbol).toBe('BTCUSDT'); // idempotent
        expect(mk(undefined).proposal?.symbol).toBe('BTCUSDT'); // blank → fallback
    });
});

describe('parseTradeProposal → level-watch harness (symbol normalization end-to-end)', () => {
    it('a "BTC" proposal arms as BTCUSDT and ticks/disarms correctly', () => {
        levelWatch.__resetForTests();
        localStorage.clear();
        // The arm clock may REST-poll a stale symbol; keep it off the network.
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
        const { proposal } = parseTradeProposal({ direction: 'Long', entry: 100, stopLoss: 95, takeProfits: [110], symbol: 'BTC' });
        expect(proposal?.symbol).toBe('BTCUSDT');
        const plan: WatchPlan = {
            planId: 'btc-norm-1', symbol: proposal!.symbol, direction: 'Long',
            entry: 100, stopLoss: 95, takeProfits: [110],
        };
        const hits: LevelHit[] = [];
        const unsubscribe = levelWatch.subscribe(hit => hits.push(hit));
        levelWatch.arm(plan, 105);
        // The live feed prints the FULL symbol — this is the match the
        // verbatim-'BTC' plan used to miss forever.
        levelWatch.tick('BTCUSDT', 94); // through ENTRY and SL
        expect(hits.map(h => h.levelId)).toEqual(['btc-norm-1:ENTRY', 'btc-norm-1:SL']);
        // Coin switch disarms by the full symbol — it removes the plan.
        levelWatch.disarmSymbol('BTCUSDT');
        expect(levelWatch.getArmedPlans()).toHaveLength(0);
        unsubscribe();
        levelWatch.__resetForTests();
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

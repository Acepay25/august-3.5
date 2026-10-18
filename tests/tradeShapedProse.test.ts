/**
 * Stage 20d — a seat that DESCRIBES a trade instead of calling `present_trade`.
 *
 * The detector's whole value is in what it must NOT do. A chip that fires on any
 * sentence containing numbers turns the transcript into a wall of buttons the
 * trader learns to ignore, and a chip that fires on a plan whose stop is on the
 * wrong side of its entry writes a broken journal row. So the tests below plant
 * the near-misses first, and the one place geometry is decided is the parser the
 * tool already uses — there is no second validator here to drift from it.
 */

import { describe, it, expect } from 'vitest';
import { planFromProse } from '../services/trade/tradeShapedProse';

describe('planFromProse reads a plan out of a sentence', () => {
    it('takes direction, entry, stop and target from labelled prose', () => {
        const plan = planFromProse('Long BTC from entry 111,000 with stop 109,500 and target 115,000.', 'BTCUSDT');
        expect(plan).not.toBeNull();
        expect(plan?.direction).toBe('Long');
        expect(plan?.entry).toBe(111000);
        expect(plan?.stopLoss).toBe(109500);
        expect(plan?.takeProfits).toEqual([115000]);
    });

    it('collects several targets and keeps the coin the turn was about', () => {
        const plan = planFromProse('short here: entry 90, stop 92, tp1 80, tp2 75', 'ethusdt');
        expect(plan?.direction).toBe('Short');
        expect(plan?.symbol).toBe('ETHUSDT');
        expect(plan?.takeProfits).toEqual([80, 75]);
    });

    it('reads a dotted decimal price, not just an integer', () => {
        const plan = planFromProse('Long SOL entry 182.4 stop 178.1 target 195.6', 'SOLUSDT');
        expect(plan?.entry).toBe(182.4);
        expect(plan?.stopLoss).toBe(178.1);
    });
});

describe('what must NOT grow a chip', () => {
    it('refuses prose with no labelled triple — a number is not a plan', () => {
        expect(planFromProse('BTC is up 3.4% today and funding ran hot at 112,000.', 'BTCUSDT')).toBeNull();
    });

    it('refuses a plan with an entry but no stop', () => {
        expect(planFromProse('Long BTC entry 111,000 target 115,000', 'BTCUSDT')).toBeNull();
    });

    it('refuses a plan with a stop but no target', () => {
        expect(planFromProse('Long BTC entry 111,000 stop 109,500', 'BTCUSDT')).toBeNull();
    });

    it('refuses a sentence that hedges both directions', () => {
        // Guessing a sign the model never committed to puts a wrong-direction
        // trade in the journal, so "long above X, short below Y" is not ONE plan.
        expect(planFromProse('Long above 112,000, short below 109,000 — entry 110,000 stop 108,000 target 114,000', 'BTCUSDT')).toBeNull();
    });

    it('refuses a row with no coin to attribute', () => {
        expect(planFromProse('Long from entry 111,000 stop 109,500 target 115,000')).toBeNull();
    });

    it('hands the GEOMETRY to the tool parser and inherits its refusal', () => {
        // A long whose stop sits ABOVE its entry is not a plan; the same check
        // present_trade applies must reject it here, because a second validator
        // is how the two paths start disagreeing about the same numbers.
        expect(planFromProse('Long BTC entry 111,000 stop 119,500 target 115,000', 'BTCUSDT')).toBeNull();
    });
});

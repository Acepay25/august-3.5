/**
 * chartTriggers — the pure watch/schedule semantics: condition hold tests,
 * the stale/expired rules, the tool-arg parsers, and the two renderers the
 * model reads (armed-watches block + the fired trigger signal).
 */

import { describe, it, expect } from 'vitest';
import {
    watchConditionHolds, watchExpired, parsePriceWatch, parseTimeWake,
    describeWatchesForModel, formatWatchFiredForModel, type PriceWatch, type TimeWake,
} from '../services/trade/chartTriggers';

const NOW = Date.parse('2026-09-11T13:00:00Z');
const priceWatch = (over: Partial<PriceWatch> = {}): PriceWatch => ({
    kind: 'price', id: 'w-1', symbol: 'BTCUSDT', condition: 'above', price: 112_000,
    note: 'breakout', expiresAt: NOW + 3_600_000, createdAt: NOW, ...over,
});
const timeWake = (over: Partial<TimeWake> = {}): TimeWake => ({
    kind: 'time', id: 'w-2', symbol: 'ETHUSDT', atMs: NOW + 1_800_000,
    note: 're-check', createdAt: NOW, ...over,
});
const defaults = { symbol: 'BTCUSDT', makeId: () => 'w-new', nowMs: NOW };

describe('watchConditionHolds', () => {
    it('above fires at-or-through the level; below mirrors', () => {
        expect(watchConditionHolds(priceWatch({ condition: 'above' }), 112_000, NOW)).toBe(true);
        expect(watchConditionHolds(priceWatch({ condition: 'above' }), 111_999, NOW)).toBe(false);
        expect(watchConditionHolds(priceWatch({ condition: 'below', price: 100 }), 100, NOW)).toBe(true);
        expect(watchConditionHolds(priceWatch({ condition: 'below', price: 100 }), 101, NOW)).toBe(false);
    });
    it('a price watch with no feed is never held', () => {
        expect(watchConditionHolds(priceWatch(), null, NOW)).toBe(false);
    });
    it('a time watch is held once its deadline arrives', () => {
        expect(watchConditionHolds(timeWake(), null, NOW + 1_800_000 - 1)).toBe(false);
        expect(watchConditionHolds(timeWake(), null, NOW + 1_800_000)).toBe(true);
    });
});

describe('watchExpired', () => {
    it('a price watch past its deadline is expired; a time wake is never "expired" by this', () => {
        expect(watchExpired(priceWatch({ expiresAt: NOW - 1 }), NOW)).toBe(true);
        expect(watchExpired(priceWatch({ expiresAt: NOW + 1 }), NOW)).toBe(false);
        // Time wakes have no expiry of their own — they simply become due.
        expect(watchExpired(timeWake({ atMs: NOW - 1 }), NOW)).toBe(false);
    });
});

describe('parsePriceWatch', () => {
    it('builds a full watch with generated id + default expiry', () => {
        const { watch, error } = parsePriceWatch({ condition: 'above', price: 112_000, note: 'range break' }, defaults);
        expect(error).toBeUndefined();
        expect(watch).toMatchObject({ id: 'w-new', symbol: 'BTCUSDT', condition: 'above', price: 112_000, note: 'range break' });
        expect(watch!.expiresAt).toBe(NOW + 720 * 60_000);
    });
    it('rejects non-positive price / bad condition', () => {
        expect(parsePriceWatch({ condition: 'above', price: 0 }, defaults).error).toMatch(/positive/);
        expect(parsePriceWatch({ condition: 'cross', price: 5 }, defaults).error).toMatch(/above.*below/);
    });
    it('honours a capped expiry', () => {
        const { watch } = parsePriceWatch({ condition: 'above', price: 5, expiresInMinutes: 999_999 }, defaults)!;
        expect(watch!.expiresAt).toBe(NOW + 7 * 24 * 60 * 60_000);
    });
});

describe('parseTimeWake', () => {
    it('computes the deadline from inMinutes', () => {
        const { wake } = parseTimeWake({ inMinutes: 30, note: 'check the breakout' }, defaults);
        expect(wake).toMatchObject({ atMs: NOW + 30 * 60_000, note: 'check the breakout' });
    });
    it('rejects under-a-minute / non-numeric', () => {
        expect(parseTimeWake({ inMinutes: 0.5 }, defaults).error).toMatch(/≥ 1/);
        expect(parseTimeWake({}, defaults).error).toMatch(/≥ 1/);
    });
});

describe('describeWatchesForModel', () => {
    it('empty → no block; otherwise lists each with its id and note', () => {
        expect(describeWatchesForModel([], NOW)).toBe('');
        const text = describeWatchesForModel([priceWatch(), timeWake()], NOW);
        expect(text).toContain('[w-1]');
        expect(text).toContain('above 112000');
        expect(text).toContain('[w-2]');
        expect(text).toContain('in 30m');
        expect(text).toContain('Do not re-arm');
    });
});

describe('formatWatchFiredForModel', () => {
    it('a price fire names the watch, the mark, PHT time, and the model note', () => {
        const text = formatWatchFiredForModel({ watch: priceWatch(), price: 112_050, at: NOW }, 0);
        expect(text).toMatch(/^\[HARNESS TRIGGER — scheduled watch fired, not the user\]/);
        expect(text).toContain('Watch w-1: BTCUSDT printed 112050, above the watched 112000');
        expect(text).toContain('21:00 PHT');
        expect(text).toContain('"breakout"');
        expect(text).toContain('ready to trade');
    });
    it('a time fire says the re-check time arrived and notes other watches', () => {
        const text = formatWatchFiredForModel({ watch: timeWake(), price: 3100, at: NOW }, 2);
        expect(text).toContain('scheduled ETHUSDT re-check time arrived');
        expect(text).toContain('with mark 3100');
        expect(text).toContain('Still armed after this: 2 watch(es)');
    });
});

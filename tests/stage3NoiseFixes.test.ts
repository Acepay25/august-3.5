/**
 * Stage 3 noise fixes — source + unit contracts for the three "the app
 * cannot be trusted to show its own transcript" repairs:
 *
 *  1. the dock settles on STRIPPED text (raw <tool_call> markup no longer
 *     reaches a settled bubble even when the loop's wipe gate skipped it);
 *  2. the harness notice line names the EVENT, never the model's orders.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { harnessNoticeLine } from '../services/trade/chatTurnRunner';
import { formatLevelHitForModel, type WatchPlan } from '../services/trade/tradePlanLevels';
import { formatWatchFiredForModel, type WatchFired } from '../services/trade/chartTriggers';

const runnerSrc = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');

describe('the dock settles on stripped text', () => {
    it('streamSeatTurn strips tool-call markup after the stream loop', () => {
        // The loop's own stripped return value is discarded by the runner's
        // accumulator; the settle point must re-strip or a text-protocol call
        // reaches the transcript as literal protocol soup.
        expect(runnerSrc).toMatch(/full = stripTextToolCalls\(full\);/);
        // The strip sits AFTER the for-await (so abort + echo repair both read
        // it) — i.e. between the loop and the settle-time thinking splitter.
        const loopEnd = runnerSrc.indexOf('full = stripTextToolCalls(full);');
        const splitter = runnerSrc.indexOf('splitThinkingFromOutput(reasoning, full)');
        expect(loopEnd).toBeGreaterThan(-1);
        expect(splitter).toBeGreaterThan(loopEnd);
    });
});

describe('harnessNoticeLine', () => {
    it('shows the event sentence, machine-tag stripped', () => {
        const signal = [
            '[HARNESS SIGNAL — price event, not the user] Plan btc-x: ENTRY @ 85175 HIT (mark 85184, 00:08 PHT).',
            'Level id btc-x:ENTRY.',
            'Plan: Entry 85175 · SL 85295 · TP 85000 / 84875.',
        ].join(' ');
        expect(harnessNoticeLine(signal)).toBe('Plan btc-x: ENTRY @ 85175 HIT (mark 85184, 00:08 PHT).');
    });

    it('never prints the model instruction that follows on the next line', () => {
        const signal = 'Event sentence here.\nWarn the user now: what hit, the price.';
        expect(harnessNoticeLine(signal)).toBe('Event sentence here.');
    });

    it('is price-decimal-safe: a dot inside a price does not end the sentence', () => {
        const signal = '[HARNESS TRIGGER — scheduled watch fired, not the user] Watch w1: BTCUSDT printed 85184.5, above the watched 85000. Time 00:08 PHT.';
        expect(harnessNoticeLine(signal)).toBe('Watch w1: BTCUSDT printed 85184.5, above the watched 85000.');
    });
});

describe('the signal composers keep instructions on their own line', () => {
    const plan: WatchPlan = {
        planId: 'btc-x',
        symbol: 'BTCUSDT',
        direction: 'Long',
        entry: 85175,
        stopLoss: 85295,
        takeProfits: [85000, 84875],
        createdAtMs: 0,
        expiresAtMs: 0,
        note: '',
    } as unknown as WatchPlan;

    it('formatLevelHitForModel puts the orders on line 2', () => {
        const text = formatLevelHitForModel(plan, { levelId: 'btc-x:ENTRY', kind: 'entry', label: 'ENTRY', price: 85175, hitPrice: 85184, at: 0 }, []);
        const lines = text.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('HIT');
        expect(lines[1]).toContain('Warn the user now');
    });

    it('formatWatchFiredForModel puts the orders on line 2', () => {
        const fired: WatchFired = {
            watch: { id: 'w1', kind: 'price', symbol: 'BTCUSDT', condition: 'above', price: 85000, note: 'reclaim', createdAtMs: 0, expiresAtMs: 0, armedMs: 0 } as unknown as WatchFired['watch'],
            price: 85184.5,
            at: 0,
        } as unknown as WatchFired;
        const text = formatWatchFiredForModel(fired, 0);
        const lines = text.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('Watch w1');
        expect(lines[1]).toContain('Act on it now');
    });
});

/**
 * Model-drawing persistence. The reported bug: a shape the MODEL drew
 * (draw_on_chart / mark_trade_levels) vanished when the user switched coins and
 * came back, while the user's OWN drawings survived — because model shapes were
 * ephemeral TradeView state, never persisted. They now live in their OWN
 * per-session-per-coin store, so they survive a switch just like user drawings,
 * while staying isolated from the user's bucket (a model clear must not wipe
 * the user's lines and vice-versa).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    loadSessionModelDrawings, saveSessionModelDrawings,
    loadSessionDrawings, saveSessionDrawings, type ChartDrawing,
} from '../services/trade/chartDrawings';

vi.mock('../utils/activeUser', () => ({ getActiveUsername: () => 'alice', LAST_ACTIVE_USER_KEY: 'last_active_user' }));

const hline = (price: number): ChartDrawing => ({
    id: `m-${price}`, kind: 'hline', points: [{ t: 1700000000, p: price }], color: '#399ef7', createdAt: 1700000000,
});

describe('model-drawing session store', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips and survives a coin switch (the reported bug)', () => {
        saveSessionModelDrawings('s1', 'BTCUSDT', [hline(65000)]);
        expect(loadSessionModelDrawings('s1', 'BTCUSDT')).toHaveLength(1);
        // Switch to ETH — its model bucket is empty…
        saveSessionModelDrawings('s1', 'ETHUSDT', []);
        expect(loadSessionModelDrawings('s1', 'ETHUSDT')).toHaveLength(0);
        // …and back to BTC: the model's line is STILL there.
        expect(loadSessionModelDrawings('s1', 'BTCUSDT')).toEqual([hline(65000)]);
    });

    it('a model "clear" (empty save) persists, so the erase survives a switch', () => {
        saveSessionModelDrawings('s1', 'BTCUSDT', [hline(65000)]);
        saveSessionModelDrawings('s1', 'BTCUSDT', []); // clear_chart_drawings scope:model
        expect(loadSessionModelDrawings('s1', 'BTCUSDT')).toHaveLength(0);
    });

    it('keeps the model bucket isolated from the user bucket', () => {
        saveSessionDrawings('s1', 'BTCUSDT', [hline(1)]);
        saveSessionModelDrawings('s1', 'BTCUSDT', [hline(2)]);
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(1)]);
        expect(loadSessionModelDrawings('s1', 'BTCUSDT')).toEqual([hline(2)]);
        // Clearing one leaves the other intact.
        saveSessionModelDrawings('s1', 'BTCUSDT', []);
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(1)]);
        expect(loadSessionModelDrawings('s1', 'BTCUSDT')).toHaveLength(0);
    });

    it('isolates sessions — a fresh session starts empty', () => {
        saveSessionModelDrawings('s1', 'BTCUSDT', [hline(9)]);
        expect(loadSessionModelDrawings('s2', 'BTCUSDT')).toEqual([]);
    });
});

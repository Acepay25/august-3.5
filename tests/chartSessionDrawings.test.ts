/**
 * Session+coin-scoped chart drawings: each Chart AI session owns a map of
 * symbol → shapes. Switching coins blanks the canvas, coming back restores
 * that coin's shapes, sessions are isolated, and a FRESH session starts
 * empty (no inheritance).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveSessionDrawings, loadSessionDrawings, type ChartDrawing } from '../services/trade/chartDrawings';

vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const hline = (price: number): ChartDrawing => ({
    id: `d-${price}`,
    kind: 'hline',
    points: [{ t: 1700000000, p: price }],
    color: '#07b56a',
    createdAt: 1700000000,
});

describe('session+coin scoped drawings', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips within one session+coin', () => {
        saveSessionDrawings('s1', 'BTCUSDT', [hline(77000)]);
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(77000)]);
    });

    it('switching coins blanks the canvas; coming BACK restores that coin', () => {
        saveSessionDrawings('s1', 'BTCUSDT', [hline(77000)]);
        // Switch to ETH: different coin, empty canvas…
        expect(loadSessionDrawings('s1', 'ETHUSDT')).toEqual([]);
        saveSessionDrawings('s1', 'ETHUSDT', [hline(3140)]);
        // …and back to BTC: its shapes are still there.
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(77000)]);
        expect(loadSessionDrawings('s1', 'ETHUSDT')).toEqual([hline(3140)]);
    });

    it('isolates sessions — a fresh session starts EMPTY even on a drawn coin', () => {
        saveSessionDrawings('s1', 'BTCUSDT', [hline(77000)]);
        expect(loadSessionDrawings('s2', 'BTCUSDT')).toEqual([]);
        // Legacy per-symbol keys (pre-session era) are NOT inherited either.
        localStorage.setItem('trade_drawings_v1_alice_BTCUSDT', JSON.stringify([hline(1)]));
        expect(loadSessionDrawings('s3', 'BTCUSDT')).toEqual([]);
    });

    it('keeps other coins intact when saving one coin', () => {
        saveSessionDrawings('s1', 'BTCUSDT', [hline(77000)]);
        saveSessionDrawings('s1', 'ETHUSDT', [hline(3140)]);
        saveSessionDrawings('s1', 'BTCUSDT', [hline(77000), hline(78000)]);
        expect(loadSessionDrawings('s1', 'ETHUSDT')).toEqual([hline(3140)]);
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(77000), hline(78000)]);
    });

    it('migrates the earlier single-symbol session shape in place', () => {
        localStorage.setItem(
            'trade_session_drawings_v1_alice_s1',
            JSON.stringify({ symbol: 'BTCUSDT', drawings: [hline(65000)] }),
        );
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(65000)]);
        // Saving ETH migrates the store to the map without losing BTC.
        saveSessionDrawings('s1', 'ETHUSDT', [hline(3140)]);
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toEqual([hline(65000)]);
        expect(loadSessionDrawings('s1', 'ETHUSDT')).toEqual([hline(3140)]);
    });

    it('treats a corrupt session store as empty rather than guessing', () => {
        localStorage.setItem('trade_session_drawings_v1_alice_s9', '{not json');
        expect(loadSessionDrawings('s9', 'BTCUSDT')).toEqual([]);
    });
});

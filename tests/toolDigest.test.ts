import { describe, it, expect } from 'vitest';
import { digestToolResult } from '../services/analysis/DeskToolsService';

describe('digestToolResult (labeled transcript rows)', () => {
    it('always prefixes the human tool label', () => {
        const digest = digestToolResult('get_order_book', true, JSON.stringify({ buyWalls: [], sellWalls: [] }));
        expect(digest.startsWith('order book · ')).toBe(true);
    });

    it('keeps the per-tool detail after the label', () => {
        const snapshot = digestToolResult('get_price_snapshot', true, JSON.stringify({ lastPrice: 77295.3 }));
        expect(snapshot).toBe('price snapshot · price 77,295.3');
    });

    it('names the coin when the call targeted a symbol other than the chart\'s', () => {
        const snapshot = digestToolResult('get_price_snapshot', true, JSON.stringify({ lastPrice: 3140.5 }), 'ETHUSDT');
        expect(snapshot).toBe('price snapshot · ETHUSDT · price 3,140.5');
        // Chart-symbol calls stay coin-free (no noise on the default).
        expect(digestToolResult('get_price_snapshot', true, JSON.stringify({ lastPrice: 1 }))).toBe('price snapshot · price 1');
    });

    it('marks failures with the label (and coin) — never raw error bodies', () => {
        expect(digestToolResult('get_derivatives', false, 'boom')).toBe('derivatives · failed');
        expect(digestToolResult('get_derivatives', false, 'boom', 'SOLUSDT')).toBe('derivatives · SOLUSDT · failed');
    });

    it('generic results digest to a bare ok under the label', () => {
        expect(digestToolResult('get_market_packet', true, 'not json at all')).toBe('hybrid packet · ok');
        expect(digestToolResult('scan_setups', true, 'nope')).toBe('scan setups · ok');
    });

    it('setup history digest drops the redundant prefix', () => {
        const stats = digestToolResult('get_setup_history_stats', true, JSON.stringify({ sample: 12, wins: 7, losses: 5, winRate: 0.5833 }));
        expect(stats).toBe('setup history · 7W/5L (58% win)');
        expect(digestToolResult('get_setup_history_stats', true, JSON.stringify({ sample: 0 }))).toBe('setup history · no logged trades');
    });
});

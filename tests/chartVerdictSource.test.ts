import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { latestChartVerdict, verdictLevels } from '../services/trade/chartData';
import type { TradeProposal } from '../services/trade/proposedTrade';
import type { Message } from '../types';

/**
 * The chart draws its Entry/Stop/Target overlay from `verdict`, and App used to
 * find that verdict by the DEBATE shapes on a row. Deleting the debate engine
 * left the selector keying on fields nothing writes any more, so the prop went
 * permanently undefined for a new run while the overlay code stayed live. These
 * pin the replacement source: the proposal a tool turn stamps on its own row.
 */

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100000,
    stopLoss: 98000,
    takeProfits: [104000, 108000],
    confidence: 'Medium',
    ...over,
});

const row = (over: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: 'ai',
    text: 'answer',
    createdAt: new Date().toISOString(),
    ...over,
} as Message);

describe('latestChartVerdict', () => {
    it('takes the NEWEST settled proposal, not an older row', () => {
        const older = row({ id: 'a', proposal: proposal({ symbol: 'ETHUSDT', entry: 3000 }) });
        const newer = row({ id: 'b', proposal: proposal() });
        const verdict = latestChartVerdict([older, newer]);
        expect(verdict?.coinName).toBe('BTCUSDT');
        expect(verdict?.entryPoints?.[0]?.price).toBe('100000');
    });

    it('falls back to the stored analysis of a row written before tool turns existed', () => {
        const legacy = row({ id: 'old', analysis: { coinName: 'SOLUSDT' } as Message['analysis'] });
        expect(latestChartVerdict([legacy, row({ id: 'blank' })])?.coinName).toBe('SOLUSDT');
    });

    it('prefers the proposal when a row carries both', () => {
        const both = row({ proposal: proposal(), analysis: { coinName: 'ETHUSDT' } as Message['analysis'] });
        expect(latestChartVerdict([both])?.coinName).toBe('BTCUSDT');
    });

    it('is null when no row settled anything — the chart draws no overlay', () => {
        expect(latestChartVerdict([row(), row({ id: 'u' })])).toBeNull();
        expect(latestChartVerdict([])).toBeNull();
    });

    /** The whole point of the prop: these become the lines on the candle chart. */
    it('produces the levels the chart overlays, on the proposal symbol only', () => {
        const verdict = latestChartVerdict([row({ proposal: proposal() })]);
        const labels = verdictLevels(verdict, 'BTCUSDT').map(l => l.price);
        expect(labels).toEqual([100000, 98000, 104000, 108000]);
        expect(verdictLevels(verdict, 'ETHUSDT')).toEqual([]);
    });

    it('is wired: App reads the verdict through this selector, not off Message.analysis', () => {
        const src = readFileSync('App.tsx', 'utf8');
        expect(src).toContain('latestChartVerdict(messages)');
        expect(src).toContain('verdict={chartVerdict}');
        expect(src).not.toContain('verdictMessage');
    });
});

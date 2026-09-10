import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// TradeView render smoke: the Minara arrangement (stats strip, local canvas
// chart, book column, chat dock) mounts, the symbol select re-points the
// panels, and the chat's empty state offers quick prompts. The canvas chart,
// klines and market services are mocked — this tests composition, not data.

vi.mock('lightweight-charts', () => {
    const series = () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn() });
    const chart = () => ({
        addSeries: vi.fn(series),
        removeSeries: vi.fn(),
        applyOptions: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
        resize: vi.fn(),
        remove: vi.fn(),
        data: () => [],
    });
    return {
        createChart: vi.fn(chart),
        CandlestickSeries: { defaultOptions: {} },
        HistogramSeries: { defaultOptions: {} },
        LineSeries: { defaultOptions: {} },
    };
});
vi.mock('../../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => []),
}));
vi.mock('../../services/analysis/MarketDataService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/analysis/MarketDataService')>();
    return {
        ...actual,
        fetchTopFuturesSymbols: vi.fn(async () => []),
        fetchMarkIndex: vi.fn(async () => ({
            markPrice: 100.5, indexPrice: 100.4, lastFundingRate: 0.0001,
            nextFundingTime: Date.now() + 3_600_000, available: true,
        })),
        fetchMarketData: vi.fn(async () => ({
            symbol: 'BTCUSDT', currentPrice: 100.5, price24hHigh: 104, price24hLow: 99,
            priceChange24h: -2.5, priceChangePercent24h: -2.5, volume24h: 1.2e9,
        })),
        fetchDerivativesData: vi.fn(async () => ({ openInterestValue: 2.9e8 })),
        fetchOrderBookDepth: vi.fn(async () => ({
            bestBid: 100.4, bestAsk: 100.6, spread: 0.2, spreadPercent: 0.199,
            bids: [{ price: 100.4, qty: 10 }, { price: 100.3, qty: 250 }],
            asks: [{ price: 100.6, qty: 7 }, { price: 100.7, qty: 300 }],
            bidDepth: 1000, askDepth: 700, depthImbalance: 0.1,
            buyWalls: [], sellWalls: [], dominantSide: 'balanced', wallDistance: {}, available: true,
        })),
    };
});
vi.mock('../../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: vi.fn(async function* () { yield 'ok'; }),
}));

import TradeView from '../../components/trade/TradeView';

const providers = [] as never[];

describe('TradeView', () => {
    it('mounts the stats strip, chart shell, book and chat dock', async () => {
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        expect(await screen.findByTestId('trade-view')).toBeTruthy();
        expect(screen.getByLabelText('Trade symbol')).toBeTruthy();
        expect(screen.getByText('Mark')).toBeTruthy();
        expect(screen.getByText('Oracle')).toBeTruthy();
        expect(screen.getByText('Order Book')).toBeTruthy();
        expect(screen.getByTestId('trade-chat-panel')).toBeTruthy();
        expect(screen.getByText('What is the bias?')).toBeTruthy();
    });

    it('timeframe buttons re-point the chart row', async () => {
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        const tf = screen.getByRole('button', { name: '4h' });
        fireEvent.click(tf);
        expect(tf.className).toContain('bg-zinc-700');
    });
});

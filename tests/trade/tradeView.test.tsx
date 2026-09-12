import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Mock } from 'vitest';

// TradeView render smoke: the Minara arrangement (stats strip, local canvas
// chart, book column, chat dock) mounts, the symbol select re-points the
// panels, and the chat's empty state offers quick prompts. The canvas chart,
// klines and market services are mocked — this tests composition, not data.

vi.mock('lightweight-charts', () => {
    const series = () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), data: vi.fn(() => []) });
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
// The live feed hook opens real websockets — flipped per test: polling
// (deterministic fallback path) or a live ~1s mark-price stream.
const { feedRef } = vi.hoisted(() => ({
    // The hook returns a FuturesLiveFeed shape; tests flip it per case.
    feedRef: {
        current: { markIndex: null, ticker: null, depth: null, kline: null, status: 'polling' } as Record<string, unknown>,
    },
}));
vi.mock('../../hooks/useFuturesLiveFeed', () => ({
    useFuturesLiveFeed: () => feedRef.current,
    klineInterval: (i: string) => i.toLowerCase(),
}));
// The level-watch service + chat store are spied: this test checks the
// SURFACE WIRING (tick from the feed, arm on present_trade, hits queued to
// the store) — the watch's own behavior is tests/levelWatch.test.ts.
const { lw } = vi.hoisted(() => ({
    lw: {
        arm: vi.fn(), disarm: vi.fn(), disarmSymbol: vi.fn(), tick: vi.fn(),
        subscribe: vi.fn(), getArmedPlans: vi.fn(() => []), firedLevelsFor: vi.fn(() => []),
    } as Record<string, Mock>,
}));
vi.mock('../../services/trade/levelWatchService', () => lw);
const { queuedSignals } = vi.hoisted(() => ({ queuedSignals: [] as string[] }));
// Real chatStore (the dock renders against it) — only the queue is spied.
vi.mock('../../services/trade/chatStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/trade/chatStore')>();
    return { ...actual, queueHarnessSignal: (t: string) => { queuedSignals.push(t); } };
});
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
import * as chatStore from '../../services/trade/chatStore';
import { streamChatWithDeskTools } from '../../services/analysis/DeskToolsService';
import type { ProviderConfig } from '../../types/provider';

const providers = [] as never[];

const readyConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
} as ProviderConfig;

const LIVE = {
    markIndex: { markPrice: 100.5, indexPrice: 100.4, fundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000 },
    ticker: { lastPrice: 100.6, changePercent24h: 1, quoteVolume24h: 1e9 },
    depth: { bids: [], asks: [] }, kline: null, status: 'live',
};
const POLLING = { markIndex: null, ticker: null, depth: null, kline: null, status: 'polling' };

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

describe('TradeView level-watch wiring', () => {
    beforeEach(() => {
        feedRef.current = POLLING;
        Object.values(lw).forEach(fn => typeof fn === 'function' && fn.mockClear?.());
        lw.subscribe.mockClear();
        lw.subscribe.mockImplementation(() => vi.fn());
        queuedSignals.length = 0;
        chatStore.__resetForTests();
        localStorage.clear();
        (streamChatWithDeskTools as unknown as Mock).mockReset();
        (streamChatWithDeskTools as unknown as Mock).mockImplementation(async function* () { yield 'ok'; });
    });

    it('ticks the watch from the live mark price and subscribes to hits', async () => {
        feedRef.current = LIVE;
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        expect(lw.tick).toHaveBeenCalledWith('BTCUSDT', 100.5);
        expect(lw.subscribe).toHaveBeenCalled();
    });

    it('arms the watch when the model calls present_trade (price at arm rides along)', async () => {
        feedRef.current = LIVE;
        (streamChatWithDeskTools as unknown as Mock).mockImplementation(async function* (
            _c: unknown, _m: unknown, opts: { executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown> },
        ) {
            yield 'setup';
            await opts.executePanelTool?.({
                id: 'c1', name: 'present_trade',
                arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
            });
        });
        render(<TradeView providers={[readyConfig]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        fireEvent.click(await screen.findByText('Read this chart'));
        await screen.findByTestId('trade-proposal-card');
        expect(lw.arm).toHaveBeenCalledTimes(1);
        const [plan, priceAtArm] = lw.arm.mock.calls[0] as [{ planId: string; symbol: string }, number];
        expect(plan.symbol).toBe('BTCUSDT');
        expect(plan.planId).toMatch(/^btc-/);
        expect(priceAtArm).toBe(100.5);
    });

    it('routes a fired level into the Chart AI signal queue', async () => {
        feedRef.current = LIVE;
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        const onHit = lw.subscribe.mock.calls[0][0] as (hit: unknown, plan: unknown) => void;
        onHit(
            { levelId: 'btc-1:TP1', kind: 'tp', label: 'TP1', price: 110, hitPrice: 110.5, at: Date.now() },
            { planId: 'btc-1', symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110, 120] },
        );
        expect(queuedSignals.length).toBe(1);
        expect(queuedSignals[0]).toContain('[HARNESS SIGNAL');
        expect(queuedSignals[0]).toContain('Level id btc-1:TP1');
    });

    it('disarms the PREVIOUS symbol when the instrument switches', async () => {
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        fireEvent.change(screen.getByLabelText('Trade symbol'), { target: { value: 'ETHUSDT' } });
        expect(lw.disarmSymbol).toHaveBeenCalledWith('BTCUSDT');
        expect(lw.disarmSymbol).not.toHaveBeenCalledWith('ETHUSDT');
    });
});

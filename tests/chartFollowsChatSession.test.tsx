/**
 * The coin chosen in Chat must be the coin the chart draws.
 *
 * The two chat homes share one conversation, and the conversation carries the
 * instrument: `TradeView` seeds its chart from the ACTIVE chat session
 * (`components/trade/TradeView.tsx:492`) instead of keeping a coin of its own.
 * That binding is invisible to a component test of either surface alone — the
 * dock's picker writes the store, the chart reads it, and only a test that
 * writes through one and reads through the other can see the seam. render-probe
 * covers the same path in a browser; this pins it in jsdom so a regression names
 * the seam rather than showing up as a screenshot.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('lightweight-charts', () => {
    const series = () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), data: vi.fn(() => []) });
    const chart = () => ({
        addSeries: vi.fn(series), removeSeries: vi.fn(), applyOptions: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
        resize: vi.fn(), remove: vi.fn(), data: () => [],
    });
    return {
        createChart: vi.fn(chart),
        CandlestickSeries: { defaultOptions: {} },
        HistogramSeries: { defaultOptions: {} },
        LineSeries: { defaultOptions: {} },
    };
});
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn(async () => []) }));
vi.mock('../hooks/useFuturesLiveFeed', () => ({
    useFuturesLiveFeed: () => ({ markIndex: null, ticker: null, depth: null, kline: null, status: 'polling' }),
    klineInterval: (i: string) => i.toLowerCase(),
}));
vi.mock('../services/trade/levelWatchService', () => ({
    arm: vi.fn(), disarm: vi.fn(), disarmSymbol: vi.fn(), tick: vi.fn(),
    subscribe: vi.fn(() => () => { }), getArmedPlans: vi.fn(() => []), firedLevelsFor: vi.fn(() => []),
}));
vi.mock('../services/analysis/MarketDataService', () => ({
    fetchAllFuturesSymbols: vi.fn(async () => []),
    fetchMarkIndex: vi.fn(async () => ({ markPrice: 100.5, indexPrice: 100.4, lastFundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, available: true })),
    fetchFuturesTicker24h: vi.fn(async () => ({ symbol: 'BTCUSDT', currentPrice: 100.5, price24hHigh: 104, price24hLow: 99, priceChange24h: -2.5, priceChangePercent24h: -2.5, volume24h: 1.2e9 })),
    fetchDerivativesData: vi.fn(async () => ({ openInterestValue: 2.9e8 })),
    fetchOrderBookDepth: vi.fn(async () => ({ bestBid: 100.4, bestAsk: 100.6, spread: 0.2, spreadPercent: 0.199, bids: [], asks: [], bidDepth: 0, askDepth: 0, depthImbalance: 0, buyWalls: [], sellWalls: [], dominantSide: 'balanced', wallDistance: {}, available: true })),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: vi.fn(async function* () { yield 'ok'; }),
}));
vi.mock('../hooks/useSymbolUniverse', () => ({
    useSymbolUniverse: () => [
        { symbol: 'BTCUSDT', baseAsset: 'BTC', lastPrice: 85000, changePercent24h: 1 },
        { symbol: 'ETHUSDT', baseAsset: 'ETH', lastPrice: 3000, changePercent24h: -2 },
    ],
}));

import TradeView from '../components/trade/TradeView';
import AgentsView from '../components/agents/AgentsView';
import * as chatStore from '../services/trade/chatStore';

const providers = [] as never[];
const dock = () => render(
    <TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => { }} />,
);
const agents = {
    username: 'rober', bots: [] as never[], groups: [] as never[], messages: [] as never[],
    selection: { kind: 'team' } as const, onSelect: () => { }, onNewBot: () => { },
    onNewGroup: () => { }, onSendBotTurn: async () => true, onAnalyze: async () => { }, coachCount: 0,
};

const chartCoin = async (): Promise<string | null> => {
    const el = await screen.findByTestId('trading-chart');
    return el.getAttribute('data-symbol');
};

beforeEach(() => {
    localStorage.clear();
    chatStore.__resetForTests();
});
afterEach(cleanup);

describe('the chart follows the chat session', () => {
    it('opens on the coin the active session carries, not on BTCUSDT', async () => {
        chatStore.addSession({ symbol: 'ETHUSDT' });
        dock();
        expect(await chartCoin()).toBe('ETHUSDT');
    });

    it('adopts a coin picked on the Chat surface when the trader returns to the chart', async () => {
        // The real handoff: choose ETH in the Chat composer, leave the surface,
        // come back. The picker's own label already proved the write landed;
        // this is the other half of that promise.
        chatStore.addSession({ symbol: 'BTCUSDT' });
        const first = render(<AgentsView {...agents} />);
        fireEvent.click(screen.getByTestId('symbol-picker-trigger'));
        fireEvent.click(screen.getByTestId('symbol-row-ETHUSDT'));
        expect(chatStore.getSnapshot().sessions
            .find(s => s.id === chatStore.getActiveId())?.symbol).toBe('ETHUSDT');
        first.unmount();

        dock();
        expect(await chartCoin()).toBe('ETHUSDT');
    });

    it("moves a mounted chart the moment the session's coin changes", async () => {
        // Live adoption, not just adoption-at-mount: the dock and the chart are
        // on screen together on a wide window, so a coin chosen in the Chat
        // column must move the chart behind it.
        chatStore.addSession({ symbol: 'BTCUSDT' });
        dock();
        expect(await chartCoin()).toBe('BTCUSDT');
        chatStore.mutate(chatStore.getActiveId(), s => ({ ...s, symbol: 'ETHUSDT' }));
        await screen.findByTestId('trade-view');
        expect(await chartCoin()).toBe('ETHUSDT');
    });

    it('adopts the coin of a session that came from storage, not just one made in memory', async () => {
        // The browser path: the store hydrates the dock's sessions from
        // `trade_chat_sessions_v1_<user>` and the last-open id from
        // `trade_chat_active_v1_<user>`. A session that arrives through that
        // loader is a different object from one `addSession` built, so the
        // adoption has to work for the loaded shape too — this is the shape the
        // trader actually hits after a reload.
        localStorage.setItem('last_active_user', 'rober');
        localStorage.setItem('trade_chat_sessions_v1_rober', JSON.stringify([
            {
                id: 's-seeded', title: 'Seeded chat', createdAt: 1, updatedAt: 2,
                symbol: 'ETHUSDT', interval: '15m', entries: [],
            },
        ]));
        localStorage.setItem('trade_chat_active_v1_rober', 's-seeded');
        chatStore.__resetForTests();

        dock();
        expect(await chartCoin()).toBe('ETHUSDT');
    });

    it('carries the coin across the conversation bind a surface switch performs', () => {
        // App.tsx binds the canonical conversation when the trader moves between
        // the two homes. If that mints a session, the mint must inherit the
        // instrument — a session born with no coin is how the chart opens on its
        // default while the conversation it joined is about something else.
        const seeded = chatStore.addSession({ symbol: 'ETHUSDT', interval: '4h' });
        // The store hydrates an empty default session when it finds nothing, and
        // a bind adopts THAT before minting. Clear the others so this exercises
        // the mint path the surface switch actually takes.
        for (const s of chatStore.getSnapshot().sessions) {
            if (s.id !== seeded && !s.conversationId && s.entries.length === 0) chatStore.removeSession(s.id);
        }
        const id = chatStore.bindConversation('c-9');
        const s = chatStore.getSnapshot().sessions.find(x => x.id === id);
        expect(s?.symbol).toBe('ETHUSDT');
        expect(s?.interval).toBe('4h');
        expect(s?.conversationId).toBe('c-9');
    });

    it('binds an existing conversation without overwriting its own coin', () => {
        const eth = chatStore.addSession({ symbol: 'ETHUSDT', conversationId: 'c-1' });
        chatStore.addSession({ symbol: 'BTCUSDT' });
        expect(chatStore.bindConversation('c-1')).toBe(eth);
        expect(chatStore.getSnapshot().sessions.find(x => x.id === eth)?.symbol).toBe('ETHUSDT');
    });
});

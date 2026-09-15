import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
        fetchAllFuturesSymbols: vi.fn(async () => []),
        fetchMarkIndex: vi.fn(async () => ({
            markPrice: 100.5, indexPrice: 100.4, lastFundingRate: 0.0001,
            nextFundingTime: Date.now() + 3_600_000, available: true,
        })),
        // The perp desk strip is futures-native now (fetchFuturesTicker24h),
        // not the spot ticker.
        fetchFuturesTicker24h: vi.fn(async () => ({
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
import { getActiveUsername } from '../../utils/activeUser';
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
        // Prototype header: HERO price (mark) with its 24h caption, and the
        // funding metric carries a depleting-window progress bar.
        const hero = await screen.findByTestId('hero-price');
        await waitFor(() => expect(hero.textContent).toContain('100.50'));
        expect(screen.getByText('24h · MARK')).toBeTruthy();
        expect(await screen.findByTestId('funding-bar')).toBeTruthy();
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
        // The TradingView-style picker: open the search, click the ETH row.
        fireEvent.click(screen.getByLabelText('Trade symbol'));
        fireEvent.click(screen.getByTestId('symbol-row-ETHUSDT'));
        expect(lw.disarmSymbol).toHaveBeenCalledWith('BTCUSDT');
        expect(lw.disarmSymbol).not.toHaveBeenCalledWith('ETHUSDT');
    });
});

// ── MOBILE 3-MODE SURFACE (audit 2026-09-16 item: "mobile Trade as
// Chart/AI/Book modes") ─────────────────────────────────────────────────────
// Below lg the stacked chart + dock + book flatten into ONE full-height pane
// picked by a segmented control; every pane stays MOUNTED in every mode
// (hidden, never unmounted) so the e2e/unit testid contract is mode-proof.
// jsdom's default 1024px window evaluates `(min-width:1024px)` as matching —
// the suites above run on the untouched desktop layout. These stub
// matchMedia to pin a phone width.
const stubViewport = (width: number): void => {
    vi.stubGlobal('matchMedia', (query: string) => {
        const min = Number(query.match(/min-width:\s*(\d+)/)?.[1] ?? '0');
        return {
            matches: width >= min,
            media: query,
            addEventListener: () => { },
            removeEventListener: () => { },
            onchange: null,
        } as unknown as MediaQueryList;
    });
};

describe('TradeView mobile 3-mode surface (<lg)', () => {
    const modeKey = () => `august_trade_mode_v1_${getActiveUsername()}`;
    beforeEach(() => {
        localStorage.clear();
        stubViewport(390);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the switcher, defaults to Chart, and keeps book + dock MOUNTED-HIDDEN', async () => {
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        const switcher = screen.getByTestId('trade-mode-switcher');
        expect(within(switcher).getAllByRole('tab').map(b => b.textContent)).toEqual(['Chart', 'AI', 'Book']);
        expect(screen.getByTestId('trade-mode-chart').getAttribute('aria-selected')).toBe('true');
        // Chart pane active; book + dock hidden but present (testids + chat
        // panel + ladder all stay in the DOM).
        expect(screen.getByTestId('trade-chart-pane').className).not.toContain('hidden');
        expect(screen.getByTestId('trade-sidebar').className).toContain('hidden');
        expect(screen.getByTestId('trade-dock').className).toContain('hidden');
        expect(screen.getByTestId('trade-chat-panel')).toBeTruthy();
        expect(within(screen.getByTestId('trade-sidebar')).getByText('Order Book')).toBeTruthy();
    });

    it('Book mode shows the full-width ladder and hides chart + dock', async () => {
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        fireEvent.click(await screen.findByTestId('trade-mode-book'));
        const book = screen.getByTestId('trade-sidebar');
        expect(book.className).not.toContain('hidden');
        expect(book.className).toContain('w-full');
        expect(screen.getByTestId('trade-chart-pane').className).toContain('hidden');
        expect(screen.getByTestId('trade-dock').className).toContain('hidden');
    });

    it('persists the choice per user and restores it on remount', async () => {
        const { unmount } = render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        fireEvent.click(await screen.findByTestId('trade-mode-ai'));
        expect(localStorage.getItem(modeKey())).toBe('ai');
        unmount();
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        expect((await screen.findByTestId('trade-mode-ai')).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('trade-dock').className).not.toContain('hidden');
        expect(screen.getByTestId('trade-chart-pane').className).toContain('hidden');
    });

    it('a junk persisted value falls back to Chart', async () => {
        localStorage.setItem(modeKey(), 'grid');
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        expect(screen.getByTestId('trade-chart-pane').className).not.toContain('hidden');
    });

    it('lg+ never renders the switcher and keeps the desktop panes active', async () => {
        stubViewport(1280);
        render(<TradeView providers={providers} selectedChatModel="" onSelectChatModel={() => {}} />);
        await screen.findByTestId('trade-view');
        expect(screen.queryByTestId('trade-mode-switcher')).toBeNull();
        expect(screen.getByTestId('trade-chart-pane').className).toContain('lg:min-h-0');
        expect(screen.getByTestId('trade-dock').className).toContain('lg:w-[var(--dock-w)]');
    });
});

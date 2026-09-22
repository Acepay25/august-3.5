/**
 * The AI's trendlines must reach the screen, not the console (2026-09-21).
 *
 * `LiveMarket` calls a paid model, gets back exact endpoints for every line it
 * drew, and used to `console.log` the count and discard the array — while the
 * adapter written to render them (`convertToLineData`) sat uncalled with no
 * consumer anywhere. Bias, summary and key levels all had state and rows; the
 * lines had neither.
 *
 * These pin the missing half: the lines render, through the adapter, and a
 * response with none adds no empty panel.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const analyzeMock = vi.hoisted(() => vi.fn());

/** The panel opens a real Binance socket on mount; jsdom's Event and undici's do
 *  not agree, and a test must not reach the network. Live data is irrelevant to
 *  what this file asserts (the AI card's rows). */
class StubSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(_url: string) { /* no connection */ }
    addEventListener(): void { /* no events */ }
    removeEventListener(): void { /* no events */ }
    send(): void { /* no traffic */ }
    close(): void { /* nothing open */ }
}

vi.mock('../services/analysis/AITrendlineService', async () => {
    const real = await import('../services/analysis/AITrendlineService');
    return {
        ...real,
        analyzeWithAI: (...args: unknown[]) => analyzeMock(...args),
    };
});

vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => Array.from({ length: 60 }, (_, i) => ({
        time: 1_700_000_000_000 + i * 3_600_000,
        open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10,
    }))),
    normalizeSymbol: vi.fn((s: string) => s),
}));

import LiveMarket from '../components/market/LiveMarket';
import { convertToLineData } from '../services/analysis/AITrendlineService';

const LEVEL = { price: 68250, type: 'resistance' as const };
const LINE = {
    type: 'trendline' as const,
    startTime: 1_700_000_000, startPrice: 64120.5,
    endTime: 1_700_036_000_000, endPrice: 67980.25,
    color: '#fff', importance: 'high' as const,
};

const analysis = (over: Record<string, unknown> = {}) => ({
    marketBias: 'bullish',
    keyLevels: [LEVEL],
    summary: 'Higher lows into a defended shelf.',
    trendlines: [],
    insights: {
        situation: '', observations: [], riskFactors: [],
        potentialMoves: { bullish: '', bearish: '' },
    },
    ...over,
});

const renderMarket = () => render(
    <LiveMarket isVisible onClose={vi.fn()} onAnalyze={vi.fn()} isEmbedded />,
);

describe('the Live Market AI panel renders the trendlines it paid for', () => {
    beforeEach(() => {
        analyzeMock.mockReset();
        vi.stubGlobal('WebSocket', StubSocket);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows a line with the endpoints the adapter produces', async () => {
        analyzeMock.mockResolvedValue(analysis({ trendlines: [LINE] }));
        renderMarket();
        const panel = await screen.findByTestId('ai-trendlines');
        // Exactly the pair convertToLineData reports — lo–hi, both endpoints.
        const [from, to] = convertToLineData(LINE);
        expect(from.value).toBe(64120.5);
        expect(to.value).toBe(67980.25);
        expect(panel.textContent).toContain('64,120.5');
        expect(panel.textContent).toContain('67,980.25');
        expect(panel.textContent).toContain('high');
    });

    it('falls back to the line type when the model sends no label', async () => {
        analyzeMock.mockResolvedValue(analysis({
            trendlines: [{ ...LINE, label: undefined, type: 'support' }],
        }));
        renderMarket();
        expect((await screen.findByTestId('ai-trendlines')).textContent).toContain('support');
    });

    it('adds no panel when the model drew nothing', async () => {
        analyzeMock.mockResolvedValue(analysis({ trendlines: [] }));
        renderMarket();
        // The rest of the AI card does arrive, so this is not a blank-panel test.
        await screen.findByText('Higher lows into a defended shelf.');
        expect(screen.queryByTestId('ai-trendlines')).not.toBeInTheDocument();
    });

    it('caps the list at four lines so a chatty model cannot blow the card', async () => {
        analyzeMock.mockResolvedValue(analysis({
            trendlines: Array.from({ length: 7 }, (_, i) => ({
                ...LINE, startTime: LINE.startTime + i, label: `line-${i}`,
            })),
        }));
        renderMarket();
        const panel = await screen.findByTestId('ai-trendlines');
        expect(panel.querySelectorAll('div.flex.items-baseline').length).toBe(4);
    });
});

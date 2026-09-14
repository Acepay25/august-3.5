/**
 * Screener → Chart AI wire, end to end: the screener's per-row learn button
 * loads the coin AND dispatches `august:prefill-chat`; the Chart AI composer
 * listens on the same window event and fills the scan prompt. Both real
 * components mount together — nothing is stubbed between them but the
 * screener's data source and the chat transport.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { runScreenerMock, streamMock } = vi.hoisted(() => ({
    runScreenerMock: vi.fn() as Mock<(...args: any[]) => any>,
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/trade/screener', () => ({
    runScreener: (...args: unknown[]) => runScreenerMock(...args),
}));
vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import ScreenerPanel from '../components/trade/ScreenerPanel';
import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

const ROW = {
    symbol: 'SOLUSDT', baseAsset: 'SOL', price: 100, change24h: 6.0, quoteVolume: 1e9,
    rsi14: 44, regime: 'range' as const,
    setups: [{ title: 'Breakout', side: 'long' as const }], edge: '7W/5L',
};

beforeEach(() => {
    runScreenerMock.mockReset();
    runScreenerMock.mockImplementation(async ({ onRows }: { onRows?: (r: unknown[]) => void }) => {
        onRows?.([ROW]);
        return [ROW];
    });
    streamMock.mockReset();
    chatStore.__resetForTests();
    __clearPacketCacheForTests();
    localStorage.clear();
    localStorage.setItem('trader_learning_v1:alice', '0');
    localStorage.setItem('supervisor_auto_v1:alice', '0');
});

describe('screener learn button → Chart AI composer prefill', () => {
    it('clicking learn loads the coin, closes the screener, and fills the composer with the scan prompt', async () => {
        const onChangeSymbol = vi.fn();
        const onClose = vi.fn();
        render(
            <>
                <ScreenerPanel open onClose={onClose} onChangeSymbol={onChangeSymbol} />
                <TradeChatPanel
                    symbol="BTCUSDT" interval="15m"
                    providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}}
                />
            </>,
        );

        // The composer starts empty; the chip beside it exists.
        const composer = await screen.findByPlaceholderText('Ask anything…');
        expect((composer as HTMLTextAreaElement).value).toBe('');
        expect(screen.getByRole('button', { name: /Scan → skills/i })).toBeTruthy();

        await waitFor(() => expect(screen.getByTestId('screener-learn-SOLUSDT')).toBeTruthy());
        fireEvent.click(screen.getByTestId('screener-learn-SOLUSDT'));

        // Coin handed to the chart + overlay dismissed…
        expect(onChangeSymbol).toHaveBeenCalledWith('SOLUSDT');
        expect(onClose).toHaveBeenCalled();
        // …and the SAME window event filled the real composer (send stays manual).
        await waitFor(() =>
            expect((composer as HTMLTextAreaElement).value).toContain('scan_chart_skills'));
        expect((composer as HTMLTextAreaElement).value).toContain('Inbox');
    });
});

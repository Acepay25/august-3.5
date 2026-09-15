/**
 * KeyLevelsCard — the model's key-levels block becomes a table card with a
 * live chart toggle: the "chart" switch draws all levels as lines, a row pin
 * survives the switch, and the most-recent card owns the chart layer (a
 * settling card never blanks it on mount). Also covers the TRANSCRIPT wiring
 * through TradeChatPanel: a closed block renders as the card (raw fence text
 * never flashes), and the card's pushes ride the onChatLevelsChange prop.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() as Mock<(...args: any[]) => any> }));
vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/analysis/KlineService', () => ({
    // BiasChips (mounted by the dock) pulls klines for its regime row.
    fetchKlines: vi.fn(async () => []),
}));

import KeyLevelsCard from '../components/trade/KeyLevelsCard';
import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import { parseKeyLevels, type ModelKeyLevel, type MessageLevelLines } from '../services/trade/keyLevels';
import * as chatStore from '../services/trade/chatStore';

const LEVELS: ModelKeyLevel[] = parseKeyLevels(
    '```key-levels\nVWAP | 78582 | below = bearish lean\nR2 | 77841 | 24h high\nS1 | 77427 | EQ highs\n```',
).levels;

const MARK = () => 77625.88;

const stateOf = (payload: MessageLevelLines | null, id: string) =>
    payload?.lines.find(l => l.id === id)?.state;

describe('KeyLevelsCard toggle → chart', () => {
    beforeEach(() => { __clearPacketCacheForTests(); localStorage.clear(); });

    it('mounts drawing nothing, the master switch draws all, pins survive the switch off', async () => {
        const push = vi.fn();
        render(<KeyLevelsCard levels={LEVELS} symbol="BTCUSDT" getMark={MARK} onChatLevels={push} />);
        // A settling card must NOT blank another card's live layer on mount.
        expect(push).not.toHaveBeenCalled();

        // 1) master on → every level drawn (dim "shown").
        fireEvent.click(screen.getByTestId('key-levels-chart-toggle'));
        await waitFor(() => expect(push).toHaveBeenCalled());
        let payload = push.mock.calls.at(-1)![0] as MessageLevelLines;
        expect(payload.symbol).toBe('BTCUSDT');
        expect(payload.lines.map(l => l.state)).toEqual(['shown', 'shown', 'shown']);

        // 2) pin the R2 row → it upgrades to "pinned" (and stays with the switch off).
        const r2 = LEVELS.find(l => l.label === 'R2')!;
        fireEvent.click(screen.getByText('R2'));
        await waitFor(() => expect(stateOf(push.mock.calls.at(-1)![0], r2.id)).toBe('pinned'));

        // 3) master off → ONLY the pinned line survives.
        fireEvent.click(screen.getByTestId('key-levels-chart-toggle'));
        await waitFor(() => {
            payload = push.mock.calls.at(-1)![0] as MessageLevelLines;
            expect(stateOf(payload, r2.id)).toBe('pinned');
            expect(stateOf(payload, LEVELS.find(l => l.label === 'S1')!.id)).toBe('hidden');
        });
    });

    it('hover previews a drawn line at full strength and resets on leave', async () => {
        const push = vi.fn();
        render(<KeyLevelsCard levels={LEVELS} symbol="BTCUSDT" getMark={MARK} onChatLevels={push} />);
        fireEvent.click(screen.getByTestId('key-levels-chart-toggle'));
        await waitFor(() => expect(push).toHaveBeenCalled());
        const vwap = LEVELS.find(l => l.label === 'VWAP')!;
        fireEvent.mouseEnter(screen.getByText('VWAP'));
        await waitFor(() => expect(stateOf(push.mock.calls.at(-1)![0], vwap.id)).toBe('preview'));
        fireEvent.mouseLeave(screen.getByTestId('key-levels-card'));
        await waitFor(() => expect(stateOf(push.mock.calls.at(-1)![0], vwap.id)).toBe('shown'));
    });

    it('a coin switch drops the draw state and clears the chart layer', async () => {
        const push = vi.fn();
        const { rerender } = render(<KeyLevelsCard levels={LEVELS} symbol="BTCUSDT" getMark={MARK} onChatLevels={push} />);
        fireEvent.click(screen.getByTestId('key-levels-chart-toggle'));
        await waitFor(() => expect(push.mock.calls.at(-1)![0]).toBeTruthy());
        rerender(<KeyLevelsCard levels={LEVELS} symbol="ETHUSDT" getMark={MARK} onChatLevels={push} />);
        await waitFor(() => expect(push.mock.calls.at(-1)![0]).toBeNull());
        // The fresh coin starts with the switch off — the BTC levels do not
        // silently repaint an ETH chart.
        expect((screen.getByTestId('key-levels-chart-toggle') as HTMLInputElement).checked).toBe(false);
    });

    it('shows prices, distances and the last divider against the live mark', () => {
        render(<KeyLevelsCard levels={LEVELS} symbol="BTCUSDT" getMark={MARK} onChatLevels={vi.fn()} />);
        expect(screen.getByText('78,582.00')).toBeTruthy();
        expect(screen.getByTestId('key-levels-last').textContent).toContain('77,625.88');
        // VWAP sits above the mark (+1.23%), S1 below (−0.26%).
        expect(screen.getByText('+1.23%')).toBeTruthy();
        expect(screen.getByText('−0.26%')).toBeTruthy();
    });
});

describe('the key-levels block inside the transcript', () => {
    const config = {
        id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
        baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
        isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
    } as never;

    beforeEach(() => { chatStore.__resetForTests(); __clearPacketCacheForTests(); localStorage.clear(); });

    it('renders the card instead of raw fence text, and its toggle reaches the dock callback', async () => {
        const push = vi.fn();
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} onChatLevelsChange={push} />);
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [{ id: 'a1', role: 'ai', text: [
                'BTC rejected the 24h high; below VWAP, bearish lean.',
                '```key-levels',
                'R2 | 77,841 | 24h high — rejection',
                'S1 | 77,427 | EQ highs (sweep bait)',
                '```',
            ].join('\n'), tools: [] }],
        })); });

        // The card renders; the protocol block never appears as prose.
        const card = await screen.findByTestId('key-levels-card');
        expect(card.textContent).toContain('24h high');
        expect(document.body.textContent).not.toContain('```');
        // The visible bubble shows the answer minus the block.
        expect(screen.getByText(/rejected the 24h high; below VWAP/)).toBeTruthy();

        // The card's master switch reaches the dock's chart-level callback.
        fireEvent.click(screen.getByTestId('key-levels-chart-toggle'));
        await waitFor(() => expect(push).toHaveBeenCalled());
        const payload = push.mock.calls.at(-1)![0] as MessageLevelLines;
        expect(payload.symbol).toBe('BTCUSDT');
        expect(payload.lines.every(l => l.state === 'shown')).toBe(true);
    });

    it('a half-streamed (unclosed) block shows neither fence nor card', async () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} />);
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [{ id: 'a1', role: 'ai', text: 'Weighing the tape…\n\n```key-levels\nR1 | 100 |', tools: [], streaming: true }],
        })); });
        expect(await screen.findByText(/Weighing the tape/)).toBeTruthy();
        expect(screen.queryByTestId('key-levels-card')).toBeNull();
        expect(screen.queryByText(/R1 \| 100/)).toBeNull();
    });

    it('a NON-OWNING card unmounting must not blank the owning card\u2019s live lines', async () => {
        const push = vi.fn();
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} onChatLevelsChange={push} />);
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [
                { id: 'k1', role: 'ai', text: 'first read\n```key-levels\nR2 | 77841 | hi\n```', tools: [] },
                { id: 'k2', role: 'ai', text: 'second read\n```key-levels\nS1 | 77427 | lo\n```', tools: [] },
            ],
        })); });
        await screen.findAllByTestId('key-levels-card');
        const toggles = () => screen.getAllByTestId('key-levels-chart-toggle');
        // Card k1 draws, then card k2 draws — k2 now OWNS the shared layer.
        fireEvent.click(toggles()[0]);
        await waitFor(() => expect(push).toHaveBeenCalled());
        fireEvent.click(toggles()[1]);
        await waitFor(() => {
            const p = push.mock.calls.at(-1)![0] as MessageLevelLines;
            expect(p).toBeTruthy();
            expect(p.lines[0].price).toBe(77427);
        });
        // k1's message leaves the transcript → its card unmounts. Its clear
        // must be DROPPED (it is not the owner): k2's lines stay drawn.
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: s.entries.filter(e => e.id !== 'k1'),
        })); });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(push.mock.calls.at(-1)![0]).not.toBeNull();
        // The OWNER leaving IS the legitimate clear — the channel blanks.
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({ ...s, entries: [] })); });
        await waitFor(() => expect(push.mock.calls.at(-1)![0]).toBeNull());
    });
});

/**
 * The dock's Chat | Coach surface switch. The Coach inbox used to be one
 * submenu deep in ⋯; these pin the replacement — that the switch exists only
 * when a Coach surface was actually handed to the dock, that it creates the
 * coach session lazily on first visit, that switching back lands on a real
 * conversation (not a blank), and that the pending count rides the label.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { streamMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => []),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

const renderDock = (props: Partial<React.ComponentProps<typeof TradeChatPanel>> = {}) => render(
    <TradeChatPanel
        symbol="BTCUSDT"
        interval="15m"
        providers={[config]}
        selectedChatModel="model-a"
        onSelectChatModel={() => {}}
        renderCoachSurface={() => <div data-testid="fake-coach-surface">coach</div>}
        {...props}
    />,
);

beforeEach(() => {
    chatStore.__resetForTests();
    streamMock.mockReset();
    __clearPacketCacheForTests();
    localStorage.clear();
});

describe('Chat | Coach surface switch', () => {
    it('replaces the wordmark with the switch when a Coach surface exists', () => {
        renderDock();
        const switcher = screen.getByTestId('dock-surface-switch');
        expect(switcher).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: /Coach/ })).toHaveAttribute('aria-selected', 'false');
        // The wordmark is gone — the switch names the surface now.
        expect(screen.queryByText('Chart AI')).toBeNull();
    });

    it('keeps the plain wordmark and no switch when no Coach surface was handed in', () => {
        renderDock({ renderCoachSurface: undefined });
        expect(screen.queryByTestId('dock-surface-switch')).toBeNull();
        expect(screen.getByText('Chart AI')).toBeInTheDocument();
    });

    it('creates the coach session on first visit and renders the surface', () => {
        renderDock();
        expect(screen.queryByTestId('chat-coach-surface')).toBeNull();
        expect(chatStore.getSnapshot().sessions.some(s => s.kind === 'coach')).toBe(false);

        fireEvent.click(screen.getByRole('tab', { name: /Coach/ }));

        expect(screen.getByTestId('chat-coach-surface')).toBeInTheDocument();
        expect(screen.getByTestId('fake-coach-surface')).toBeInTheDocument();
        expect(chatStore.getSnapshot().sessions.filter(s => s.kind === 'coach')).toHaveLength(1);
        expect(screen.getByRole('tab', { name: /Coach/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('reuses the existing coach session instead of stacking duplicates', () => {
        renderDock();
        const coachTab = screen.getByRole('tab', { name: /Coach/ });
        fireEvent.click(coachTab);
        const firstId = chatStore.getActiveId();

        fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
        fireEvent.click(coachTab);

        expect(chatStore.getSnapshot().sessions.filter(s => s.kind === 'coach')).toHaveLength(1);
        expect(chatStore.getActiveId()).toBe(firstId);
    });

    it('switching back to Chat returns the transcript, not a blank pane', () => {
        renderDock();
        const soloId = chatStore.getActiveId();
        fireEvent.click(screen.getByRole('tab', { name: /Coach/ }));
        expect(screen.queryByTestId('chat-coach-surface')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));

        expect(chatStore.getActiveId()).toBe(soloId);
        expect(screen.queryByTestId('chat-coach-surface')).toBeNull();
        expect(screen.getByTestId('trade-chat-panel')).toBeInTheDocument();
    });

    it('opens a fresh conversation when Chat is clicked and none exists', () => {
        renderDock();
        // Land on the Coach surface, then wipe every conversation behind it.
        fireEvent.click(screen.getByRole('tab', { name: /Coach/ }));
        act(() => {
            for (const s of chatStore.getSnapshot().sessions) {
                if (s.kind !== 'coach') chatStore.removeSession(s.id);
            }
        });
        expect(chatStore.getSnapshot().sessions.every(s => s.kind === 'coach')).toBe(true);

        fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));

        expect(chatStore.getSnapshot().sessions.some(s => s.kind === 'solo')).toBe(true);
        expect(screen.queryByTestId('chat-coach-surface')).toBeNull();
    });

    it('shows how many decisions are waiting on the Coach tab', () => {
        const { rerender } = renderDock({ coachPending: 0 });
        expect(screen.queryByText('0')).toBeNull();
        expect(screen.getByRole('tab', { name: /Coach/ })).toHaveAttribute(
            'title', 'Coach inbox — nothing waiting',
        );

        rerender(
            <TradeChatPanel
                symbol="BTCUSDT" interval="15m" providers={[config]}
                selectedChatModel="model-a" onSelectChatModel={() => {}}
                renderCoachSurface={() => <div data-testid="fake-coach-surface">coach</div>}
                coachPending={7}
            />,
        );
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Coach/ })).toHaveAttribute(
            'title', '7 awaiting your decision',
        );
    });
});

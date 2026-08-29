import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { AgentRosterRail } from '../components/chat/AgentRosterRail';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import type { ProviderConfig } from '../types/provider';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
});

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
});

const provider = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'OpenAI',
    apiKey: over.apiKey ?? 'sk-test',
    baseUrl: over.baseUrl ?? 'https://api.example.com',
    apiFormat: over.apiFormat ?? 'chat_completions',
    isEnabled: over.isEnabled ?? true,
    isBuiltIn: over.isBuiltIn ?? false,
    models: over.models ?? ['gpt-test'],
    selectedModel: over.selectedModel ?? 'gpt-test',
});

let seq = 0;
const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? `m${seq += 1}`,
    role: over.role ?? MessageRole.USER,
    text: over.text ?? '',
    createdAt: over.createdAt ?? new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
});

const base = {
    selection: { kind: 'team' } as const,
    onSelectTeam: () => {},
    onSelectProvider: () => {},
    openedMap: {},
    activeUsername: 'Armand',
};

describe('AgentRosterRail', () => {
    it('renders the pinned Team row plus one row per provider', () => {
        render(
            <AgentRosterRail
                {...base}
                providers={[provider({ id: 'p1', name: 'OpenAI' }), provider({ id: 'p2', name: 'Anthropic' })]}
                messages={[]}
            />,
        );
        expect(screen.getByTestId('roster-team')).toBeTruthy();
        expect(screen.getByTestId('roster-agent-p1')).toBeTruthy();
        expect(screen.getByTestId('roster-agent-p2')).toBeTruthy();
    });

    it('marks the selected agent with data-active="1" (team default)', () => {
        render(
            <AgentRosterRail
                {...base}
                providers={[provider({ id: 'p1' })]}
                messages={[]}
            />,
        );
        expect(screen.getByTestId('roster-team').getAttribute('data-active')).toBe('1');
        expect(screen.getByTestId('roster-agent-p1').getAttribute('data-active')).toBe('0');
    });

    it('clicking a provider row selects it; clicking Team selects the team', () => {
        const onSelectProvider = vi.fn();
        const onSelectTeam = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                selection={{ kind: 'provider', providerId: 'p2' }}
                onSelectProvider={onSelectProvider}
                onSelectTeam={onSelectTeam}
                providers={[provider({ id: 'p1' }), provider({ id: 'p2' })]}
                messages={[]}
            />,
        );
        fireEvent.click(screen.getByTestId('roster-agent-p2'));
        expect(onSelectProvider).toHaveBeenCalledWith('p2');
        fireEvent.click(screen.getByTestId('roster-team'));
        expect(onSelectTeam).toHaveBeenCalledTimes(1);
    });

    it('search filters agent rows by name but keeps Team visible', () => {
        render(
            <AgentRosterRail
                {...base}
                providers={[provider({ id: 'p1', name: 'OpenAI' }), provider({ id: 'p2', name: 'Anthropic' })]}
                messages={[]}
            />,
        );
        const search = screen.getByTestId('roster-search') as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'anthropic' } });
        expect(screen.queryByTestId('roster-agent-p1')).toBeNull();
        expect(screen.getByTestId('roster-agent-p2')).toBeTruthy();
        expect(screen.getByTestId('roster-team')).toBeTruthy();
    });

    it('shows the last thread message as the row preview', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'watch BTC order flow', modelsUsed: undefined }),
            msg({ role: MessageRole.AI, text: 'Buy wall holding at 94.8k.', modelsUsed: { p1: 'gpt-test' } }),
        ];
        render(
            <AgentRosterRail
                {...base}
                providers={[provider({ id: 'p1', name: 'OpenAI' })]}
                messages={messages}
            />,
        );
        const row = screen.getByTestId('roster-agent-p1');
        expect(row.textContent).toContain('Buy wall holding at 94.8k.');
    });

    it('renders the trader identity footer', () => {
        render(
            <AgentRosterRail
                {...base}
                providers={[]}
                messages={[]}
                activeUsername="Armand"
            />,
        );
        expect(screen.getByText('Armand')).toBeTruthy();
        expect(screen.getByText('Trader')).toBeTruthy();
    });
});

import { FloorRail } from '../components/chat/FloorRail';

describe('FloorRail (chat right rail)', () => {
    const base = {
        activeProviderCount: 3,
        gaugeStats: { tasks: 12, running: 1, shipped: 4, approvals: 0 },
        approvalItems: [] as import('../utils/approvalInbox').ApprovalItem[],
        isDebating: false,
        phase: undefined as string | undefined,
    };

    it('renders the office cast vertically with the live count', () => {
        render(<FloorRail {...base} />);
        const cast = screen.getByTestId('floor-rail-cast');
        expect(cast.textContent).toContain('Chief');
        expect(cast.textContent).toContain('Verify');
        expect(cast.textContent).toContain('3 live');
    });

    it('surfaces the approval queue under "Needs you"', () => {
        render(
            <FloorRail
                {...base}
                gaugeStats={{ tasks: 12, running: 1, shipped: 4, approvals: 2 }}
                approvalItems={[
                    { id: 'a1', kind: 'autopilot', title: 'TP1 hit on NVDA', detail: 'd', messageId: 'm1' },
                ]}
            />,
        );
        const needs = screen.getByTestId('floor-rail-needs-you');
        expect(needs.textContent).toContain('Needs you');
        expect(needs.textContent).toContain('TP1 hit on NVDA');
    });

    it('shows the live debate phase while running, idle text otherwise', () => {
        const { rerender } = render(<FloorRail {...base} />);
        expect(screen.getByTestId('floor-rail-status').textContent).toContain('Floor idle');
        rerender(<FloorRail {...base} isDebating phase="Round 2 of 3" />);
        expect(screen.getByTestId('floor-rail-status').textContent).toContain('Round 2 of 3');
    });
});

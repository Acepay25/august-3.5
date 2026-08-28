import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { CompanyRoom } from '../components/room/CompanyRoom';
import { AgentChatView } from '../components/room/AgentChatView';
import type { ProviderConfig } from '../types/provider';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

afterEach(() => cleanup());

const provider = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'Test Provider',
    isEnabled: over.isEnabled ?? true,
    apiKey: over.apiKey ?? 'k',
    baseUrl: '',
    models: over.models ?? ['m1'],
    selectedModel: 'm1',
    isBuiltIn: false,
    apiFormat: 'chat_completions',
    createdAt: 0,
    updatedAt: 0,
    extraHeaders: {},
} as ProviderConfig);

describe('CompanyRoom', () => {
    it('renders the office background and counts lit desks from activeProviderCount', () => {
        const { container } = render(<CompanyRoom activeProviderCount={2} />);
        expect(screen.getByTestId('company-room')).toBeTruthy();
        // 6 default desks; the first 2 are lit.
        const lit = container.querySelectorAll('[data-lit="1"]');
        const dark = container.querySelectorAll('[data-lit="0"]');
        expect(lit.length).toBe(2);
        expect(dark.length).toBe(4);
    });

    it('respects a custom seatNames list', () => {
        const { container } = render(
            <CompanyRoom
                activeProviderCount={2}
                seatNames={['Macro', 'Risk', 'Technical']}
            />,
        );
        const desks = container.querySelectorAll('[data-testid^="company-desk-"]');
        expect(desks.length).toBe(3);
    });

    it('hides the header strip when showHeader is false', () => {
        render(<CompanyRoom showHeader={false} />);
        // The header label "Autonomous AI Company" should not appear.
        expect(screen.queryByText('Autonomous AI Company')).toBeNull();
    });
});

describe('AgentChatView', () => {
    it('renders nothing when open is false', () => {
        const { container } = render(
            <AgentChatView
                open={false}
                onClose={() => {}}
                providers={[]}
                agents={[]}
                activeAgentId={null}
                onSelectAgent={() => {}}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('lists every ready provider as an agent when open', () => {
        const providers = [
            provider({ id: 'p1', name: 'OpenAI' }),
            provider({ id: 'p2', name: 'Anthropic', apiKey: '' }),  // not ready
            provider({ id: 'p3', name: 'Google', models: ['gem-1'] }),
        ];
        const agents = providers
            .filter(p => p.isEnabled && p.apiKey.trim().length > 0)
            .map((p, idx) => ({ providerId: p.id, displayName: p.name }));
        render(
            <AgentChatView
                open
                onClose={() => {}}
                providers={providers}
                agents={agents}
                activeAgentId="p1"
                onSelectAgent={() => {}}
            />,
        );
        expect(screen.getByTestId('agent-chat-item-p1')).toBeTruthy();
        expect(screen.getByTestId('agent-chat-item-p3')).toBeTruthy();
        // p2 has no apiKey so it must NOT appear in the agent list.
        expect(screen.queryByTestId('agent-chat-item-p2')).toBeNull();
    });

    it('marks the active agent with data-active="1" and the others with "0"', () => {
        render(
            <AgentChatView
                open
                onClose={() => {}}
                providers={[]}
                agents={[
                    { providerId: 'a', displayName: 'A' },
                    { providerId: 'b', displayName: 'B' },
                ]}
                activeAgentId="b"
                onSelectAgent={() => {}}
            />,
        );
        expect(screen.getByTestId('agent-chat-item-a').getAttribute('data-active')).toBe('0');
        expect(screen.getByTestId('agent-chat-item-b').getAttribute('data-active')).toBe('1');
    });

    it('clicking an agent row calls onSelectAgent with its id', () => {
        const onSelect = vi.fn();
        render(
            <AgentChatView
                open
                onClose={() => {}}
                providers={[]}
                agents={[
                    { providerId: 'a', displayName: 'A' },
                    { providerId: 'b', displayName: 'B' },
                ]}
                activeAgentId={null}
                onSelectAgent={onSelect}
            />,
        );
        fireEvent.click(screen.getByTestId('agent-chat-item-b'));
        expect(onSelect).toHaveBeenCalledWith('b');
    });

    it('clicking the close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <AgentChatView
                open
                onClose={onClose}
                providers={[]}
                agents={[]}
                activeAgentId={null}
                onSelectAgent={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /close per-agent chat/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

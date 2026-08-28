import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

import { CompanyRoom } from '../components/room/CompanyRoom';
import { AgentChatView } from '../components/room/AgentChatView';
import { getRoleOverrides, setRoleOverride, clearRoleOverride } from '../services/desk/roleOverrides';
import { getRoomLayout, setSeatPosition, clearUndoStack } from '../services/desk/roomLayout';
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

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.localStorage.setItem('last_active_user', 'default');
        clearUndoStack();
    }
});

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

    it('shows the Autonomous AI Company header label and live count by default', () => {
        render(<CompanyRoom activeProviderCount={2} />);
        expect(screen.getByText('Autonomous AI Company')).toBeTruthy();
        // 2 of 6 default names are live.
        expect(screen.getByText('2 / 6 live')).toBeTruthy();
    });

    it('renders the four task-flow gauges in the header', () => {
        render(<CompanyRoom activeProviderCount={3} />);
        for (const label of ['Tasks', 'Running', 'Shipped', 'Approvals']) {
            expect(screen.getByText(label)).toBeTruthy();
        }
    });

    it('shows a centered human-approval-queue panel between the header and the desks', () => {
        render(<CompanyRoom activeProviderCount={2} />);
        expect(screen.getByText('Human approval queue')).toBeTruthy();
    });

    it('positions desks at the default 6-cell grid when no saved layout exists', () => {
        const { container } = render(<CompanyRoom />);
        const desks = container.querySelectorAll('[data-testid^="company-desk-"]');
        // 6 desks, each with `left: NN%` and `top: 78%` (the default).
        expect(desks).toHaveLength(6);
        for (let i = 0; i < desks.length; i += 1) {
            const el = desks[i] as HTMLElement;
            expect(el.style.left).toMatch(/^\d+(\.\d+)?%$/);
            expect(el.style.top).toBe('78%');
        }
    });

    it('honors a saved roomLayout from the store (overrides default cells)', () => {
        setSeatPosition(
            ['Chief', 'Sales', 'Research', 'Build', 'Test', 'Verify'],
            'Chief',
            { x: 0.5, y: 0.5 },
        );
        const { container } = render(<CompanyRoom />);
        const chiefDesk = container.querySelector('[data-testid="company-desk-0"]') as HTMLElement;
        expect(chiefDesk.style.left).toBe('50%');
        expect(chiefDesk.style.top).toBe('50%');
    });

    it('renders the live gauge stats with raw counts when gaugeStats is provided', () => {
        render(
            <CompanyRoom
                activeProviderCount={3}
                gaugeStats={{
                    tasks: 24,
                    running: 1,
                    shipped: 17,
                    approvals: 4,
                }}
            />,
        );
        // The four labels.
        expect(screen.getByText('Tasks')).toBeTruthy();
        expect(screen.getByText('Running')).toBeTruthy();
        expect(screen.getByText('Shipped')).toBeTruthy();
        expect(screen.getByText('Approvals')).toBeTruthy();
        // The raw counts (when gaugeStats is set, the bar shows a
        // monospace digit so the trader can read the exact number).
        expect(screen.getByText('24')).toBeTruthy();
        expect(screen.getByText('17')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('honors a per-user seat-name override from Settings -> Roles (no label change)', () => {
        // The override map (`getRoleOverrides`) is keyed by seat name
        // and stores a RolePreset. The display label is the seat name
        // itself; the override changes the AVATAR's role color, not
        // the text. So the test asserts that the label stays the same
        // and that getRoleOverrides is consulted (no error). This is
        // a smoke test rather than a full color-routing check.
        setRoleOverride('Chief', 'risk');
        const { container } = render(
            <CompanyRoom seatNames={['Chief', 'Sales', 'Research']} />,
        );
        // The label is rendered as a <span> with the
        // bg-zinc-900/80 class (the desk plate). Filter to those.
        const labels = Array.from(container.querySelectorAll(
            '[data-testid^="company-desk-"] span.bg-zinc-900\\/80',
        )).map(el => el.textContent);
        // The first desk still says "Chief" (the override is about
        // the avatar's role, not the displayed text).
        expect(labels).toContain('Chief');
        // Cleanup so other tests aren't affected.
        clearRoleOverride('Chief');
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

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

import { CompanyRoom } from '../components/room/CompanyRoom';
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

    it('honors a per-user seat-name override from Settings -> Roles (avatar color routes)', () => {
        // The override map (`getRoleOverrides`) is keyed by seat name
        // and stores a RolePreset. The display label is the seat name
        // itself; the override changes the AVATAR's role color. The
        // heuristic gives 'Chief' the 'unknown' (grayscale) accent —
        // pinning it to 'risk' must repaint the avatar with the risk
        // accent (#f87171) without touching the name plate.
        const { container } = render(
            <CompanyRoom seatNames={['Chief', 'Sales', 'Research']} />,
        );
        const chiefDesk = container.querySelector(
            '[data-testid="company-desk-0"]',
        ) as HTMLElement;
        const chiefRole = (): string | null =>
            chiefDesk.querySelector('button')?.getAttribute('data-role') ?? null;
        // Heuristic: 'Chief' → 'unknown' (grayscale accent).
        expect(chiefRole()).toBe('unknown');

        // The override lands without a remount (subscription → tick)
        // and data-role is what colorForToken reads, so this proves
        // the avatar repaints with the pinned role's accent.
        act(() => { setRoleOverride('Chief', 'risk'); });
        expect(chiefRole()).toBe('risk');
        expect(chiefDesk.textContent).toContain('Chief');
        // Cleanup so other tests aren't affected.
        clearRoleOverride('Chief');
    });
});


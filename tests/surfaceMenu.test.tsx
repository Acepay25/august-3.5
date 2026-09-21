/**
 * SurfaceMenuList — the five surfaces as the hamburger menu's first section,
 * after the always-visible icon rail went. Every row states its keyboard
 * shortcut in its accessible name (the visible kbd is invisible to a screen
 * reader once aria-label owns the name), the active row is marked, and the
 * rail's two leftover entry points — Approvals and Switch profile — sit below.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SurfaceMenuList from '../components/shell/SurfaceMenuList';

const renderMenu = (props: Partial<React.ComponentProps<typeof SurfaceMenuList>> = {}) => render(
    <SurfaceMenuList surface="trade" onSelect={() => {}} {...props} />,
);

describe('the surface menu', () => {
    it('lists every surface, and marks + names the active one', () => {
        renderMenu();
        for (const label of ['Trade', 'Journal', 'Studio', 'Agents', 'Learn']) {
            // Prefix match: the accessible name also carries the shortcut.
            expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
        }
        const trade = screen.getByRole('button', { name: /^Trade/ });
        expect(trade.getAttribute('aria-current')).toBe('page');
        expect(trade.getAttribute('aria-label')).toContain('Alt+1');
        expect(screen.getByRole('button', { name: /^Learn/ }).getAttribute('aria-current')).toBeNull();
    });

    it('clicking a row selects that surface', () => {
        const onSelect = vi.fn();
        renderMenu({ onSelect });
        fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));
        expect(onSelect).toHaveBeenCalledWith('agents');
    });

    it('announces a live badge through the row name and shows its count', () => {
        renderMenu({ surface: 'learn', badges: { agents: { count: 3, detail: '3 awaiting your decision' } } });
        const agents = screen.getByRole('button', { name: /^Agents/ });
        expect(agents.getAttribute('aria-label')).toBe('Agents. 3 awaiting your decision, shortcut Alt+4');
        expect(agents.textContent).toContain('3');
    });

    it('shows a pulsing dot, not a count, for a badge with nothing numbered', () => {
        const { container } = renderMenu({ badges: { agents: { active: true, detail: 'a bot is working' } } });
        // The count pill is the amber-500 badge; the dot is amber-400.
        expect(container.querySelectorAll('.bg-amber-500')).toHaveLength(0);
        expect(screen.getByRole('button', { name: /^Agents/ }).querySelector('span.animate-pulse')).toBeTruthy();
    });
});

describe('approvals entry point (WS-5.2)', () => {
    it('reaches the one approvals drawer, counting what waits', () => {
        const onOpenApprovals = vi.fn();
        renderMenu({ onOpenApprovals, approvalsCount: 3 });
        const btn = screen.getByTestId('nav-approvals');
        expect(btn.textContent).toContain('3');
        expect(btn.getAttribute('aria-label')).toBe('Approvals, 3 waiting');
        fireEvent.click(btn);
        expect(onOpenApprovals).toHaveBeenCalledTimes(1);
    });

    it('keeps the inbox reachable with an empty tray, minus the count pill', () => {
        renderMenu({ onOpenApprovals: () => {}, approvalsCount: 0 });
        expect(screen.getByTestId('nav-approvals').textContent).toBe('Approvals');
    });

    it('renders no approvals or switch-profile row without the handler', () => {
        renderMenu();
        expect(screen.queryByTestId('nav-approvals')).toBeNull();
        expect(screen.queryByTestId('nav-switch-user')).toBeNull();
    });
});

describe('profile switching', () => {
    it('fires the handler the rail used to carry', () => {
        const onSwitchUser = vi.fn();
        renderMenu({ onSwitchUser });
        fireEvent.click(screen.getByTestId('nav-switch-user'));
        expect(onSwitchUser).toHaveBeenCalledTimes(1);
    });
});

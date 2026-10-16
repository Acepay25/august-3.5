/**
 * SurfaceMenuList — the five surfaces of the expanded nav rail. Every row
 * states its keyboard shortcut in its accessible name (the visible kbd is
 * invisible to a screen reader once aria-label owns the name), the active row
 * is marked, and Approvals sits below the surfaces. Switch profile moved to
 * the account row (NavRail) in stage 3 — it is a profile action, not nav.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SurfaceMenuList from '../components/shell/SurfaceMenuList';

const renderMenu = (props: Partial<React.ComponentProps<typeof SurfaceMenuList>> = {}) => render(
    <SurfaceMenuList surface="trade" onSelect={() => {}} {...props} />,
);

describe('the surface menu', () => {
    it('Skills is no longer a surface, and Customize carries its Alt+3', () => {
        // The Strategy Studio is the Skills SETTINGS tab now. The rail row that
        // replaced it is a route into a pane, not a destination, so it must not
        // claim aria-current — and the chord survives rather than vanishing.
        const onSelect = vi.fn();
        const onOpenCustomize = vi.fn();
        renderMenu({ onSelect, onOpenCustomize });
        expect(screen.queryByRole('button', { name: /^Skills/ })).toBeNull();
        const customize = screen.getByTestId('nav-customize');
        expect(customize.textContent).toContain('Customize');
        expect(customize.getAttribute('aria-current')).toBeNull();
        fireEvent.click(customize);
        expect(onOpenCustomize).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('hides the Customize row when nothing can open the tab', () => {
        renderMenu();
        expect(screen.queryByTestId('nav-customize')).toBeNull();
    });

    it('the rail carries five rows: four surfaces plus Customize', () => {
        // Approvals was the sixth. It is a tab of the Knowledge surface, so the
        // row was a second way into the surface below it — and both showed the
        // same count on one screen. The probe's `rows === 5` means this.
        renderMenu({ onOpenCustomize: () => {} });
        expect(document.querySelectorAll('[data-testid="surface-menu"] button')).toHaveLength(5);
    });

    it('lists every surface, and marks + names the active one', () => {
        renderMenu();
        for (const label of ['Trade', 'Journal', 'Chat', 'Knowledge']) {
            // Prefix match: the accessible name also carries the shortcut.
            expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
        }
        const trade = screen.getByRole('button', { name: /^Trade/ });
        expect(trade.getAttribute('aria-current')).toBe('page');
        expect(trade.getAttribute('aria-label')).toContain('Alt+1');
        expect(screen.getByRole('button', { name: /^Knowledge/ }).getAttribute('aria-current')).toBeNull();
    });

    it('clicking a row selects that surface', () => {
        const onSelect = vi.fn();
        renderMenu({ onSelect });
        fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));
        expect(onSelect).toHaveBeenCalledWith('agents');
    });

    it('announces a live badge through the row name and shows its count', () => {
        renderMenu({ surface: 'learn', badges: { agents: { count: 3, detail: '3 awaiting your decision' } } });
        const agents = screen.getByRole('button', { name: /^Chat/ });
        expect(agents.getAttribute('aria-label')).toBe('Chat. 3 awaiting your decision, shortcut Alt+4');
        expect(agents.textContent).toContain('3');
    });

    it('shows a pulsing dot, not a count, for a badge with nothing numbered', () => {
        const { container } = renderMenu({ badges: { agents: { active: true, detail: 'a bot is working' } } });
        // The count pill is the amber-500 badge; the dot is amber-400.
        expect(container.querySelectorAll('.bg-amber-500')).toHaveLength(0);
        expect(screen.getByRole('button', { name: /^Chat/ }).querySelector('span.animate-pulse')).toBeTruthy();
    });
});

describe('the waiting count rides the surface that holds it', () => {
    it('Knowledge carries the number, and there is no Approvals row', () => {
        renderMenu({ badges: { learn: { count: 3, detail: '3 decisions waiting' } } });
        expect(screen.queryByTestId('nav-approvals')).toBeNull();
        const knowledge = screen.getByRole('button', { name: /^Knowledge/ });
        expect(knowledge.textContent).toContain('3');
        expect(knowledge.getAttribute('aria-label')).toBe('Knowledge. 3 decisions waiting, shortcut Alt+5');
    });

    it('the row still exists with nothing waiting', () => {
        renderMenu();
        expect(screen.getByRole('button', { name: /^Knowledge/ }).textContent).toBe('KnowledgeAlt+5');
    });

    it('renders no approvals row and no switch-profile control', () => {
        renderMenu();
        // Switch profile is NOT here any more — the account row owns it.
        expect(screen.queryByTestId('nav-switch-user')).toBeNull();
    });
});

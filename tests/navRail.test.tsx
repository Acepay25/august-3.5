/**
 * NavRail — Antigravity's activity bar: a thin always-visible icon column of
 * the surfaces. Clicking an inactive surface selects it; clicking the ACTIVE
 * one toggles that surface's sidebar — but only on a surface that HAS a
 * sidebar (Trade). Account + settings stay pinned at the bottom.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NavRail from '../components/shell/NavRail';

describe('NavRail activity bar', () => {
    it('renders every surface as a visible icon; the active one is marked', () => {
        render(<NavRail surface="trade" onSelect={() => {}} onToggleSidebar={() => {}} onOpenSettings={() => {}} username="Rober" />);
        for (const label of ['Trade', 'Journal', 'Studio', 'Agents']) {
            // Prefix match: each accessible name now also carries the badge
            // detail and its keyboard shortcut.
            expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
        }
        const trade = screen.getByRole('button', { name: /^Trade/ });
        expect(trade.getAttribute('aria-current')).toBe('page');
        // The visual Tip is aria-hidden, so the key hint has to live in the
        // accessible name or it exists for nobody but the mouse.
        expect(trade.getAttribute('aria-label')).toContain('Alt+1');
    });

    it('clicking another surface selects it; clicking the ACTIVE one toggles the sidebar', () => {
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        render(<NavRail surface="trade" onSelect={onSelect} onToggleSidebar={onToggle} onOpenSettings={() => {}} username="Rober" />);
        fireEvent.click(screen.getByRole('button', { name: /^Agents/ }));
        expect(onSelect).toHaveBeenCalledWith('agents');
        expect(onToggle).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^Trade/ }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('only Trade advertises a panel toggle — Learn/Agents re-select instead', () => {
        const onToggle = vi.fn();
        const onSelect = vi.fn();
        render(<NavRail surface="learn" onSelect={onSelect} onToggleSidebar={onToggle} onOpenSettings={() => {}} username="Rober" />);
        const learn = screen.getByRole('button', { name: /^Learn/ });
        expect(learn.getAttribute('aria-label')).not.toMatch(/toggle panel/);
        fireEvent.click(learn);
        expect(onToggle).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledWith('learn');
        // And Learn is a real surface with its shortcut advertised.
        expect(learn.getAttribute('aria-label')).toContain('Alt+5');
        expect(learn.getAttribute('aria-current')).toBe('page');
    });

    it('the account menu is the rail\'s only settings entry', () => {
        const onOpenSettings = vi.fn();
        render(<NavRail surface="journal" onSelect={() => {}} onToggleSidebar={() => {}} onOpenSettings={onOpenSettings} username="Rober" />);
        // The gear is gone: it opened the same overlay as the menu's Settings
        // row, so the rail was spending an icon on a duplicate.
        expect(screen.queryByRole('button', { name: /^Settings/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
        fireEvent.click(screen.getByTestId('nav-settings'));
        expect(onOpenSettings).toHaveBeenCalled();
    });
});

describe('approvals entry point (WS-5.2)', () => {
    it('reaches the one approvals drawer from the rail, counting what waits', () => {
        const onOpenApprovals = vi.fn();
        render(<NavRail surface="trade" onSelect={() => {}} onToggleSidebar={() => {}}
            onOpenSettings={() => {}} onOpenApprovals={onOpenApprovals} approvalsCount={3} />);
        const btn = screen.getByTestId('nav-approvals');
        expect(btn.textContent).toContain('3');
        expect(btn.getAttribute('aria-label')).toBe('Approvals, 3 waiting');
        fireEvent.click(btn);
        expect(onOpenApprovals).toHaveBeenCalledTimes(1);
    });

    it('keeps the inbox reachable with an empty tray, minus the count pill', () => {
        render(<NavRail surface="trade" onSelect={() => {}} onToggleSidebar={() => {}}
            onOpenSettings={() => {}} onOpenApprovals={() => {}} approvalsCount={0} />);
        expect(screen.getByTestId('nav-approvals').textContent).toBe('');
    });
});

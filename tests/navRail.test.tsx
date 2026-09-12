/**
 * NavRail — Antigravity's activity bar: a thin always-visible icon column of
 * the surfaces. Clicking an inactive surface selects it; clicking the ACTIVE
 * one toggles that surface's sidebar panel (Trade's order book) instead of
 * re-selecting. Account + settings stay pinned at the bottom.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NavRail from '../components/shell/NavRail';

describe('NavRail activity bar', () => {
    it('renders every surface as a visible icon; the active one is marked', () => {
        render(<NavRail surface="trade" onSelect={() => {}} onToggleSidebar={() => {}} onOpenSettings={() => {}} username="Rober" />);
        for (const label of ['Trade', 'Journal', 'Studio', 'Agents']) {
            expect(screen.getByRole('button', { name: label })).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: 'Trade' }).getAttribute('aria-current')).toBe('page');
    });

    it('clicking another surface selects it; clicking the ACTIVE one toggles the sidebar', () => {
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        render(<NavRail surface="trade" onSelect={onSelect} onToggleSidebar={onToggle} onOpenSettings={() => {}} username="Rober" />);
        fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
        expect(onSelect).toHaveBeenCalledWith('agents');
        expect(onToggle).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('settings + account stay pinned', () => {
        const onOpenSettings = vi.fn();
        render(<NavRail surface="journal" onSelect={() => {}} onToggleSidebar={() => {}} onOpenSettings={onOpenSettings} username="Rober" />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(onOpenSettings).toHaveBeenCalled();
    });
});

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

import { DeskSeatMappingEditor } from '../components/settings/DeskSeatMappingEditor';
import { getRoleOverrides, setRoleOverride } from '../services/desk/roleOverrides';

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
    if (typeof window !== 'undefined') window.localStorage.clear();
    window.localStorage.setItem('last_active_user', 'default');
});

describe('DeskSeatMappingEditor — typed-confirm reset', () => {
    it('clicking Reset opens a modal with a typed-confirm input', () => {
        setRoleOverride('Satoshi', 'risk');
        render(<DeskSeatMappingEditor />);
        fireEvent.click(screen.getByTestId('desk-mapping-reset'));
        const input = screen.getByTestId('confirm-typed-input');
        expect(input).toBeTruthy();
        expect(input.getAttribute('placeholder')).toBe('RESET');
        const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('typing RESET enables the confirm button and clears all overrides', async () => {
        setRoleOverride('Satoshi', 'risk');
        setRoleOverride('Fibonacci', 'macro');
        expect(getRoleOverrides()).toEqual({ Satoshi: 'risk', Fibonacci: 'macro' });
        render(<DeskSeatMappingEditor />);
        fireEvent.click(screen.getByTestId('desk-mapping-reset'));
        const input = screen.getByTestId('confirm-typed-input');
        const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
        fireEvent.change(input, { target: { value: 'RESET' } });
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
        await act(async () => {
            fireEvent.click(confirmBtn);
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(getRoleOverrides()).toEqual({});
        });
    });
});

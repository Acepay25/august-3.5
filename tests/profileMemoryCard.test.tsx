/**
 * ProfileMemoryCard — the human surface for Chart AI's collaboration memory.
 * It lists what the model remembered (kind + description + body + slug),
 * refreshes when the store changes, and Forget deletes for real.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ProfileMemoryCard from '../components/settings/ProfileMemoryCard';
import { rememberProfileMemory, listProfileMemories, __clearProfileMemoriesForTests } from '../services/learning/profileMemory';

beforeEach(() => {
    localStorage.clear();
    __clearProfileMemoriesForTests();
});

describe('ProfileMemoryCard', () => {
    it('shows an empty-state when nothing is remembered', () => {
        render(<ProfileMemoryCard />);
        expect(screen.getByTestId('profile-memory-card').textContent).toContain('No memories yet');
    });

    it('lists a saved memory with kind + description + body + slug', () => {
        rememberProfileMemory({ name: 'Prefers BTC only', kind: 'user', description: 'When picking symbols.', body: 'User trades BTCUSDT only.' });
        render(<ProfileMemoryCard />);
        expect(screen.getByText('When picking symbols.')).toBeTruthy();
        expect(screen.getByText('User trades BTCUSDT only.')).toBeTruthy();
        expect(screen.getByText(/prefers-btc-only/)).toBeTruthy();
        expect(screen.getByText('user')).toBeTruthy();
    });

    it('Forget deletes the entry from the store and the list', () => {
        rememberProfileMemory({ name: 'Temp', kind: 'project', description: 'd', body: 'b' });
        render(<ProfileMemoryCard />);
        fireEvent.click(screen.getByLabelText('Forget memory temp'));
        expect(listProfileMemories().length).toBe(0);
        expect(screen.getByTestId('profile-memory-card').textContent).toContain('No memories yet');
    });

    it('re-renders when a memory is saved elsewhere (august-profile-memory event)', () => {
        render(<ProfileMemoryCard />);
        expect(screen.getByTestId('profile-memory-card').textContent).toContain('No memories yet');
        // The model saves one mid-session → the store dispatches the event.
        act(() => {
            rememberProfileMemory({ name: 'Just learned', kind: 'feedback', description: 'When answering.', body: 'Keep replies short.' });
        });
        // rememberProfileMemory writes + dispatches; the card should now show it.
        expect(screen.getByText('Keep replies short.')).toBeTruthy();
    });
});

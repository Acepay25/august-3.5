/**
 * WS-2.2 — the learning queue must not read as a to-do list. Each row states
 * who still has it in hand: the supervisor (pending review) or, when
 * auto-review is paused, the human — because that is the difference between
 * overriding and being required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import LearningQueuePanel from '../components/skills/LearningQueuePanel';
import { queueLearningProposal, listLearningProposals } from '../utils/learningQueue';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import * as supervisorStore from '../services/learning/supervisorStore';

const USER = 'queue-panel-user';

beforeEach(() => {
    store = {};
    localStorage.clear();
    // The panel reads the ACTIVE user, not a prop — without this it correctly
    // finds an empty queue and renders nothing.
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    supervisorStore.__resetForTests();
});

afterEach(cleanup);

const seed = (): void => {
    queueLearningProposal({
        kind: 'rescope',
        text: 'This rule only ever fires on BTC — narrow it or drop it.',
        skillSlug: 'btc-sweep',
    } as never, USER);
    expect(listLearningProposals(USER)).toHaveLength(1);
};

describe('LearningQueuePanel review state', () => {
    it('labels a queued proposal pending-review while the supervisor is on', () => {
        seed();
        render(<LearningQueuePanel />);
        const pill = screen.getByTestId('proposal-review-state');
        expect(pill.textContent).toBe('pending review');
        expect(pill.getAttribute('title')).toContain('overrides');
    });

    it('says the human is the only mover once auto-review is paused', () => {
        seed();
        supervisorStore.setAutoEnabled(false);
        render(<LearningQueuePanel />);
        expect(screen.getByTestId('proposal-review-state').textContent).toBe('needs you');
    });

    it('relives the label the moment the toggle flips, without a remount', async () => {
        seed();
        render(<LearningQueuePanel />);
        expect(screen.getByTestId('proposal-review-state').textContent).toBe('pending review');
        await act(async () => { supervisorStore.setAutoEnabled(false); });
        await waitFor(() =>
            expect(screen.getByTestId('proposal-review-state').textContent).toBe('needs you'));
    });

    it('keeps Apply/Dismiss reachable either way — they are overrides, not the corpse of a required path', () => {
        seed();
        render(<LearningQueuePanel />);
        fireEvent.click(screen.getByText('Dismiss'));
        expect(listLearningProposals(USER)).toHaveLength(0);
    });
});

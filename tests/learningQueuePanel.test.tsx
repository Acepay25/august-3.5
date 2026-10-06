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
import { applyLearningProposalByKind } from '../services/learning/SkillMemoryService';

const mockDispatch = vi.mocked(applyLearningProposalByKind);

vi.mock('../services/learning/SkillMemoryService', () => ({
    // The panel no longer dispatches on kind itself — one dispatcher does it for
    // both approval surfaces — so this is the collaborator under test. Which
    // applier a kind reaches is pinned against the real store in
    // tests/learningQueueApply.test.ts, not re-derived here.
    applyLearningProposalByKind: vi.fn(async () => ({ applied: true })),
}));

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

describe('rescope apply (A2 slice 1)', () => {
    const clauses = {
        ifCondition: 'funding positive 8 sessions and the daily low was swept',
        thenAction: 'go long only after a 1h close back above the swept level',
        predicate: 'close > open',
    };
    const seedRescope = () => queueLearningProposal({
        kind: 'rescope', text: 'Narrow this rule.', skillSlug: 'btc-sweep',
        fingerprint: 'model-revision:btc-sweep:x', payload: { source: 'model:desk', ...clauses },
    } as never, USER);

    it('offers Apply for a rescope, and still not for a contradiction', async () => {
        seedRescope();
        queueLearningProposal({
            kind: 'contradiction', text: 'Two rules disagree.', skillSlug: 'a',
            relatedSlug: 'b', fingerprint: 'contradiction|a|b', payload: { pair: ['a', 'b'] },
        } as never, USER);
        render(<LearningQueuePanel />);
        // Exactly one Apply: rescope joined the deterministic set, contradiction
        // has no clause payload to apply and stays Dismiss-only.
        expect(await screen.findAllByRole('button', { name: /^Apply/ })).toHaveLength(1);
    });

    it('applies the clauses the proposer stored, verbatim', async () => {
        seedRescope();
        render(<LearningQueuePanel />);
        fireEvent.click(await screen.findByRole('button', { name: /^Apply/ }));
        // The panel's contract: hand the STORED proposal to the dispatcher
        // untouched, with the active user. Clause fidelity is tested at the
        // dispatcher against the real notebook.
        await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ skillSlug: 'btc-sweep', payload: expect.objectContaining(clauses) }),
            USER,
        ));
    });

    it('a rescope with no clauses in its payload offers Dismiss only', () => {
        // The regime/recurrence pass queues exactly this shape
        // (`SkillMemoryService.ts:1622`, no payload). Hiding Apply here is the
        // difference between an override offered and a button that can only refuse.
        seed();
        render(<LearningQueuePanel />);
        expect(screen.queryAllByRole('button', { name: /^Apply/ })).toHaveLength(0);
        expect(screen.getByText('Dismiss')).toBeTruthy();
    });

    it('a refused rescope names the reason it was refused', async () => {
        seedRescope();
        mockDispatch.mockResolvedValueOnce({ applied: false, reason: 'below-bar' });
        render(<LearningQueuePanel />);
        fireEvent.click(await screen.findByRole('button', { name: /^Apply/ }));
        // The row is the human's only copy of the proposal, so it stays — and the
        // copy must be the reason the library gave, not a guess about one.
        await waitFor(() => expect(screen.getByText(/below the bar/i)).toBeTruthy());
        expect(screen.getByText(/re-scope/)).toBeTruthy();
        expect(screen.queryByText(/no longer exists/i)).toBeNull();
    });
});

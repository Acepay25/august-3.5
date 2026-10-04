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
import { applyRescopeProposal } from '../services/learning/SkillMemoryService';

const mockApplyRescope = vi.mocked(applyRescopeProposal);

vi.mock('../services/learning/SkillMemoryService', () => ({
    // The panel imports the whole applier set; only rescope is under test here,
    // and the others are stubbed so the module resolves.
    applyDisplacementProposal: vi.fn(async () => true),
    applyRevivalProposal: vi.fn(async () => true),
    applyDemoteProposal: vi.fn(async () => true),
    applyRescopeProposal: vi.fn(async () => true),
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
        await waitFor(() => expect(mockApplyRescope)
            .toHaveBeenCalledWith('btc-sweep', clauses, USER));
    });
});

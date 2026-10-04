/**
 * A2 slice 4 — the override button reports what the library did.
 *
 * `overrideApproveSkill` already returns the ingest's named outcome (commit
 * 03a3bfe made it stop claiming "approved" when nothing wrote). This suite pins
 * the CALLER: an override that wrote nothing must say why, on the row the human
 * just pressed, and must not relabel the verdict as theirs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
// The supervisor resolves a model for "Run now"; this suite never presses it.
vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    getQuickResponse: vi.fn(),
}));

import SupervisorStream from '../components/learn/SupervisorStream';
import * as supervisorStore from '../services/learning/supervisorStore';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { queueSkillDraft } from '../utils/skillDrafts';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import type { CraftedSkill } from '../schemas/learning';

const USER = 'override-user';

const craft = (): CraftedSkill => ({
    name: 'Funding exhaustion long',
    kind: 'repeat',
    when: 'funding has run positive for many sessions and price stalls at swept lows',
    inputs: [],
    steps: ['Confirm the funding streak', 'Wait for a 1h close back above the swept low'],
    validate: 'Confirm the sweep on the live chart before acting',
    output: 'A defined long entry with a stop under the liquidity low',
    approval: 'A human approves before it is ever applied',
    ifCondition: 'funding positive 8 sessions and the daily low was swept',
    thenAction: 'go long only after a 1h close back above the swept level',
} as CraftedSkill);

/** A REJECTED verdict with its draft snapshot — exactly the row the "Approve
 *  anyway" override exists for. */
const seedRejectedRow = (): string => {
    const draft = queueSkillDraft({ tradeId: 'msg-1', coin: 'BTC', crafted: craft() }, USER)!;
    const id = supervisorStore.pushEvent({
        phase: 'deciding', text: 'Reviewing a skill draft', itemKind: 'skill',
        itemTitle: draft.crafted.name, itemId: draft.id, draftSnapshot: draft,
    });
    supervisorStore.setDecision(id, { verdict: 'rejected', reason: 'too generic', atMs: Date.now() });
    return id;
};

beforeEach(async () => {
    store = {};
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    supervisorStore.__resetForTests();
    await initMemoryFiles(USER);
});

afterEach(cleanup);

describe('SupervisorStream override feedback', () => {
    it('an override that could not write names why on the row', async () => {
        // A notebook with no harness folders at all: the ingest reaches its
        // `if (!folder)` decline, so nothing can be approved no matter what
        // this row then says.
        const mf = getMemoryFiles();
        mf.folders = [{ id: 'custom', name: 'my-notes', order: 0, parentId: null }] as never;
        mf.files = [];
        const id = seedRejectedRow();

        render(<SupervisorStream />);
        fireEvent.click(screen.getByRole('button', { name: /Approve anyway/ }));

        await waitFor(() => expect(screen.getByTestId(`supervisor-override-note-${id}`)).toBeTruthy());
        expect(screen.getByTestId(`supervisor-override-note-${id}`).textContent).toMatch(/skills folder/i);
        // The verdict stays the model's: nothing was approved, so the row must not
        // read "approved (you)".
        expect(screen.getByTestId(`supervisor-event-${id}`).textContent).toMatch(/rejected/);
    });

    it('an override that really did write claims the approval and shows no failure', async () => {
        const id = seedRejectedRow();
        render(<SupervisorStream />);
        fireEvent.click(screen.getByRole('button', { name: /Approve anyway/ }));

        await waitFor(() => expect(screen.getByTestId(`supervisor-event-${id}`).textContent).toMatch(/approved \(you\)/));
        expect(screen.queryByTestId(`supervisor-override-note-${id}`)).toBeNull();
    });
});

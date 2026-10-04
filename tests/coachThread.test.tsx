import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// The Coach thread: the learning loop's inbox as a conversation
// surface. The panel lists pending skill drafts + queue proposals as cards
// with real actions. (The rail's Coach shortcut and its waiting-count badge
// are covered in tests/agentsSurface.test.tsx.)

const mockIngest = vi.hoisted(() => vi.fn());
const mockIngestDraft = vi.hoisted(() => vi.fn());
const mockApplyRevival = vi.hoisted(() => vi.fn(async (): Promise<ProposalApplyResult> => ({ applied: true })));
const mockApplyRescope = vi.hoisted(() => vi.fn(async () => ({ applied: true })));

vi.mock('../services/learning/SkillMemoryService', () => ({
    ingestCraftedSkill: mockIngest,
    ingestCraftedSkillFromDraft: mockIngestDraft,
    applyDisplacementProposal: vi.fn(async () => ({ applied: true })),
    applyRevivalProposal: mockApplyRevival,
    applyDemoteProposal: vi.fn(async () => ({ applied: true })),
    applyRescopeProposal: mockApplyRescope,
}));

import CoachThreadPanel from '../components/chat/CoachThreadPanel';
import { queueSkillDraft } from '../utils/skillDrafts';
import { queueLearningProposal } from '../utils/learningQueue';
import type { CraftedSkill } from '../schemas/learning';
import type { ProposalApplyResult } from '../utils/learningQueue';

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

const crafted = (over: Partial<CraftedSkill> = {}): CraftedSkill => ({
    name: 'Fade the reclaim',
    kind: 'avoid',
    when: 'BTC short after a fake breakout',
    inputs: [],
    steps: ['wait'],
    validate: 'reclaim fails',
    output: 'skip',
    approval: 'user',
    ifCondition: 'fake breakout then reclaim on BTC',
    thenAction: 'skip the short',
    ...over,
} as CraftedSkill);

describe('CoachThreadPanel', () => {
    let draft: { id: string };
    beforeEach(() => {
        localStorage.clear();
        // queueSkillDraft now returns null when the store did not take the row
        // (it reads back before claiming success), so a null here is the inbox
        // being broken — fail loudly rather than type-coerce past it.
        const queued = queueSkillDraft({ tradeId: 'msg-1', coin: 'BTCUSDT', crafted: crafted() });
        if (!queued) throw new Error('queueSkillDraft stored nothing — the draft never reached the inbox');
        draft = queued;
    });

    it('lists pending drafts and proposals as cards', () => {
        queueLearningProposal({ kind: 'revival', text: 'Revive twin?', fingerprint: 'rev|twin', skillSlug: 'twin' });
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        expect(screen.getByTestId(`coach-draft-${draft.id}`).textContent).toContain('Fade the reclaim');
        expect(screen.getByTestId(`coach-draft-${draft.id}`).textContent).toContain('fake breakout');
        expect(document.querySelector('[data-testid^="coach-proposal-"]')).toBeTruthy();
    });

    it('empty state explains the loop', () => {
        localStorage.clear();
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        expect(screen.getByText(/Nothing needs your decision/)).toBeTruthy();
    });

    it('Save routes through the allow handler and clears the card', () => {
        const onAllow = vi.fn((d: { id: string }) => {
            // Mimic App: takeSkillDraft removes it from the store.
            import('../utils/skillDrafts').then(m => m.takeSkillDraft(d.id));
        });
        render(<CoachThreadPanel onAllowDraft={onAllow} onDenyDraft={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`coach-draft-allow-${draft.id}`));
        expect(onAllow).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id }));
    });

    it('Discard routes through the deny handler', () => {
        const onDeny = vi.fn();
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={onDeny} />);
        fireEvent.click(screen.getByTestId(`coach-draft-deny-${draft.id}`));
        expect(onDeny).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id }));
    });

    it('proposal Apply calls the actuation path and dismisses on success', async () => {
        const { applyRevivalProposal } = await import('../services/learning/SkillMemoryService');
        const p = queueLearningProposal({ kind: 'revival', text: 'Revive?', fingerprint: 'rev|x', skillSlug: 'x', payload: { slug: 'x' } })!;
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`coach-proposal-apply-${p.id}`));
        await vi.waitFor(() => {
            expect(applyRevivalProposal).toHaveBeenCalledWith('x', expect.any(String));
            expect(screen.queryByTestId(`coach-proposal-${p.id}`)).toBeNull();
        });
    });

    it('rescope is applyable and contradiction is not — one Apply between them', () => {
        const rs = queueLearningProposal({ kind: 'rescope', text: 'Re-scope?', fingerprint: 'rs|x', skillSlug: 'x' })!;
        const co = queueLearningProposal({ kind: 'contradiction', text: 'Conflict?', fingerprint: 'co|a|b', skillSlug: 'a', payload: { pair: ['a', 'b'] } })!;
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        // rescope joined the applyable set (A2); contradiction stayed out because its
        // payload is a slug pair with no clause text to apply.
        expect(screen.getByTestId(`coach-proposal-apply-${rs.id}`)).toBeTruthy();
        expect(screen.getAllByTestId(/^coach-proposal-apply-/)).toHaveLength(1);
        fireEvent.click(screen.getByTestId(`coach-proposal-dismiss-${co.id}`));
        expect(screen.queryByTestId(`coach-proposal-${co.id}`)).toBeNull();
    });

    it('Apply on a rescope passes the clauses the PROPOSER stored, verbatim', async () => {
        const clauses = {
            ifCondition: 'funding positive 8 sessions and the daily low was swept',
            thenAction: 'go long only after a 1h close back above the swept level',
            predicate: 'close > open',
        };
        const p = queueLearningProposal({
            kind: 'rescope', text: 'Re-scope?', fingerprint: 'rs:y', skillSlug: 'y',
            payload: { source: 'model:desk', ...clauses },
        })!;
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`coach-proposal-apply-${p.id}`));
        await vi.waitFor(() => {
            expect(mockApplyRescope).toHaveBeenCalledWith('y', clauses, expect.any(String));
            expect(screen.queryByTestId(`coach-proposal-${p.id}`)).toBeNull();
        });
    });

    it('an apply that wrote nothing keeps the card and names WHY', async () => {
        mockApplyRevival.mockResolvedValueOnce({ applied: false, reason: 'no-target' });
        const p = queueLearningProposal({ kind: 'revival', text: 'Revive?', fingerprint: 'rev|gone', skillSlug: 'gone', payload: { slug: 'gone' } })!;
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`coach-proposal-apply-${p.id}`));
        // The row must survive a failed apply — it is the human's only copy of the
        // proposal — and say what failed, not just that something did.
        await vi.waitFor(() => expect(screen.getByTestId(`coach-proposal-error-${p.id}`)).toBeTruthy());
        const card = screen.getByTestId(`coach-proposal-${p.id}`);
        expect(card.textContent).toMatch(/no live skill/i);
        expect(card.querySelector(`[data-testid="coach-proposal-apply-${p.id}"]`)).toBeTruthy();
    });
});

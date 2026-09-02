import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// §10.1 — the Coach thread: the learning loop's inbox as a conversation
// surface. The roster row carries the waiting-count badge; the panel lists
// pending skill drafts + queue proposals as cards with real actions.

const mockIngest = vi.hoisted(() => vi.fn());
const mockIngestDraft = vi.hoisted(() => vi.fn());

vi.mock('../services/learning/SkillMemoryService', () => ({
    ingestCraftedSkill: mockIngest,
    ingestCraftedSkillFromDraft: mockIngestDraft,
    applyDisplacementProposal: vi.fn(async () => true),
    applyRevivalProposal: vi.fn(async () => true),
    applyDemoteProposal: vi.fn(async () => true),
}));

import { AgentRosterRail } from '../components/chat/AgentRosterRail';
import CoachThreadPanel from '../components/chat/CoachThreadPanel';
import { queueSkillDraft } from '../utils/skillDrafts';
import { queueLearningProposal } from '../utils/learningQueue';
import type { CraftedSkill } from '../schemas/learning';

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

const railBase = {
    messages: [],
    bots: [],
    groups: [],
    selection: { kind: 'team' } as const,
    onSelectTeam: () => {},
    onSelectBot: () => {},
    onSelectGroup: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
};

describe('Coach roster row (§10.1)', () => {
    it('renders only when the coach callback exists; badge counts drafts + proposals', () => {
        const { rerender } = render(<AgentRosterRail {...railBase} />);
        expect(screen.queryByTestId('roster-coach')).toBeNull();

        queueSkillDraft({ tradeId: 't1', coin: 'BTCUSDT', crafted: crafted() });
        queueLearningProposal({ kind: 'demote', text: 't', fingerprint: 'f1' });

        rerender(<AgentRosterRail {...railBase} onSelectCoach={() => {}} coachCount={2} />);
        const row = screen.getByTestId('roster-coach');
        expect(row.textContent).toContain('Coach');
        expect(row.textContent).toContain('2 items need your call');
        expect(row.querySelector('[data-testid="roster-unread-badge"]')?.textContent).toBe('2');
    });

    it('clicking selects the coach thread', () => {
        const onSelectCoach = vi.fn();
        render(<AgentRosterRail {...railBase} onSelectCoach={onSelectCoach} coachCount={0} />);
        fireEvent.click(screen.getByTestId('roster-coach'));
        expect(onSelectCoach).toHaveBeenCalledTimes(1);
        // Zero count reads "in sync", no badge.
        expect(screen.getByTestId('roster-coach').textContent).toContain('in sync');
    });
});

describe('CoachThreadPanel (§10.1)', () => {
    let draft: { id: string };
    beforeEach(() => {
        localStorage.clear();
        draft = queueSkillDraft({ tradeId: 'msg-1', coin: 'BTCUSDT', crafted: crafted() });
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

    it('non-applyable kinds (rescope/contradiction) get Dismiss only', () => {
        const p = queueLearningProposal({ kind: 'rescope', text: 'Re-scope?', fingerprint: 'rs|x', skillSlug: 'x' })!;
        render(<CoachThreadPanel onAllowDraft={vi.fn()} onDenyDraft={vi.fn()} />);
        const card = screen.getByTestId(`coach-proposal-${p.id}`);
        expect(card.querySelector(`[data-testid="coach-proposal-apply-${p.id}"]`)).toBeNull();
        fireEvent.click(card.querySelector(`[data-testid="coach-proposal-dismiss-${p.id}"]`)!);
        expect(screen.queryByTestId(`coach-proposal-${p.id}`)).toBeNull();
    });
});

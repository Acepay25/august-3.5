/**
 * The skills-review UI — the UI half of the "review all my skills" item.
 *
 * The service (`services/learning/skillReview.ts`) is `clean-code`'s; this file
 * covers the half this side owns: the "Review all my skills" button in
 * `components/learn/SkillsCatalog.tsx` and the per-skill verdict display in
 * `components/learn/SkillViewerPanel.tsx`.
 *
 * The load-bearing properties, in order of how badly they'd hurt if wrong:
 *
 *  1. **THE BUTTON WRITES NOTHING.** The review is a read. A repair is a
 *     PROPOSAL that goes into the existing human approval queue; the notebook
 *     is untouched until the trader approves it there. A "review" button that
 *     rewrote skills would be the worst possible surprise.
 *  2. **THE VERDICT IS SHOWN, NOT JUST COUNTED.** A count ("1 ghost") tells
 *     the trader there is a problem; the evidence ("line 3: the closing
 *     frontmatter fence has trailing content") tells them what to do.
 *  3. **A WIDENING REPAIR IS LABELLED.** Rebuilding a ghost's frontmatter
 *     gives it a reach it did not have — it can suddenly be matched and
 *     injected — so the UI says so.
 *  4. **THE VIEWER SHOWS THE SAME VERDICT THE REPORT SHOWS**, or the two
 *     surfaces can disagree about the same file.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SkillsCatalog from '../components/learn/SkillsCatalog';
import SkillViewerPanel, { type SkillViewerRecord } from '../components/learn/SkillViewerPanel';
import type { SkillReviewFinding, SkillReviewReport } from '../services/learning/skillReview';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

// ── the roster ──────────────────────────────────────────────────────────────
const listSkillsMock = vi.fn();
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: () => listSkillsMock(),
    skillEnabledFlag: (meta: { status?: string; suspendedAt?: string; disabledByUser?: boolean }) =>
        meta.status === 'confirmed' && !meta.suspendedAt && !meta.disabledByUser,
    // The viewer reads these two; they are pure derivations, so a straight
    // implementation is the real behaviour.
    skillExpectancyR: (meta: { netR?: number; rSampled?: number }) =>
        (meta.rSampled ?? 0) >= 5 && typeof meta.netR === 'number' ? meta.netR / (meta.rSampled ?? 1) : undefined,
    // The availability mark reads the seat's approval gate, so the stand-in
    // carries its rule: a pure derivation, like the two above. (The real one
    // also asks Settings whether the starter shelf is withdrawn; `prior: 'book'`
    // rows in this file are not what those tests are about.)
    isApprovedSkill: (meta: { approvedBy?: string; prior?: string }) =>
        meta.approvedBy === 'human' || meta.approvedBy === 'grandfathered' || meta.prior === 'book',
    EXPECTANCY_MIN_R_SAMPLE: 5,
}));

// ── the review service ──────────────────────────────────────────────────────
const reviewAllSkillsMock = vi.fn();
vi.mock('../services/learning/skillReview', () => ({
    reviewAllSkills: (options?: unknown) => reviewAllSkillsMock(options),
}));

// ── the approval queue ──────────────────────────────────────────────────────
const queueLearningProposalMock = vi.fn();
vi.mock('../utils/learningQueue', () => ({
    queueLearningProposal: (proposal: unknown) => queueLearningProposalMock(proposal),
}));

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'repeat',
    description: 'Fade a failed breakout when volume diverges',
    wins: 0,
    losses: 0,
    // The availability mark reads the seat's approval gate; these tests are
    // about the review verdict, so the row is an ordinary approved skill.
    approvedBy: 'human',
    ...over,
} as SkillMeta);

const finding = (over: Partial<SkillReviewFinding> = {}): SkillReviewFinding => ({
    fileId: 'f1',
    name: 'ghost-skill.md',
    slug: 'ghost-skill',
    chars: 120,
    bytes: 120,
    verdict: 'ghost',
    evidence: 'Line 3: the closing frontmatter fence has trailing content — it must be exactly `---` on its own line. This file is in the skills folder but appears in no list.',
    reasons: ['the frontmatter contract fails on line 3'],
    checks: {} as SkillReviewFinding['checks'],
    ...over,
} as SkillReviewFinding);

const report = (findings: SkillReviewFinding[]): SkillReviewReport => ({
    findings,
    counts: {
        fine: findings.filter(f => f.verdict === 'fine').length,
        dormant: findings.filter(f => f.verdict === 'dormant').length,
        clipped: findings.filter(f => f.verdict === 'clipped').length,
        ghost: findings.filter(f => f.verdict === 'ghost').length,
    },
    generatedAt: 1,
    ghostCount: findings.filter(f => f.verdict === 'ghost').length,
});

beforeEach(() => {
    vi.clearAllMocks();
    listSkillsMock.mockReturnValue([
        { file: { id: 'f1', name: 'fade-the-fakeout.md', content: '' }, meta: meta() },
    ]);
    reviewAllSkillsMock.mockReturnValue(report([finding()]));
    queueLearningProposalMock.mockReturnValue({ id: 'lp-1' });
});

afterEach(cleanup);

describe('the skills review — the button', () => {
    it('exists, and it is named', () => {
        render(<SkillsCatalog />);
        expect(screen.getByLabelText('Review all my skills')).toBeTruthy();
    });

    it('says nothing before it is pressed', () => {
        render(<SkillsCatalog />);
        expect(screen.queryByTestId('skills-review')).toBeNull();
        expect(reviewAllSkillsMock).not.toHaveBeenCalled();
    });

    it('runs the review and reports the counts', () => {
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        expect(reviewAllSkillsMock).toHaveBeenCalledTimes(1);
        const note = screen.getByTestId('skills-review-note').textContent ?? '';
        expect(note).toContain('1 ghost');
        expect(note).toContain('Reviewed 1 skill file');
    });

    it('WRITES NOTHING — the review queues nothing and touches no skill', () => {
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        // The review is a read. A repair is a proposal, and a proposal is
        // something the trader must ask for.
        expect(queueLearningProposalMock).not.toHaveBeenCalled();
    });

    it('says so when the store read fails', () => {
        reviewAllSkillsMock.mockImplementation(() => { throw new Error('store unavailable'); });
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        expect(screen.getByTestId('skills-review-note').textContent).toBe('Could not read the skill files');
    });
});

describe('the skills review — the report', () => {
    it('names the problem, the verdict and the evidence', () => {
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        const row = screen.getByTestId('skills-review-row');
        expect(row.textContent).toContain('Ghost');
        expect(row.textContent).toContain('ghost-skill.md');
        expect(row.textContent).toContain('the closing frontmatter fence has trailing content');
    });

    it('does not list a skill that is fine', () => {
        reviewAllSkillsMock.mockReturnValue(report([
            finding(),
            finding({ fileId: 'f2', name: 'ok-skill.md', slug: 'ok-skill', verdict: 'fine' }),
        ]));
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        expect(screen.getAllByTestId('skills-review-row')).toHaveLength(1);
    });

    it('shows the proposed change where a repair exists', () => {
        reviewAllSkillsMock.mockReturnValue(report([finding({
            repair: {
                kind: 'reconstruct',
                before: 'the broken file',
                after: 'the rebuilt file',
                widens: true,
                summary: 'Rebuild the frontmatter around this file\'s own text.',
                reason: 'the frontmatter contract fails on line 3',
                queueKind: 'rewrite',
            },
        })]));
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        const row = screen.getByTestId('skills-review-row');
        expect(row.textContent).toContain('the broken file');
        expect(row.textContent).toContain('the rebuilt file');
    });

    it('says a widening repair WIDENS the skill\'s reach', () => {
        reviewAllSkillsMock.mockReturnValue(report([finding({
            repair: {
                kind: 'reconstruct',
                before: 'a', after: 'b', widens: true,
                summary: 'Rebuild it.', reason: 'why', queueKind: 'rewrite',
            },
        })]));
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        expect(screen.getByTestId('skills-review-row').textContent).toContain('widens the skill');
    });

    it('a proposed repair goes to the approval queue, NOT to the notebook', () => {
        reviewAllSkillsMock.mockReturnValue(report([finding({
            repair: {
                kind: 'reconstruct',
                before: 'a', after: 'b', widens: true,
                summary: 'Rebuild it.', reason: 'why', queueKind: 'rewrite',
            },
        })]));
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        fireEvent.click(screen.getByLabelText('Propose the repair for ghost-skill.md'));
        expect(queueLearningProposalMock).toHaveBeenCalledTimes(1);
        const proposal = queueLearningProposalMock.mock.calls[0][0] as Record<string, unknown>;
        expect(proposal.kind).toBe('rewrite');
        expect(proposal.skillSlug).toBe('ghost-skill');
        // And it says, in the queue row, that nothing has been written.
        expect(String(proposal.text)).toContain('Nothing has been written');
    });

    it('the roster row carries its own verdict', () => {
        reviewAllSkillsMock.mockReturnValue(report([
            finding({ fileId: 'f1', name: 'fade-the-fakeout.md', slug: 'fade-the-fakeout', verdict: 'dormant' }),
        ]));
        render(<SkillsCatalog />);
        fireEvent.click(screen.getByLabelText('Review all my skills'));
        const badge = screen.getAllByTestId('skills-row-verdict')[0];
        expect(badge.textContent).toBe('Dormant');
    });
});

describe('the skills review — the viewer', () => {
    const record = (): SkillViewerRecord => ({
        file: { id: 'f1', name: 'ghost-skill.md', content: 'x' } as SkillViewerRecord['file'],
        meta: meta(),
    });

    it('shows nothing extra when no review has been run', () => {
        render(<SkillViewerPanel skill={record()} />);
        expect(screen.queryByTestId('skill-viewer-review')).toBeNull();
    });

    it('shows the verdict, the evidence and the reasons', () => {
        render(<SkillViewerPanel skill={record()} review={finding()} />);
        const block = screen.getByTestId('skill-viewer-review');
        expect(block.textContent).toContain('Ghost');
        expect(block.textContent).toContain('the closing frontmatter fence has trailing content');
        expect(block.textContent).toContain('the frontmatter contract fails on line 3');
    });

    it('shows the diff where a repair exists, and says it widens the reach', () => {
        render(<SkillViewerPanel skill={record()} review={finding({
            repair: {
                kind: 'reconstruct',
                before: 'the broken file', after: 'the rebuilt file', widens: true,
                summary: 'Rebuild it.', reason: 'why', queueKind: 'rewrite',
            },
        })} />);
        const block = screen.getByTestId('skill-viewer-review');
        expect(block.textContent).toContain('the broken file');
        expect(block.textContent).toContain('the rebuilt file');
        expect(block.textContent).toContain('widens the skill');
        expect(block.textContent).toContain('nothing has been written');
    });
});

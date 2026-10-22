/**
 * The skills surfaces, brought in line with the reference's Customize → Skills
 * page — on August's own data.
 *
 * The reference draws a catalogue: a title with a one-line muted subtitle, a
 * header row carrying search / refresh / settings / Add, an "Installed"
 * heading over a TWO-COLUMN grid of cards (a coloured icon tile, the name, a
 * one-line muted description truncated with an ellipsis, and a checkmark at the
 * right edge), and then a category row — the category's name in muted text
 * with a raised "System" pill beside it.
 *
 * The claims pinned here, in order of how badly they would hurt if wrong:
 *
 *  1. THE CHECKMARK MEANS "AVAILABLE", AND ONLY THAT. The reference draws one
 *     check; August has three honest answers to "does this rule reach a
 *     seat?", so it has three marks, and the two that are not "yes" say WHICH
 *     no they are. A check on a suspended rule is a lie the trader cannot see
 *     through — and the whole vocabulary hangs off ONE derivation.
 *  2. THE SUSPENSION IS DERIVED, NOT RE-DERIVED. `skillEnabledFlag` is the
 *     only place `enabled` may be derived; a second implementation here is
 *     how an unrelated attribution write silently un-suspends a skill.
 *  3. THE SHIPPED SHELF IS BROKEN OUT, NOT REPEATED. The reference lists a
 *     skill twice — once installed, once under the plugin that provides it.
 *     August has no plugins, so the shipped starter library (`prior: 'book'`)
 *     gets the reference's "System" badge and its OWN category row, and the
 *     same card is never printed twice.
 *  4. THE READER SPEAKS THE SAME WORDS AS THE CATALOGUE. Two surfaces
 *     spelling one state two ways is how a suspended skill ends up reading as
 *     "active" on one of them.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SkillsCatalog, { skillAvailability } from '../components/learn/SkillsCatalog';
import SkillViewerPanel, { type SkillViewerRecord } from '../components/learn/SkillViewerPanel';
import type { SkillMeta } from '../services/learning/SkillMemoryService';
import { humanizeSkillName } from '../utils/skillNames';

/**
 * `listSkills` is faked at MODULE level with a mutable roster, for the reason
 * `tests/skillsCatalog.test.tsx` documents: the real service pulls in the
 * notebook store, Capacitor and the Electron bridge, and times out in jsdom.
 * `skillEnabledFlag` stays the REAL one, because the derivation under test is
 * the real one.
 */
const listSkillsMock = vi.fn();
vi.mock('../services/learning/SkillMemoryService', async () => {
    const actual = await vi.importActual<typeof import('../services/learning/SkillMemoryService')>(
        '../services/learning/SkillMemoryService',
    );
    return { ...actual, listSkills: () => listSkillsMock() };
});

/** The viewer reaches `SkillDetail`, which reaches the notebook store. */
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'repeat',
    description: 'Fade a failed breakout when volume diverges',
    wins: 0,
    losses: 0,
    // The approval fact the SEAT's gate reads. A skill that reaches a seat is an
    // approved one, so the default row says so; the tests below pass
    // `approvedBy: undefined` to check the state that is not.
    approvedBy: 'human',
    ...over,
} as SkillMeta);

const roster = (rows: Array<{ name: string } & Partial<SkillMeta>>): void => {
    listSkillsMock.mockReturnValue(rows.map(r => ({
        file: { id: r.name, name: r.name, content: '' },
        meta: meta(r),
    })));
};

const LIVE = { name: 'fade-the-fakeout.md', description: 'Fade a failed breakout when volume diverges', family: 'mean-reversion' };
const SUSPENDED = { name: 'resting.md', description: 'Wait for the reclaim', family: 'trend', suspendedAt: new Date().toISOString() };
const SHIPPED = { name: 'book-trend-pullback.md', description: 'Join the trend at value', family: 'Family C', prior: 'book' as const };

beforeEach(() => {
    store = {};
    roster([LIVE]);
});

afterEach(() => {
    cleanup();
    listSkillsMock.mockReset();
});

describe('the catalogue — the reference\'s page', () => {
    it('draws the title and the one-line muted subtitle under it', () => {
        render(<SkillsCatalog />);
        expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy();
        // One muted line, the reference's shape.
        const status = screen.getByTestId('skills-status');
        expect(status.textContent).toMatch(/learned to do/);
        expect(status.className).toContain('text-zinc-500');
    });

    it('carries the reference\'s header row: search, refresh, settings, Add', () => {
        render(<SkillsCatalog onAddSkill={() => {}} onOpenSettings={() => {}} />);
        expect(screen.getByLabelText('Search skills')).toBeTruthy();
        expect(screen.getByLabelText('Refresh the skill list')).toBeTruthy();
        expect(screen.getByLabelText('Skill settings')).toBeTruthy();
        expect(screen.getByText('Add')).toBeTruthy();
    });

    it('lays the roster out as a grid of cards, each one openable', () => {
        render(<SkillsCatalog />);
        expect(screen.getByTestId('skills-catalog-grid')).toBeTruthy();
        const card = screen.getByTestId('skills-catalog-card');
        // The card's NAME is the human label the reference uses; the slug stays
        // the identity - the tooltip, the aria-label and every write path.
        expect(card.textContent).toContain('Fade the fakeout');
        expect(card.textContent).not.toContain('fade-the-fakeout.md');
        // The card is the opener — a row that cannot be pressed is a list of
        // file names. Its accessible name matches the visible, humanized label
        // (WCAG label-in-name), while the slug stays in the tooltip.
        expect(screen.getByRole('button', { name: 'Read Fade the fakeout' })).toBeTruthy();
    });

    it('gives the card a one-line description a title, so the clipped tail is reachable', () => {
        render(<SkillsCatalog />);
        expect(screen.getByText('Fade a failed breakout when volume diverges').getAttribute('title'))
            .toBe('Fade a failed breakout when volume diverges');
    });

    it('draws the "Installed" heading over the grid, on a hairline', () => {
        render(<SkillsCatalog />);
        const heading = screen.getByRole('heading', { name: 'Installed' });
        expect(heading.className).toContain('border-b');
        expect(heading.className).toContain('border-zinc-800/80');
    });
});

describe('the catalogue — the availability marks', () => {
    it('marks a skill that reaches a seat with the check', () => {
        render(<SkillsCatalog />);
        expect(screen.getByLabelText('Enabled')).toBeTruthy();
    });

    it('does NOT check a suspended skill — it gets its own mark and says why', () => {
        // THE DEFECT THIS SURFACE EXISTS TO AVOID: a check on a rule that
        // reaches no seat is a lie the trader cannot see through.
        roster([SUSPENDED]);
        render(<SkillsCatalog />);
        expect(screen.queryByLabelText('Enabled')).toBeNull();
        // And it says WHY, not just "not enabled" — the reason is the one
        // thing a trader needs.
        expect(screen.getByTitle(/Not injected/)).toBeTruthy();
        expect(screen.getByLabelText('Suspended')).toBeTruthy();
    });

    it('tells a switched-off skill apart from a suspended one', () => {
        roster([{ name: 'off.md', description: 'x', family: 'trend', disabledByUser: true }]);
        render(<SkillsCatalog />);
        expect(screen.queryByLabelText('Enabled')).toBeNull();
        expect(screen.queryByLabelText('Suspended')).toBeNull();
        expect(screen.getByLabelText('Off')).toBeTruthy();
        expect(screen.getByTitle(/you switched this off/)).toBeTruthy();
    });

    it('takes a retired rule out of play without claiming it is live', () => {
        roster([{ name: 'old.md', description: 'x', family: 'trend', status: 'retired' as const }]);
        render(<SkillsCatalog />);
        expect(screen.queryByLabelText('Enabled')).toBeNull();
        expect(screen.getByLabelText('Off')).toBeTruthy();
        expect(screen.getByTitle(/retired/)).toBeTruthy();
    });

    it('derives the state ONCE — the catalogue and the reader cannot disagree', () => {
        // `skillEnabledFlag` is the one place `enabled` may be derived. The
        // reader imports the same function, so a rule cannot read "suspended"
        // on the card and "active" in the record.
        const suspended = skillAvailability(meta({ suspendedAt: new Date().toISOString() }), false, true);
        expect(suspended.state).toBe('suspended');
        expect(suspended.label).toBe('Suspended');
        expect(skillAvailability(meta(), true, true).state).toBe('enabled');
        expect(skillAvailability(meta({ status: 'retired' }), false, true).state).toBe('off');
        // THE SEAT'S OWN GATE, ON THE CARD. A rule nothing has approved is not
        // injected and not indexed (P10), so the catalogue may not mark it with
        // the check — that is a lie about a skill the trader cannot see through.
        const unapproved = skillAvailability(meta(), true, false);
        expect(unapproved.state).toBe('off');
        expect(unapproved.title).toMatch(/nothing has approved/i);
    });

    it('follows the starter shelf’s own switch — the fact is read, not re-derived', () => {
        // A `prior: 'book'` skill is approved by the Settings switch, not by a
        // human click. A component that hand-tested `approvedBy === 'human'`
        // would call the whole shelf "not injected" while the injection uses it.
        roster([{ name: 'book-shelf.md', description: 'Join the trend at value', family: 'Family C', prior: 'book' as const }]);
        render(<SkillsCatalog />);
        expect(screen.getByLabelText('Enabled'), 'the shelf is approved by its switch, so the card must say so').toBeTruthy();
    });

    it('does not mark a skill nothing has approved with the check', () => {
        // The card-level half of the same rule: the row builder reads
        // `isApprovedSkill`, so a candidate with no `approvedBy` and no `prior`
        // cannot render as injected.
        roster([{ name: 'gated.md', description: 'Sweep the low then fade', family: 'Family A', prior: 'gated' as const, approvedBy: undefined }]);
        render(<SkillsCatalog />);
        expect(screen.queryByLabelText('Enabled')).toBeNull();
        expect(screen.getByTitle(/nothing has approved/i)).toBeTruthy();
    });
});

describe('the catalogue — the two sections', () => {
    it('breaks the shipped starter shelf out under its own category row', () => {
        roster([LIVE, SHIPPED]);
        render(<SkillsCatalog />);
        // The reference's category row: the name in muted text, and the
        // raised pill that says WHAT the category is.
        expect(screen.getByRole('heading', { name: 'Starter library' })).toBeTruthy();
        expect(screen.getByText('System')).toBeTruthy();
    });

    it('never prints the same skill twice', () => {
        roster([LIVE, SHIPPED]);
        render(<SkillsCatalog />);
        expect(screen.getAllByText('Fade the fakeout')).toHaveLength(1);
        expect(screen.getAllByText('Book trend pullback')).toHaveLength(1);
    });

    it('omits a section that holds nothing — an empty group teaches the reader the filter is broken', () => {
        roster([LIVE]);
        render(<SkillsCatalog />);
        expect(screen.queryByText('System')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Starter library' })).toBeNull();
    });
});

describe('the reader — the same words as the catalogue', () => {
    const record = (over: Partial<SkillMeta> = {}): SkillViewerRecord => ({
        file: { id: 'f1', name: 'fade-the-fakeout.md', content: 'name: x\n' } as SkillViewerRecord['file'],
        meta: meta(over),
    });

    it('says Enabled for a skill that reaches a seat', () => {
        render(<SkillViewerPanel skill={record()} />);
        expect(screen.getByText('Enabled')).toBeTruthy();
    });

    it('says Suspended — and why — where the catalogue shows the pause mark', () => {
        render(<SkillViewerPanel skill={record({ suspendedAt: new Date().toISOString() })} />);
        expect(screen.getByText('Suspended')).toBeTruthy();
        expect(screen.getByTitle(/Not injected/)).toBeTruthy();
        expect(screen.queryByText('injected')).toBeNull();
    });
});

/**
 * The name a skill is SHOWN by.
 *
 * The slug identifies a skill — the Approvals inbox, the notebook and every
 * write path use it — and the catalogue's card shows the human label, the way
 * the reference names "Fc Nginx Website" rather than the file behind it. One
 * helper, so a skill cannot be called one thing on a card and another in a
 * list.
 */
describe('humanizeSkillName (the name a person can recognize)', () => {
    it('turns a slug into a readable label', () => {
        expect(humanizeSkillName('fade-the-first-break.md')).toBe('Fade the first break');
        expect(humanizeSkillName('book_trend_pullback.md')).toBe('Book trend pullback');
    });

    it('drops the file extension — it says where the rule lives, not what it is', () => {
        expect(humanizeSkillName('resting.md')).not.toContain('.md');
        expect(humanizeSkillName('resting.markdown')).toBe('Resting');
    });

    it('leaves a name that is already a phrase alone', () => {
        expect(humanizeSkillName('Session open fade')).toBe('Session open fade');
        expect(humanizeSkillName('')).toBe('');
    });
});
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SkillsCatalog from '../components/learn/SkillsCatalog';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

/**
 * The skills catalog on August's own data.
 *
 * The load-bearing properties, in order of how badly they'd hurt if wrong:
 *
 *  1. A tab with ZERO skills is never drawn. An empty decorative group is the
 *     defect this screen exists to avoid — a tab that shows nothing teaches the
 *     user the filter is broken.
 *  2. The checkmark is `skillEnabledFlag`, the ONE place `enabled` is derived.
 *     Suspension is `enabled:false` + `meta.suspendedAt`, NOT a fourth
 *     SkillStatus; deriving it a second way lets an unrelated attribution write
 *     silently un-suspend a skill.
 *  3. A truncated description carries a `title` so the full text is reachable.
 *     The last audit counted 138 `truncate` sites against 272 `title=`.
 *  4. A store read failure says it could not load, rather than drawing an empty
 *     grid that reads as "you have no skills".
 */

const listSkillsMock = vi.fn();

// Mocked at MODULE level, with the real `skillEnabledFlag` spread back in: the
// derivation under test is the real one, and a per-test `resetModules()` +
// dynamic import pulls the actual service — which drags in the notebook store,
// Capacitor and the Electron bridge, and times out in jsdom.
vi.mock('../services/learning/SkillMemoryService', async () => {
    const actual = await vi.importActual<typeof import('../services/learning/SkillMemoryService')>(
        '../services/learning/SkillMemoryService',
    );
    return { ...actual, listSkills: () => listSkillsMock() };
});

const roster = (rows: Array<Partial<SkillMeta> & { name: string }>): void => {
    listSkillsMock.mockReturnValue(rows.map(r => ({
        file: { id: r.name, name: r.name, content: '' },
        meta: {
            status: 'confirmed',
            kind: 'repeat',
            wins: 0,
            losses: 0,
            ...r,
        } as SkillMeta,
    })));
};

const ROSTER = [
    { name: 'fade-the-fakeout.md', description: 'Fade a failed breakout when volume diverges', family: 'mean-reversion' },
    { name: 'never-chase-the-open.md', description: 'Avoid the first 15 minutes of a session', family: 'avoid', kind: 'avoid' as const },
    { name: 'ride-the-trend.md', description: 'Hold with the 4h structure while it holds', family: 'trend' },
];

describe('SkillsCatalog', () => {
    beforeEach(() => {
        roster(ROSTER);
    });
    afterEach(() => {
        listSkillsMock.mockReset();
    });

    it('lists the roster with its real names and descriptions', () => {
        render(<SkillsCatalog />);
        expect(screen.getByText('fade-the-fakeout.md')).toBeDefined();
        expect(screen.getByText('Fade a failed breakout when volume diverges')).toBeDefined();
    });

    it('gives every truncated line a title, so the full text is reachable', () => {
        render(<SkillsCatalog />);
        expect(screen.getByText('fade-the-fakeout.md').getAttribute('title')).toBe('fade-the-fakeout.md');
    });

    it('marks an enabled skill with the checkmark', () => {
        // skillEnabledFlag: confirmed, not suspended, not disabled → true.
        const { container } = render(<SkillsCatalog />);
        expect(container.querySelector('[aria-label="Enabled"]')).not.toBeNull();
    });

    it('does NOT mark a suspended skill — suspension is not a SkillStatus', () => {
        // THE DERIVATION GUARD. `enabled:false` + `suspendedAt` is the one shape;
        // a second derivation here would let an attribution write re-inject it.
        roster([{ name: 'resting.md', description: 'x', family: 'trend', suspendedAt: new Date().toISOString() }]);
        const { container } = render(<SkillsCatalog />);
        expect(container.querySelector('[aria-label="Enabled"]')).toBeNull();
        expect(screen.getByTitle(/Not injected/)).toBeDefined();
    });

    it('draws a tab per family that actually holds skills, and no empty ones', () => {
        render(<SkillsCatalog />);
        // Three families in the roster → three tabs, plus "All".
        expect(screen.getByRole('tab', { name: /mean-reversion/ })).toBeDefined();
        expect(screen.getByRole('tab', { name: /trend/ })).toBeDefined();
        expect(screen.getByRole('tab', { name: /avoid/ })).toBeDefined();
        // No tab for a family with zero skills.
        expect(screen.queryByRole('tab', { name: /breakout/ })).toBeNull();
    });

    it('hides the tab strip entirely when there is only one collection', () => {
        // One tab that is always selected is a control that does nothing.
        roster([{ name: 'a.md', description: 'x', family: 'trend' }, { name: 'b.md', description: 'y', family: 'trend' }]);
        render(<SkillsCatalog />);
        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('filters by the search box against name and description', () => {
        render(<SkillsCatalog />);
        fireEvent.change(screen.getByLabelText('Search skills'), { target: { value: 'volume' } });
        expect(screen.getByText('fade-the-fakeout.md')).toBeDefined();
        expect(screen.queryByText('ride-the-trend.md')).toBeNull();
    });

    it('says a search found nothing rather than showing an empty grid', () => {
        render(<SkillsCatalog />);
        fireEvent.change(screen.getByLabelText('Search skills'), { target: { value: 'zzzz' } });
        expect(screen.getByTestId('skills-catalog-empty')).toBeDefined();
    });

    it('routes Add to the caller — it does not approve a draft itself', () => {
        // A second approval surface is the exact IA defect the 2026-10-07 audit
        // named. The Add button hands off; the Coach inbox owns the decision.
        const onAddSkill = vi.fn();
        render(<SkillsCatalog onAddSkill={onAddSkill} />);
        fireEvent.click(screen.getByText('Add'));
        expect(onAddSkill).toHaveBeenCalled();
    });

    it('omits Add entirely when no handler is wired — no dead button', () => {
        render(<SkillsCatalog />);
        expect(screen.queryByText('Add')).toBeNull();
    });

    it('every control clears the 24px hit-target floor', () => {
        render(<SkillsCatalog onAddSkill={() => {}} onOpenSettings={() => {}} />);
        for (const label of ['Refresh the skill list', 'Skill settings']) {
            expect(screen.getByLabelText(label).className).toContain('hit-target');
        }
    });

    it('says the library could not be read, rather than rendering an empty grid', () => {
        // An empty grid reads as "you have no skills" — which is a lie when the
        // store simply failed to load.
        listSkillsMock.mockImplementation(() => { throw new Error('store unavailable'); });
        render(<SkillsCatalog />);
        expect(screen.getByTestId('skills-catalog-error')).toBeDefined();
    });
});

/**
 * The Refresh press must be OBSERVABLE. `reload()` always re-read the store,
 * but with nothing on disk changed the screen came back byte-identical, so a
 * working button and a dead one were indistinguishable — exactly what
 * render-probe's inert-control gate measures. These pin the REPORT; the
 * re-read was never the bug.
 */
describe('SkillsCatalog — a refresh says what it found', () => {
    // This block sits outside the file's main describe, so it must seed its own
    // roster — without it every press hits a throwing mock and the "failed to
    // read" case passes for the wrong reason.
    beforeEach(() => { roster(ROSTER); });

    const statusOf = (container: HTMLElement): string =>
        container.querySelector('[data-testid="skills-status"]')?.textContent ?? '';

    it('reports "nothing changed" instead of leaving the press invisible', () => {
        const { container } = render(<SkillsCatalog />);
        // Before any press the slot carries the screen's descriptive line.
        expect(statusOf(container)).toMatch(/learned to do/);
        fireEvent.click(screen.getByLabelText('Refresh the skill list'));
        expect(statusOf(container)).toBe('Refreshed — nothing changed');
    });

    it('names a file the re-read picked up', () => {
        const { container } = render(<SkillsCatalog />);
        roster([...ROSTER, { name: 'scale-out-early.md', description: 'Take first profit at 1R', family: 'risk' }]);
        fireEvent.click(screen.getByLabelText('Refresh the skill list'));
        expect(statusOf(container)).toBe('Refreshed — 1 new');
    });

    it('names a row whose record moved', () => {
        const { container } = render(<SkillsCatalog />);
        roster([{ ...ROSTER[0], wins: 7 }, ROSTER[1], ROSTER[2]]);
        fireEvent.click(screen.getByLabelText('Refresh the skill list'));
        expect(statusOf(container)).toBe('Refreshed — 1 updated');
    });

    it('says so when the store read fails on a press', () => {
        const { container } = render(<SkillsCatalog />);
        listSkillsMock.mockImplementationOnce(() => { throw new Error('store unavailable'); });
        fireEvent.click(screen.getByLabelText('Refresh the skill list'));
        expect(statusOf(container)).toBe('Could not read the skill files');
    });
});



import { describe, it, expect } from 'vitest';

/**
 * E-49 — the skills index is 30 slots, and it used to be filled in notebook
 * file order, unranked and unfiltered by status.
 *
 * The index is the ONLY place a skill is ever NAMED to the model, and the
 * prompt tells the seat to "APPLY any that match" from it. So a retired
 * skill and an unproven candidate occupied a slot exactly like a confirmed
 * one, and a dormant skill could displace a good one — repairing the library
 * did not guarantee the model ever saw the repaired skill.
 *
 * The ranking lives in `buildSkillsIndexForPrompt` so every caller benefits.
 * The gate is the same one the INJECTION path uses (retired / suspended /
 * disabled / manual-only / audience), because the index must never offer a
 * rule the harness would refuse to hand the seat.
 */

import {
    buildSkillsIndexForPrompt,
    compareSkillIndexRows,
    isIndexableSkill,
    rankSkillIndexRows,
    type SkillIndexRow,
} from '../services/trade/tradeChatContext';

const row = (over: Partial<SkillIndexRow> & { slug: string }): SkillIndexRow => ({
    status: 'confirmed',
    description: 'a rule the seat can apply',
    ...over,
});

describe('E-49 — the gate: a skill the harness would never inject is not offered', () => {
    it('a retired skill is out', () => {
        expect(isIndexableSkill(row({ slug: 'old', status: 'retired' }))).toBe(false);
    });

    it('a dormant (idle-suspended) skill is out', () => {
        expect(isIndexableSkill(row({ slug: 'dormant', suspended: true }))).toBe(false);
    });

    it('a skill the trader switched off is out', () => {
        expect(isIndexableSkill(row({ slug: 'off', disabled: true }))).toBe(false);
    });

    it('a human-invoked-only skill is out (it is never handed to a seat on its own)', () => {
        expect(isIndexableSkill(row({ slug: 'manual', manualOnly: true }))).toBe(false);
    });

    it('another seat\'s rule is out', () => {
        expect(isIndexableSkill(row({ slug: 'mod', audience: 'moderator' }), 'analyst')).toBe(false);
        expect(isIndexableSkill(row({ slug: 'mod', audience: 'analyst' }), 'moderator')).toBe(false);
        expect(isIndexableSkill(row({ slug: 'both', audience: 'all' }), 'analyst')).toBe(true);
        expect(isIndexableSkill(row({ slug: 'mine', audience: 'analyst' }), 'analyst')).toBe(true);
    });

    it('a row that says nothing about these facts is KEPT (a quiet caller must not lose a skill)', () => {
        expect(isIndexableSkill({ slug: 'bare' })).toBe(true);
    });
});

describe('E-49 — the ranking', () => {
    it('a usable trigger outranks a bare name', () => {
        const ranked = rankSkillIndexRows([
            { slug: 'bare', status: 'confirmed' },
            { slug: 'triggered', status: 'confirmed', ifCondition: 'x > 1' },
        ]);
        expect(ranked.map(r => r.slug)).toEqual(['triggered', 'bare']);
    });

    it('confirmed comes before candidate', () => {
        const ranked = rankSkillIndexRows([
            { slug: 'cand', status: 'candidate', description: 'd' },
            { slug: 'conf', status: 'confirmed', description: 'd' },
        ]);
        expect(ranked.map(r => r.slug)).toEqual(['conf', 'cand']);
    });

    it('the most recently evidenced comes first among equals', () => {
        const ranked = rankSkillIndexRows([
            { slug: 'old', status: 'confirmed', description: 'd', lastEvidenceAt: '2026-01-01T00:00:00.000Z' },
            { slug: 'new', status: 'confirmed', description: 'd', lastEvidenceAt: '2026-09-01T00:00:00.000Z' },
        ]);
        expect(ranked.map(r => r.slug)).toEqual(['new', 'old']);
    });

    it('ties keep the caller\'s order (the sort is stable — nothing is reshuffled for tidiness)', () => {
        const rows = ['a', 'b', 'c', 'd'].map(slug => ({ slug, status: 'confirmed', description: 'd' }));
        expect(rankSkillIndexRows(rows).map(r => r.slug)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('the comparator is a total order on the axes it claims', () => {
        const a = row({ slug: 'a' });
        const b = row({ slug: 'b' });
        expect(compareSkillIndexRows(a, b)).toBe(0);
    });
});

describe('E-49 — the index a seat actually reads', () => {
    it('a retired skill is absent and a confirmed one is first', () => {
        const block = buildSkillsIndexForPrompt([
            { slug: 'retired-one', status: 'retired', description: 'gone' },
            { slug: 'cand-one', status: 'candidate', description: 'unproven' },
            { slug: 'conf-one', status: 'confirmed', description: 'proven' },
        ]);
        expect(block).not.toContain('retired-one');
        expect(block.indexOf('conf-one')).toBeLessThan(block.indexOf('cand-one'));
    });

    it('a dormant skill does not take a slot a live one needed', () => {
        const block = buildSkillsIndexForPrompt([
            { slug: 'dormant-one', status: 'confirmed', description: 'asleep', suspended: true },
            { slug: 'live-one', status: 'confirmed', description: 'awake' },
        ]);
        expect(block).not.toContain('dormant-one');
        expect(block).toContain('live-one');
    });

    it('a manual-only skill stays out of an audience that may not see it', () => {
        const rows: SkillIndexRow[] = [
            { slug: 'manual-one', status: 'confirmed', description: 'd', manualOnly: true },
            { slug: 'normal-one', status: 'confirmed', description: 'd' },
        ];
        expect(buildSkillsIndexForPrompt(rows)).not.toContain('manual-one');
        expect(buildSkillsIndexForPrompt(rows)).toContain('normal-one');
    });

    it('the overflow line counts what this seat could use and was NOT shown', () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({
            slug: `skill-${i}`,
            status: 'confirmed',
            description: 'd',
        }));
        const block = buildSkillsIndexForPrompt(rows, 30);
        expect(block).toContain('skill-29');
        expect(block).not.toContain('skill-30\n');
        expect(block).toContain('…and 10 more');
    });

    it('the overflow line does not count the skills that were filtered out', () => {
        // 30 usable + 5 retired: the retired ones are not this seat's to pull,
        // so the honest count is 0 more — not 5.
        const rows = [
            ...Array.from({ length: 30 }, (_, i) => ({ slug: `live-${i}`, status: 'confirmed' as const, description: 'd' })),
            ...Array.from({ length: 5 }, (_, i) => ({ slug: `dead-${i}`, status: 'retired' as const, description: 'd' })),
        ];
        const block = buildSkillsIndexForPrompt(rows, 30);
        expect(block).not.toContain('…and');
        expect(block).toContain('## Skills library — 30 skills');
    });

    it('an empty library is still empty text', () => {
        expect(buildSkillsIndexForPrompt([])).toBe('');
    });

    it('a library with nothing this seat may use is empty text, not a heading with no rows', () => {
        expect(buildSkillsIndexForPrompt([
            { slug: 'dead', status: 'retired', description: 'd' },
        ])).toBe('');
    });
});

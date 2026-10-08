import { describe, it, expect } from 'vitest';

import { parseSkillBody, projectSkillCard } from '../services/learning/skillDocument';
import { formatCraftedSkillBody } from '../services/learning/SkillCraftService';
import { descriptionOf } from '../components/skills/SkillDetail';
import type { CraftedSkill } from '../schemas/learning';

const craft = (over: Partial<CraftedSkill> = {}): CraftedSkill => ({
    name: 'Funding exhaustion long',
    kind: 'repeat',
    when: 'funding has run positive for many sessions and price stalls at swept lows',
    whenNot: ['funding is positive but price is making higher highs — that is trend, not exhaustion'],
    inputs: ['BTCUSDT', 'Long', '1h'],
    steps: ['Confirm the funding streak on the premium panel', 'Wait for a 1h close above the swept low', 'Enter with stop under the low'],
    pitfalls: ['Entering on the first touch — the sweep usually extends one more leg'],
    verification: 'Price holds above the swept low for two consecutive 1h closes',
    validate: 'the funding streak is still running',
    output: 'a long ticket with a defined stop',
    approval: 'a human confirms size',
    ifCondition: 'funding positive 8 sessions and the daily low was swept',
    thenAction: 'go long only after a 1h close back above the swept level',
    ...over,
} as CraftedSkill);

describe('a crafted skill is a document, not a rule', () => {
    const body = formatCraftedSkillBody(craft());

    it('keeps the bold core every existing reader depends on', () => {
        // utils/ifThenSkill.ts writes the same `**What I do:**` line and
        // syncSkillRuleLine rewrites `**My rule:**` byte-identically; a dozen
        // fixtures seed this shape. The sections are ADDITIVE.
        expect(body).toContain('**When:** funding has run positive');
        expect(body).toContain('**What I do:**');
        expect(body).toContain('**What I look at:** BTCUSDT, Long, 1h');
        expect(body).toMatch(/^\*\*My rule:\*\* when funding positive 8 sessions and the daily low was swept, I go long only after/m);
    });

    it('carries the sections that make it a procedure', () => {
        for (const heading of ['## When NOT to use', '## Pitfalls', '## Verification']) {
            expect(body, `missing ${heading}`).toContain(heading);
        }
        expect(body).toContain('- funding is positive but price is making higher highs');
        expect(body).toContain('- Entering on the first touch');
        expect(body).toContain('- Price holds above the swept low for two consecutive 1h closes');
    });

    it('still leads with a line every existing reader can use as the summary', () => {
        // descriptionOf() takes the first non-heading line; the listing rows and
        // the recall fallback depend on it being the trigger, not a heading.
        expect(descriptionOf(body)).toMatch(/^\*\*When:\*\* funding has run positive/);
    });

    it('a rule-only craft still renders, with the empty sections named rather than hidden', () => {
        const bare = formatCraftedSkillBody(craft({
            whenNot: undefined, pitfalls: undefined, verification: undefined, relatedSkills: undefined,
        } as Partial<CraftedSkill>));
        expect(bare).toContain('- none recorded');
        expect(bare).not.toContain('undefined');
    });
});

describe('the recall card is projected from the sections', () => {
    const body = formatCraftedSkillBody(craft());

    it('parses every section back out of the stored body', () => {
        const s = parseSkillBody(body);
        expect(s.whenNot.length).toBeGreaterThan(0);
        expect(s.pitfalls[0]).toMatch(/first touch/);
        expect(s.verification[0]).toMatch(/two consecutive 1h closes/);
        expect(s.validate[0]).toMatch(/funding streak is still running/);
        expect(s.steps.length).toBe(3);
    });

    it('fits the budget and spends it on the parts that stop a wrong application', () => {
        const card = projectSkillCard(body, {
            ifCondition: craft().ifCondition, thenAction: craft().thenAction, budget: 700,
        });
        expect(card.chars).toBeLessThanOrEqual(700);
        expect(card.text).toContain('IF ');
        expect(card.text).toContain('NOT when:');
        expect(card.text).toContain('Watch:');
        expect(card.text).toContain('Verify:');
        expect(card.clipped).toBe(false);
    });

    it('drops the TAIL when it cannot fit, never the trigger', () => {
        const card = projectSkillCard(body, {
            ifCondition: craft().ifCondition, thenAction: craft().thenAction, budget: 90,
        });
        expect(card.clipped).toBe(true);
        expect(card.chars).toBeLessThanOrEqual(90);
        expect(card.droppedChars).toBeGreaterThan(0);
        expect(card.text.startsWith('IF ')).toBe(true);
    });

    it('a legacy body with no headings at all still yields a usable card', () => {
        const legacy = '**When:** skip BTC shorts when funding is positive\n\n**My rule:** when funding positive, I skip shorts';
        const card = projectSkillCard(legacy, { ifCondition: 'funding positive', thenAction: 'skip the short' });
        // Served whole. The card's job is deciding what to DROP once the budget
        // bites; re-shaping a body that fits would trade the trader's own words
        // for labels this module invented.
        expect(card.text).toBe(legacy);
        expect(card.clipped).toBe(false);
        expect(card.droppedChars).toBe(0);
    });

    it('a legacy body over budget is projected and keeps its rule, trigger and procedure', () => {
        // The projection path, driven by a file written before this module: no
        // `##` headings, and a procedure under a bold label the parser reserves
        // only as a fallback. Nothing may vanish for using an unfamiliar label.
        const filler = 'x'.repeat(900);
        const legacy = [
            '**When:** skip BTC shorts when funding is positive',
            `**My plan:** ${filler}`,
            '**Procedure:** wait for the funding print to flip before re-arming',
            '**My rule:** when funding positive, I skip shorts',
        ].join('\n');
        const card = projectSkillCard(legacy, {
            ifCondition: 'funding positive', thenAction: 'skip the short', budget: 300,
        });
        expect(card.clipped).toBe(true);
        expect(card.chars).toBeLessThanOrEqual(300);
        expect(card.text.startsWith('IF funding positive THEN skip the short')).toBe(true);
        expect(card.text).toContain('When: skip BTC shorts');
        expect(card.text).toContain('wait for the funding print to flip');
    });
});

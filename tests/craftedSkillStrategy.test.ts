/**
 * A skill can be MORE than an IF/THEN rule.
 *
 * The model could only ever state "when X, do Y", so when it learned a real
 * STRATEGY from a post-mortem — entry, stop, target, sizing — the plan had to
 * be prose inside `steps`, which nothing could read back, check, or turn into
 * a ticket. These tests pin that a structured plan survives the boundary parse
 * AND is visible in the skill body the next seat actually reads.
 */
import { describe, it, expect } from 'vitest';
import { parseCraftedSkill } from '../schemas/learning';
import { formatCraftedSkillBody, SKILL_CRAFT_FALLBACK } from '../services/learning/SkillCraftService';
import { syncSkillRuleLine } from '../services/learning/SkillMemoryService';

const base = {
    name: 'liquidity sweep reclaim',
    kind: 'repeat' as const,
    when: 'price sweeps the prior low then reclaims it',
    inputs: ['coin', 'timeframe'],
    steps: ['wait for the reclaim candle close'],
    validate: 'the reclaim holds above the swept level',
    output: 'enter on the reclaim',
    approval: 'half size',
    ifCondition: 'a prior-day low is swept and reclaimed',
    thenAction: 'enter long above the reclaim',
};

describe('a crafted skill may carry a structured strategy', () => {
    it('keeps entry, stop, target, sizing and conditions through the parse', () => {
        const skill = parseCraftedSkill({
            ...base,
            strategy: {
                entry: 'above the reclaim candle high',
                invalidation: 'close back below the swept low',
                stop: 'the swept low',
                target: 'prior day high',
                sizing: '0.5% of equity',
                conditions: ['volume above average on the reclaim', '4H trend is not down'],
            },
        });
        expect(skill?.strategy?.entry).toBe('above the reclaim candle high');
        expect(skill?.strategy?.stop).toBe('the swept low');
        expect(skill?.strategy?.target).toBe('prior day high');
        expect(skill?.strategy?.sizing).toBe('0.5% of equity');
        expect(skill?.strategy?.conditions).toHaveLength(2);
    });

    it('shows the plan in the body the next seat reads', () => {
        // A field that parses but never renders is invisible: the seat would
        // read the rule and miss the plan entirely.
        const skill = parseCraftedSkill({
            ...base,
            strategy: { entry: 'above the reclaim', stop: 'the swept low', target: 'prior high', sizing: 'half' },
        });
        const body = formatCraftedSkillBody(skill!);
        expect(body).toMatch(/Entry: above the reclaim/);
        expect(body).toMatch(/Stop: the swept low/);
        expect(body).toMatch(/Target: prior high/);
        expect(body).toMatch(/Size: half/);
    });

    it('a pure avoid-rule with no strategy still renders, without a plan block', () => {
        const skill = parseCraftedSkill({ ...base, kind: 'avoid' });
        expect(skill?.strategy).toBeUndefined();
        expect(formatCraftedSkillBody(skill!)).toContain('**My rule:**');
        expect(formatCraftedSkillBody(skill!)).not.toContain('**My plan:**');
    });

    it('the rule line a re-scope moves is byte-identical to the one a craft writes', () => {
        // Two producers of this one prose line is exactly how a skill ends up
        // stating two triggers. Every writer that moves a clause must produce the
        // SAME sentence the craft path writes at creation — pin the parity, so a
        // future edit to one template fails here instead of shipping a file whose
        // front matter and prose disagree (the A2 re-scope bug).
        const skill = parseCraftedSkill(base)!;
        const craftedLine = (formatCraftedSkillBody(skill).split('\n')
            .find(l => l.startsWith('**My rule:**')) ?? '');
        expect(craftedLine).toBeTruthy();
        const moved = { ifCondition: skill.ifCondition, thenAction: skill.thenAction, body: '' };
        syncSkillRuleLine(moved as never);
        expect(moved.body).toBe(craftedLine);
    });

    it('accepts a partial plan — an invalidation-only rule is still valid', () => {
        const skill = parseCraftedSkill({ ...base, strategy: { invalidation: 'a close above the prior high' } });
        expect(skill?.strategy?.invalidation).toBe('a close above the prior high');
        expect(skill?.strategy?.entry).toBeUndefined();
    });

    it('survives a model that omits it entirely', () => {
        expect(parseCraftedSkill(base)?.strategy).toBeUndefined();
    });

    it('is offered in the craft prompt, or the model will never emit it', () => {
        expect(SKILL_CRAFT_FALLBACK).toMatch(/"strategy"/);
        expect(SKILL_CRAFT_FALLBACK).toMatch(/invalidation/);
        expect(SKILL_CRAFT_FALLBACK).toMatch(/sizing/);
    });
});

/**
 * E-46b — the `compatibility` block: WHAT a skill needs.
 *
 * The retrieval already has an "invocation control" concept — `audience`,
 * `lensScope`, `manualOnly` — and those say WHO may see a skill. The other
 * half is what the skill NEEDS: a tool the seat does not expose, an env var
 * that is not set, a platform it does not run on.
 *
 * The rules this pins:
 *  - it is ADDITIVE: a skill with no compatibility block is byte-identical to
 *    what it was before the key existed, and means exactly what it meant;
 *  - it is a plain serialisable YAML scalar (a JSON string, which is a valid
 *    YAML 1.2 double-quoted scalar) like every other key in the frontmatter —
 *    no nested YAML, so a hand-edit cannot break the block;
 *  - a corrupt or hand-mangled value degrades to "no constraint" instead of
 *    poisoning the file.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const loadYaml = createRequire(import.meta.url)('js-yaml').load as (source: string) => unknown;

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async () => null),
    getPreference: vi.fn(async () => null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async () => { }),
    removePreference: vi.fn(async () => { }),
}));

import {
    parseSkillMarkdown,
    serializeSkill,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'candidate',
    kind: 'avoid',
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    tradeIds: [],
    description: 'Avoid: IF BTC short fires into resistance without a reclaim close THEN stand aside.',
    ifCondition: 'BTC short fires into resistance without a reclaim close',
    thenAction: 'stand aside until the reclaim prints',
    body: '**When:** BTC short fires into resistance.\n**What I do:** stand aside.',
    ...over,
} as SkillMeta);

const frontmatter = (content: string): Record<string, unknown> =>
    loadYaml(content.match(/^---\n([\s\S]*?)\n---/m)![1]) as Record<string, unknown>;

describe('the compatibility block', () => {
    it('is ABSENT from a skill that has none — byte-identical to before the key existed', () => {
        const content = serializeSkill(meta(), 'Avoid BTC');
        expect(content).not.toMatch(/(^|\n)compatibility:/);
        // And the parsed meta carries no constraint.
        expect(parseSkillMarkdown(content)!.compatibility).toBeUndefined();
    });

    it('is written as ONE plain scalar, so the frontmatter stays valid YAML', () => {
        const content = serializeSkill(meta({
            compatibility: {
                requiresTools: ['run_screener'],
                requiresEnv: ['POLYGON_API_KEY'],
                platforms: ['web', 'native'],
            },
        }), 'Avoid BTC');

        const fm = frontmatter(content);
        expect(fm.compatibility).toBeTruthy();
        // It is a plain string, not a nested mapping — so the frontmatter is
        // still the flat, hand-editable block it has always been.
        expect(typeof fm.compatibility).toBe('string');
        expect(JSON.parse(fm.compatibility as string)).toEqual({
            requiresTools: ['run_screener'],
            requiresEnv: ['POLYGON_API_KEY'],
            platforms: ['web', 'native'],
        });
    });

    it('round-trips', () => {
        const compat = { requiresTools: ['run_screener'], platforms: ['native'] };
        const back = parseSkillMarkdown(serializeSkill(meta({ compatibility: compat }), 'Avoid BTC'))!;
        expect(back.compatibility).toEqual(compat);
    });

    it('degrades a corrupt value to NO constraint instead of poisoning the file', () => {
        const broken = [
            '---',
            'name: "broken"',
            'description: "a skill with a mangled compatibility block"',
            'compatibility: "not json at all"',
            '---',
            '',
            '# Broken',
            '',
            'body',
            '',
        ].join('\n');
        const back = parseSkillMarkdown(broken)!;
        expect(back.compatibility).toBeUndefined();
        // And the rest of the file still parses. The skill's identity is
        // the FILE name — `SkillMeta` carries no `name` field, because the
        // name is derived from the title at write time — so assert the raw
        // frontmatter's name line survived instead of a property the meta
        // does not have.
        expect(broken).toContain('name: "broken"');
        expect(back.description).toContain('mangled');
    });

    it('drops an empty compatibility object, because empty means "no constraint"', () => {
        const back = parseSkillMarkdown(serializeSkill(meta({ compatibility: {} }), 'Avoid BTC'))!;
        expect(back.compatibility).toBeUndefined();
    });

    it('keeps only the string lists it understands', () => {
        const back = parseSkillMarkdown(serializeSkill(meta({
            compatibility: { requiresTools: ['a', 'b'], requiresEnv: [] },
        }), 'Avoid BTC'))!;
        expect(back.compatibility).toEqual({ requiresTools: ['a', 'b'] });
    });
});

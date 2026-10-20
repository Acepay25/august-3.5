/**
 * E-47a — the skill file's ENVELOPE: the filename and the `version:` key.
 *
 * The skill CONTENT is already a deliberate port of the Agent Skills spec
 * (`services/learning/SkillMemoryService.ts:411-431`): YAML frontmatter with
 * `name` + `description`, a portable face and a ledger face behind one
 * marker, and a parser that loads a spec-only file as an unproven candidate.
 *
 * What was missing was the ENVELOPE:
 *  - the convention names a skill's file `SKILL.md`, and a file the trader
 *    drops in must be RECOGNISED as a spec-shaped skill rather than only
 *    happening to end in `.md`;
 *  - a skill could not say which revision of ITSELF it was.
 *
 * And the width of the filename check has to be widened WITHOUT breaking the
 * dozens of places that assume a `slug.md` file name.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string) => {
        const raw = store[key];
        return Array.isArray(raw) ? raw : [];
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import {
    isSkillFile,
    isSpecShapedSkillFile,
    frontmatterName,
    listSkills,
    parseSkillMarkdown,
    serializeSkill,
    SPEC_SKILL_FILE_NAME,
    SKILL_FILE_VERSION,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';

const USER = 'envelope-user';

const skillsFolder = (): string =>
    getMemoryFiles().folders.find(f => f.name === 'skills')!.id;

/** A spec-only skill: the two fields the convention REQUIRES, nothing else. */
const specOnly = (name: string, description: string): string => [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    '# Reclaim continuation',
    '',
    '**When:** the prior session high is reclaimed on expanding volume.',
    '**What I do:** enter on the reclaim close.',
    '',
].join('\n');

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

beforeEach(async () => {
    store = {};
    localStorage.clear();
    await initMemoryFiles(USER);
});

describe('the filename check accepts the convention\'s name', () => {
    it('recognises a spec-shaped SKILL.md, lists it, and loads it as an unproven candidate', async () => {
        const file = await createMemoryFile(
            skillsFolder(),
            SPEC_SKILL_FILE_NAME,
            specOnly('reclaim-continuation', 'Repeat: when price reclaims the prior session high, take the long continuation.'),
            USER,
            true,
        );

        expect(isSkillFile(file)).toBe(true);
        expect(isSpecShapedSkillFile(file)).toBe(true);
        // It LISTS — the file is not invisible to the app.
        const listed = listSkills().find(s => s.file.name === SPEC_SKILL_FILE_NAME);
        expect(listed).toBeTruthy();
        // It PARSES.
        expect(listed!.meta.status).toBe('candidate');
        expect(listed!.meta.wins).toBe(0);
        expect(listed!.meta.losses).toBe(0);
        // It loads as an UNPROVEN candidate: no evidence of its own.
        expect(listed!.meta.prior).toBeUndefined();
        expect(frontmatterName(file.content)).toBe('reclaim-continuation');
    });

    it('accepts an upper-case extension, so a hand-edited file is not invisible', async () => {
        const file = await createMemoryFile(
            skillsFolder(),
            'NOTES.MD',
            specOnly('notes', 'A skill whose extension was typed in capitals.'),
            USER,
            true,
        );
        expect(isSkillFile(file)).toBe(true);
        expect(listSkills().some(s => s.file.name === 'NOTES.MD')).toBe(true);
    });

    it('does NOT call a broken SKILL.md spec-shaped — that is a ghost, and the review says so', async () => {
        const file = await createMemoryFile(
            skillsFolder(),
            SPEC_SKILL_FILE_NAME,
            '# no frontmatter at all\n',
            USER,
            true,
        );
        // It is still a skill FILE (so the review can report it)…
        expect(isSkillFile(file)).toBe(true);
        // …but it is not spec-shaped, because it does not parse.
        expect(isSpecShapedSkillFile(file)).toBe(false);
    });

    it('leaves the slug derivation alone: every `slug.md` site keeps working', async () => {
        await createMemoryFile(skillsFolder(), 'btc-avoid.md', serializeSkill(meta(), 'Avoid BTC'), USER, true);
        // The slug is still the file name's stem.
        expect(listSkills()[0].file.name.replace(/\.md$/i, '')).toBe('btc-avoid');
    });
});

describe('the version key', () => {
    it('is written on the portable face, after the spec-required pair', () => {
        const content = serializeSkill(meta(), 'Avoid BTC');
        const lines = content.split('\n');
        // The spec's required pair still LEADS the file.
        expect(lines[1]).toMatch(/^name:/);
        expect(lines[2]).toMatch(/^description:/);
        // The version follows them.
        expect(lines[3]).toMatch(/^version:/);
        // And it is on the PORTABLE face (above the ledger marker).
        const markerIdx = content.indexOf('# august:skill-ledger');
        expect(content.slice(0, markerIdx)).toMatch(/(^|\n)version:/);
    });

    it('defaults to the current file version when the skill does not declare one', () => {
        const content = serializeSkill(meta(), 'Avoid BTC');
        expect(content).toContain(`version: ${JSON.stringify(SKILL_FILE_VERSION)}`);
        expect(parseSkillMarkdown(content)!.version).toBe(SKILL_FILE_VERSION);
    });

    it('carries the skill\'s OWN version when it declares one', () => {
        const content = serializeSkill(meta({ version: '7' }), 'Avoid BTC');
        expect(content).toContain('version: "7"');
        expect(parseSkillMarkdown(content)!.version).toBe('7');
    });

    it('round-trips through the markdown', () => {
        const back = parseSkillMarkdown(serializeSkill(meta({ version: '3' }), 'Avoid BTC'))!;
        expect(back.version).toBe('3');
    });
});

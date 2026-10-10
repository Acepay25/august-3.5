import { describe, it, expect } from 'vitest';
import {
    serializeSkill,
    parseSkillMarkdown,
    skillBody,
    isSkillFile,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';

// Plan #3: a skill file is a database row wearing markdown. The Agent Skills
// spec's required frontmatter is exactly two fields — name and description —
// and it has NO lifecycle or outcome fields at all; its only extension point
// is a string→string metadata map. Our file carries ~35 outcome/lifecycle
// keys inline, which is why a skill cannot be shared, imported, or reasoned
// about as a procedure.
//
// The split this pins: a PORTABLE face (spec-shaped, readable as a procedure)
// and a LEDGER face (August's outcome/lifecycle state), separated in the one
// file so no migration is needed and nothing is rewritten.

/** Outcome/lifecycle keys that belong to the ledger, never the portable face. */
const LEDGER_KEYS = [
    'status', 'wins', 'losses', 'sample', 'netR', 'rSampled', 'consecutiveLosses',
    'tradeIds', 'evidenceCount', 'controlIds', 'controlWins', 'controlLosses',
    'overriddenIds', 'crossRegimeIds', 'regimeStats', 'prediction', 'shadow',
    'history', 'previousVersion', 'birthEvidence', 'recentOutcomes',
    'evalVerdict', 'evalStreak', 'lastEvidenceAt', 'lastMatchedAt', 'lastEvalAt',
    'refinedAt', 'suspendedAt', 'supersededBy', 'claimTestedEvidence',
];

const richMeta = (): SkillMeta => ({
    status: 'confirmed',
    kind: 'avoid',
    description: 'Avoid: IF BTC short fires into resistance without a reclaim close THEN stand aside until the reclaim prints.',
    coin: 'BTCUSDT',
    direction: 'Short',
    family: 'Family A',
    regime: 'ranging',
    wins: 4,
    losses: 7,
    consecutiveLosses: 2,
    netR: -1.5,
    rSampled: 11,
    tradeIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    evidenceCount: 11,
    controlIds: ['c1', 'c2'],
    controlWins: 3,
    controlLosses: 2,
    recentOutcomes: 'LLWLWLLLWWL',
    ifCondition: 'BTC short into resistance without reclaim',
    thenAction: 'stand aside until the reclaim close prints',
    strategyFamily: 'mean_reversion',
    horizon: 'intraday',
    approvedBy: 'human',
    approvedAt: '2026-08-01T00:00:00.000Z',
    audience: 'analyst',
    lensScope: 'risk',
    evalVerdict: 'helps',
    evalDetail: '3/3',
    lastEvalAt: '2026-09-01T00:00:00.000Z',
    lastEvidenceAt: '2026-09-02T00:00:00.000Z',
    modifiedAt: '2026-09-03T00:00:00.000Z',
    body: '**When:** BTC short into resistance without a reclaim close.\n**What I do:** stand aside until the reclaim prints.',
});

/** Frontmatter block of a serialized skill, split into non-empty lines. */
const frontmatterLines = (content: string): string[] =>
    content.split(/^---$/m)[1]?.split('\n').filter(l => l.trim()) ?? [];

describe('skill file splits into a portable face and a ledger face', () => {
    it('round-trips every field unchanged', () => {
        const meta = richMeta();
        const back = parseSkillMarkdown(serializeSkill(meta, 'Avoid BTC Short'));
        expect(back).not.toBeNull();
        expect(back!.status).toBe('confirmed');
        expect(back!.wins).toBe(4);
        expect(back!.losses).toBe(7);
        expect(back!.netR).toBe(-1.5);
        expect(back!.rSampled).toBe(11);
        expect(back!.evidenceCount).toBe(11);
        expect(back!.controlWins).toBe(3);
        expect(back!.controlLosses).toBe(2);
        expect(back!.recentOutcomes).toBe('LLWLWLLLWWL');
        expect(back!.approvedBy).toBe('human');
        expect(back!.audience).toBe('analyst');
        expect(back!.lensScope).toBe('risk');
        expect(back!.evalVerdict).toBe('helps');
        expect(back!.description).toBe(meta.description);
        // `meta.body` is the raw body as authored (the `# Title` line belongs
        // to the file, and the parser keeps it there). `skillBody()` is the
        // one that strips both frontmatter and the title heading — that is
        // what every injection path reads, so the title never reaches a seat
        // twice (once in the skill header line, once as a heading).
        expect(back!.body).toContain('**What I do:** stand aside');
        expect(skillBody(serializeSkill(meta, 'Avoid BTC Short'))).not.toContain('# Avoid BTC Short');
        expect(skillBody(serializeSkill(meta, 'Avoid BTC Short'))).toContain('**What I do:** stand aside');
    });

    it('declares the spec-required name and description in the portable face', () => {
        const content = serializeSkill(richMeta(), 'Avoid BTC Short');
        const fm = frontmatterLines(content);
        // The two fields the Agent Skills spec REQUIRES must be present and
        // leading the file — that is what makes it readable as a procedure.
        expect(fm.some(l => /^name:\s*\S/.test(l))).toBe(true);
        expect(fm.some(l => /^description:\s*\S/.test(l))).toBe(true);
        // name <= 64 chars per the spec.
        const nameLine = fm.find(l => l.startsWith('name:'))!;
        expect(nameLine.slice('name:'.length).trim().length).toBeLessThanOrEqual(64);
    });

    it('keeps outcome/lifecycle state OUT of the portable face', () => {
        const content = serializeSkill(richMeta(), 'Avoid BTC Short');
        const markerIdx = content.indexOf('<!-- august:skill-ledger -->');
        expect(markerIdx).toBeGreaterThan(-1);
        const portable = content.slice(0, markerIdx);
        const ledger = content.slice(markerIdx);
        // The ledger keys still exist (nothing is lost) but live below the
        // marker, so a reader can tell procedure from bookkeeping.
        for (const key of ['wins', 'losses', 'netR', 'controlIds', 'recentOutcomes']) {
            expect(ledger).toMatch(new RegExp(`(^|\\n)${key}:`));
        }
        // ...and none of them is in the portable face.
        for (const key of LEDGER_KEYS) {
            expect(portable).not.toMatch(new RegExp(`(^|\\n)${key}:`));
        }
    });

    it('an imported spec-only skill (name + description, nothing else) still parses', () => {
        // The whole point of portability: a skill authored against the spec,
        // carrying ONLY the two required fields, must load — it simply has no
        // local evidence yet.
        const specOnly = [
            '---',
            'name: reclaim-continuation',
            'description: Repeat: when price reclaims the prior session high on expanding volume, take the long continuation toward the next liquidity pool.',
            '---',
            '',
            '# Reclaim continuation',
            '',
            '**When:** the prior session high is reclaimed on expanding volume.',
            '**What I do:** enter on the reclaim close.',
            '',
        ].join('\n');
        const meta = parseSkillMarkdown(specOnly);
        expect(meta).not.toBeNull();
        expect(meta!.status).toBe('candidate'); // unproven by default
        expect(meta!.wins).toBe(0);
        expect(meta!.losses).toBe(0);
        expect(meta!.description).toContain('reclaims the prior session high');
        expect(skillBody(specOnly)).toContain('enter on the reclaim close');
    });

    it('a hand-edited ledger edit is preserved by a re-serialize', () => {
        // The MemoryFilesManager toggles parse → mutate → serialize. Any field
        // the round-trip drops silently un-disables or un-suspends a skill.
        const first = serializeSkill(richMeta(), 'Avoid BTC Short');
        const meta = parseSkillMarkdown(first)!;
        meta.disabledByUser = true;
        const second = serializeSkill(meta, 'Avoid BTC Short');
        const back = parseSkillMarkdown(second)!;
        expect(back.disabledByUser).toBe(true);
        expect(back.wins).toBe(4);
        expect(back.approvedBy).toBe('human');
    });

    it('isSkillFile still recognises a skill after the split', async () => {
        const user = `split-user-${Math.random().toString(36).slice(2)}`;
        await initMemoryFiles(user);
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const file = await createMemoryFile(
            skills.id, 'btc-avoid.md', serializeSkill(richMeta(), 'Avoid BTC Short'), user, true,
        );
        expect(isSkillFile(file)).toBe(true);
        expect(parseSkillMarkdown(file.content)!.kind).toBe('avoid');
    });
});

describe('ledger keys never leak into the portable face', () => {
    it('the portable face carries no outcome counters above the ledger marker', () => {
        const content = serializeSkill(richMeta(), 'Avoid BTC Short');
        const markerIdx = content.indexOf('<!-- august:skill-ledger -->');
        expect(markerIdx).toBeGreaterThan(-1);
        const portable = content.slice(0, markerIdx);
        // Behavior keys stay in the portable face — they describe the procedure.
        for (const key of ['kind', 'coin', 'direction', 'family', 'ifCondition', 'thenAction']) {
            expect(portable).toMatch(new RegExp(`(^|\\n)${key}:`));
        }
        // Outcome/lifecycle keys must not — they are bookkeeping.
        for (const key of LEDGER_KEYS) {
            expect(portable).not.toMatch(new RegExp(`(^|\\n)${key}:`));
        }
        // And the spec-required pair is what leads the file.
        expect(portable.split('\n')[1]).toMatch(/^name:/);
    });
});

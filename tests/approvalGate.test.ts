/**
 * THE ACTIVATION GATE — proof before implementation.
 *
 * The Step B audit (docs/plans/workstream1-stepB-evidence.md §b) listed 13 paths by
 * which a skill becomes active with no human approval. The owner's rule is the
 * opposite: nothing model-generated becomes active, gets veto weight, or is retired
 * without their approval. This file is written FIRST, against the code as it stands,
 * so each path is either proven real or reported otherwise — and so the gate has to
 * earn every green rather than being declared.
 *
 * "Active" is tested at the three places a belief actually reaches a trade:
 *   prompt injection  — getMemoryFilesContext / substituteSkillContext
 *   soft enforcement  — applyNotebookSkillsToAnalysis (confidence caps, warnings)
 *   hard enforcement  — confirmedAvoidForSetup (skip_to_verdict veto)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import { initMemoryFiles, getMemoryFiles, createMemoryFile, updateMemoryFile } from '../services/learning/MemoryFilesService';
import {
    confirmedAvoidForSetup, applyNotebookSkillsToAnalysis, isApprovedSkill,
    grandfatherExistingApprovals,
    parseSkillMarkdown, serializeSkill, titleFromMeta, type SkillMeta,
} from '../services/learning/SkillMemoryService';
import { getMemoryFilesContext, substituteSkillContext } from '../services/learning/MemoryRetrievalService';
import { saveHarnessSettings } from '../utils/harnessSettings';

const USER = 'gate-user';
const SETUP = { coin: 'BTCUSDT', direction: 'Short', family: 'Family A', regime: 'ranging' };

/** A skill row in the exact shape the store holds. `extra` is the approval fact
 *  under test, spliced into the front matter. */
const skillFile = (name: string, extra = '', over: Record<string, string> = {}) => `---
status: ${over.status ?? 'confirmed'}
kind: ${over.kind ?? 'avoid'}
coin: BTCUSDT
direction: Short
family: Family A
wins: 3
losses: 1
tradeIds: a,b,c,d
${extra}ifCondition: BTC short into a rising 4h VWAP with funding flat
thenAction: skip the short and wait for the reclaim
modified: 2026-10-05T00:00:00.000Z
---

# ${name}

**My rule:** when BTC short into a rising 4h VWAP with funding flat, I skip the short and wait for the reclaim
`;

const plant = async (name: string, extra = '', over?: Record<string, string>) => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, `${name}.md`, skillFile(name, extra, over), USER, true);
};

const injects = (): string => getMemoryFilesContext(SETUP as never, [], 'analyst', 'opening');

beforeEach(async () => {
    store = {};
    localStorage.clear();
    await initMemoryFiles(USER);
});

describe('the predicate itself', () => {
    it('exists and reads the approval fact off the row', async () => {
        expect(typeof isApprovedSkill).toBe('function');
    });

    it('a row with NO approval fact is not approved', async () => {
        await plant('no-approval-row');
        const meta = readMeta('no-approval-row');
        expect(isApprovedSkill(meta)).toBe(false);
    });

    it('a supervisor approval is not a human approval', async () => {
        await plant('supervisor-row', 'approvedBy: supervisor\n');
        expect(isApprovedSkill(readMeta('supervisor-row'))).toBe(false);
    });

    it.each([['human'], ['grandfathered']])('"%s" is approval', async (source) => {
        await plant(`approved-${source}`, `approvedBy: ${source}\napprovedAt: 2026-10-05T00:00:00.000Z\n`);
        expect(isApprovedSkill(readMeta(`approved-${source}`))).toBe(true);
    });
});

describe('path 13 + 7 — hard veto weight, unapproved', () => {
    it('confirmedAvoidForSetup must NOT hand a veto to an unapproved skill', async () => {
        await plant('unapproved-veto');
        // Pre-gate, this row DOES come back (the audit's claim): enforcement reads
        // only `enabled` + not-retired, never an approval fact.
        expect(confirmedAvoidForSetup(SETUP)).toBeNull();
    });

    it('applyNotebookSkillsToAnalysis must not veto or cap an unapproved skill', async () => {
        await plant('unapproved-cap');
        const next = applyNotebookSkillsToAnalysis({
            coinName: 'BTCUSDT', direction: 'Short', confidence: 'High', probability: 82,
            detectedPatternFamily: 'Family A', riskVeto: undefined as string | undefined,
        });
        expect(next.riskVeto).toBeUndefined();
        // An unenforced analysis carries no notebook warnings array at all, so read
        // it as empty rather than assuming the field exists.
        expect((next as { validationWarnings?: string[] }).validationWarnings ?? []).toEqual([]);
    });

    it('a grandfathered skill keeps vetoing exactly as before', async () => {
        await plant('grandfathered-veto', 'approvedBy: grandfathered\napprovedAt: 2026-10-05T00:00:00.000Z\n');
        expect(confirmedAvoidForSetup(SETUP)).not.toBeNull();
        const next = applyNotebookSkillsToAnalysis({
            coinName: 'BTCUSDT', direction: 'Short', confidence: 'High', probability: 82,
            detectedPatternFamily: 'Family A', riskVeto: undefined as string | undefined,
        });
        expect((next as { validationWarnings?: string[] }).validationWarnings?.join(' ')).toMatch(/NOTEBOOK SKILL/);
    });
});

describe('paths 1-6, 12 — injection, unapproved', () => {
    it('an unapproved skill is not injected into the seat prompt', async () => {
        await plant('unapproved-injection', 'status: candidate\n');
        expect(injects()).not.toMatch(/rising 4h VWAP/);
        expect(substituteSkillContext('ANSWER_WITH_SKILL', {
            coin: 'BTCUSDT', direction: 'Short', family: 'Family A',
        } as never)).not.toMatch(/rising 4h VWAP/);
    });

    it('a grandfathered skill is still injected — the migration must not silence the app', async () => {
        await plant('grandfathered-injection', 'approvedBy: grandfathered\napprovedAt: 2026-10-05T00:00:00.000Z\n');
        expect(injects()).toMatch(/rising 4h VWAP/);
    });
});

describe('revocation', () => {
    it('clearing the approval fact deactivates a live skill without touching its text', async () => {
        await plant('revocable', 'approvedBy: human\napprovedAt: 2026-10-05T00:00:00.000Z\n');
        expect(confirmedAvoidForSetup(SETUP)).not.toBeNull();
        const before = skillBytes('revocable');
        expect(before).toContain('approvedBy: human');
        await revokeApproval('revocable');
        expect(confirmedAvoidForSetup(SETUP)).toBeNull();
        expect(injects()).not.toMatch(/rising 4h VWAP/);
        // The clause survives revocation: this is a gate, not a delete.
        const after = skillBytes('revocable');
        expect(after).toContain('rising 4h VWAP');
        expect(after).not.toContain('approvedBy: human');
    });
});

describe('the starter library', () => {
    it('book seeds are approved by the explicit toggle, and the toggle defaults ON', async () => {
        await plant('book-seed-row', 'prior: book\nstatus: candidate\n');
        expect(isApprovedSkill(readMeta('book-seed-row'))).toBe(true);
        setStarterLibrary(false);
        expect(isApprovedSkill(readMeta('book-seed-row'))).toBe(false);
        expect(injects()).not.toMatch(/rising 4h VWAP/);
    });
});

describe('the grandfather migration', () => {
    it('marks a pre-gate row and changes nothing else about the rule', async () => {
        await plant('pre-existing');
        const before = readMeta('pre-existing');
        const beforeBytes = skillBytes('pre-existing');
        const report = await grandfatherExistingApprovals(USER, '2026-10-05T09:00:00.000Z');
        expect(report.stamped).toBe(1);
        const after = readMeta('pre-existing');
        expect(skillBytes('pre-existing')).toContain('approvedBy: grandfathered');
        expect(skillBytes('pre-existing')).toContain('approvedAt: 2026-10-05T09:00:00.000Z');
        // Marks, does not rewrite: everything except the two inserted lines is the
        // same BYTES — the H1 heading, the prose rule line, the order of the fields.
        // (Re-serializing would have normalized the title and `evidenceCount`; the
        // migration inserts into the front matter instead, which is why this assert
        // is byte-level and still passes.)
        const withoutApproval = (s: string) => s.split('\n').filter(l => !l.startsWith('approved'));
        expect(withoutApproval(skillBytes('pre-existing')))
            .toEqual(withoutApproval(beforeBytes));
        for (const field of ['ifCondition', 'thenAction', 'status', 'kind', 'wins', 'losses', 'body', 'coin', 'direction', 'family'] as const) {
            expect(after[field]).toEqual(before[field]);
        }
    });

    it('is idempotent — a second pass finds nothing to stamp and rewrites nothing', async () => {
        await plant('pre-existing-2');
        await grandfatherExistingApprovals(USER, '2026-10-05T09:00:00.000Z');
        const once = skillBytes('pre-existing-2');
        const again = await grandfatherExistingApprovals(USER, '2026-11-01T00:00:00.000Z');
        expect(again.stamped).toBe(0);
        expect(again.alreadyMarked).toBe(1);
        expect(skillBytes('pre-existing-2')).toBe(once);
    });

    it('leaves the starter shelf to its toggle, and a supervisor row to the trader', async () => {
        await plant('book-row', 'prior: book\n');
        await plant('supervisor-row', 'approvedBy: supervisor\n');
        const report = await grandfatherExistingApprovals(USER);
        expect(report.stamped).toBe(0);
        expect(report.skipped).toBe(1);          // the book row
        expect(report.alreadyMarked).toBe(1);    // the supervisor row
        expect(skillBytes('book-row')).not.toContain('approvedBy:');
        expect(skillBytes('supervisor-row')).toContain('approvedBy: supervisor');
        // …and neither is approved: the shelf needs the toggle, the model row needs
        // a person.
        expect(isApprovedSkill(readMeta('supervisor-row'))).toBe(false);
    });

    it('after the pass the existing library still works exactly as before', async () => {
        await plant('legacy-veto');
        expect(confirmedAvoidForSetup(SETUP)).toBeNull();  // pre-migration: silent
        await grandfatherExistingApprovals(USER);
        expect(confirmedAvoidForSetup(SETUP)).not.toBeNull();
        expect(injects()).toMatch(/rising 4h VWAP/);
    });
});

// ─── local helpers over the real store ───────────────────────────────────────

const readMeta = (name: string): SkillMeta => {
    const file = getMemoryFiles().files.find(f => f.name === `${name}.md`)!;
    return parseSkillMarkdown(file.content)!;
};

const skillBytes = (name: string): string =>
    getMemoryFiles().files.find(f => f.name === `${name}.md`)?.content ?? '';

const revokeApproval = async (name: string): Promise<void> => {
    const file = getMemoryFiles().files.find(f => f.name === `${name}.md`)!;
    const meta = parseSkillMarkdown(file.content)!;
    meta.approvedBy = undefined;
    meta.approvedAt = undefined;
    await updateMemoryFile(file.id, { content: serializeSkill(meta, titleFromMeta(meta)) }, USER);
};

const setStarterLibrary = (on: boolean): void => {
    saveHarnessSettings({ starterLibraryEnabled: on });
};

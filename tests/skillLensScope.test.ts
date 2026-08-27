import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import {
    parseSkillMarkdown,
    serializeSkill,
    applyNotebookSkillsToAnalysis,
} from '../services/learning/SkillMemoryService';
import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
} from '../services/learning/MemoryFilesService';
import { AnalystRole, TradeOutcome } from '../types';
import type { LoggedTrade } from '../types';

const USERNAME = 'lens-scope-test';

const buildSkill = (overrides: Record<string, unknown>): string => {
    const fm: Record<string, string> = {
        status: 'confirmed',
        kind: 'avoid',
        coin: 'BTC',
        direction: 'Long',
        family: 'Family A',
        wins: '1',
        losses: '2',
        sample: '3',
        modified: '2026-08-01T00:00:00.000Z',
    };
    for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) continue;
        fm[k] = String(v);
    }
    const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `---\n${fmLines}\n---\n\nIF BTC long setup showing the Family A pattern THEN skip.`;
};

describe('SkillMeta.lensScope — round-trip', () => {
    it('defaults to "all" when the frontmatter omits lensScope', () => {
        const meta = parseSkillMarkdown(buildSkill({}));
        expect(meta).not.toBeNull();
        expect(meta!.lensScope ?? 'all').toBe('all');
    });

    it('reads lensScope: macro from frontmatter', () => {
        const meta = parseSkillMarkdown(buildSkill({ lensScope: 'macro' }));
        expect(meta!.lensScope).toBe('macro');
    });

    it('reads lensScope: risk from frontmatter', () => {
        const meta = parseSkillMarkdown(buildSkill({ lensScope: 'risk' }));
        expect(meta!.lensScope).toBe('risk');
    });

    it('falls back to "all" for unknown lensScope values', () => {
        const meta = parseSkillMarkdown(buildSkill({ lensScope: 'gibberish' }));
        expect(meta!.lensScope ?? 'all').toBe('all');
    });

    it('serializeSkill writes lensScope only when it is not "all"', () => {
        const meta = parseSkillMarkdown(buildSkill({ lensScope: 'technical' }))!;
        const out = serializeSkill(meta, 'BTC Long Family A');
        expect(out).toContain('lensScope: technical');

        const metaAll = parseSkillMarkdown(buildSkill({}))!;
        const outAll = serializeSkill(metaAll, 'BTC Long Family A');
        expect(outAll).not.toContain('lensScope:');
    });
});

describe('applyNotebookSkillsToAnalysis — lens filter', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    const seedAvoid = async (lensScope: 'all' | 'macro' | 'technical' | 'risk'): Promise<void> => {
        const skill = buildSkill({ lensScope });
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
        if (!folder) throw new Error('skills folder missing');
        await createMemoryFile(folder.id, `btc-long-family-a-${lensScope}.md`, skill, USERNAME, false);
    };

    const analysis = {
        coinName: 'BTC',
        direction: 'Long' as const,
        confidence: 'High' as const,
        detectedPatternFamily: 'Family A',
        validationWarnings: [] as string[],
    };

    it('without activeLens, the lens filter is permissive — every scope can match', async () => {
        await seedAvoid('risk');
        const out = applyNotebookSkillsToAnalysis(analysis);
        // No activeLens ⇒ filter is a no-op, skill vets as before.
        expect(out.validationWarnings?.some((w: string) => /NOTEBOOK SKILL VETO/.test(w))).toBe(true);
    });

    it('activeLens="macro" filters out a risk-scope avoid skill from vetoing', async () => {
        await seedAvoid('risk');
        const out = applyNotebookSkillsToAnalysis(analysis, { activeLens: AnalystRole.MACRO_VOLATILITY });
        // The risk-scope skill is dropped for the macro seat.
        expect(out.validationWarnings ?? []).toEqual([]);
    });

    it('activeLens="risk" lets a risk-scope skill veto the macro lens seat when the seat is risk', async () => {
        await seedAvoid('risk');
        const out = applyNotebookSkillsToAnalysis(analysis, { activeLens: AnalystRole.RISK_EXECUTION });
        expect(out.validationWarnings?.some((w: string) => /NOTEBOOK SKILL VETO/.test(w))).toBe(true);
    });

    it('an "all" lensScope skill is unaffected by activeLens', async () => {
        await seedAvoid('all');
        const out = applyNotebookSkillsToAnalysis(analysis, { activeLens: AnalystRole.TECHNICAL_ANALYST });
        expect(out.validationWarnings?.some((w: string) => /NOTEBOOK SKILL VETO/.test(w))).toBe(true);
    });

    it('a macro-scope skill does not veto the risk seat', async () => {
        await seedAvoid('macro');
        const out = applyNotebookSkillsToAnalysis(analysis, { activeLens: AnalystRole.RISK_EXECUTION });
        expect(out.validationWarnings ?? []).toEqual([]);
    });
});

// Reuse LoggedTrade type for completeness check
const _tradeShape: LoggedTrade = {
    id: 't',
    timestamp: '2026-08-01T00:00:00.000Z',
    outcome: TradeOutcome.LOSS,
    analysis: { coinName: 'BTC' } as any,
};
void _tradeShape;

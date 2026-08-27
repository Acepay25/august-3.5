import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Preferences layer so memory files + the regime ledger live in-memory.
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

import { AnalystRole } from '../types';
import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
} from '../services/learning/MemoryFilesService';
import {
    getMemoryFilesContext,
    lensSkillSupplementLine,
    type MemoryRetrievalQuery,
} from '../services/learning/MemoryRetrievalService';
import { appendLensMemoryLine, readLensMemory } from '../services/learning/lensMemory';
import { hydrateRegimeLedger, recordRegimeDay } from '../services/learning/regimeLedger';
import { buildDoctrinePrompt } from '../services/learning/DoctrineConsolidationService';

const USERNAME = 'lens-prompt-scope-test';

const buildSkill = (overrides: Record<string, unknown>): string => {
    const fm: Record<string, string> = {
        status: 'confirmed',
        kind: 'avoid',
        coin: 'BTC',
        direction: 'Long',
        family: 'Family A',
        wins: '3',
        losses: '1',
        sample: '4',
        modified: '2026-08-01T00:00:00.000Z',
    };
    for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) continue;
        fm[k] = String(v);
    }
    const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `---\n${fmLines}\n---\n\nIF BTC long setup showing the Family A pattern THEN skip.`;
};

const seedSkill = async (filename: string, overrides: Record<string, unknown>): Promise<void> => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) throw new Error('skills folder missing');
    await createMemoryFile(folder.id, filename, buildSkill(overrides), USERNAME, false);
};

const QUERY: MemoryRetrievalQuery = { coin: 'BTC', direction: 'Long', family: 'Family A' };

describe('prompt-side lensScope filter (getMemoryFilesContext)', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('without activeLens, a risk-scoped skill can occupy the shared slot', async () => {
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk' });
        const ctx = getMemoryFilesContext(QUERY, undefined, 'analyst', 'opening', { recordInjections: false });
        expect(ctx).toContain('btc-risk-rule.md');
    });

    it('activeLens="macro" keeps a risk-scoped skill out of the macro seat prompt', async () => {
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk' });
        const ctx = getMemoryFilesContext(QUERY, undefined, 'analyst', 'opening', {
            recordInjections: false,
            activeLens: AnalystRole.MACRO_VOLATILITY,
        });
        expect(ctx).not.toContain('btc-risk-rule.md');
    });

    it('activeLens="risk" lets a risk-scoped skill reach the risk seat', async () => {
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk' });
        const ctx = getMemoryFilesContext(QUERY, undefined, 'analyst', 'opening', {
            recordInjections: false,
            activeLens: AnalystRole.RISK_EXECUTION,
        });
        expect(ctx).toContain('btc-risk-rule.md');
    });

    it('an "all"-scope skill reaches every seat', async () => {
        await seedSkill('btc-global-rule.md', {});
        for (const lens of [AnalystRole.MACRO_VOLATILITY, AnalystRole.TECHNICAL_ANALYST, AnalystRole.RISK_EXECUTION]) {
            const ctx = getMemoryFilesContext(QUERY, undefined, 'analyst', 'opening', {
                recordInjections: false,
                activeLens: lens,
            });
            expect(ctx).toContain('btc-global-rule.md');
        }
    });

    it('a blocked best-match surfaces the next in-scope skill, not an empty slot', async () => {
        // risk skill has MORE evidence → it is the global best; macro skill is runner-up.
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk', wins: '9', losses: '1', sample: '10' });
        await seedSkill('btc-macro-rule.md', { lensScope: 'macro', wins: '2', losses: '1', sample: '3' });
        const ctx = getMemoryFilesContext(QUERY, undefined, 'analyst', 'opening', {
            recordInjections: false,
            activeLens: AnalystRole.MACRO_VOLATILITY,
        });
        expect(ctx).not.toContain('btc-risk-rule.md');
        expect(ctx).toContain('btc-macro-rule.md');
    });
});

describe('lensSkillSupplementLine', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('returns "" when the lens best equals the global best', async () => {
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk' });
        expect(lensSkillSupplementLine(QUERY, AnalystRole.RISK_EXECUTION)).toBe('');
    });

    it('surfaces the in-scope skill when an out-of-scope skill is the global best', async () => {
        await seedSkill('btc-risk-rule.md', { lensScope: 'risk', wins: '9', losses: '1', sample: '10' });
        await seedSkill('btc-macro-rule.md', { lensScope: 'macro', wins: '2', losses: '1', sample: '3' });
        const line = lensSkillSupplementLine(QUERY, AnalystRole.MACRO_VOLATILITY);
        expect(line).toContain('btc-macro-rule.md');
        expect(line).not.toContain('btc-risk-rule.md');
    });

    it('returns "" when no skill matches the setup', async () => {
        expect(lensSkillSupplementLine({ coin: 'DOGE' }, AnalystRole.MACRO_VOLATILITY)).toBe('');
    });
});

describe('appendLensMemoryLine persistence', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('persists the appended line to Preferences, not just the in-memory cache', async () => {
        await appendLensMemoryLine(AnalystRole.MACRO_VOLATILITY, 'BTC 4H regime flipped to ranging', USERNAME);
        // The notebook blob must contain the line — a cache-only mutation would
        // never reach the store and would be lost on next load.
        const blobKey = `memory_files_v1_${USERNAME}`;
        const blob = store[blobKey] as { files?: Array<{ name: string; content: string }> } | undefined;
        expect(blob).toBeTruthy();
        const macroFile = blob?.files?.find(f => f.name === 'macro.md');
        expect(macroFile).toBeTruthy();
        expect(macroFile!.content).toContain('BTC 4H regime flipped to ranging');
        // And the sync read agrees.
        expect(readLensMemory(AnalystRole.MACRO_VOLATILITY)).toContain('BTC 4H regime flipped to ranging');
    });

    it('keeps the file bounded to the newest MAX_LENS_MEMORY_LINES bullets', async () => {
        for (let i = 0; i < 50; i++) {
            await appendLensMemoryLine(AnalystRole.RISK_EXECUTION, `risk note ${i}`, USERNAME);
        }
        const content = readLensMemory(AnalystRole.RISK_EXECUTION);
        const bullets = content.split('\n').filter(l => l.startsWith('- '));
        expect(bullets.length).toBeLessThanOrEqual(40);
        // Newest survives, oldest is evicted.
        expect(content).toContain('risk note 49');
        expect(content).not.toContain('risk note 0 ');
    });
});

describe('buildDoctrinePrompt reads per-lens memory + regime ledger', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
        await hydrateRegimeLedger(USERNAME);
    });

    it('includes the lens-memory and regime sections when provided', () => {
        const prompt = buildDoctrinePrompt([], '', {
            lensMemory: '- macro: Ranging follow-through has failed 4 of 5 times',
            regimeLines: '- BTC: ranging now (day 3) · 10d observed · ranging 80% / trending 20%',
        });
        expect(prompt).toContain('PER-LENS MEMORY');
        expect(prompt).toContain('Ranging follow-through has failed 4 of 5 times');
        expect(prompt).toContain('REGIME LEDGER');
        expect(prompt).toContain('BTC: ranging now (day 3)');
    });

    it('omits both sections when the extras are empty', () => {
        const prompt = buildDoctrinePrompt([], '', { lensMemory: '', regimeLines: '' });
        expect(prompt).not.toContain('PER-LENS MEMORY');
        expect(prompt).not.toContain('REGIME LEDGER');
    });
});

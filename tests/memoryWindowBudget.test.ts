import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The stage budget scales with the model's REAL context window
 * (`stageBudgetChars(stage, contextWindowTokens)`), but the production call
 * sites used to pass nothing — the window parameter existed, was tested at
 * the unit level, and never reached prompt assembly. These tests pin both
 * halves of the fix:
 *   1. BEHAVIOR — a small window yields a strictly smaller notebook slice
 *      that reports its elision (clipNote), not a silent trim;
 *   2. WIRING — assemblePipelineMemoryContext threads the value to every
 *      notebook slice it builds (opening + verdict + rebuttal).
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    // The notebook init reads the RAW value so it can tell "no key" apart
    // from "unparseable blob" — the store holds parsed objects, so stringify
    // on the way out (same contract as tests/memoryFilesService.test.ts).
    getPreference: vi.fn(async (key: string) => {
        const v = store[key];
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? v : JSON.stringify(v);
    }),
    setPreference: vi.fn(async (key: string, value: string) => {
        store[key] = value;
    }),
    hasPreference: vi.fn(async (key: string) => store[key] !== undefined && store[key] !== null),
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

// Wrap — don't replace — so behavior stays real while the pipeline wiring
// becomes observable (memoryContext's imports resolve through this module).
vi.mock('../services/learning/MemoryRetrievalService', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../services/learning/MemoryRetrievalService')>();
    return { ...mod, getMemoryFilesContext: vi.fn(mod.getMemoryFilesContext) };
});

import { initMemoryFiles, getMemoryFiles, createMemoryFile, updateMemoryFile } from '../services/learning/MemoryFilesService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import { assemblePipelineMemoryContext } from '../hooks/analysisPipeline/memoryContext';
import { findClipIn } from '../utils/harnessMarks';
import type { MemoryRetrievalQuery } from '../services/learning/MemoryRetrievalService';
import type { LoggedTrade, TradeAnalysis } from '../types';
import { TradeOutcome } from '../types';

const USER = 'window-budget-user';

const QUERY: MemoryRetrievalQuery = {
    coin: 'BTCUSDT',
    direction: 'Short',
    family: 'Family A',
};

const makeTrade = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    timestamp: '2026-08-09T12:00:00.000Z',
});

/** Fill the verdict stage's block classes — a long skill body (capped at
 *  SKILL_BLOCK_MAX), two Top-K runner-up index lines, and a full risk-rules
 *  excerpt — so total content sits between the small-window budget (800)
 *  and the default one (2400): the narrow slice MUST elide, the wide one
 *  keeps everything. */
const seedContent = async (): Promise<void> => {
    const folders = getMemoryFiles().folders;
    const skills = folders.find(f => f.name === 'skills')!;
    const skillFrontmatter = `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 3
losses: 2
tradeIds: a,b,c,d,e
---
`;
    await createMemoryFile(skills.id, 'btc-short-familya-avoid.md', `${skillFrontmatter}
# Avoid BTCUSDT Short Family A

**Procedure:** ${'Wait for the reclaim candle to close above the range low before doing anything at all. '.repeat(5)}
`, USER, true);
    // Two more IN-SCOPE skills: the verdict stage renders runners-up as index
    // lines (Top-K), which is what pushes total content comfortably between
    // the narrow budget (800) and the default one (2400) — so the narrow
    // slice's elision genuinely outweighs its own clip note, and the wide
    // slice keeps everything.
    await createMemoryFile(skills.id, 'btc-short-familya-repeat.md', `${skillFrontmatter}
# Repeat BTCUSDT Short Family A

**Procedure:** Log the session plan before entry and never widen the stop mid-trade.
`, USER, true);
    await createMemoryFile(skills.id, 'btc-short-familya-caution.md', `${skillFrontmatter}
# Caution BTCUSDT Short Family A

**Procedure:** Skip the setup entirely when funding is pinned against the direction.
`, USER, true);
    const rules = getMemoryFiles().files.find(f => f.name === 'risk-rules.md')!;
    await updateMemoryFile(rules.id, {
        content: `- ${'Never risk more than one percent; size every position from the stop distance alone. '.repeat(4)}`,
    }, USER);
};

describe('context-window-scaled memory budget', () => {
    beforeEach(async () => {
        store = {};
        vi.mocked(getMemoryFilesContext).mockClear();
        await initMemoryFiles(USER);
    });

    it('slices the notebook to the window and reports what it elided', async () => {
        await seedContent();
        const trades = [makeTrade('t1'), makeTrade('t2'), makeTrade('t3')];

        const wide = getMemoryFilesContext(QUERY, trades, 'analyst', 'verdict', { recordInjections: false });
        const narrow = getMemoryFilesContext(QUERY, trades, 'analyst', 'verdict', {
            recordInjections: false,
            contextWindowTokens: 8_192,
        });

        // Strictly smaller: the small window dropped blocks the default kept.
        expect(narrow.length).toBeLessThan(wide.length);
        // The elision is REPORTED, not silent — absent content must read as
        // "not injected this stage", never as "no lesson exists".
        expect(findClipIn(narrow)).not.toBeNull();
        // Priority order holds: the matched skill is pushed before the tail
        // blocks, so the narrow slice still carries it.
        expect(narrow).toContain('btc-short-familya-avoid');
    });

    it('threads the window through assemblePipelineMemoryContext to every slice', async () => {
        const spy = vi.mocked(getMemoryFilesContext);
        spy.mockClear();

        assemblePipelineMemoryContext('BTCUSDT Short Family A setup watch', [], null, undefined, undefined, 8_192);

        // Opening + verdict + rebuttal — all three notebook slices.
        expect(spy.mock.calls).toHaveLength(3);
        for (const call of spy.mock.calls) {
            expect(call[4]).toMatchObject({ contextWindowTokens: 8_192 });
        }

        // And omitted ⇒ no option churn: callers that predate the field keep
        // their byte-identical default behavior.
        spy.mockClear();
        assemblePipelineMemoryContext('BTCUSDT Short Family A setup watch', [], null);
        for (const call of spy.mock.calls) {
            expect((call[4] as { contextWindowTokens?: number } | undefined)?.contextWindowTokens).toBeUndefined();
        }
    });
});

/**
 * lensMemoryRecord — the writer the lens files never had.
 *
 * The audit's finding was that the lens files were READ and injected into every
 * Lens seat (AnalystLensService) and folded into the doctrine rewrite, while
 * `appendLensMemoryLine` had ZERO production callers — so the "MY LENS MEMORY"
 * block was permanently empty, and the tests that appeared to cover it called
 * the writer directly.
 *
 * These tests pin the two halves of that gap:
 *   1. the CONTENT — what a seat's line says, and what it must never contain;
 *   2. the ROUND TRIP — a closed trade actually leaves text a seat can read
 *      back, which is the specific thing that was broken.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Preferences runs in-memory so initMemoryFiles + the writer exercise the real
// notebook path rather than a stub.
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import { lensLinesForTrade, recordLensMemoryFromTrade } from '../services/learning/lensMemoryRecord';
import { readLensMemory, summarizeLensMemory } from '../services/learning/lensMemory';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { AnalystRole, TradeOutcome } from '../types';
import type { TradeAnalysis } from '../types/analysis';

const USERNAME = 'trader';

const analysis = (over: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'Medium',
    probability: 60,
    strategy: 'reclaim',
    entryPoints: [{ price: '100000' }],
    stopLoss: '98000',
    takeProfit: [{ price: '105000' }],
    rrRatio: 2.5,
    marketConditions: { prices: {} } as never,
    createdAt: new Date().toISOString(),
    keyLevels: { support: [], resistance: [] },
    detectedPatterns: [],
    validationWarnings: [],
    ...over,
} as unknown as TradeAnalysis);

describe('lens memory line content', () => {
    it('gives the technical seat the plan shape and how it closed', () => {
        const lines = lensLinesForTrade({ analysis: analysis(), outcome: 'WIN', username: USERNAME });
        const tech = lines.find(l => l.role === AnalystRole.TECHNICAL_ANALYST);
        expect(tech).toBeDefined();
        expect(tech!.line).toContain('BTC');
        expect(tech!.line).toContain('long');
        expect(tech!.line).toContain('WIN');
    });

    it('gives the risk seat the planned risk, not the realized one', () => {
        const lines = lensLinesForTrade({ analysis: analysis(), outcome: 'LOSS', username: USERNAME });
        const risk = lines.find(l => l.role === AnalystRole.RISK_EXECUTION);
        expect(risk).toBeDefined();
        // Planned R:R is the quote the trader acted on. The realized ratio is
        // a different question and lives in the journal.
        expect(risk!.line).toContain('2.5:1');
        expect(risk!.line).toContain('LOSS');
    });

    it('records a veto for the risk seat rather than a size', () => {
        const lines = lensLinesForTrade({
            analysis: analysis(), outcome: 'LOSS', username: USERNAME,
            riskVeto: 'GATE VETO: insufficient data',
        });
        const risk = lines.find(l => l.role === AnalystRole.RISK_EXECUTION)!;
        expect(risk.line).toContain('vetoed');
        expect(risk.line).toContain('GATE VETO');
    });

    it('only writes the macro line when a regime was actually known', () => {
        expect(lensLinesForTrade({ analysis: analysis(), outcome: 'WIN', username: USERNAME })
            .some(l => l.role === AnalystRole.MACRO_VOLATILITY)).toBe(false);
        expect(lensLinesForTrade({ analysis: analysis(), outcome: 'WIN', username: USERNAME, regime: 'ranging' })
            .some(l => l.role === AnalystRole.MACRO_VOLATILITY)).toBe(true);
    });

    it('flags it when the tape disagreed with the stated outcome', () => {
        const lines = lensLinesForTrade({
            analysis: analysis(), outcome: 'LOSS', username: USERNAME, tapeAgreed: false,
        });
        expect(lines.some(l => l.line.includes('tape disagreed'))).toBe(true);
    });

    it('writes nothing for a trade with no analysis', () => {
        expect(lensLinesForTrade({ analysis: undefined, outcome: 'WIN', username: USERNAME })).toEqual([]);
    });

    it('never pastes model prose into a seat record', () => {
        // A line must be facts the seat can act on. Copying the report in would
        // bloat every future injection with text the seat cannot use.
        const lines = lensLinesForTrade({ analysis: analysis(), outcome: 'WIN', username: USERNAME });
        for (const l of lines) {
            expect(l.line.length).toBeLessThan(200);
            expect(l.line).not.toContain('undefined');
            expect(l.line).not.toContain('NaN');
        }
    });
});

describe('lens memory round trip', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('a closed trade leaves a line the seat can actually read back', async () => {
        // The exact thing the audit found broken: the files were read and
        // injected but never written, so this could only be made true by
        // calling the writer by hand.
        const trade = { outcome: TradeOutcome.WIN, analysis: analysis() };
        await recordLensMemoryFromTrade(trade, { username: USERNAME, regime: 'trending' });

        expect(readLensMemory(AnalystRole.TECHNICAL_ANALYST)).toContain('BTC');
        expect(readLensMemory(AnalystRole.MACRO_VOLATILITY)).toContain('trending');
        // ...and the block the seat is actually shown is no longer empty.
        expect(summarizeLensMemory(AnalystRole.TECHNICAL_ANALYST)).not.toBe('');
    });

    it('two closed trades read back as two lines, not a merge', async () => {
        await recordLensMemoryFromTrade(
            { outcome: TradeOutcome.WIN, analysis: analysis({ coinName: 'BTCUSDT' }) },
            { username: USERNAME },
        );
        await recordLensMemoryFromTrade(
            { outcome: TradeOutcome.LOSS, analysis: analysis({ coinName: 'ETHUSDT' }) },
            { username: USERNAME },
        );
        const technical = readLensMemory(AnalystRole.TECHNICAL_ANALYST);
        expect(technical).toContain('BTC');
        expect(technical).toContain('ETH');
    });

    it('one closed trade is a bounded number of lines — not one per seat-turn', async () => {
        // A file that grows per RUN becomes noise the seat learns to skim,
        // which is worse than an empty one. The bound is per closed trade.
        await recordLensMemoryFromTrade(
            { outcome: TradeOutcome.WIN, analysis: analysis() },
            { username: USERNAME, regime: 'ranging' },
        );
        const lines = readLensMemory(AnalystRole.TECHNICAL_ANALYST)
            .split('\n').filter(l => l.startsWith('- '));
        expect(lines).toHaveLength(1);
    });
});

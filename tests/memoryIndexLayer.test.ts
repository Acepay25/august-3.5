import { describe, it, expect } from 'vitest';

// Index-layer memory injection (Batch 5 remainder, plan §4.7): the prompt
// gets a compact INDEX of GlobalMemory instead of the JSON dump, with
// familyPerformance staying injected verbatim (six-phase constraint).

import { buildGlobalMemoryIndex, constructOptimizedContext } from '../utils/memoryUtils';
import { GlobalMemory } from '../types';

const mem = (over: Partial<GlobalMemory> = {}): GlobalMemory => ({
    totalTradesAnalyzed: 42,
    familyPerformance: { 'Family A': '62% WR (31/50)', 'Family B': '48% WR (12/25)' },
    aiPatternMemory: [],
    userPreferences: { leverageDefault: 10, favoriteAssets: ['BTC', 'ETH'], preferredSetup: 'sweep-reclaim' },
    globalCorrections: [],
    lastUpdated: new Date().toISOString(),
    ...over,
});

describe('buildGlobalMemoryIndex', () => {
    it('keeps familyPerformance injected verbatim', () => {
        const idx = buildGlobalMemoryIndex(mem());
        expect(idx).toContain('Family A: 62% WR (31/50)');
        expect(idx).toContain('Family B: 48% WR (12/25)');
    });
    it('indexes list sections newest-first with a cap, not the whole wall', () => {
        const patterns = Array.from({ length: 10 }, (_, i) => `pattern ${i}`);
        const idx = buildGlobalMemoryIndex(mem({ aiPatternMemory: patterns }));
        expect(idx).toContain('newest 5 of 10');
        expect(idx).toContain('pattern 0');
        expect(idx).not.toContain('pattern 9');
    });
    it('indexes the insight KB as top-5 one-liners by use count', () => {
        const insights = Array.from({ length: 8 }, (_, i) => ({
            id: `i${i}`, category: 'general' as const, insight: `insight ${i} text`,
            sourceTradeId: 't', createdAt: new Date().toISOString(), useCount: i,
        }));
        const idx = buildGlobalMemoryIndex(mem({ insightKnowledgeBase: { insights, lastUpdated: '' } }));
        expect(idx).toContain('top 5 of 8');
        expect(idx).toContain('insight 7 text'); // highest useCount
        expect(idx).not.toContain('insight 0 text'); // lowest, cut
        expect(idx).not.toContain('"useCount"'); // no JSON dump
    });
    it('stays under the index char cap', () => {
        const fat = mem({
            aiPatternMemory: Array.from({ length: 10 }, () => 'x'.repeat(200)),
            globalCorrections: Array.from({ length: 10 }, () => 'y'.repeat(200)),
        });
        expect(buildGlobalMemoryIndex(fat).length).toBeLessThanOrEqual(905); // 900 + ellipsis line
    });
    it('empty memory yields a one-line empty index', () => {
        const idx = buildGlobalMemoryIndex({
            ...mem({ familyPerformance: {} }),
            userPreferences: { leverageDefault: 0, favoriteAssets: [], preferredSetup: '' },
        });
        expect(idx).toContain('empty');
    });
});

describe('constructOptimizedContext (index layer)', () => {
    it('injects the INDEX, never the raw JSON dump', () => {
        const ctx = constructOptimizedContext([], undefined, mem({
            aiPatternMemory: ['sweep then reclaim in london'],
        }));
        expect(ctx).toContain('GLOBAL MEMORY INDEX');
        expect(ctx).toContain('sweep then reclaim in london');
        expect(ctx).toContain('Family A: 62% WR (31/50)');
        expect(ctx).not.toContain('"totalTradesAnalyzed"'); // no JSON.stringify dump
        expect(ctx).not.toContain('"lastUpdated"');
    });
    it('undefined memory keeps the honest empty line', () => {
        const ctx = constructOptimizedContext([], undefined, undefined);
        expect(ctx).toContain('No global memory initialized yet');
    });
});

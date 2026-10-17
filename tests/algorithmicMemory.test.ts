import { describe, it, expect } from 'vitest';

/**
 * Two stores held the same detector output, so one lesson reached the prompt
 * twice — the legacy `aiPatternMemory` string list and
 * `insightKnowledgeBase.insights` (docs/learning-loop-map.md asymmetry #2).
 * The string-list write was deleted then; the KB write goes with the
 * post-mortem, because every detector was a keyword scan of
 * `trade.postMortem` and nothing writes that field any more.
 *
 * So BOTH stores are now frozen, and what these tests pin is that freezing a
 * store must not rewrite a profile's history:
 *   1. a fresh memory never gains either list;
 *   2. entries a stored profile already carries survive byte-identical —
 *      including `insightKnowledgeBase`, whose empty shell this service still
 *      initializes;
 *   3. the index renders the KB and nothing else — never the legacy list, and
 *      never the same lesson twice.
 */

import { updateGlobalMemoryAlgorithmically } from '../services/learning/AlgorithmicMemoryService';
import { buildGlobalMemoryIndex } from '../utils/memoryUtils';
import type { GlobalMemory, LoggedTrade, TradeAnalysis, TradeInsight } from '../types';
import { TradeOutcome } from '../types';

const LEGACY = ['⚠️ RECURRING MISTAKE: old duplicate lesson (3 occurrences in recent batch)'];

/** A lesson as the deleted detector used to write it: `useCount` was the
 *  occurrence count at distillation time, and the index labels it
 *  "pattern strength" precisely because nothing increments it afterwards. */
const lesson: TradeInsight = {
    id: 'ins-1',
    category: 'entry_timing',
    insight: 'Late entry after move started',
    sourceTradeId: 't0',
    createdAt: '2026-08-01T00:00:00.000Z',
    useCount: 5,
};

const loss = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    timestamp: '2026-08-09T12:00:00.000Z',
});

const baseMemory = (): GlobalMemory => ({
    totalTradesAnalyzed: 10,
    familyPerformance: {},
    aiPatternMemory: [...LEGACY],
    userPreferences: { leverageDefault: 0, favoriteAssets: [], preferredSetup: '' },
    globalCorrections: [],
    lastUpdated: new Date().toISOString(),
});

const storedKb = (): GlobalMemory => ({
    ...baseMemory(),
    insightKnowledgeBase: { insights: [lesson], lastUpdated: '2026-08-01T00:00:00.000Z' },
});

describe('the memory pass freezes both lesson stores', () => {
    const losses = Array.from({ length: 5 }, (_, i) => loss(`t${i}`));

    it('never grows the legacy string list on a fresh memory', () => {
        const out = updateGlobalMemoryAlgorithmically(losses);
        expect(out.aiPatternMemory).toEqual([]);
    });

    it('leaves a STORED legacy list byte-identical — freezing a store rewrites nothing', () => {
        const out = updateGlobalMemoryAlgorithmically(losses, baseMemory());
        expect(out.aiPatternMemory).toEqual(LEGACY);
    });

    it('never grows the insight KB, even though the batch is 5 identical losses', () => {
        const out = updateGlobalMemoryAlgorithmically(losses);
        expect(out.insightKnowledgeBase?.insights ?? []).toEqual([]);
    });

    it('leaves a STORED insight KB byte-identical', () => {
        const out = updateGlobalMemoryAlgorithmically(losses, storedKb());
        expect(out.insightKnowledgeBase?.insights).toEqual([lesson]);
    });

    it('still counts the batch into the stats it does own', () => {
        const out = updateGlobalMemoryAlgorithmically(losses, storedKb());
        expect(out.totalTradesAnalyzed).toBe(15);
        expect(out.familyPerformance['Family A']).toBe('0% WR (0/5)');
    });

    it('the index renders the KB alone — never the legacy list, never twice', () => {
        const idx = buildGlobalMemoryIndex(updateGlobalMemoryAlgorithmically(losses, storedKb()));
        expect(idx).not.toContain('PATTERN MEMORY');
        expect(idx).not.toContain('old duplicate lesson');
        expect(idx).toContain('Late entry after move started');
        expect(idx.match(/Late entry after move started/g)).toHaveLength(1);
    });
});

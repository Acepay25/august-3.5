import { describe, it, expect } from 'vitest';

/**
 * E3 — the legacy `aiPatternMemory` string list was a SECOND store for the
 * same detector output that already feeds `insightKnowledgeBase.insights`,
 * so one lesson reached the prompt twice
 * (docs/learning-loop-map.md asymmetry #2, closed here). The write and the
 * index section are gone. These tests pin the three halves of that removal:
 *   1. a fresh memory never gains the string list;
 *   2. a STORED legacy list is left byte-identical — removing a store may
 *      not retract history that a stored profile already carries;
 *   3. the insight KB still grows from the same detector, and it — alone —
 *      is what the index renders.
 */

import { updateGlobalMemoryAlgorithmically } from '../services/learning/AlgorithmicMemoryService';
import { buildGlobalMemoryIndex } from '../utils/memoryUtils';
import type { GlobalMemory, LoggedTrade, TradeAnalysis } from '../types';
import { TradeOutcome } from '../types';

const LEGACY = ['⚠️ RECURRING MISTAKE: old duplicate lesson (3 occurrences in recent batch)'];

/** Post-mortem containing ONLY the 'chased' trigger: it fires the one
 *  detector `Late entry after move started` and none of the other eight
 *  (no 'early', 'stop', 'weak', 'moved stop'… substrings), so five of these
 *  losses yield exactly one recurring mistake at 5 occurrences. */
const chasedLoss = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Short',
        detectedPatternFamily: 'Family A',
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    postMortem: 'Chased the breakdown entry after it printed.',
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

describe('aiPatternMemory is frozen — the insight KB is the one store', () => {
    const losses = Array.from({ length: 5 }, (_, i) => chasedLoss(`t${i}`));

    it('never grows the legacy string list on a fresh memory', () => {
        const out = updateGlobalMemoryAlgorithmically(losses);
        expect(out.aiPatternMemory).toEqual([]);
    });

    it('leaves a STORED legacy list byte-identical — removal rewrites nothing', () => {
        const out = updateGlobalMemoryAlgorithmically(losses, baseMemory());
        expect(out.aiPatternMemory).toEqual(LEGACY);
    });

    it('the same detector still grows the insight KB, which the index alone renders', () => {
        const out = updateGlobalMemoryAlgorithmically(losses, baseMemory());
        const insights = out.insightKnowledgeBase?.insights ?? [];
        expect(insights).toHaveLength(1);
        expect(insights[0].insight).toBe('Late entry after move started');
        expect(insights[0].category).toBe('entry_timing');
        expect(insights[0].useCount).toBe(5); // occurrences, not a use counter

        // The index renders the insight, never the legacy list — and it does
        // not show the SAME lesson twice under two headings.
        const idx = buildGlobalMemoryIndex(out);
        expect(idx).not.toContain('PATTERN MEMORY');
        expect(idx).not.toContain('old duplicate lesson');
        expect(idx).toContain('Late entry after move started');
    });
});

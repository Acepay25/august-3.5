import { describe, it, expect, beforeEach } from 'vitest';
import { buildDecisionReflectionContext } from '../services/learning/DecisionReflectionService';
import { findRelevantTrades } from '../services/learning/PatternMemorySynthesisService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import {
    initMemoryFiles,
    createMemoryFile,
    getMemoryFiles,
} from '../services/learning/MemoryFilesService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import type { LoggedTrade, TradeAnalysis, TradeOutcome } from '../types';

const day = 86_400_000;
const NOW = () => Date.now();

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis,
    outcome: 'LOSS' as TradeOutcome,
    timestamp: new Date().toISOString(),
    postMortem: '**Key Lesson:** default lesson',
    ...overrides,
} as LoggedTrade);

describe('point-in-time lesson gating (backtests must not learn from the future)', () => {
    it('DecisionReflection excludes lessons written after the cutoff', () => {
        const oldLesson = makeTrade({
            id: 'known',
            timestamp: new Date(NOW() - 30 * day).toISOString(),
            postMortemCreatedAt: new Date(NOW() - 30 * day).toISOString(),
            postMortem: '**Key Lesson:** the known lesson ZEBRA',
        });
        const futureLesson = makeTrade({
            id: 'future',
            timestamp: new Date(NOW() - 2 * day).toISOString(),
            // Trade logged before the cutoff, but its post-mortem was written after it.
            postMortemCreatedAt: new Date(NOW() + 1 * day).toISOString(),
            postMortem: '**Key Lesson:** a lesson the future wrote OWL',
        });
        const trades = [oldLesson, futureLesson];
        const live = buildDecisionReflectionContext(trades, 'BTCUSDT');
        expect(live).toContain('ZEBRA');
        expect(live).toContain('OWL');

        const replay = buildDecisionReflectionContext(trades, 'BTCUSDT', NOW());
        expect(replay).toContain('ZEBRA');
        expect(replay).not.toContain('OWL');
    });

    it('DecisionReflection falls back to trade timestamp without a lesson date', () => {
        const before = makeTrade({
            id: 'before', timestamp: new Date(NOW() - 10 * day).toISOString(),
            postMortem: '**Key Lesson:** BEFORE-MARK', postMortemCreatedAt: undefined,
        });
        const after = makeTrade({
            id: 'after', timestamp: new Date(NOW() - 1 * day).toISOString(),
            postMortem: '**Key Lesson:** AFTER-MARK', postMortemCreatedAt: undefined,
        });
        const replay = buildDecisionReflectionContext([before, after], 'BTCUSDT', NOW() - 5 * day);
        expect(replay).toContain('BEFORE-MARK');
        expect(replay).not.toContain('AFTER-MARK');
    });

    it('findRelevantTrades hides trades logged after the cutoff and ages decay from it', () => {
        const before = makeTrade({ id: 'b', timestamp: new Date(NOW() - 20 * day).toISOString(), postMortem: 'B-LESSON' });
        const after = makeTrade({ id: 'a', timestamp: new Date(NOW() - 1 * day).toISOString(), postMortem: 'A-LESSON' });
        const setup = { coin: 'BTC', direction: 'Short' as const };

        const live = findRelevantTrades(setup, [before, after]);
        expect(live.map(r => r.tradeId)).toContain('a');
        expect(live.map(r => r.tradeId)).toContain('b');

        const replay = findRelevantTrades(setup, [before, after], { cutoffMs: NOW() - 10 * day });
        expect(replay.map(r => r.tradeId)).toEqual(['b']);
        // Age reference is the cutoff, not now: 20 days before cutoff ≈ 10
        // days of decay, not 20.
        const decayed = findRelevantTrades(setup, [before], { decayByAge: true, cutoffMs: NOW() });
        const replayDecayed = findRelevantTrades(setup, [before], { decayByAge: true, cutoffMs: NOW() + 365 * day });
        expect(replayDecayed[0].similarity).toBeLessThan(decayed[0].similarity);
    });

    it('backtestSimilarSetups only counts trades logged by the cutoff', () => {
        const current = { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as TradeAnalysis;
        const mk = (id: string, daysAgo: number) => makeTrade({
            id,
            outcome: 'WIN' as TradeOutcome,
            timestamp: new Date(NOW() - daysAgo * day).toISOString(),
        });
        const trades = [mk('old1', 40), mk('old2', 39), mk('future1', 1)];
        const live = backtestSimilarSetups(current, trades);
        expect(live.totalMatches).toBeGreaterThanOrEqual(2);
        const replay = backtestSimilarSetups(current, trades, undefined, { asOfMs: NOW() - 10 * day });
        expect(replay.matchedTrades.every(m => m.tradeId !== 'future1')).toBe(true);
    });

    it('skill injection honors creation date and status-ledger replay', async () => {
        await initMemoryFiles('pit-user');
        const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        const born = NOW();
        // Two eras: candidate at birth → confirmed two days later (future).
        const history = JSON.stringify([
            { status: 'candidate', validFrom: new Date(born).toISOString(), invalidAt: new Date(born + 2 * day).toISOString() },
            { status: 'confirmed', validFrom: new Date(born + 2 * day).toISOString() },
        ]);
        await createMemoryFile(skills.id, 'pit-skill.md', `---
status: confirmed
kind: repeat
coin: BTCUSDT
direction: Short
family: Family A
wins: 5
losses: 2
ifCondition: BTC short setup in Family A
thenAction: ride it
modified: ${new Date(born).toISOString()}
history: ${history}
---

# PIT skill body MARKER-PIT

**When:** \${SYMBOL} short in Family A
**What I do:** ride the reclaim.
`, 'pit-user', true);

        const query = { coin: 'BTCUSDT', direction: 'Short' as const, family: 'Family A' };
        const liveCtx = getMemoryFilesContext(query, [], 'analyst', 'opening', {});
        expect(liveCtx).toContain('pit-skill.md');

        // Before the skill existed → invisible.
        const preHistory = getMemoryFilesContext(query, [], 'analyst', 'opening', { asOfMs: born - 10 * day });
        expect(preHistory).not.toContain('pit-skill.md');

        // Inside the candidate era → visible and the header carries the
        // REPLAYED status (candidate), not today's confirmed.
        const replay = getMemoryFilesContext(query, [], 'analyst', 'opening', { asOfMs: born + 1 * day });
        expect(replay).toContain('pit-skill.md');
        expect(replay).toContain('· candidate ·');
        expect(replay).not.toContain('· confirmed ·');
    });
});

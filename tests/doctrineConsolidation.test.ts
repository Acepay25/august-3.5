import { describe, it, expect } from 'vitest';
import { shouldConsolidateDoctrine, buildDoctrinePrompt } from '../services/learning/DoctrineConsolidationService';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { LoggedTrade, TradeOutcome, TradeAnalysis } from '../types';

const trade = (i: number, outcome: TradeOutcome): LoggedTrade => ({
    id: `t${i}`,
    timestamp: new Date(Date.UTC(2026, 7, i + 1)).toISOString(),
    outcome,
    analysis: {
        coinName: 'BTC',
        direction: 'Long',
    } as TradeAnalysis,
});

describe('shouldConsolidateDoctrine', () => {
    it('returns false below the evidence threshold', async () => {
        await initMemoryFiles('doctrine-test');
        const trades = Array.from({ length: 5 }, (_, i) => trade(i, TradeOutcome.WIN));
        expect(shouldConsolidateDoctrine(trades)).toBe(false);
    });

    it('returns true at the threshold when no doctrine exists yet', async () => {
        await initMemoryFiles('doctrine-test-2');
        const trades = Array.from({ length: 15 }, (_, i) => trade(i, i % 3 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN));
        // No doctrine file exists → lastCount = 0 → closed(10) - 0 >= 10.
        expect(shouldConsolidateDoctrine(trades)).toBe(true);
    });
});

describe('buildDoctrinePrompt', () => {
    it('includes recent trades and current doctrine in first-person framing', () => {
        const trades = [trade(0, TradeOutcome.WIN), trade(1, TradeOutcome.LOSS)];
        const prompt = buildDoctrinePrompt(trades, 'I wait for reclaims.');
        expect(prompt).toContain('your own trading doctrine');
        expect(prompt).toContain('I wait for reclaims.');
        expect(prompt).toContain('BTC Long WIN');
        expect(prompt).toContain('BTC Long LOSS');
        expect(prompt).toContain('First person');
    });
});

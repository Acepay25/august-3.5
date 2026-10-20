/**
 * Coverage for utilities that survived the debate-engine deletion. The engine's
 * suite was their only test file; deleting it left five live modules with no
 * test at all. These are the surviving behaviors, restored without the deleted
 * debate types around them.
 */

import { describe, expect, it } from 'vitest';
import { TradeAnalysis, LoggedTrade, TradeOutcome } from '../types';
import { describeOpenBookRisk, paperPnlR } from '../utils/paperPnl';
import { summarizePromptVersions } from '../utils/promptVersionStats';
import { computeEvidenceQualityStats } from '../utils/analysisQuality';
import { describeWatchTick } from '../utils/watchTicks';
import { parseComposerIntent, formatComposerSteer } from '../utils/composerMentions';

describe('paper book', () => {
    it('reports +1R when price travels the stop distance in favour', () => {
        const p = paperPnlR({
            direction: 'Long', confidence: 'High',
            entryPoints: [{ price: '100' }], stopLoss: '90',
        } as unknown as TradeAnalysis, 110);
        expect(p?.r).toBe(1);
    });

    it('flags two open Long alts', () => {
        const row = (coin: string) => ({
            analysis: { coinName: coin, direction: 'Long', confidence: 'High' },
            outcome: TradeOutcome.PENDING,
        });
        expect(describeOpenBookRisk([row('ETHUSDT'), row('SOLUSDT')] as never)).toMatch(/Long alts/);
    });
});

describe('prompt version stats', () => {
    it('rolls win rate per stamped version', () => {
        const stats = summarizePromptVersions([
            { id: '1', timestamp: 't', outcome: TradeOutcome.WIN, promptVersion: 'pv-a', analysis: {} },
            { id: '2', timestamp: 't', outcome: TradeOutcome.LOSS, promptVersion: 'pv-a', analysis: {} },
            { id: '3', timestamp: 't', outcome: TradeOutcome.WIN, analysis: {} },
        ] as unknown as LoggedTrade[]);
        expect(stats).toEqual([{
            version: 'pv-a', trades: 2, wins: 1, losses: 1, winRate: 50,
            avgDeclared: null, avgRealized: 50,
        }]);
    });
});

describe('evidence quality', () => {
    it('buckets coverage vs win rate', () => {
        const stats = computeEvidenceQualityStats([
            {
                id: '1', timestamp: 't', outcome: TradeOutcome.WIN,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'observed' }], probability: 70 },
            },
            {
                id: '2', timestamp: 't', outcome: TradeOutcome.LOSS,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'unobserved' }], probability: 80 },
            },
        ] as unknown as LoggedTrade[]);
        expect(stats.find(s => s.coverage === 'high')?.winRate).toBe(100);
        expect(stats.find(s => s.coverage === 'low')?.winRate).toBe(0);
    });
});

describe('watch ticks', () => {
    it('emits invalidation when long price breaks below the level', () => {
        const tick = describeWatchTick({
            direction: 'Long',
            invalidationCriteria: [{ level: '100', condition: 'close below' }],
        } as unknown as TradeAnalysis, 99, 101);
        expect(tick?.kind).toBe('invalidation');
    });

    it('ignores tiny price noise', () => {
        expect(describeWatchTick({ direction: 'Long' } as unknown as TradeAnalysis, 100.1, 100)).toBeNull();
    });
});

describe('composer mentions', () => {
    it('keeps the skill slug and stops inventing a seat to address', () => {
        // @Macro named one of the four built-in analyst seats, and all four are
        // deleted; the mention still emitted "Address Macro only." into the
        // prompt, so the model was told to speak to a thing that does not exist.
        const intent = parseComposerIntent('@Macro /fade-wick BTC 4h');
        expect(intent.skills).toEqual(['fade-wick']);
        expect(formatComposerSteer(intent)).toMatch(/fade-wick/);
        expect(formatComposerSteer(intent)).not.toMatch(/Address/);
        // The trader's own words survive a mention that routes nothing, instead
        // of being stripped out of the text they typed.
        expect(intent.rest).toBe('@Macro BTC 4h');
    });
});

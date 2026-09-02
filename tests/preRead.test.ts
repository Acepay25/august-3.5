import { describe, it, expect, beforeEach } from 'vitest';

// Pre-read capture (Batch 5 remainder, plan §5a): prior-vs-verdict comparison
// and the human-Brier journal read-out.

import {
    loadPreReadEnabled,
    savePreReadEnabled,
    comparePriorToVerdict,
    buildHumanCalibration,
    humanCalibrationLine,
} from '../utils/preRead';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { TradeAnalysis } from '../types';

const trade = (over: Partial<LoggedTrade> & { outcome: TradeOutcome }): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as TradeAnalysis,
    timestamp: new Date().toISOString(),
    ...over,
});

describe('pre-read toggle', () => {
    beforeEach(() => localStorage.clear());
    it('defaults OFF and round-trips the save', () => {
        expect(loadPreReadEnabled()).toBe(false);
        savePreReadEnabled(true);
        expect(loadPreReadEnabled()).toBe(true);
        savePreReadEnabled(false);
        expect(loadPreReadEnabled()).toBe(false);
    });
});

describe('comparePriorToVerdict', () => {
    it('AGREE / DISAGREE on direction', () => {
        const prior = { direction: 'Long' as const, confidencePct: 70, createdAt: '' };
        expect(comparePriorToVerdict(prior, { direction: 'Long', probability: 65 })?.direction).toBe('AGREE');
        expect(comparePriorToVerdict(prior, { direction: 'Short', probability: 65 })?.direction).toBe('DISAGREE');
        expect(comparePriorToVerdict(prior, { direction: 'Neutral' })?.direction).toBe('NO_VERDICT');
        expect(comparePriorToVerdict(prior, undefined)?.direction).toBe('NO_VERDICT');
    });
    it('null without a prior; USER_FLAT when the user passed', () => {
        expect(comparePriorToVerdict(undefined, { direction: 'Long' })).toBeNull();
        const flat = { direction: 'Flat' as const, confidencePct: 50, createdAt: '' };
        expect(comparePriorToVerdict(flat, { direction: 'Long', probability: 60 })?.direction).toBe('USER_FLAT');
    });
});

describe('buildHumanCalibration', () => {
    it('scores human Brier vs verdict Brier over pre-read closed rows', () => {
        const trades = [
            // user 80% Long, verdict 70% Long, WIN → human (0.8-1)²=0.04, verdict (0.7-1)²=0.09
            trade({ outcome: TradeOutcome.WIN, analysis: { direction: 'Long', probability: 70 } as TradeAnalysis, userPriorCall: { direction: 'Long', confidencePct: 80, createdAt: '' } }),
            // user 60% Short, verdict 65% Long, LOSS → human (0.6-0)²=0.36, verdict (0.65-0)²=0.4225
            trade({ outcome: TradeOutcome.LOSS, analysis: { direction: 'Long', probability: 65 } as TradeAnalysis, userPriorCall: { direction: 'Short', confidencePct: 60, createdAt: '' } }),
            // no prior — excluded
            trade({ outcome: TradeOutcome.WIN, analysis: { direction: 'Long', probability: 70 } as TradeAnalysis }),
            // open — excluded
            trade({ outcome: TradeOutcome.SKIPPED, userPriorCall: { direction: 'Flat', confidencePct: 50, createdAt: '' } }),
        ];
        const row = buildHumanCalibration(trades)!;
        expect(row.n).toBe(2);
        expect(row.humanBrier!).toBeCloseTo((0.04 + 0.36) / 2, 4);
        expect(row.verdictBrier!).toBeCloseTo((0.09 + 0.4225) / 2, 4);
        expect(row.agreePct).toBeCloseTo(50, 4);
        // the disagreement row LOST → disagree win rate 0
        expect(row.disagreeWinRate).toBe(0);
    });
    it('null when nobody has pre-read', () => {
        expect(buildHumanCalibration([trade({ outcome: TradeOutcome.WIN, pnlAmount: 5 })])).toBeNull();
        expect(humanCalibrationLine(null)).toBe('');
    });
    it('framing line names both Briers and the over-rule rate', () => {
        const trades = [
            trade({ outcome: TradeOutcome.WIN, analysis: { direction: 'Long', probability: 50 } as TradeAnalysis, userPriorCall: { direction: 'Short', confidencePct: 90, createdAt: '' } }),
            trade({ outcome: TradeOutcome.LOSS, analysis: { direction: 'Long', probability: 50 } as TradeAnalysis, userPriorCall: { direction: 'Long', confidencePct: 90, createdAt: '' } }),
        ];
        const line = humanCalibrationLine(buildHumanCalibration(trades));
        expect(line).toContain('Brier');
        expect(line).toContain('agreed with the floor');
        // the one disagreement row was a WIN → over-rule win rate 100%
        expect(line).toContain('you won 100%');
    });
});

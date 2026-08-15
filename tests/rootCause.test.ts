import { describe, expect, it } from 'vitest';
import { TradeOutcome } from '../types';
import {
    classifyRootCause,
    shouldAdmitTechnicalStrategyRule,
    tradeAdmitsTechnicalStrategyRule,
} from '../utils/rootCause';

describe('classifyRootCause', () => {
    it('reads an explicit SETUP_EDGE_FAILURE label', () => {
        expect(classifyRootCause('SETUP_EDGE_FAILURE\nIF close loses 4H THEN stand down')).toBe('SETUP_EDGE_FAILURE');
    });

    it('uses the dominant blame share', () => {
        expect(classifyRootCause('Blame Assessment - Setup 20% | Execution 70% | Market 10%')).toBe('EXECUTION_ERROR');
        expect(classifyRootCause('Setup 15% Execution 15% Market 70%')).toBe('MACRO_SHOCK');
        expect(classifyRootCause('Setup 80% | Execution 10% | Market 10%')).toBe('SETUP_EDGE_FAILURE');
    });

    it('falls back to execution and macro keywords', () => {
        expect(classifyRootCause('I chased the breakout after it ran.')).toBe('EXECUTION_ERROR');
        expect(classifyRootCause('CPI print spiked through the stop.')).toBe('MACRO_SHOCK');
    });

    it('treats unlabeled wins as setup and unlabeled losses as unclear', () => {
        expect(classifyRootCause('Wait for the 15m reclaim.', TradeOutcome.WIN)).toBe('SETUP_EDGE_FAILURE');
        expect(classifyRootCause('Wait for the 15m reclaim.', TradeOutcome.LOSS)).toBe('UNCLEAR');
    });
});

describe('shouldAdmitTechnicalStrategyRule', () => {
    it('blocks execution and macro, keeps setup and unlabeled', () => {
        expect(shouldAdmitTechnicalStrategyRule('SETUP_EDGE_FAILURE')).toBe(true);
        expect(shouldAdmitTechnicalStrategyRule('UNCLEAR')).toBe(true);
        expect(shouldAdmitTechnicalStrategyRule('EXECUTION_ERROR')).toBe(false);
        expect(shouldAdmitTechnicalStrategyRule('MACRO_SHOCK')).toBe(false);
    });

    it('gates a trade from its stored class', () => {
        expect(tradeAdmitsTechnicalStrategyRule({
            outcome: TradeOutcome.LOSS,
            postMortem: 'IF x THEN y',
            rootCauseClass: 'EXECUTION_ERROR',
        })).toBe(false);
        expect(tradeAdmitsTechnicalStrategyRule({
            outcome: TradeOutcome.LOSS,
            postMortem: 'IF 15m reclaim THEN wait',
        })).toBe(true);
    });
});

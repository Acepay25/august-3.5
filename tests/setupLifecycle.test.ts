import { describe, expect, it } from 'vitest';
import { TradeAnalysis } from '../types/analysis';
import { TradeOutcome } from '../types/enums';
import { getSetupLifecycle } from '../utils/setupLifecycle';

const analysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'Medium',
    probability: 60,
    strategy: 'Test setup',
    activeStrategies: [],
    entryPoints: [{ description: 'Entry', price: '100' }],
    stopLoss: '90',
    takeProfit: [{ price: '110' }],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    ...overrides,
});

describe('setup lifecycle', () => {
    it('starts an unlogged analysis as a draft', () => {
        expect(getSetupLifecycle(analysis()).stage).toBe('draft');
    });

    it('tracks a pending setup as watching, active, and modified', () => {
        expect(getSetupLifecycle(analysis(), TradeOutcome.PENDING).stage).toBe('watching');
        expect(getSetupLifecycle(analysis(), TradeOutcome.PENDING, Date.now(), [0]).stage).toBe('active');
        expect(getSetupLifecycle(analysis({ isUpdate: true }), TradeOutcome.PENDING).stage).toBe('modified');
    });

    it('resolves terminal outcomes and expires validity windows', () => {
        expect(getSetupLifecycle(analysis(), TradeOutcome.WIN).stage).toBe('resolved');
        expect(getSetupLifecycle(analysis(), TradeOutcome.SKIPPED).stage).toBe('skipped');
        expect(getSetupLifecycle(analysis({ createdAt: '2025-01-01T00:00:00.000Z', validityDurationMinutes: 60 }), TradeOutcome.PENDING, new Date('2025-01-01T02:00:00.000Z').getTime()).stage).toBe('expired');
    });
});

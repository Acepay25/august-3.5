import { describe, it, expect } from 'vitest';

// Batch 7 trust-surface helpers: funding carry framing, quiet hours,
// rendered-copy sweep, plan amendments, calibration ledger.

import {
    fundingCarryCost,
    fundingCarrySnapshotLine,
    sweepDeterministicClaims,
    planAmendmentDiff,
    FINANCIAL_ADVICE_DISCLAIMER,
} from '../utils/trustSurface';
import {
    isWithinQuietHours,
    quietHoursLabel,
    DEFAULT_QUIET_HOURS,
} from '../utils/quietHours';
import {
    buildCalibrationLedger,
    ledgerFramingLine,
    brierQuality,
} from '../services/validation/CalibrationLedgerService';
import { buildTicketSheet } from '../utils/analysisReport';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { TradeAnalysis } from '../types';

describe('fundingCarryCost', () => {
    it('a Long PAYS when funding is positive (Binance convention)', () => {
        const c = fundingCarryCost('Long', 0.0001); // +0.01%/8h
        expect(c.costPctPer8h).toBeCloseTo(0.01);
        expect(c.line).toContain('long pays');
        expect(c.line).toContain('~0.0100%/8h');
        expect(c.line).toContain('~0.030%/day'); // 3 intervals
    });

    it('a Short RECEIVES when funding is positive', () => {
        const c = fundingCarryCost('Short', 0.0001);
        expect(c.costPctPer8h).toBeCloseTo(-0.01);
        expect(c.line).toContain('short receives');
    });

    it('negative funding flips both sides', () => {
        expect(fundingCarryCost('Long', -0.0001).line).toContain('long receives');
        expect(fundingCarryCost('Short', -0.0001).line).toContain('short pays');
    });

    it('missing funding or neutral direction → no line', () => {
        expect(fundingCarryCost('Long', undefined).line).toBe('');
        expect(fundingCarryCost('Neutral', 0.0001).line).toBe('');
        expect(fundingCarryCost('Long', 0).line).toBe('');
    });
});

describe('fundingCarrySnapshotLine', () => {
    it('states both sides for the debate (no verdict yet)', () => {
        expect(fundingCarrySnapshotLine(0.0001)).toContain('longs pay / shorts receive');
        expect(fundingCarrySnapshotLine(-0.0001)).toContain('shorts pay / longs receive');
        expect(fundingCarrySnapshotLine(undefined)).toBe('');
    });
});

describe('isWithinQuietHours', () => {
    const at = (h: number): Date => new Date(2026, 7, 29, h, 30); // local time

    it('disabled → never quiet', () => {
        expect(isWithinQuietHours({ ...DEFAULT_QUIET_HOURS, enabled: false }, at(2))).toBe(false);
    });

    it('wrap-around window 23→07: 02:30 inside, 12:30 outside, 23:30 inside', () => {
        const cfg: typeof DEFAULT_QUIET_HOURS = { enabled: true, startHour: 23, endHour: 7 };
        expect(isWithinQuietHours(cfg, at(2))).toBe(true);
        expect(isWithinQuietHours(cfg, at(12))).toBe(false);
        expect(isWithinQuietHours(cfg, at(23))).toBe(true);
        // Window end is exclusive: 07:30 is awake.
        expect(isWithinQuietHours(cfg, at(7))).toBe(false);
    });

    it('forward window 13→14: 13:30 inside, 14:30 outside', () => {
        const cfg: typeof DEFAULT_QUIET_HOURS = { enabled: true, startHour: 13, endHour: 14 };
        expect(isWithinQuietHours(cfg, at(13))).toBe(true);
        expect(isWithinQuietHours(cfg, at(14))).toBe(false);
    });

    it('equal start/end = off', () => {
        const cfg: typeof DEFAULT_QUIET_HOURS = { enabled: true, startHour: 8, endHour: 8 };
        expect(isWithinQuietHours(cfg, at(8))).toBe(false);
    });

    it('label pads hours', () => {
        expect(quietHoursLabel({ enabled: true, startHour: 23, endHour: 7 })).toBe('23:00–07:00');
    });
});

describe('sweepDeterministicClaims', () => {
    it('softens "will hit" to "may hit"', () => {
        const r = sweepDeterministicClaims('BTC will hit 120k this week.');
        expect(r.text).toBe('BTC may hit 120k this week.');
        expect(r.softened).toContain('will hit');
    });

    it('softens guaranteed and certainty adverbs', () => {
        const r = sweepDeterministicClaims('This trade is guaranteed to print — definitely.');
        expect(r.text).toContain('not guaranteed to print');
        expect(r.text).toContain('likely');
        expect(r.softened.length).toBeGreaterThanOrEqual(2);
    });

    it('leaves ordinary prose untouched', () => {
        const prose = 'ETH may test the 4h FVG midpoint; momentum is fading and RSI is overbought.';
        expect(sweepDeterministicClaims(prose)).toEqual({ text: prose, softened: [] });
    });
});

describe('planAmendmentDiff', () => {
    const base = {
        direction: 'Long', confidence: 'High',
        entryPoints: [{ price: '100000' }], stopLoss: '97000',
        takeProfit: [{ price: '110000' }],
    } as unknown as TradeAnalysis;

    it('records a moved stop as an explicit diff', () => {
        const next = { ...base, stopLoss: '98000' } as TradeAnalysis;
        expect(planAmendmentDiff(base, next)).toBe('SL $97000 → $98000');
    });

    it('combines multiple moves', () => {
        const next = { ...base, direction: 'Short', confidence: 'Medium' } as TradeAnalysis;
        const diff = planAmendmentDiff(base, next);
        expect(diff).toContain('direction Long → Short');
        expect(diff).toContain('confidence High → Medium');
    });

    it('unchanged plans diff to empty string', () => {
        expect(planAmendmentDiff(base, { ...base })).toBe('');
    });
});

describe('buildCalibrationLedger', () => {
    const trade = (overrides: {
        outcome: TradeOutcome;
        grade?: string;
        confidence?: string;
        probability?: number;
        moderatorProvider?: string;
    }): LoggedTrade => ({
        id: `t-${Math.random().toString(36).slice(2)}`,
        analysis: {
            grade: overrides.grade,
            confidence: overrides.confidence,
            probability: overrides.probability,
        } as unknown as TradeAnalysis,
        outcome: overrides.outcome,
        timestamp: '2026-08-29T10:00:00Z',
        moderatorProvider: overrides.moderatorProvider,
    });

    it('win rates and Brier math are exact', () => {
        // Grade A: p=70% win (Brier (0.7-1)^2 = 0.09), p=70% loss (0.49) → 0.29
        const trades = [
            trade({ outcome: TradeOutcome.WIN, grade: 'A', confidence: 'High', probability: 70 }),
            trade({ outcome: TradeOutcome.LOSS, grade: 'A', confidence: 'High', probability: 70 }),
        ];
        const ledger = buildCalibrationLedger(trades);
        expect(ledger.totalClosed).toBe(2);
        const a = ledger.byGrade.find(r => r.label === 'A')!;
        expect(a.n).toBe(2);
        expect(a.winRate).toBeCloseTo(50);
        expect(a.avgDeclaredPct).toBeCloseTo(70);
        expect(a.brier).toBeCloseTo(0.29);
        expect(ledger.overallBrier).toBeCloseTo(0.29);
    });

    it('rows without a declared probability count in win rates but not Brier', () => {
        const trades = [
            trade({ outcome: TradeOutcome.WIN, grade: 'B', confidence: 'High' }), // no probability
            trade({ outcome: TradeOutcome.LOSS, grade: 'B', confidence: 'High', probability: 60 }),
        ];
        const ledger = buildCalibrationLedger(trades);
        const b = ledger.byBand.find(r => r.label === 'High')!;
        expect(b.n).toBe(2);
        expect(b.winRate).toBeCloseTo(50);
        expect(ledger.brierN).toBe(1);
        expect(ledger.overallBrier).toBeCloseTo(0.36); // (0.6-0)^2
    });

    it('groups by moderator provider, sorted by volume', () => {
        const trades = [
            trade({ outcome: TradeOutcome.WIN, moderatorProvider: 'gemini' }),
            trade({ outcome: TradeOutcome.LOSS, moderatorProvider: 'gemini' }),
            trade({ outcome: TradeOutcome.WIN, moderatorProvider: 'custom-1' }),
            trade({ outcome: TradeOutcome.WIN, moderatorProvider: 'custom-1' }),
            trade({ outcome: TradeOutcome.LOSS, moderatorProvider: 'custom-1' }),
        ];
        const ledger = buildCalibrationLedger(trades);
        expect(ledger.byModerator.map(r => r.label)).toEqual(['custom-1', 'gemini']);
        expect(ledger.byModerator[0].winRate).toBeCloseTo(66.666, 1);
    });

    it('framing line speaks in frequency format when the High band has data', () => {
        const trades = Array.from({ length: 8 }, (_, i) => trade({
            outcome: i < 6 ? TradeOutcome.WIN : TradeOutcome.LOSS,
            confidence: 'High',
            probability: 70,
        }));
        const line = ledgerFramingLine(buildCalibrationLedger(trades));
        expect(line).toContain('When the verdict says High (~70%)');
        expect(line).toContain('it hit 75% of the time over 8 closed trades');
    });

    it('framing line stays empty on a thin journal', () => {
        const ledger = buildCalibrationLedger([trade({ outcome: TradeOutcome.WIN, confidence: 'High', probability: 70 })]);
        expect(ledgerFramingLine(ledger)).toBe('');
    });

    it('brierQuality buckets around the 0.25 coin-flip baseline', () => {
        expect(brierQuality(0.10)).toBe('good');
        expect(brierQuality(0.20)).toBe('fair');
        expect(brierQuality(0.40)).toBe('poor');
        expect(brierQuality(null)).toBe('none');
    });
});

describe('buildTicketSheet copy pass', () => {
    it('softens deterministic conditions and closes with the disclaimer', () => {
        const analysis = {
            coinName: 'BTC',
            direction: 'Long',
            confidence: 'High',
            entryPoints: [{ price: '100000' }],
            stopLoss: '97000',
            takeProfit: [{ price: '110000' }],
            invalidationCriteria: [{ level: '97000', condition: 'will invalidate the setup' }],
        } as unknown as TradeAnalysis;
        const sheet = buildTicketSheet(analysis);
        expect(sheet).toContain('may invalidate the setup');
        expect(sheet).toContain(FINANCIAL_ADVICE_DISCLAIMER);
    });
});

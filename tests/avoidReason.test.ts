import { describe, expect, it } from 'vitest';
import { TradeAnalysis } from '../types';
import {
    buildConfidenceTimeline,
    classifyAvoidBasis,
    confirmationTrigger,
    describeModelCalibration,
    rescueSoftAvoid,
} from '../utils/avoidReason';

const baseAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Long',
    confidence: 'Avoid',
    probability: 45,
    strategy: '',
    activeStrategies: [],
    entryPoints: [{ price: '100', description: '' }],
    stopLoss: '95',
    takeProfit: [{ price: '110' }],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    ...overrides,
});

describe('classifyAvoidBasis', () => {
    it('flags hard blockers: gate veto, ungrounded levels, hard validation, R:R floor', () => {
        const basis = classifyAvoidBasis(baseAnalysis({
            riskVeto: 'GATE VETO: insufficient data — this signal must not be traded on its own.',
            validationWarnings: ['Ungrounded Entry — forced Neutral (cite hybrid/OCR or do not trade).', ' HARD VALIDATION: no 1h klines'],
            rrRatio: 0.8,
        }));
        expect(basis.hard.map(item => item.text)).toEqual(expect.arrayContaining([
            expect.stringContaining('GATE VETO'),
            expect.stringContaining('Ungrounded'),
            expect.stringContaining('HARD VALIDATION'),
            expect.stringContaining('1:1 viability floor'),
        ]));
        expect(basis.downgrades).toEqual([]);
    });

    it('sorts soft warnings into downgrades with gate cap and penalties', () => {
        const basis = classifyAvoidBasis(baseAnalysis({
            validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Low'],
            gateResult: {
                passed: true,
                confidenceCap: 0.5,
                penalties: { dataIntegrity: 0, patternMemory: 0.1, htfConflict: 0.12, volumeContext: 0, rawTotal: 0.22, effectiveTotal: 0.22 },
                familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: [] },
                warnings: [],
                insights: [],
            },
        }));
        expect(basis.hard).toEqual([]);
        expect(basis.downgrades.map(item => item.text)).toEqual(expect.arrayContaining([
            'CALIBRATION ADJUSTMENT: Medium → Low',
            expect.stringContaining('capped conviction at 50%'),
            expect.stringContaining('Higher-timeframe conflict'),
            expect.stringContaining('pattern memory'),
        ]));
    });

    it('reports a failed gate as a blocker once, even with a veto', () => {
        const basis = classifyAvoidBasis(baseAnalysis({
            riskVeto: 'GATE VETO: insufficient data',
            gateResult: { passed: false, confidenceCap: 0.3, penalties: undefined as never, familyBias: undefined as never, warnings: [], insights: [] },
        }));
        expect(basis.hard.length).toBe(1);
        expect(basis.hard[0]?.text).toBe('GATE VETO: insufficient data');
    });

    it('derives the R:R floor from levels when rrRatio is unset', () => {
        const basis = classifyAvoidBasis(baseAnalysis({
            entryPoints: [{ price: '100', description: '' }],
            stopLoss: '90',
            takeProfit: [{ price: '105' }],
        }));
        expect(basis.hard.some(item => item.text.includes('1:1 viability floor'))).toBe(true);
    });
});

describe('rescueSoftAvoid', () => {
    it('floors a soft Avoid to Low and restores the pre-veto direction', () => {
        const analysis = baseAnalysis({
            direction: 'Neutral',
            validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Avoid'],
            originalConfidence: 'Medium',
        });
        const rescued = rescueSoftAvoid(analysis, { directionBefore: 'Long' });
        expect(rescued).toBe(true);
        expect(analysis.confidence).toBe('Low');
        expect(analysis.direction).toBe('Long');
        expect(analysis.originalConfidence).toBe('Medium');
        expect(analysis.validationWarnings).toContain('SOFT AVOID RESCINDED: no hard blocker — kept as a Low-confidence watch.');
    });

    it('keeps a hard-blocked Avoid untouched', () => {
        const analysis = baseAnalysis({
            validationWarnings: ['Ungrounded SL — forced Neutral (cite hybrid/OCR or do not trade).'],
        });
        expect(rescueSoftAvoid(analysis, { directionBefore: 'Short' })).toBe(false);
        expect(analysis.confidence).toBe('Avoid');
        expect(analysis.direction).toBe('Long');
    });

    it('keeps a model-declared Avoid untouched', () => {
        const analysis = baseAnalysis({ validationWarnings: [] });
        expect(rescueSoftAvoid(analysis, { modelDeclaredAvoid: true })).toBe(false);
        expect(analysis.confidence).toBe('Avoid');
    });

    it('is a no-op for non-Avoid verdicts', () => {
        const analysis = baseAnalysis({ confidence: 'Medium' });
        expect(rescueSoftAvoid(analysis)).toBe(false);
        expect(analysis.validationWarnings).toBeUndefined();
    });
});

describe('buildConfidenceTimeline', () => {
    it('walks initial → gate cap → rules → final with tones', () => {
        const steps = buildConfidenceTimeline(baseAnalysis({
            originalConfidence: 'High',
            confidence: 'Avoid',
            validationWarnings: ['CALIBRATION ADJUSTMENT: High → Low', 'GATE VETO: insufficient data'],
            gateResult: { passed: true, confidenceCap: 0.6, penalties: undefined as never, familyBias: undefined as never, warnings: [], insights: [] },
        }));
        expect(steps.map(step => step.label)).toEqual(['Initial', 'Gate cap', 'CALIBRATION ADJUSTMENT', 'GATE VETO', 'Final']);
        expect(steps[0]?.value).toBe('High');
        expect(steps[1]?.value).toBe('60% ceiling');
        expect(steps[1]?.tone).toBe('warning');
        expect(steps[3]?.tone).toBe('blocked');
        expect(steps[4]?.value).toBe('Avoid');
        expect(steps[4]?.tone).toBe('blocked');
    });

    it('caps the rule steps and notes the overflow', () => {
        const warnings = Array.from({ length: 9 }, (_, i) => `RULE ${i + 1}: warning number ${i + 1}`);
        const steps = buildConfidenceTimeline(baseAnalysis({ confidence: 'Low', validationWarnings: warnings }));
        const ruleSteps = steps.filter(step => step.label.startsWith('RULE'));
        expect(ruleSteps.length).toBe(6);
        expect(steps.some(step => step.label === 'More rules' && step.value === '+3 further warnings')).toBe(true);
    });
});

describe('confirmationTrigger', () => {
    it('prefers the suggested entry trigger', () => {
        const trigger = confirmationTrigger(baseAnalysis({
            entryTimingScore: { score: 40, timingQuality: 'weak', suggestedEntry: { price: 102, reason: 'Wait for the 4H close above 101.5.' } },
            invalidationCriteria: [{ level: '101', condition: 'close below 101' }],
        }));
        expect(trigger?.text).toContain('4H close above');
        expect(trigger?.level).toBe('102');
    });

    it('falls back to the invalidation contract when no entry timing exists', () => {
        const trigger = confirmationTrigger(baseAnalysis({
            invalidationCriteria: [{ level: '101.5', condition: '4H close above this level', category: 'price' }],
        }));
        expect(trigger?.text).toBe('4H close above this level');
        expect(trigger?.level).toBe('101.5');
    });

    it('skips the invalidation source when the card already renders that line', () => {
        const trigger = confirmationTrigger(baseAnalysis({
            invalidationCriteria: [{ level: '101.5', condition: '4H close above this level', category: 'price' }],
        }), { skipInvalidationSource: true });
        expect(trigger).toBeNull();
    });

    it('falls back to a wait-related gate insight, then a warning', () => {
        expect(confirmationTrigger(baseAnalysis({
            gateResult: { passed: true, confidenceCap: 1, penalties: undefined as never, familyBias: undefined as never, warnings: [], insights: ['Once volume returns above the 20-period average the setup revalidates.'] },
        }))?.text).toContain('volume returns');
        expect(confirmationTrigger(baseAnalysis({
            validationWarnings: ['ENTRY TIMING: Weak candle confirmation - consider waiting for clearer signal'],
        }))?.text).toContain('clearer signal');
    });

    it('returns null when nothing actionable exists', () => {
        expect(confirmationTrigger(baseAnalysis({ validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Low'] }))).toBeNull();
    });
});

describe('describeModelCalibration', () => {
    it('renders realized accuracy once enough trades are logged', () => {
        const calibration = {
            high: { wins: 0, losses: 0, total: 0 },
            medium: { wins: 0, losses: 0, total: 0 },
            low: { wins: 0, losses: 0, total: 0 },
            avoid: { wins: 0, losses: 0, total: 0 },
            granular: {
                byCoin: {}, byPattern: {}, byTimeframe: {}, byRegime: {}, bySession: {}, byDayOfWeek: {},
                byProvider: { gemini: { wins: 7, losses: 3, total: 10 } },
            },
        };
        const lines = describeModelCalibration(calibration, { gemini: 'gemini-2.0-flash' });
        expect(lines).toEqual(['Gemini 2.0 Flash: 70% realized (n=10)']);
    });

    it('marks small samples as pending and skips untracked providers', () => {
        const calibration = {
            high: { wins: 0, losses: 0, total: 0 },
            medium: { wins: 0, losses: 0, total: 0 },
            low: { wins: 0, losses: 0, total: 0 },
            avoid: { wins: 0, losses: 0, total: 0 },
            granular: {
                byCoin: {}, byPattern: {}, byTimeframe: {}, byRegime: {}, bySession: {}, byDayOfWeek: {},
                byProvider: { gemini: { wins: 1, losses: 0, total: 1 } },
            },
        };
        expect(describeModelCalibration(calibration, { gemini: 'gemini-2.0-flash', claude: 'claude-3' })).toEqual([
            'Gemini 2.0 Flash: 1 logged trade — calibration pending',
        ]);
        expect(describeModelCalibration(undefined, { gemini: 'gemini-2.0-flash' })).toEqual([]);
        expect(describeModelCalibration(calibration, undefined)).toEqual([]);
    });
});

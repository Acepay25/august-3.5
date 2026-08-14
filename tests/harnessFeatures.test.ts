import { describe, expect, it } from 'vitest';
import { AnalystRole } from '../types';
import { buildOcrEnvelope, envelopeKindForRole } from '../utils/debateEnvelopes';
import { buildRecommendationContract } from '../utils/recommendationContract';
import { debateTurnsToRoundTexts, lastCompletedRound, reconstructOpenings } from '../utils/debateResume';
import { computeEvidenceQualityStats } from '../utils/analysisQuality';
import { buildAnalysisReportMarkdown } from '../utils/analysisReport';
import { describeWatchTick } from '../utils/watchTicks';
import { TradeOutcome } from '../types';

describe('harness envelopes', () => {
    it('maps lens roles to isolated kinds', () => {
        expect(envelopeKindForRole(AnalystRole.MACRO_VOLATILITY)).toBe('macro');
        expect(envelopeKindForRole(AnalystRole.TECHNICAL_ANALYST)).toBe('technical');
        expect(envelopeKindForRole(AnalystRole.RISK_EXECUTION)).toBe('risk');
    });

    it('withholds OCR from moderator and risk envelopes', () => {
        expect(buildOcrEnvelope(['chart A'], 'moderator')).toMatch(/withheld/);
        expect(buildOcrEnvelope(['chart A', 'chart B'], 'macro')).toContain('chart A');
        expect(buildOcrEnvelope(['chart A', 'chart B'], 'technical')).toContain('Chart 2');
    });
});

describe('recommendation contract', () => {
    it('marks Avoid as avoid with no position', () => {
        const c = buildRecommendationContract({
            direction: 'Short',
            confidence: 'Avoid',
            probability: 40,
            strategy: '',
            activeStrategies: [],
            entryPoints: [],
            stopLoss: '100',
            takeProfit: [],
            marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
            historicalCorrelation: '',
            invalidationCriteria: [{ level: '101', condition: 'close above' }],
            validityDurationMinutes: 60,
        });
        expect(c.action).toBe('avoid');
        expect(c.riskBoundary).toMatch(/No position/);
        expect(c.invalidation).toHaveLength(1);
        expect(c.validityMinutes).toBe(60);
    });
});

describe('debate resume', () => {
    it('rebuilds round texts and last completed round', () => {
        const turns = [
            { speaker: 'Macro', round: 1, text: 'open A', createdAt: 't' },
            { speaker: 'Tech', round: 1, text: 'open B', createdAt: 't' },
            { speaker: 'Macro', round: 2, text: 'rebut', createdAt: 't' },
        ];
        const texts = debateTurnsToRoundTexts(turns);
        expect(texts.Macro[1]).toBe('open A');
        expect(texts.Macro[2]).toBe('rebut');
        expect(lastCompletedRound(turns)).toBe(2);
        expect(reconstructOpenings(turns).map(s => s.name)).toEqual(['Macro', 'Tech']);
    });
});

describe('evidence quality', () => {
    it('buckets coverage vs win rate', () => {
        const stats = computeEvidenceQualityStats([
            {
                id: '1', timestamp: 't', outcome: TradeOutcome.WIN,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'observed' }], probability: 70 } as any,
            },
            {
                id: '2', timestamp: 't', outcome: TradeOutcome.LOSS,
                analysis: { evidence: [{ claim: 'a', sources: ['x'], state: 'unobserved' }], probability: 80 } as any,
            },
        ]);
        const high = stats.find(s => s.coverage === 'high');
        const low = stats.find(s => s.coverage === 'low');
        expect(high?.winRate).toBe(100);
        expect(low?.winRate).toBe(0);
    });
});

describe('analysis report', () => {
    it('includes verdict and contract', () => {
        const md = buildAnalysisReportMarkdown({
            analysis: {
                coinName: 'BTC',
                direction: 'Long',
                confidence: 'Medium',
                probability: 62,
                recommendationContract: { action: 'long', riskBoundary: 'SL 1', invalidation: [], thesis: 'Long BTC' },
            } as any,
            debateTurns: [],
        });
        expect(md).toMatch(/BTC/);
        expect(md).toMatch(/Contract/);
    });
});

describe('watch ticks', () => {
    it('emits invalidation when long price breaks below the level', () => {
        const tick = describeWatchTick({
            direction: 'Long',
            invalidationCriteria: [{ level: '100', condition: 'close below' }],
        } as any, 99, 101);
        expect(tick?.kind).toBe('invalidation');
    });

    it('ignores tiny price noise', () => {
        expect(describeWatchTick({ direction: 'Long' } as any, 100.1, 100)).toBeNull();
    });
});

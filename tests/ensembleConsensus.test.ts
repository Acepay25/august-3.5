import { describe, expect, it } from 'vitest';
import type { AnalystConsensus, TradeAnalysis } from '../types';
import {
    analyzePreDebateDivergence,
    attachVerdictCitations,
    buildAnalystConsensus,
    enforceCitedVerdict,
    generateDivergenceContext,
} from '../services/providers/ensembleConsensus';
import * as ensembleService from '../services/providers/ensembleService';

const baseAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'Medium',
    probability: 60,
    strategy: 'test',
    activeStrategies: [],
    entryPoints: [{ description: 'Entry', price: '100' }],
    stopLoss: '90',
    takeProfit: [{ price: '110' }],
    marketConditions: {
        pattern: 'trend',
        candleBehavior: 'steady',
        timeframeAlignment: 'aligned',
        rsi: 'neutral',
        macd: 'neutral',
        sentiment: 'neutral',
    },
    historicalCorrelation: 'N/A',
    ...overrides,
});

const makeAnalyst = (
    providerId: string,
    name: string,
    analysis: TradeAnalysis,
    thoughtsKey?: string,
) => ({
    provider: { config: { id: providerId }, name, thoughtsKey },
    result: { analysis },
});

describe('ensemble consensus aggregation', () => {
    it('returns undefined for an empty roster', () => {
        expect(buildAnalystConsensus([])).toBeUndefined();
    });

    it('projects each analyst call without losing provider identity or numeric probability', () => {
        const consensus = buildAnalystConsensus([
            makeAnalyst('provider-a', 'Macro', baseAnalysis({ probability: 62 }), 'provider-a::macro'),
            makeAnalyst('provider-b', 'Technical', baseAnalysis({
                entryPoints: [{ description: 'Zone', price: '100 - 110' }],
                probability: 68,
            })),
        ])!;

        expect(consensus.entries).toEqual([
            {
                providerId: 'provider-a',
                thoughtsKey: 'provider-a::macro',
                displayName: 'Macro',
                direction: 'Long',
                entry: '100',
                stopLoss: '90',
                takeProfit: '110',
                confidence: 'Medium',
                probability: 62,
            },
            {
                providerId: 'provider-b',
                thoughtsKey: undefined,
                displayName: 'Technical',
                direction: 'Long',
                entry: '100 - 110',
                stopLoss: '90',
                takeProfit: '110',
                confidence: 'Medium',
                probability: 68,
            },
        ]);
    });

    it('keeps the consensus payload shallowly stable when citations are attached', () => {
        const consensus = buildAnalystConsensus([
            makeAnalyst('p1', 'Alpha', baseAnalysis()),
            makeAnalyst('p2', 'Beta', baseAnalysis()),
        ])!;
        const cited = attachVerdictCitations(consensus, baseAnalysis());

        expect(cited).not.toBe(consensus);
        expect(cited.entries).toBe(consensus.entries);
        expect(cited.divergence).toBe(consensus.divergence);
        expect(cited.citations).toHaveLength(2);
    });
});

describe('pre-debate divergence analysis', () => {
    it('does not manufacture disagreement for fewer than two analysts', () => {
        expect(analyzePreDebateDivergence([], [])).toEqual({
            score: 0,
            isEchoChamber: false,
            divergenceType: 'none',
            details: [],
            syntheticDissentRequired: false,
            dissentProtocol: '',
        });
        expect(analyzePreDebateDivergence([{ analysis: baseAnalysis() }], ['Alpha'])).toMatchObject({
            score: 0,
            isEchoChamber: false,
            divergenceType: 'none',
        });
    });

    it('recognizes unanimous agreement as echo-chamber risk', () => {
        const result = analyzePreDebateDivergence([
            { analysis: baseAnalysis({ probability: 60 }) },
            { analysis: baseAnalysis({ probability: 61 }) },
        ], ['Alpha', 'Beta']);

        expect(result).toMatchObject({
            score: 0,
            isEchoChamber: true,
            divergenceType: 'none',
            syntheticDissentRequired: true,
        });
        expect(result.dissentProtocol).toContain("DEVIL'S ADVOCATE");
        expect(result.dissentProtocol).toContain('SHORT');
    });

    it('scores directional disagreement independently', () => {
        const result = analyzePreDebateDivergence([
            { analysis: baseAnalysis({ direction: 'Long' }) },
            { analysis: baseAnalysis({ direction: 'Short' }) },
        ], ['Alpha', 'Beta']);

        expect(result.score).toBe(40);
        expect(result.divergenceType).toBe('direction');
        expect(result.isEchoChamber).toBe(false);
        expect(result.details).toContain('Direction disagreement: long vs short ');
    });

    it('scores confidence disagreement when directions agree', () => {
        const result = analyzePreDebateDivergence([
            { analysis: baseAnalysis({ confidence: 'High' }) },
            { analysis: baseAnalysis({ confidence: 'Low' }) },
        ], ['Alpha', 'Beta']);

        expect(result.score).toBe(20);
        expect(result.divergenceType).toBe('confidence');
        expect(result.isEchoChamber).toBe(false);
    });

    it('uses parsed numeric entry prices and flags spreads over two percent', () => {
        const result = analyzePreDebateDivergence([
            { analysis: baseAnalysis({ entryPoints: [{ description: 'A', price: '100' }] }) },
            { analysis: baseAnalysis({ entryPoints: [{ description: 'B', price: '110' }] }) },
        ], ['Alpha', 'Beta']);

        expect(result.score).toBe(25);
        expect(result.divergenceType).toBe('entry');
        expect(result.details).toContain('Entry price divergence: 9.1% spread');
    });

    it('combines independent disagreements and caps the score at one hundred', () => {
        const result = analyzePreDebateDivergence([
            {
                analysis: baseAnalysis({
                    direction: 'Long',
                    confidence: 'High',
                    entryPoints: [{ description: 'A', price: '100' }],
                    probability: 40,
                }),
            },
            {
                analysis: baseAnalysis({
                    direction: 'Short',
                    confidence: 'Low',
                    entryPoints: [{ description: 'B', price: '110' }],
                    probability: 61,
                }),
            },
        ], ['Alpha', 'Beta']);

        expect(result.score).toBe(100);
        expect(result.divergenceType).toBe('multiple');
        expect(result.isEchoChamber).toBe(false);
        expect(result.details.some(detail => detail.includes('Probability spread'))).toBe(true);
    });

    it('renders moderator context for both echo-chamber and divergent rosters', () => {
        const echoContext = generateDivergenceContext([
            { analysis: baseAnalysis(), thoughtProcess: 'agree' },
            { analysis: baseAnalysis(), thoughtProcess: 'agree' },
        ], ['Alpha', 'Beta']);
        const divergenceContext = generateDivergenceContext([
            { analysis: baseAnalysis({ direction: 'Long' }), thoughtProcess: 'long' },
            { analysis: baseAnalysis({ direction: 'Short' }), thoughtProcess: 'short' },
        ], ['Alpha', 'Beta']);

        expect(echoContext).toMatch(/Divergence Score: 0\/100\s+LOW \(Echo Chamber Risk\)/);
        expect(echoContext).toContain('SYNTHETIC DISSENT PROTOCOL');
        expect(divergenceContext).toMatch(/Divergence Score: 40\/100\s+MODERATE/);
        expect(divergenceContext).toContain('Direction disagreement');
    });
});

describe('verdict citation attachment and enforcement', () => {
    const directionalConsensus = (direction: 'Long' | 'Short'): AnalystConsensus => attachVerdictCitations(
        buildAnalystConsensus([
            makeAnalyst('p1', 'Alpha', baseAnalysis({ direction })),
            makeAnalyst('p2', 'Beta', baseAnalysis({ direction: direction === 'Long' ? 'Short' : 'Long' })),
        ])!,
        baseAnalysis({ direction }),
    );

    it('marks aligned and dissenting analysts with audit notes', () => {
        const cited = directionalConsensus('Long');

        expect(cited.citations).toEqual([
            { displayName: 'Alpha', aligned: true, note: 'Tracked in verdict (Long)' },
            { displayName: 'Beta', aligned: false, note: 'Dissented Short vs Long' },
        ]);
    });

    it('treats a Neutral verdict as aligned only with no-trade analyst calls', () => {
        const consensus = buildAnalystConsensus([
            makeAnalyst('p1', 'Alpha', baseAnalysis({ direction: 'Neutral', confidence: 'Medium' })),
            makeAnalyst('p2', 'Beta', baseAnalysis({ direction: 'Long', confidence: 'Avoid' })),
            makeAnalyst('p3', 'Gamma', baseAnalysis({ direction: 'Long', confidence: 'Medium' })),
        ])!;
        const cited = attachVerdictCitations(consensus, baseAnalysis({ direction: 'Neutral', confidence: 'Medium' }));

        expect(cited.citations?.map(citation => citation.aligned)).toEqual([true, true, false]);
    });

    it('forces an uncited directional verdict to Neutral/Avoid and records provenance', () => {
        const uncitedConsensus: AnalystConsensus = {
            entries: [
                { providerId: 'p1', displayName: 'Alpha', direction: 'Short', confidence: 'Medium' },
                { providerId: 'p2', displayName: 'Beta', direction: 'Short', confidence: 'Medium' },
            ],
            divergence: {
                score: 40,
                isEchoChamber: false,
                divergenceType: 'direction',
                details: [],
            },
            citations: [
                { displayName: 'Alpha', aligned: false, note: 'Dissented Short vs Long' },
                { displayName: 'Beta', aligned: false, note: 'Dissented Short vs Long' },
            ],
        };
        const result = enforceCitedVerdict(
            {
                direction: 'Long',
                confidence: 'High',
                originalConfidence: undefined,
                verdictReview: undefined,
                validationWarnings: ['existing'],
            },
            uncitedConsensus,
        );

        expect(result.direction).toBe('Neutral');
        expect(result.confidence).toBe('Avoid');
        expect(result.originalConfidence).toBe('High');
        expect(result.verdictReview).toEqual({ reason: 'uncited', from: 'Long' });
        expect(result.validationWarnings).toEqual([
            'existing',
            'Verdict had no cited analyst — forced Neutral (moderator must quote, not average).',
        ]);
    });

    it('preserves a directional verdict when any analyst citation aligns', () => {
        const original = { direction: 'Long', confidence: 'High' };
        expect(enforceCitedVerdict(original, directionalConsensus('Long'))).toBe(original);
    });

    it('uses a kept analyst name as a case-insensitive citation gate', () => {
        const consensus = directionalConsensus('Long');
        expect(enforceCitedVerdict(
            { direction: 'Long', confidence: 'High' },
            consensus,
            '  alpha  ',
        ).direction).toBe('Long');
        expect(enforceCitedVerdict(
            { direction: 'Long', confidence: 'High' },
            consensus,
            'Gamma',
        ).direction).toBe('Long');
    });

    it('forces a named verdict when the kept name has no aligned citation', () => {
        const consensus: AnalystConsensus = {
            entries: [
                { providerId: 'p1', displayName: 'Alpha', direction: 'Short', confidence: 'Medium' },
            ],
            divergence: {
                score: 0,
                isEchoChamber: false,
                divergenceType: 'none',
                details: [],
            },
            citations: [
                { displayName: 'Alpha', aligned: false, note: 'Dissented Short vs Long' },
            ],
        };

        expect(enforceCitedVerdict(
            { direction: 'Long', confidence: 'High' },
            consensus,
            'Gamma',
        )).toMatchObject({ direction: 'Neutral', confidence: 'Avoid' });
    });

    it('never overrides an existing no-trade verdict', () => {
        const original = { direction: 'Neutral', confidence: 'Medium' };
        expect(enforceCitedVerdict(original, directionalConsensus('Short'))).toBe(original);
    });
});

describe('ensembleService compatibility re-exports', () => {
    it('keeps the legacy import path bound to the extracted pure implementations', () => {
        expect(ensembleService.analyzePreDebateDivergence).toBe(analyzePreDebateDivergence);
        expect(ensembleService.buildAnalystConsensus).toBe(buildAnalystConsensus);
        expect(ensembleService.attachVerdictCitations).toBe(attachVerdictCitations);
        expect(ensembleService.enforceCitedVerdict).toBe(enforceCitedVerdict);
        expect(ensembleService.generateDivergenceContext).toBe(generateDivergenceContext);
    });
});

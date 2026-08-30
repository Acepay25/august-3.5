import { describe, it, expect } from 'vitest';

// Batch 4 debate-science helpers: seat anonymization, homogeneous-roster
// detection, targeted devil question, FinCom parsing, vocabulary flag,
// deterministic ensemble line.

import {
    buildSeatAliases,
    findHomogeneousPairs,
    homogeneousRosterWarning,
    buildTargetedDevilQuestion,
    flagBannedVocabulary,
    parseFinComMarkers,
    withFinComMetadata,
    computeEnsembleLine,
    formatEnsembleLineBlock,
    CONTEXT_MATCH_DIRECTIVE,
} from '../services/providers/debateScience';
import { DebateTurn } from '../types';

describe('buildSeatAliases', () => {
    it('lens-assigned seats get role aliases; others get seat numbers', () => {
        const a = buildSeatAliases(
            ['Gemini Pro', 'DeepSeek R1', 'GLM'],
            name => (name === 'Gemini Pro' ? 'technical' : name === 'DeepSeek R1' ? 'risk' : undefined),
        );
        expect(a.aliasOf['Gemini Pro']).toBe('Technical Analyst');
        expect(a.aliasOf['DeepSeek R1']).toBe('Risk Analyst');
        expect(a.aliasOf['GLM']).toBe('Seat 3');
    });

    it('anonymize replaces every seat name (longest first) and leaves unknowns', () => {
        const a = buildSeatAliases(['AlphaChat', 'Alpha', 'Beta'], () => undefined);
        const out = a.anonymize('AlphaChat said X, then Alpha agreed, Beta objected. Moderator stays.');
        expect(out).toBe('Seat 1 said X, then Seat 2 agreed, Seat 3 objected. Moderator stays.');
    });

    it('two seats on the same lens fall back to seat numbers (no alias collision)', () => {
        const a = buildSeatAliases(['A', 'B'], () => 'technical');
        expect(a.aliasOf['A']).toBe('Technical Analyst');
        expect(a.aliasOf['B']).toBe('Seat 2');
    });
});

describe('findHomogeneousPairs', () => {
    it('flags seats sharing provider+model; different models pass', () => {
        const seats = [
            { providerId: 'gemini', model: 'pro', name: 'A' },
            { providerId: 'gemini', model: 'pro', name: 'B' },
            { providerId: 'gemini', model: 'flash', name: 'C' },
        ];
        expect(findHomogeneousPairs(seats)).toEqual(['A + B']);
    });

    it('an all-identical roster flags every member', () => {
        const seats = [
            { providerId: 'x', model: 'm', name: 'A' },
            { providerId: 'x', model: 'm', name: 'B' },
            { providerId: 'x', model: 'm', name: 'C' },
        ];
        expect(findHomogeneousPairs(seats)).toEqual(['A + B + C']);
    });

    it('a clean roster warns nothing', () => {
        expect(homogeneousRosterWarning([])).toBe('');
        expect(homogeneousRosterWarning(['A + B'])).toContain('ROSTER WARNING');
        expect(homogeneousRosterWarning(['A + B'])).toContain('correlated errors');
    });
});

describe('buildTargetedDevilQuestion', () => {
    it('names the specific entry, invalidation, and target under attack', () => {
        const q = buildTargetedDevilQuestion({
            floorDirection: 'Long',
            entry: '$100,000',
            invalidation: '$97,000',
            takeProfit: '$110,000',
        });
        expect(q).toContain('The floor leans Long');
        expect(q).toContain('entry trigger at $100,000');
        expect(q).toContain('invalidation at $97,000');
        expect(q).toContain('retail cluster');
        expect(q).toContain('target at $110,000');
        // The always-on probes:
        expect(q).toContain('hidden correlation');
        expect(q).toContain('regime mismatch');
        expect(q).toContain('revenge check');
    });

    it('missing claims drop out instead of rendering placeholders', () => {
        const q = buildTargetedDevilQuestion({});
        expect(q).not.toContain('undefined');
        expect(q).toContain('regime mismatch');
    });
});

describe('flagBannedVocabulary', () => {
    it('flags urgency-framed words', () => {
        expect(flagBannedVocabulary('This setup is URGENT and easy money — guaranteed.')).toEqual(['urgent', 'easy', 'guaranteed']);
    });

    it('clean analysis has no hits', () => {
        expect(flagBannedVocabulary('Momentum is fading; the 4h FVG may fill.')).toEqual([]);
    });
});

describe('parseFinComMarkers', () => {
    it('parses COMMIT and DISSENT lines with em or hyphen dashes', () => {
        const text = [
            'Some prose first.',
            'COMMIT: Seat 1 — their entry logic is sound and the SL respects structure.',
            'prose in between',
            'DISSENT: Seat 2 - the TP2 sits past an untested weekly high; unrealistic.',
            'DISSENT:Seat 3—no dash spacing still parses',
        ].join('\n');
        const markers = parseFinComMarkers(text);
        expect(markers).toHaveLength(3);
        expect(markers[0]).toEqual({ seat: 'Seat 1', stance: 'commit', why: 'their entry logic is sound and the SL respects structure.' });
        expect(markers[1].stance).toBe('dissent');
        expect(markers[2].seat).toBe('Seat 3');
    });

    it('no markers → empty array', () => {
        expect(parseFinComMarkers('just plain debate prose')).toEqual([]);
    });

    it('withFinComMetadata attaches markers to the turn copy', () => {
        const turn: DebateTurn = { speaker: 'A', round: 2, text: 'COMMIT: B — solid levels.' };
        const withMeta = withFinComMetadata(turn);
        expect(withMeta.fincom).toHaveLength(1);
        expect(withMeta.fincom![0].seat).toBe('B');
        expect(turn.fincom).toBeUndefined(); // original untouched
    });
});

describe('computeEnsembleLine', () => {
    it('agreement at 70 across seats stays near 70 (plain log-odds mean)', () => {
        const line = computeEnsembleLine([
            { seat: 'A', conviction: 70 },
            { seat: 'B', conviction: 70 },
            { seat: 'C', conviction: 70 },
        ])!;
        expect(line.probabilityPct).toBeCloseTo(70, 0);
        expect(line.alpha).toBe(1);
        expect(line.seats).toBe(3);
    });

    it('weights shift the mean toward the trusted seat', () => {
        const even = computeEnsembleLine([
            { seat: 'A', conviction: 90 },
            { seat: 'B', conviction: 30 },
        ])!;
        const weighted = computeEnsembleLine([
            { seat: 'A', conviction: 90, weight: 3 },
            { seat: 'B', conviction: 30 },
        ])!;
        expect(weighted.probabilityPct).toBeGreaterThan(even.probabilityPct);
    });

    it('mixed convictions aggregate between the poles, above the arithmetic-50 drag', () => {
        const line = computeEnsembleLine([
            { seat: 'A', conviction: 80 },
            { seat: 'B', conviction: 60 },
        ])!;
        // Log-odds mean of 0.8/0.6 ≈ 0.715 — above the naive 0.70 midpoint.
        expect(line.probabilityPct).toBeCloseTo(71.5, 0);
    });

    it('extreme convictions clamp inside logit domain, alpha extremizes', () => {
        const line = computeEnsembleLine([
            { seat: 'A', conviction: 100 },
            { seat: 'B', conviction: 0 },
        ])!;
        expect(Number.isFinite(line.probabilityPct)).toBe(true);
        const stronger = computeEnsembleLine([{ seat: 'A', conviction: 70 }], 1.5)!;
        expect(stronger.probabilityPct).toBeGreaterThan(70);
    });

    it('no convictions → null', () => {
        expect(computeEnsembleLine([])).toBeNull();
    });

    it('the block frames the line as scored advisory, never an override', () => {
        const block = formatEnsembleLineBlock(computeEnsembleLine([{ seat: 'A', conviction: 70 }]));
        expect(block).toContain('DETERMINISTIC ENSEMBLE LINE');
        expect(block).toContain('NOT an override');
        expect(formatEnsembleLineBlock(null)).toBe('');
    });
});

describe('context-match directive', () => {
    it('makes NO TRADE a first-class outcome of the first round', () => {
        expect(CONTEXT_MATCH_DIRECTIVE).toContain('CONTEXT-MATCH FIRST');
        expect(CONTEXT_MATCH_DIRECTIVE).toContain('NO TRADE');
        expect(CONTEXT_MATCH_DIRECTIVE).toContain('regime');
        expect(CONTEXT_MATCH_DIRECTIVE).toContain('kill zone');
    });
});

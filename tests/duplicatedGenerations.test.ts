import { describe, it, expect } from 'vitest';
import { generateDivergenceContext } from '../services/providers/ensembleConsensus';
import { duplicateTextPairs } from '../services/ui/EnsembleAnalystService';
import type { TradeAnalysis } from '../types';

/**
 * A gateway that serves ONE generation to several seats must not be allowed to
 * read as consensus. The detector has existed for a while but stopped at a
 * toast, so the moderator kept counting an echo as a second independent
 * confirmation — these pin the part that was missing: the fact reaching the
 * model that is about to weigh the votes.
 */

const a = (over: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Long', confidence: 'High', entryPoints: [], takeProfit: [],
    reasoning: '', ...over,
} as TradeAnalysis);

/**
 * Two genuinely distinct generations. They must differ in vocabulary AND
 * structure: an early draft of this file swapped one phrase inside an
 * otherwise identical paragraph and the detector — correctly — still called it
 * a 94% echo, because that IS what a gateway collapse looks like.
 */
const ECHO_A = 'BTC is pressing into the 200-EMA on declining funding while the '
    + 'liquidation book thins above the swing; the cleanest expression is a staged '
    + 'short with half risk, invalidated on a 4h close beyond the range high, and a '
    + 'time stop if the reclaim never comes. '.repeat(2);

const ECHO_B = 'Three weeks of higher-timeframe accumulation, spot premium turning '
    + 'positive and VWAP reclaimed on rising volume argue for adding longs into the '
    + 'pullback. Size a third now, another third at the value-area low, and treat a '
    + 'daily close beneath the 20-day average as the idea being wrong. '.repeat(2);

const ECHO_C = 'News-driven expansion is not a trend: the move is thin, the order '
    + 'book is one-sided, and nothing here survives a full session of two-way tape. '
    + 'Stand aside, mark the extremes, and re-underwrite the setup after the next '
    + 'settlement print rather than chasing the wick. '.repeat(2);

const results = (outputs: string[], direction: 'Long' | 'Short' = 'Long') => outputs.map(finalOutput => ({
    analysis: a({ direction, confidence: 'Medium' }),
    thoughtProcess: '',
    finalOutput,
}));

describe('duplicateTextPairs', () => {
    it('finds an identical pair and reports it by index', () => {
        const pairs = duplicateTextPairs([ECHO_A, ECHO_A, ECHO_B]);
        expect(pairs).toHaveLength(1);
        expect(pairs[0]).toMatchObject({ a: 0, b: 1, identical: true, similarity: 1 });
    });

    it('leaves genuinely different generations alone', () => {
        expect(duplicateTextPairs([ECHO_A, ECHO_B, ECHO_C])).toHaveLength(0);
    });

    it('refuses to judge a short answer, where agreement is expected', () => {
        expect(duplicateTextPairs(['Avoid.', 'Avoid.'])).toHaveLength(0);
    });

    it('survives an empty and an undefined roster', () => {
        expect(duplicateTextPairs([])).toHaveLength(0);
        expect(duplicateTextPairs([undefined, undefined, ''])).toHaveLength(0);
    });

    it('pairs more than two seats that share one generation', () => {
        expect(duplicateTextPairs([ECHO_A, ECHO_A, ECHO_A])).toHaveLength(3); // 0⇄1, 0⇄2, 1⇄2
    });
});

describe('the moderator is told which seats are one voice', () => {
    const names = ['Gemini', 'OpenAI', 'Claude'];

    it('names the echoed seats and says not to count them twice', () => {
        const block = generateDivergenceContext(
            results([ECHO_A, ECHO_A, ECHO_B]), names,
        );
        expect(block).toMatch(/DUPLICATED GENERATIONS/i);
        expect(block).toMatch(/NOT INDEPENDENT/i);
        expect(block).toContain('Gemini ⇄ OpenAI');
        expect(block).toMatch(/do not raise confidence/i);
        // The third seat generated independently and must not be implicated.
        expect(block).not.toMatch(/Claude ⇄/);
        expect(block).not.toMatch(/Gemini ⇄ Claude/);
    });

    it('says nothing when every seat generated independently', () => {
        const block = generateDivergenceContext(
            results([ECHO_A, ECHO_B, ECHO_C]), names,
        );
        expect(block).not.toMatch(/DUPLICATED GENERATIONS/i);
    });

    /** The check no longer sits behind the divergence verdict's own early
     *  return: an echo is reportable whether the seats also agree on direction
     *  or not, and the duplicated text is the same fact either way. */
    it('reports an echo whether the seats agree or disagree on direction', () => {
        for (const direction of ['Long', 'Short'] as const) {
            const block = generateDivergenceContext(results([ECHO_A, ECHO_A], direction), ['Gemini', 'OpenAI']);
            expect(block).toMatch(/DUPLICATED GENERATIONS/i);
        }
    });

    it('copes with a short names list rather than indexing past it', () => {
        const block = generateDivergenceContext(results([ECHO_A, ECHO_A]), ['Gemini']);
        expect(block).toMatch(/Gemini ⇄ seat 2/);
    });
});

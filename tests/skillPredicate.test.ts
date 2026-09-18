import { describe, it, expect } from 'vitest';
import {
    parsePredicate,
    buildPredicateSeries,
    evaluatePredicateAt,
    evaluatePredicateSource,
    resolveField,
    predicateFields,
    lastClosedIndex,
    PREDICATE_MAX_LENGTH,
} from '../services/analysis/skillPredicate';
import type { ScanCandle } from '../services/trade/setupScan';

// The predicate language is the one place a model-authored string becomes
// executable policy, so the parser's REJECTIONS matter more than its accepts.

const ok = (src: string) => parsePredicate(src).ok;
const err = (src: string): string => {
    const r = parsePredicate(src);
    return r.ok ? '' : r.error;
};

const bar = (o: number, h: number, l: number, c: number, v: number): ScanCandle =>
    ({ time: 0, open: o, high: h, low: l, close: c, volume: v });

describe('parsePredicate — accepts', () => {
    it('takes the documented comparison and conjunction forms', () => {
        for (const src of [
            'rsi14 > 70',
            'rsi_14 > 70',
            'RSI14 >= 70 and volume_sma_20 > 0',
            'close > sma20 && volumeRatio < 0.5',
            'not (close > bbUpper)',
            'close > sma20 and (rsi14 > 50 or volumeRatio > 1.5)',
            'rangePct < 0.4 and atr14 > 0',
        ]) {
            expect(ok(src), src).toBe(true);
        }
    });

    it('normalizes separators out of field names', () => {
        expect(resolveField('RSI_14')).toBe('rsi14');
        expect(resolveField('volume-sma-20')).toBe('volumeSma20');
        expect(resolveField('Volume Ratio')).toBe('volumeRatio');
        expect(resolveField('rsi')).toBe('rsi14');
    });
});

describe('parsePredicate — rejects', () => {
    it('refuses any field not derived from candles', () => {
        // The blueprint's flagship example used funding rate; the repo keeps no
        // historical series for it, so a predicate naming it must not evaluate.
        expect(ok('funding_rate > 0.0005')).toBe(false);
        expect(err('funding_rate > 0.0005')).toMatch(/unknown field/);
        expect(ok('open_interest > 1000')).toBe(false);
    });

    it('refuses names that are not conditions', () => {
        expect(ok('close')).toBe(false);            // a bare value is not a test
        expect(ok('close >')).toBe(false);          // dangling operator
        expect(ok('close > 1 and')).toBe(false);
        expect(ok('(close > 1')).toBe(false);       // unbalanced
        expect(ok('close > 1)')).toBe(false);
        expect(ok('')).toBe(false);
        expect(ok('   ')).toBe(false);
    });

    it('refuses assignment, member access and JS-shaped payloads', () => {
        expect(ok('close = 1')).toBe(false);
        // Prototype names must not pass the whitelist via Object.prototype.
        for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
            expect(ok(`${name} > 1`), name).toBe(false);
            expect(resolveField(name), name).toBeUndefined();
        }
        expect(ok('this.close > 1')).toBe(false);    // "." terminates a token
        expect(ok('close > 1; alert(1)')).toBe(false);
        expect(ok('globalThis > 0')).toBe(false);
    });

    it('bounds length and nesting', () => {
        expect(ok(`rsi14 > 1 and ${'close > 0 and '.repeat(40)}volume > 0`)).toBe(false);
        expect(err('x'.repeat(PREDICATE_MAX_LENGTH + 1))).toMatch(/longer than/);
        const deep = `${'('.repeat(40)}rsi14 > 70${')'.repeat(40)}`;
        expect(deep.length <= PREDICATE_MAX_LENGTH ? ok(deep) : false).toBe(false);
    });
});

describe('evaluatePredicateAt', () => {
    // 40 rising bars with steady volume: warm indicators by the last bar.
    const rising: ScanCandle[] = Array.from({ length: 40 }, (_, i) =>
        bar(100 + i, 102 + i, 99 + i, 101 + i, 1000));
    const series = buildPredicateSeries(rising);
    const last = lastClosedIndex(series);

    it('fires on a condition the tape satisfies and stays quiet otherwise', () => {
        expect(evaluatePredicateSource('close > sma20', series, last)).toEqual({ status: 'fired' });
        expect(evaluatePredicateSource('close < sma20', series, last)).toEqual({ status: 'quiet' });
        expect(evaluatePredicateSource('rsi14 > 50', series, last)).toEqual({ status: 'fired' });
    });

    it('reports an unwarmed indicator as unknown, never as false', () => {
        // rsi14 has no value on bar 5 (needs 15), so nothing may be concluded.
        expect(evaluatePredicateSource('rsi14 > 70', series, 5)).toEqual({
            status: 'unknown', missing: ['rsi14'],
        });
    });

    it('keeps three-valued logic honest for and / or / not', () => {
        const ast = (s: string) => {
            const r = parsePredicate(s);
            if (!r.ok) throw new Error(r.error);
            return r.ast;
        };
        // unknown AND false → false (the false side is decisive)
        expect(evaluatePredicateAt(ast('rsi14 > 70 and close < 0'), series, 5)).toEqual({ status: 'quiet' });
        // unknown AND true → unknown (nothing can be concluded)
        expect(evaluatePredicateAt(ast('rsi14 > 70 and close > 0'), series, 5)).toEqual({ status: 'unknown', missing: ['rsi14'] });
        // unknown OR true → true (the true side is decisive)
        expect(evaluatePredicateAt(ast('rsi14 > 70 or close > 0'), series, 5)).toEqual({ status: 'fired' });
        // not unknown → unknown
        expect(evaluatePredicateAt(ast('not rsi14 > 70'), series, 5)).toEqual({ status: 'unknown', missing: ['rsi14'] });
    });

    it('treats a bar with no volume as unknown, not as zero volume', () => {
        const noVolume = rising.map(c => ({ ...c, volume: undefined }));
        const s = buildPredicateSeries(noVolume);
        expect(evaluatePredicateSource('volume < 999999', s, last)).toEqual({ status: 'unknown', missing: ['volume'] });
    });

    it('flags a stored predicate that no longer parses as invalid, not quiet', () => {
        expect(evaluatePredicateSource('funding_rate > 0', series, last)).toEqual({
            status: 'invalid', error: expect.stringContaining('unknown field'),
        });
    });

    it('refuses an out-of-range index rather than reading undefined as false', () => {
        expect(evaluatePredicateSource('close > 0', series, 9999)).toEqual({ status: 'unknown', missing: [] });
        expect(evaluatePredicateSource('close > 0', series, -1)).toEqual({ status: 'unknown', missing: [] });
    });
});

describe('predicateFields', () => {
    it('lists the fields a clause depends on for the evidence line', () => {
        expect(predicateFields('rsi14 > 70 and volumeRatio < 0.5').sort()).toEqual(['rsi14', 'volumeRatio']);
        expect(predicateFields('nonsense > 1')).toEqual([]);
    });
});

describe('storage', () => {
    it('drops a clause that cannot be evaluated instead of storing it', async () => {
        const { sanitizePredicate } = await import('../services/analysis/skillPredicate');
        expect(sanitizePredicate('funding_rate > 0.0005')).toBeUndefined();
        expect(sanitizePredicate('   ')).toBeUndefined();
        expect(sanitizePredicate(undefined)).toBeUndefined();
        expect(sanitizePredicate('  rsi_14 > 70  ')).toBe('rsi_14 > 70');
    });

    it('round-trips a predicate through the skill markdown frontmatter', async () => {
        const { serializeSkill, parseSkillMarkdown } = await import('../services/learning/SkillMemoryService');
        const meta = {
            status: 'confirmed', kind: 'avoid', wins: 3, losses: 1, consecutiveLosses: 0,
            tradeIds: [], body: '**Trigger:** t', ifCondition: 'when RSI is hot on fading volume',
            predicate: 'rsi_14 > 70 and volumeRatio < 0.5',
        } as Parameters<typeof serializeSkill>[0];
        const restored = parseSkillMarkdown(serializeSkill(meta, 'hot fade'))!;
        expect(restored.predicate).toBe('rsi_14 > 70 and volumeRatio < 0.5');
        // Still parsable after the trip through text, so the gate keeps working.
        expect(parsePredicate(restored.predicate!).ok).toBe(true);
    });

    it('writes no predicate line at all when the skill has none', async () => {
        const { serializeSkill } = await import('../services/learning/SkillMemoryService');
        const meta = {
            status: 'candidate', kind: 'repeat', wins: 0, losses: 0, consecutiveLosses: 0,
            tradeIds: [], body: 'x', ifCondition: 'a prose-only trigger',
        } as Parameters<typeof serializeSkill>[0];
        expect(serializeSkill(meta, 'prose only')).not.toContain('predicate:');
    });
});

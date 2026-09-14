/**
 * keyLevels — the Chart AI key-levels PROTOCOL, pure: parsing the fenced
 * `key-levels` block out of a model answer (display-stripping, closed-vs-open
 * fences, junk tolerance, caps, kind inference, high→low order), the chart
 * visibility model (master switch / pin / hover — the prototype's exact CSS
 * semantics), and the Dist formatter. The card + chart wiring these drive is
 * covered by tests/keyLevelsCard.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import {
    parseKeyLevels, deriveChartLines, formatDist, kindForLevel,
} from '../services/trade/keyLevels';

const BLOCK_TEXT = [
    'BTC is grounding after the spike. Rejection at the 24h high,',
    'ranging 77,500 – 76,650. Watch R1 for the first liquidity test.',
    '',
    '```key-levels',
    'R2 | 77,841 | 24h high — breakdown confirmed',
    'VWAP | 78582.00 | Price below VWAP — intraday bearish lean',
    'S1 | 77427 | EQ highs x7 (sweep bait)',
    'garbage line without a price',
    'R9 | notaprice | broken row',
    '```',
].join('\n');

describe('parseKeyLevels', () => {
    it('extracts valid levels from a closed block, skipping junk', () => {
        const { levels, hadBlock } = parseKeyLevels(BLOCK_TEXT);
        expect(hadBlock).toBe(true);
        expect(levels.map(l => l.price)).toEqual([78582, 77841, 77427]); // high → low
        expect(levels.map(l => l.label)).toEqual(['VWAP', 'R2', 'S1']);
        expect(levels.map(l => l.id)).toEqual(['kl0', 'kl1', 'kl2']); // positional after sort
    });

    it('classifies kinds by label/context so the colors agree with the tape', () => {
        const { levels } = parseKeyLevels(BLOCK_TEXT);
        const kinds = Object.fromEntries(levels.map(l => [l.label, l.kind]));
        expect(kinds).toMatchObject({ VWAP: 'vwap', R2: 'resistance', S1: 'support' });
        expect(kindForLevel('Demand', 'buyers defending')).toBe('support');
        expect(kindForLevel('Pivot', '')).toBe('level');
    });

    it('strips the block from the display text but keeps the prose', () => {
        const { clean } = parseKeyLevels(BLOCK_TEXT);
        expect(clean).not.toContain('key-levels');
        expect(clean).not.toContain('```');
        expect(clean).not.toContain('sweep bait');
        expect(clean).toContain('Watch R1 for the first liquidity test');
    });

    it('accepts the august-key-levels tag alias', () => {
        const { levels } = parseKeyLevels('```august-key-levels\nR1 | 100 | hi\n```');
        expect(levels).toHaveLength(1);
    });

    it('hides an OPEN block (mid-stream) but yields no levels yet', () => {
        const streaming = 'Analysis so far…\n\n```key-levels\nR1 | 100 | partial';
        const { clean, levels } = parseKeyLevels(streaming);
        expect(levels).toEqual([]);
        expect(clean).toBe('Analysis so far…');
    });

    it('passes text without a block through untouched', () => {
        const plain = 'No levels here, just prose.';
        const parsed = parseKeyLevels(plain);
        expect(parsed).toEqual({ clean: plain, levels: [], hadBlock: false });
        expect(parseKeyLevels('')).toEqual({ clean: '', levels: [], hadBlock: false });
    });

    it('caps at 12 levels and clamps absurd label/context lengths', () => {
        const many = Array.from({ length: 20 }, (_, i) => `L${i} | ${1000 + i} | ${'x'.repeat(300)}`).join('\n');
        const { levels } = parseKeyLevels('```key-levels\n' + many + '\n```');
        expect(levels.length).toBeLessThanOrEqual(12);
        expect(levels.every(l => l.label.length <= 24 && l.context.length <= 140)).toBe(true);
    });

    it('rejects non-positive and garbage prices instead of drawing nonsense', () => {
        const { levels } = parseKeyLevels('```key-levels\nA | -5 | bad\nB | 0 | zero\nC | 12.5 | fine\n```');
        expect(levels.map(l => l.label)).toEqual(['C']);
    });
});

describe('deriveChartLines (the prototype visibility model)', () => {
    const mk = () => [
        { id: 'kl0', label: 'R2', price: 200, context: '', kind: 'resistance' as const, color: '#f75d5f' },
        { id: 'kl1', label: 'S1', price: 100, context: '', kind: 'support' as const, color: '#07b56a' },
    ];

    it('master off + nothing pinned → every line hidden', () => {
        const lines = deriveChartLines(mk(), { allOn: false, pinned: new Set() });
        expect(lines.every(l => l.state === 'hidden')).toBe(true);
    });

    it('master on → all shown, pinned at full strength, hover previews', () => {
        const lines = deriveChartLines(mk(), { allOn: true, pinned: new Set(['kl1']), hoverId: 'kl0' });
        expect(lines.find(l => l.id === 'kl0')?.state).toBe('preview');
        expect(lines.find(l => l.id === 'kl1')?.state).toBe('pinned');
    });

    it('master off → pinned lines stay drawn; hover cannot reveal hidden ones', () => {
        const lines = deriveChartLines(mk(), { allOn: false, pinned: new Set(['kl0']), hoverId: 'kl1' });
        expect(lines.find(l => l.id === 'kl0')?.state).toBe('pinned');
        expect(lines.find(l => l.id === 'kl1')?.state).toBe('hidden');
    });
});

describe('formatDist', () => {
    it('signs distance from the mark with two decimals', () => {
        expect(formatDist(101, 100)).toBe('+1.00%');
        expect(formatDist(99, 100)).toBe('−1.00%');
        expect(formatDist(77841, 77625.88)).toBe('+0.28%');
    });
    it('em-dashes without a mark', () => {
        expect(formatDist(100, null)).toBe('—');
    });
});

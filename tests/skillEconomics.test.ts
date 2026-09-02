import { describe, it, expect } from 'vitest';

// §8.5c — context-budget economics: cost = injected chars, benefit = lift ×
// frequency, value = lift-per-char. Index lines (opening) are cheap; the
// full-body pull (verdict) is not — legacy records without `chars` fall back
// to per-stage defaults so BOTH are priced.

import {
    computeSkillEconomics,
    worstBudgetOffender,
    DEFAULT_INDEX_CHARS,
    DEFAULT_BODY_CHARS,
} from '../utils/skillEconomics';
import { MemoryInjectionRecord } from '../services/learning/MemoryInjectionService';
import { SkillLiftResult } from '../services/learning/MemoryProvenanceService';

const inj = (
    stage: string,
    sources: Array<{ path: string; chars?: number }>,
    ts = '2026-08-01T00:00:00Z',
): MemoryInjectionRecord => ({
    ts,
    stage,
    audience: 'analyst',
    sources: sources.map(s => ({ kind: 'skill', ...s })),
});

const lift = (name: string, liftPts: number | null, extra: Partial<SkillLiftResult> = {}): SkillLiftResult => ({
    fileId: `id-${name}`,
    name,
    influencedTrades: 2,
    postWinRate: 0.7,
    preWinRate: 0.55,
    lift: liftPts,
    verdict: liftPts === null ? 'insufficient-data' : 'positive',
    ...extra,
});

describe('computeSkillEconomics', () => {
    it('computes cost (Σ chars), benefit (lift × fires) and lift-per-char from fixture logs', () => {
        const injections = [
            inj('opening', [{ path: 'skills/mono.md', chars: 120 }]),
            inj('verdict', [{ path: 'skills/mono.md', chars: 400 }]),
            inj('opening', [{ path: 'skills/bloat.md', chars: 300 }]),
        ];
        const lifts = [lift('mono.md', 20), lift('bloat.md', 5)];

        const entries = computeSkillEconomics(injections, lifts);
        const mono = entries.find(e => e.stem === 'mono')!;
        const bloat = entries.find(e => e.stem === 'bloat')!;

        expect(mono.fires).toBe(2);
        expect(mono.indexFires).toBe(1);
        expect(mono.bodyFires).toBe(1);
        expect(mono.avgChars).toBe(260); // (120 + 400)/2
        expect(mono.cost).toBe(520);
        expect(mono.benefit).toBe(40); // 20pt × 2 fires
        expect(mono.liftPerChar).toBeCloseTo(40 / 520);

        expect(bloat.fires).toBe(1);
        expect(bloat.cost).toBe(300);
        expect(bloat.benefit).toBe(5);
        expect(bloat.liftPerChar).toBeCloseTo(5 / 300);
    });

    it('sorts descending on lift-per-char (best value first)', () => {
        const injections = [
            inj('opening', [{ path: 'skills/bloat.md', chars: 300 }]),
            inj('opening', [{ path: 'skills/good.md', chars: 60 }]),
        ];
        const entries = computeSkillEconomics(injections, [lift('good.md', 20), lift('bloat.md', 5)]);
        expect(entries.map(e => e.stem)).toEqual(['good', 'bloat']);
    });

    it('prices an index line and a recall pull differently (legacy records, no char count)', () => {
        // No `chars` on any source → per-stage defaults: index 120, body 450.
        const injections = [
            inj('opening', [{ path: 'skills/legacy.md' }]),
            inj('verdict', [{ path: 'skills/legacy.md' }]),
        ];
        const entries = computeSkillEconomics(injections, [lift('legacy.md', 10)]);
        const e = entries[0];
        expect(e.indexFires).toBe(1);
        expect(e.bodyFires).toBe(1);
        expect(e.cost).toBe(DEFAULT_INDEX_CHARS + DEFAULT_BODY_CHARS);
        expect(e.avgChars).toBe((DEFAULT_INDEX_CHARS + DEFAULT_BODY_CHARS) / 2);
        expect(DEFAULT_BODY_CHARS).toBeGreaterThan(DEFAULT_INDEX_CHARS * 2); // recall pulls dominate
    });

    it('a skill measured only as no-lift data never beats a measured skill in the offender race', () => {
        const entries = computeSkillEconomics(
            [
                inj('opening', [{ path: 'skills/ghost.md', chars: 900 }]),
                inj('opening', [{ path: 'skills/live.md', chars: 150 }]),
            ],
            [lift('ghost.md', null), lift('live.md', 2)],
        );
        // ghost has no measurable lift → excluded from the lift-driven pick
        expect(worstBudgetOffender(entries)?.stem).toBe('live');
    });

    it('with no lift data at all, the offender falls back to highest cost', () => {
        const entries = computeSkillEconomics(
            [
                inj('opening', [{ path: 'skills/small.md', chars: 80 }]),
                inj('opening', [{ path: 'skills/big.md', chars: 700 }]),
            ],
            [lift('small.md', null), lift('big.md', null)],
        );
        expect(worstBudgetOffender(entries)?.stem).toBe('big');
    });

    it('empty log yields no entries', () => {
        expect(computeSkillEconomics([], [])).toEqual([]);
        expect(worstBudgetOffender([])).toBeNull();
    });
});

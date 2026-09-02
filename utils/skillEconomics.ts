/**
 * §8.5c — context-budget economics (plan §8.5c).
 *
 * Injection chars are the scarce resource, but nothing measured a skill's
 * cost against its benefit: a +1pt-lift skill occupying 200 chars of every
 * opening slice can be net-negative versus letting a runner-up in.
 *
 * Cost  = Σ injected chars per fire (from the injection log's `chars` field;
 *         legacy records without it fall back to the per-stage default —
 *         an index line is cheap, a full-body verdict pull is not, so the
 *         §4.7 index-layer economics price both).
 * Benefit = lift points × injection frequency. liftPerChar = benefit / cost.
 *
 * The monthly report card names the worst offender (the most chars per unit
 * of measured benefit) so the library's cost side is audited on a cadence
 * instead of being invisible.
 */

import { MemoryInjectionRecord } from '../services/learning/MemoryInjectionService';
import { SkillLiftResult } from '../services/learning/MemoryProvenanceService';

/** Fallback cost when a legacy record carries no `chars` (per stage of the
 *  slice that contained the skill: opening = index line, verdict = body). */
export const DEFAULT_INDEX_CHARS = 120;
export const DEFAULT_BODY_CHARS = 450;

export interface SkillEconomicsEntry {
    /** skills/ file stem (name without .md). */
    stem: string;
    /** Injection fires containing this skill. */
    fires: number;
    /** Opening-stage fires (index line — cheap). */
    indexFires: number;
    /** Verdict-stage fires (full body — recall-grade, expensive). */
    bodyFires: number;
    /** Mean chars injected per fire. */
    avgChars: number;
    /** Measured lift in percentage points, or null when undetermined. */
    liftPts: number | null;
    /** Total chars spent on this skill across the log window. */
    cost: number;
    /** liftPts × fires (0 when no lift). */
    benefit: number;
    /** benefit / cost — null when cost is 0. */
    liftPerChar: number | null;
}

const costOfSource = (chars: number | undefined, stage: string): number =>
    typeof chars === 'number' && Number.isFinite(chars)
        ? Math.max(0, chars)
        : (stage === 'verdict' ? DEFAULT_BODY_CHARS : DEFAULT_INDEX_CHARS);

/** Aggregate per-skill cost/benefit from the injection log + lift results. */
export const computeSkillEconomics = (
    injections: MemoryInjectionRecord[],
    lifts: SkillLiftResult[],
): SkillEconomicsEntry[] => {
    const liftByName = new Map(lifts.map(l => [l.name.replace(/\.md$/i, ''), l]));
    const agg = new Map<string, { fires: number; indexFires: number; bodyFires: number; charSum: number }>();

    for (const rec of injections) {
        for (const src of rec.sources) {
            if (!src.path.startsWith('skills/')) continue;
            const stem = src.path.slice('skills/'.length).replace(/\.md$/i, '');
            const cur = agg.get(stem) ?? { fires: 0, indexFires: 0, bodyFires: 0, charSum: 0 };
            cur.fires += 1;
            if (rec.stage === 'verdict') cur.bodyFires += 1;
            else cur.indexFires += 1;
            cur.charSum += costOfSource(src.chars, rec.stage);
            agg.set(stem, cur);
        }
    }

    return [...agg.entries()]
        .map(([stem, cur]): SkillEconomicsEntry => {
            const liftPts = liftByName.get(stem)?.lift ?? null;
            const avgChars = cur.fires > 0 ? cur.charSum / cur.fires : 0;
            const cost = cur.charSum;
            const benefit = liftPts !== null ? liftPts * cur.fires : 0;
            return {
                stem,
                fires: cur.fires,
                indexFires: cur.indexFires,
                bodyFires: cur.bodyFires,
                avgChars,
                liftPts,
                cost,
                benefit,
                liftPerChar: cost > 0 ? benefit / cost : null,
            };
        })
        .sort((a, b) => (b.liftPerChar ?? -Infinity) - (a.liftPerChar ?? -Infinity));
};

/** The skill that spent the most chars for the least measured value.
 *  With lift data: smallest liftPerChar. Without: highest cost (a cost-side
 *  audit is still better than none). */
export const worstBudgetOffender = (entries: SkillEconomicsEntry[]): SkillEconomicsEntry | null => {
    const withLift = entries.filter(e => e.liftPts !== null && e.cost > 0);
    if (withLift.length > 0) {
        return withLift.reduce((w, e) =>
            (e.liftPerChar ?? Infinity) < (w.liftPerChar ?? Infinity) ? e : w,
        );
    }
    const costly = entries.filter(e => e.cost > 0);
    return costly.length > 0 ? costly.reduce((w, e) => (e.cost > w.cost ? e : w)) : null;
};

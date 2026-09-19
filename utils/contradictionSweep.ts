/**
 * Contradiction sweep.
 *
 * Nothing detected two LIVE skills with overlapping IF conditions and
 * conflicting THEN actions: both could inject (ranking independently) and
 * seats would receive incoherent guidance. This is a deterministic periodic
 * pass (weekly, inside the scheduled hygiene pass — no LLM): pairwise
 * condition-token overlap ≥ 2 with a conflicting action (opposite kind, or
 * opposing direction mention) surfaces a merge/priority proposal for the
 * human gate — deduped by fingerprint, so the same pair is not re-queued
 * every week. The counts come back as a `ContradictionSweepResult` so the
 * hygiene pass can write them into the health log instead of a console line.
 */

import { listSkills } from '../services/learning/SkillMemoryService';
import { queueLearningProposal } from './learningQueue';

export interface SkillForSweep {
    slug: string;
    ifCondition: string;
    thenAction: string;
    kind: 'avoid' | 'repeat';
}

export interface ContradictingPair {
    a: SkillForSweep;
    b: SkillForSweep;
    /** Number of shared meaningful condition tokens. */
    overlap: number;
    /** Why they conflict (for the proposal text). */
    conflict: 'opposite-kind' | 'opposite-direction';
}

const STOPWORDS = new Set(['the','a','an','in','on','at','for','to','of','and','or','when','then','if','not','no','with','into','after','before','while','is','are','any','all']);

const meaningfulTokens = (s: string): string[] => {
    const toks = (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return [...new Set(toks.filter(t => t.length >= 3 && !STOPWORDS.has(t)))];
};

const directionOf = (s: string): 'long' | 'short' | null => {
    const toks = meaningfulTokens(s);
    if (toks.includes('long') || toks.includes('buy')) return 'long';
    if (toks.includes('short') || toks.includes('sell')) return 'short';
    return null;
};

/** Pairwise contradictions among LIVE skills only (archive/retired excluded). */
export const findContradictingPairs = (skills: SkillForSweep[]): ContradictingPair[] => {
    const pairs: ContradictingPair[] = [];
    for (let i = 0; i < skills.length; i++) {
        for (let j = i + 1; j < skills.length; j++) {
            const a = skills[i];
            const b = skills[j];
            const ta = meaningfulTokens(a.ifCondition);
            const tb = meaningfulTokens(b.ifCondition);
            const overlap = ta.filter(t => tb.includes(t)).length;
            if (overlap < 2) continue;
            const conflict = a.kind !== b.kind
                ? ('opposite-kind' as const)
                : (() => {
                    const da = directionOf(a.ifCondition);
                    const db = directionOf(b.ifCondition);
                    return da && db && da !== db ? ('opposite-direction' as const) : null;
                })();
            if (conflict) pairs.push({ a, b, overlap, conflict });
        }
    }
    return pairs;
};

/** What one sweep actually did — every number here is a count of real work,
 *  so the hygiene pass can report the run instead of logging it to nowhere. */
export interface ContradictionSweepResult {
    /** Live-skill pairs compared (n(n-1)/2 over the eligible skills). */
    pairsExamined: number;
    /** Pairs that genuinely contradicted (shared tokens + conflicting action). */
    conflicts: number;
    /** NEW merge/priority proposals this pass queued. */
    queued: number;
    /** Conflict pairs dismissed by the fingerprint dedupe — their proposal is
     *  still pending in the queue, so there was nothing to re-queue. */
    dismissed: number;
}

/**
 * The weekly pass: queue one deduped merge/priority proposal per pair.
 * Called by the scheduled hygiene pass (`memoryHygiene.runMemoryHygiene`),
 * which turns the result into the one-line health entry the Health tab
 * renders — the counts used to stop at a `console.log` and reached nobody.
 */
export const runContradictionSweep = (username: string): ContradictionSweepResult => {
    const skills: SkillForSweep[] = listSkills()
        .filter(({ meta }) => meta.status !== 'retired' && !meta.supersededBy && (meta.wins + meta.losses) > 0)
        .map(({ file, meta }) => ({
            slug: file.name.replace(/\.md$/i, ''),
            ifCondition: meta.ifCondition ?? '',
            thenAction: meta.thenAction ?? '',
            kind: meta.kind,
        }));
    const pairs = findContradictingPairs(skills);
    const result: ContradictionSweepResult = {
        pairsExamined: skills.length * (skills.length - 1) / 2,
        conflicts: pairs.length,
        queued: 0,
        dismissed: 0,
    };
    for (const p of pairs) {
        const text = `Contradicting live skills: "${p.a.slug}" (${p.a.kind}) vs "${p.b.slug}" (${p.b.kind}) share ${p.overlap} condition tokens (${p.conflict.replace('-', ' ')}) — seats can receive incoherent guidance. Merge or prioritize one.`;
        const proposal = queueLearningProposal({
            kind: 'contradiction',
            text,
            skillSlug: p.a.slug,
            relatedSlug: p.b.slug,
            fingerprint: `contradiction|${[p.a.slug, p.b.slug].sort().join('|')}`,
            payload: { pair: [p.a.slug, p.b.slug] },
        }, username);
        if (proposal) result.queued += 1;
        else result.dismissed += 1;
    }
    return result;
};

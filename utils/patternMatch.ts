/**
 * Negation-aware pattern-family matching.
 *
 * Family/pattern strings come from LLM-extracted analysis fields, so plain
 * substring matching used to treat "breakout" and "fake-breakout" as the same
 * family — the exact opposite setup. Matching now works on word segments with
 * a small negator lexicon: segments may overlap, but an unmatched negator on
 * either side flips the meaning and forces a non-match.
 */

const NEGATORS = new Set([
    'fake', 'false', 'failed', 'failure', 'exhausted', 'inverted', 'rejection', 'rejected',
]);

const segmentsOf = (value: string): string[] =>
    value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * TRUE when two family strings plausibly describe the same setup: they share
 * at least one word segment AND neither side carries a negator segment the
 * other lacks.
 *   familiesRelate('breakout', 'fake-breakout')   → false
 *   familiesRelate('breakout retest', 'breakout') → true
 *   familiesRelate('fake-breakout', 'Fake Breakout') → true
 */
export const familiesRelate = (a: string, b: string): boolean => {
    const sa = segmentsOf(a);
    const sb = segmentsOf(b);
    if (sa.length === 0 || sb.length === 0) return false;
    if (!sa.some(s => sb.includes(s))) return false;
    const negated = (segs: string[], other: string[]): boolean =>
        segs.some(s => NEGATORS.has(s) && !other.includes(s));
    return !negated(sa, sb) && !negated(sb, sa);
};

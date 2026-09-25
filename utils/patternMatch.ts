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

/**
 * Words that NAME a family rather than describe one. The app's own labels are
 * "Family A" … "Family Z", so every one of them contains the literal token
 * "family" — which made `familiesRelate('Family Z', 'Family A')` TRUE on the
 * shared word alone. That is not a near-miss: this same predicate backs the
 * strict enforcement matcher, so a "Family A" skill claimed to cover
 * "Family Z" and a distinct setup looked already handled.
 *
 * Stripped from the FRONT only, and only while something remains — so a bare
 * "family" is still comparable, and a family genuinely NAMED "family" keeps it.
 */
const LABEL_PREFIXES = new Set(['family', 'pattern', 'setup', 'class', 'type']);

const segmentsOf = (value: string): string[] => {
    const segs = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    while (segs.length > 1 && LABEL_PREFIXES.has(segs[0])) segs.shift();
    return segs;
};

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

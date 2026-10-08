/**
 * followedSkills — the machine-readable citation line on a moderator verdict.
 *
 * Skill adherence used to be INFERRED: `annotateVerdictCitations` guessed which
 * skills a verdict followed by matching the slug stem, the title words, or the
 * majority of the IF-clause's significant words against the verdict prose. That
 * is a heuristic over free text, and it misroutes real evidence — a verdict
 * that paraphrases a rule without reusing its nouns reads as `overridden`, so
 * the skill that actually shaped the trade is denied credit.
 *
 * The verdict is already asked for other machine-readable lines (`KEPT:` via
 * `parseKeptAnalyst`), so this follows the same convention: the moderator names
 * the skills it followed, and the join becomes exact. Word-overlap stays as a
 * FALLBACK for verdicts written before this line existed — an old transcript
 * must not silently read as "followed nothing".
 */

/** The literal prefix the moderator is told to emit. Kept lowercase and
 *  hyphenated so it cannot be confused with prose. */
export const FOLLOWED_SKILLS_LABEL = 'followed-skills:';

/**
 * Parse the `followed-skills:` line out of a verdict.
 *
 * Returns the normalized slugs (no `skills/` prefix, no `.md`), or `null` when
 * the line is ABSENT — which is what lets the caller tell "the model said it
 * followed nothing" (`[]`) apart from "this verdict predates the line"
 * (`null`, fall back to word overlap).
 *
 * Accepts the several shapes a model actually writes: a bare slug list, a
 * `skills/`-prefixed path, a `.md` suffix, `none`, and `(none)`.
 */
export const parseFollowedSkills = (text: string): string[] | null => {
    const match = text.match(/^\s*followed-skills:\s*(.*)$/im);
    if (!match) return null;
    const raw = match[1].replace(/[.\s]+$/, '').trim();
    if (!raw || /^\(?none\)?$/i.test(raw)) return [];
    return raw
        .split(/[,;]/)
        .map(normalizeSkillSlug)
        .filter((s): s is string => Boolean(s));
};

/** `skills/btc-short-avoid.md` → `btc-short-avoid`. Both the prompt's display
 *  path and the stored source path have to resolve to one identity, or the
 *  join silently misses. */
export const normalizeSkillSlug = (raw: string): string => {
    const s = raw.trim().replace(/^["'`]|["'`]$/g, '').trim();
    if (!s) return '';
    return s.replace(/^skills\//i, '').replace(/\.md$/i, '').trim().toLowerCase();
};

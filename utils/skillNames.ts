/**
 * How a skill's name is spoken.
 *
 * A skill is a FILE: `fade-the-first-break.md`. That slug is its identity —
 * the Approvals inbox, the notebook and every write path use it — so it must
 * never be rewritten. But a CATALOGUE that lists twelve of them wants the
 * human name, the way the reference's skills panel names "Fc Nginx Website"
 * rather than the file behind it.
 *
 * So the two are different things: the slug identifies, the display name
 * labels. This is the ONE place the label is made, so a skill cannot be
 * called one thing on a card and another in a list.
 */

/**
 * The display name for a skill slug: dashes and underscores become spaces,
 * the first letter is capitalised, and the file extension is dropped (it is
 * an implementation detail of where the rule lives, not part of its name).
 *
 * The slug is returned unchanged when there is nothing to humanize — a name
 * that is already a phrase reads better as it was written.
 */
export const humanizeSkillName = (slug: string): string => {
    const trimmed = slug.trim();
    if (!trimmed) return trimmed;
    const withoutExt = trimmed.replace(/\.(md|markdown)$/i, '');
    const words = withoutExt.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words) return trimmed;
    return words.replace(/^\w/, c => c.toUpperCase());
};

/**
 * followedSkills — the one skill-slug normalizer shared by the prompt display
 * path and the stored source path. The verdict annotator that once consumed a
 * `followed-skills:` line was deleted with the debate engine; its parser and
 * label went with it, and no caller remains.
 */
export const normalizeSkillSlug = (raw: string): string => {
    const s = raw.trim().replace(/^["'`]|["'`]$/g, '').trim();
    if (!s) return '';
    return s.replace(/^skills\//i, '').replace(/\.md$/i, '').trim().toLowerCase();
};

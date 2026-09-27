/**
 * escapeRegExp — the ONE regex-metacharacter escaper.
 *
 * Seven hand-rolled copies of `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` had
 * drifted across five files; each new copy is a chance for one to later drop
 * a character, so a user/model-supplied label breaks — or silently widens —
 * a RegExp built from it. Escape through here and never inline the class.
 */
export const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

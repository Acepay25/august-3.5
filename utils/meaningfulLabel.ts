/**
 * Labels that flow back from the model layer (pattern families, IF/THEN
 * clause text, lesson lines) are sometimes placeholder junk rather than
 * absent — e.g. the analysis schema defaults empty marketConditions fields
 * to the literal string 'N/A'. Everything that builds learned artifacts
 * (skill drafts, skill descriptions, pattern-memory sections) must treat
 * those placeholders as missing, or the notebook fills up with skills about
 * the "N/A pattern".
 */

const JUNK_LABELS = new Set([
    'n/a', 'n.a.', 'n.a', 'na', 'none', 'null', 'undefined', 'nil',
    'unknown', 'tbd', 'not applicable', 'no data', 'no setup', 'nothing',
    '-', '—', '–', '...', '…', '?',
]);

/** True when `value` is a real label, not a placeholder emitted for "no value". */
export const isMeaningfulLabel = (value: string | null | undefined): boolean => {
    if (typeof value !== 'string') return false;
    const cleaned = value.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleaned.length < 3) return false;
    return !JUNK_LABELS.has(cleaned);
};

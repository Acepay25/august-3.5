/**
 * memorySections — the display categories on Settings → Memory.
 *
 * A memory row belongs to a section a person reads ("Trading", "Risk",
 * "Instruments"), not to a storage enum. The model names the section when it
 * writes (`remember.section`); a NEW name creates a new section, so the page
 * grows with the trading vocabulary instead of being trapped in the fixed
 * subject set. Rows written before this field fall back to their subject, which
 * keeps legacy files grouped exactly as they were.
 *
 * One vocabulary for the page, the export and the store's own write path, so a
 * label can never be spelled two ways in two places.
 */

import type { ProfileMemoryEntry } from './profileMemory';

/** The fallback sections, in the order they hold when no custom name applies. */
export const DEFAULT_MEMORY_SECTIONS: readonly string[] = [
    'Preferences', 'Profile', 'Topics', 'People', 'Areas',
];

const FALLBACK_BY_SUBJECT: Record<NonNullable<ProfileMemoryEntry['subject']>, string> = {
    preference: 'Preferences',
    profile: 'Profile',
    topic: 'Topics',
    person: 'People',
    area: 'Areas',
};

const titleWords = (raw: string): string => raw
    .split(' ')
    .map(w => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

/**
 * A display section name, or null when the text is empty. Kebab/snake and
 * all-lowercase input is title-cased ("risk_management" → "Risk Management");
 * deliberate casing is preserved ("BTC", "AI Tools").
 */
export const normalizeMemorySection = (raw: unknown): string | null => {
    if (typeof raw !== 'string') return null;
    const text = raw.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').slice(0, 40);
    if (!text) return null;
    return /[A-Z]/.test(text) ? text : titleWords(text);
};

/** The section a row falls into when it carries no explicit one. */
export const fallbackSectionOf = (
    entry: Pick<ProfileMemoryEntry, 'subject' | 'kind'>,
): string => FALLBACK_BY_SUBJECT[
    entry.subject ?? (entry.kind === 'user' ? 'profile'
        : entry.kind === 'feedback' ? 'preference'
            : entry.kind === 'project' ? 'area' : 'topic')
];

/** The one label a row is displayed and exported under. */
export const memorySectionOf = (
    entry: Pick<ProfileMemoryEntry, 'section' | 'subject' | 'kind'>,
): string => normalizeMemorySection(entry.section) ?? fallbackSectionOf(entry);

/** Custom sections first (alphabetical), then the fallback sections in their
 *  own order. A model-created trading category is what the trader came for, so
 *  it must not sit under five generic headings. */
export const orderMemorySections = (labels: readonly string[]): string[] => {
    const unique = [...new Set(labels.filter(Boolean))];
    const isDefault = (label: string): boolean => DEFAULT_MEMORY_SECTIONS.includes(label);
    const custom = unique.filter(label => !isDefault(label)).sort((a, b) => a.localeCompare(b));
    const defaults = DEFAULT_MEMORY_SECTIONS.filter(label => unique.includes(label));
    return [...custom, ...defaults];
};

/** A stable DOM id for a section heading: "Risk Management" → risk-management. */
export const memorySectionSlug = (label: string): string =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';

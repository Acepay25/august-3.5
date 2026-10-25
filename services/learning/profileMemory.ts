/**
 * profileMemory — August's counterpart to this coding agent's memory system.
 *
 * The trader NOTEBOOK (MemoryFilesService) remembers what the MARKET taught
 * the models. This remembers what the USER taught the assistant — the small,
 * durable facts about the collaboration itself, in the same shape this
 * environment's memory has:
 *
 *   • one fact per entry, with a short kebab-case slug, a one-line
 *     description (used to decide relevance), and a body holding the fact;
 *   • four kinds — 'user' (who they are), 'feedback' (how they want the
 *     assistant to work — bodies carry **Why** + **How to apply**),
 *     'project' (ongoing work/constraints not derivable from the journal),
 *     'reference' (pointers to external things);
 *   • the INDEX (slug + one-line description per entry) is injected into
 *     every Chart AI system prompt and every analysis-pipeline memory block —
 *     always loaded, like this environment's MEMORY.md;
 *   • bodies are pulled on demand via the read_memory desk tool, not dumped;
 *   • the model maintains it itself: remember (upsert by slug — update over
 *     duplicate), forget (wrong memories get deleted, not left to rot).
 *
 * Per-user localStorage blob (`profile_memory_v1_${user}`), bounded — same
 * persistence grain as learningQueue/chatSessions, so no new storage path.
 */

import { getActiveUsername } from '../../utils/activeUser';

export type ProfileMemoryKind = 'user' | 'feedback' | 'project' | 'reference';

export interface ProfileMemoryEntry {
    /** Short kebab-case slug — the entry's identity (upsert key). */
    slug: string;
    /** One line, ≤ ~140 chars: how to decide relevance. */
    description: string;
    kind: ProfileMemoryKind;
    /** The fact itself (markdown). feedback/project bodies should carry
     *  **Why:** / **How to apply:** lines. */
    body: string;
    /** Provenance: who wrote it — the model via remember(), the automatic
     *  trader learner ('auto'), or a human edit. Absent on legacy rows. */
    source?: 'model' | 'auto' | 'user';
    createdAt: string;
    updatedAt: string;
    /** Optimistic-lock counter, incremented on every write. Absent on legacy
     *  rows — read as 1, so a first if_version against a legacy row succeeds
     *  and stamps the field from then on. */
    version?: number;
    /** Provenance of the fact: 'stated' (the USER said it — the only tag the
     *  chat agent may write), 'observed' (a system path watched behaviour) or
     *  'inferred'. Absent on legacy rows reads as 'stated' — that is what
     *  every pre-field row was. */
    tag?: 'stated' | 'observed' | 'inferred';
    /** A sensitive-category fact (health / finances / identity). Stored only
     *  when the user's setting allows, and excluded from pre-reads and
     *  unattended contexts. */
    sensitive?: boolean;
    /** Extra match strings the deterministic pre-read may hit on, beyond the
     *  slug's own words ("bun" for user-runs-bun). */
    aliases?: string[];
    /** The row as it read BEFORE this edit — "now X, previously Y". One
     *  generation deep; the history is provenance, not a version store. */
    previous?: { body: string; description: string; updatedAt: string };
}

const KEY_PREFIX = 'profile_memory_v1';
/** The store's hard limits. Exported so the consolidation pass and the UI use
 *  the same numbers the write path enforces. */
export const PROFILE_MEMORY_MAX_ENTRIES = 40;
export const PROFILE_MEMORY_MAX_BODY_CHARS = 2_000;
const MAX_ENTRIES = PROFILE_MEMORY_MAX_ENTRIES;
const MAX_BODY_CHARS = PROFILE_MEMORY_MAX_BODY_CHARS;
const MAX_DESC_CHARS = 160;

const storageKey = (user: string): string => `${KEY_PREFIX}_${user}`;

const KINDS: readonly string[] = ['user', 'feedback', 'project', 'reference'];

export const normalizeKind = (v: unknown): ProfileMemoryKind | null =>
    typeof v === 'string' && KINDS.includes(v) ? v as ProfileMemoryKind : null;

/** Kebab-case slug from a name (stable, collision-safe enough). */
export const slugify = (name: string): string =>
    (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const readAll = (user: string): ProfileMemoryEntry[] => {
    try {
        const raw = localStorage.getItem(storageKey(user));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e): e is ProfileMemoryEntry => {
            const v = e as ProfileMemoryEntry;
            return !!v && typeof v === 'object'
                && typeof v.slug === 'string' && typeof v.description === 'string'
                && typeof v.body === 'string' && normalizeKind(v.kind) !== null;
        });
    } catch (err) {
        // A read that cannot happen must not look like an empty notebook: the
        // prompt would silently forget every fact the trader taught it.
        console.error('[profileMemory] read FAILED — memory is unavailable this turn:', err);
        return [];
    }
};

const writeAll = (user: string, entries: ProfileMemoryEntry[]): void => {
    try {
        localStorage.setItem(storageKey(user), JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch (err) {
        // The cache is not a store here: readAll() re-reads localStorage, so a
        // swallowed throw means the tool says "saved" and the next turn knows
        // nothing. Log it and let the caller report the failure.
        console.error('[profileMemory] write FAILED — the fact is NOT on disk:', err);
        throw err;
    }
    // Nudge any open Settings → Memory card to re-read.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('august-profile-memory'));
};

/** All entries for the active user, oldest first. */
export const listProfileMemories = (username?: string): ProfileMemoryEntry[] =>
    readAll(username || getActiveUsername());

export const getProfileMemory = (slug: string, username?: string): ProfileMemoryEntry | undefined =>
    listProfileMemories(username).find(e => e.slug === slug);

/**
 * Create or UPSERT by slug (update in place beats a near-duplicate, mirroring
 * this environment's "update the file rather than create a duplicate").
 * Returns the entry + whether it was new.
 */
export type RememberResult =
    /** `persisted:false` means the entry was built but storage refused it —
     *  the caller must NOT report success. */
    | { entry: ProfileMemoryEntry; created: boolean; conflict?: false; persisted?: boolean; error?: string }
    /** `if_version` did not match: nothing was written. `current` is the row
     *  that IS stored, so the caller can merge and retry in the same turn
     *  instead of overwriting a concurrent edit blind. */
    | { conflict: true; current: ProfileMemoryEntry };

export const rememberProfileMemory = (input: {
    slug?: string; name?: string; description: string; kind: ProfileMemoryKind; body: string;
    source?: ProfileMemoryEntry['source'];
    /** Provenance of the fact — only 'stated' is writable by the chat agent;
     *  'observed'/'inferred' come from separate system paths. */
    tag?: ProfileMemoryEntry['tag'];
    /** Sensitive-category flag (the caller decides, from the user's setting,
     *  whether a detected sensitive write is refused or flagged). */
    sensitive?: boolean;
    /** Extra match strings for the deterministic pre-read. */
    aliases?: string[];
    /** Optimistic lock: when given and a row with this slug already exists,
     *  the write only lands if the row's version is exactly this. */
    ifVersion?: number;
}, username?: string): RememberResult => {
    const user = username || getActiveUsername();
    const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name || input.description);
    const now = new Date().toISOString();
    const all = readAll(user);
    const idx = all.findIndex(e => e.slug === (slug || ''));
    if (idx >= 0 && typeof input.ifVersion === 'number' && (all[idx].version ?? 1) !== input.ifVersion) {
        return { conflict: true, current: all[idx] };
    }
    const prior = idx >= 0 ? all[idx] : undefined;
    const entry: ProfileMemoryEntry = {
        slug: slug || `memory-${Date.now().toString(36)}`,
        description: input.description.trim().slice(0, MAX_DESC_CHARS),
        kind: input.kind,
        body: input.body.trim().slice(0, MAX_BODY_CHARS),
        ...(input.source ? { source: input.source } : {}),
        ...(input.tag ? { tag: input.tag } : {}),
        ...(input.sensitive !== undefined ? { sensitive: input.sensitive } : {}),
        ...(input.aliases ? { aliases: input.aliases.map(a => a.trim()).filter(Boolean).slice(0, 8) } : {}),
        createdAt: now,
        updatedAt: now,
        version: idx >= 0 ? (prior!.version ?? 1) + 1 : 1,
        // "now X, previously Y": one generation of provenance, stamped only
        // when the body actually changed — re-saving identical text is not
        // history, it is churn.
        ...(idx >= 0 && prior!.body !== input.body.trim()
            ? { previous: { body: prior!.body, description: prior!.description, updatedAt: prior!.updatedAt } }
            : {}),
    };
    const created = idx < 0;
    if (created) {
        all.push(entry);
    } else {
        all[idx] = { ...all[idx], ...entry, createdAt: all[idx].createdAt };
    }
    try {
        writeAll(user, all);
        return { entry, created, persisted: true };
    } catch (err) {
        return { entry, created, persisted: false, error: err instanceof Error ? err.message : String(err) };
    }
};

export const forgetProfileMemory = (slug: string, username?: string): boolean => {
    const user = username || getActiveUsername();
    const all = readAll(user);
    const next = all.filter(e => e.slug !== slug);
    if (next.length === all.length) return false;
    try {
        writeAll(user, next);
        return true;
    } catch {
        return false;
    }
};

/** How many index lines a prompt gets (capped; older entries fall off — the
 *  newest remember more, like this environment trimming its index). */
const INDEX_MAX_LINES = 30;
const INDEX_LINE_MAX = 150;

/**
 * The always-loaded memory index for prompts — one line per entry:
 * `- [kind] slug — description`. Empty string when nothing is stored, so it
 * composes cleanly into any prompt. The model reads bodies via read_memory.
 */
export const buildProfileMemoryIndex = (username?: string, maxLines = INDEX_MAX_LINES): string => {
    // A sensitive fact never rides the always-on index: this block is injected
    // into every turn, including turns that have nothing to do with health,
    // money or identity. It stays readable by explicit slug when the trader
    // asks; it is not advertised to every future prompt.
    const visible = listProfileMemories(username).filter(e => !e.sensitive);
    if (visible.length === 0) return '';
    const newest = visible.slice(-maxLines);
    const lines = newest.map(e => {
        const desc = e.description.length > INDEX_LINE_MAX ? `${e.description.slice(0, INDEX_LINE_MAX - 1)}…` : e.description;
        const tagMark = e.tag === 'observed' ? ' ·observed' : e.tag === 'inferred' ? ' ·inferred' : '';
        return `- [${e.kind}] ${e.slug}${tagMark} — ${desc}`;
    });
    const dropped = visible.length - newest.length;
    return [
        `## Your memory about this user — ${visible.length} entr${visible.length === 1 ? 'y' : 'ies'}. These are collaboration facts (who they are, how they want you to work, ongoing context), NOT trading lessons. When one matters, pull its full body with read_memory(slug). If this session teaches you something durable about the USER, save it with remember (update an existing slug rather than duplicating).`,
        ...lines,
        dropped > 0 ? `…${dropped} older entr${dropped === 1 ? 'y' : 'ies'} not listed — read_memory with slug "all" shows every entry.` : '',
    ].filter(Boolean).join('\n');
};

/** Test hook: wipe the store. */
export const __clearProfileMemoriesForTests = (username?: string): void => {
    try { localStorage.removeItem(storageKey(username || getActiveUsername())); } catch { /* noop */ }
};

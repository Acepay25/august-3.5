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
}

const KEY_PREFIX = 'profile_memory_v1';
const MAX_ENTRIES = 40;
const MAX_BODY_CHARS = 2_000;
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
    } catch {
        return [];
    }
};

const writeAll = (user: string, entries: ProfileMemoryEntry[]): void => {
    try {
        localStorage.setItem(storageKey(user), JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch { /* private mode — memory stays in-session */ }
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
export const rememberProfileMemory = (input: {
    slug?: string; name?: string; description: string; kind: ProfileMemoryKind; body: string;
    source?: ProfileMemoryEntry['source'];
}, username?: string): { entry: ProfileMemoryEntry; created: boolean } => {
    const user = username || getActiveUsername();
    const slug = input.slug?.trim() ? slugify(input.slug) : slugify(input.name || input.description);
    const now = new Date().toISOString();
    const entry: ProfileMemoryEntry = {
        slug: slug || `memory-${Date.now().toString(36)}`,
        description: input.description.trim().slice(0, MAX_DESC_CHARS),
        kind: input.kind,
        body: input.body.trim().slice(0, MAX_BODY_CHARS),
        ...(input.source ? { source: input.source } : {}),
        createdAt: now,
        updatedAt: now,
    };
    const all = readAll(user);
    const idx = all.findIndex(e => e.slug === entry.slug);
    const created = idx < 0;
    if (created) {
        all.push(entry);
    } else {
        all[idx] = { ...all[idx], ...entry, createdAt: all[idx].createdAt };
    }
    writeAll(user, all);
    return { entry, created };
};

export const forgetProfileMemory = (slug: string, username?: string): boolean => {
    const user = username || getActiveUsername();
    const all = readAll(user);
    const next = all.filter(e => e.slug !== slug);
    if (next.length === all.length) return false;
    writeAll(user, next);
    return true;
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
export const buildProfileMemoryIndex = (username?: string): string => {
    const all = listProfileMemories(username);
    if (all.length === 0) return '';
    const newest = all.slice(-INDEX_MAX_LINES);
    const lines = newest.map(e => {
        const desc = e.description.length > INDEX_LINE_MAX ? `${e.description.slice(0, INDEX_LINE_MAX - 1)}…` : e.description;
        return `- [${e.kind}] ${e.slug} — ${desc}`;
    });
    const dropped = all.length - newest.length;
    return [
        `## Your memory about this user — ${all.length} entr${all.length === 1 ? 'y' : 'ies'}. These are collaboration facts (who they are, how they want you to work, ongoing context), NOT trading lessons. When one matters, pull its full body with read_memory(slug). If this session teaches you something durable about the USER, save it with remember (update an existing slug rather than duplicating).`,
        ...lines,
        dropped > 0 ? `…${dropped} older entr${dropped === 1 ? 'y' : 'ies'} not listed — read_memory with slug "all" shows every entry.` : '',
    ].filter(Boolean).join('\n');
};

/** Test hook: wipe the store. */
export const __clearProfileMemoriesForTests = (username?: string): void => {
    try { localStorage.removeItem(storageKey(username || getActiveUsername())); } catch { /* noop */ }
};

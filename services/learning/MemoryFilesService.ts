/**
 * MemoryFilesService — the Trader Notebook (Settings → Personal edge).
 *
 * Matching enabled files are retrieved by walking the memory graph
 * (see `getMemoryFilesContext`). The user writes
 * market-conditions notes and personal rules; the harness maintains three
 * things automatically:
 *   - profile/memory.md          — what the harness knows about the user
 *   - profile/pattern-memory.md  — human-readable synthesis (not dumped into prompts)
 *   - trader-diary/<coin>.md     — one diary entry per closed trade
 *   - rules/recurring-mistakes.md — loss clusters from the trade log
 *   - skills/*.md                — evidence-gated procedures (trigger + scores)
 *
 * Storage mirrors StrategyService: a synchronous module cache (so prompt
 * assembly at call time never awaits storage) backed by a per-user
 * Preferences key.
 */

import { getPreferenceObject, setPreferenceObject, removePreference } from '../infrastructure/PreferencesService';
import { LoggedTrade, MemoryFile, MemoryFolder, TradeOutcome, UserProfile } from '../../types';
import { isMeaningfulLabel } from '../../utils/meaningfulLabel';

const MEMORY_KEY_PREFIX = 'memory_files_v1_';
/** Diaries keep only the most recent entries so the injected file stays tight. */
const MAX_DIARY_ENTRIES = 50;

export interface MemoryFilesStore {
    version: 1;
    folders: MemoryFolder[];
    files: MemoryFile[];
}

/** Synchronous cache — populated by initMemoryFiles and every mutation. */
let memoryCache: MemoryFilesStore = { version: 1, folders: [], files: [] };

const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Folder/file names are slugified everywhere (UI and AI writer) so the
 *  notebook stays filesystem-safe: lowercase, spaces → dashes, symbols out. */
export const slugifyName = (name: string): string =>
    name.trim()
        .replace(/[^A-Za-z0-9 _-]/g, '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

// ─── Default seed (first boot of a user) ────────────────────────────────────

const DEFAULT_FOLDERS: MemoryFolder[] = [
    { id: 'profile', name: 'profile', order: 0 },
    { id: 'trader-diary', name: 'trader-diary', order: 1 },
    { id: 'market-conditions', name: 'market-conditions', order: 2 },
    { id: 'rules', name: 'rules', order: 3 },
    { id: 'skills', name: 'skills', order: 4 },
    { id: 'bots', name: 'bots', order: 5 },
];

const SEED_FILES: Omit<MemoryFile, 'id' | 'createdAt' | 'updatedAt'>[] = [
    // The market-conditions starter playbooks (ranging-day.md,
    // after-liquidity-sweep.md) were removed: no retrieval path ever read
    // them, so they only posed as knowledge. The folder stays — user
    // notes there are still welcome, and the memory graph indexes them.
    {
        folderId: 'rules',
        name: 'risk-rules.md',
        enabled: true,
        content: `# Personal Risk Rules

The ensemble already enforces the R:R ladder and ATR stops. Add YOUR hard rules here — e.g.:

- Never risk more than 1% per trade.
- No new entries after 2 consecutive losses — stop for the day.
- Only take the highest-confluence setup (MTF score >= 60).
- Close early if price stalls at the 0.5 fib for more than 2 candles.

The model treats every line here as a binding rule.`,
    },
];

/**
 * Load the active user's notebook into the sync cache (seed the default
 * folders + starter templates on first boot). Call on app boot and on every
 * user switch.
 *
 * NOTE: DEFAULT_FOLDERS objects are shared module state — rename/move mutate
 * folder fields in place, so every seed must deep-copy them or a moved/renamed
 * folder silently rewrites the defaults for all future users.
 */
export const initMemoryFiles = async (username: string): Promise<void> => {
    const freshSeed = (): MemoryFilesStore => ({
        version: 1,
        folders: DEFAULT_FOLDERS.map(f => ({ ...f })),
        files: [],
    });
    try {
        const stored = await getPreferenceObject<MemoryFilesStore>(`${MEMORY_KEY_PREFIX}${username}`);
        if (stored && Array.isArray(stored.folders) && Array.isArray(stored.files)) {
            memoryCache = stored;
            await ensureHarnessFoldersUnlocked(username);
            return;
        }
        memoryCache = freshSeed();
        const now = Date.now();
        memoryCache.files = SEED_FILES.map(f => ({ ...f, id: uid(), createdAt: now, updatedAt: now }));
        await persist(username);
    } catch (e) {
        console.warn('[MemoryFiles] Failed to load notebook:', e);
        memoryCache = freshSeed();
    }
};

/** Current notebook state (for the Settings UI and prompt injection). */
export const getMemoryFiles = (): MemoryFilesStore => memoryCache;

/** Add any missing harness folders (skills, …) for notebooks created before they existed. */
export const ensureHarnessFoldersUnlocked = async (username: string): Promise<void> => {
    const names = new Set(memoryCache.folders.map(f => f.name));
    const looksLikeHarness = DEFAULT_FOLDERS.some(d => names.has(d.name));
    if (!looksLikeHarness) return;
    let changed = false;
    for (const def of DEFAULT_FOLDERS) {
        if (!memoryCache.folders.some(f => f.name === def.name)) {
            memoryCache.folders.push({ id: def.id, name: def.name, order: memoryCache.folders.length });
            changed = true;
        }
    }
    if (changed) await persist(username);
};

/** Serialized public API — see withNotebookWriteLock. */
export const ensureHarnessFolders = (username: string): Promise<void> =>
    withNotebookWriteLock(() => ensureHarnessFoldersUnlocked(username));

/** Retired skills land here — out of every skill path (folder-based), kept for the record. */
export const ARCHIVE_FOLDER_NAME = 'archive';

/** Create/find skills/archive. Caller must hold the write lock (or be boot). */
export const ensureSkillsArchiveFolderUnlocked = async (username: string): Promise<MemoryFolder | null> => {
    const existing = memoryCache.folders.find(f => f.name === ARCHIVE_FOLDER_NAME);
    if (existing) return existing;
    if (!memoryCache.folders.some(f => f.name === 'skills')) return null;
    const folder: MemoryFolder = { id: uid(), name: ARCHIVE_FOLDER_NAME, order: memoryCache.folders.length };
    memoryCache.folders.push(folder);
    await persist(username);
    return folder;
};

/** Persist the cache for the active user (empty store clears the key). */
const persist = async (username: string): Promise<void> => {
    if (persistSilentDepth === 0) upsertNotebookIndexInCache();
    if (memoryCache.folders.length === 0 && memoryCache.files.length === 0) {
        await removePreference(`${MEMORY_KEY_PREFIX}${username}`);
    } else {
        warnIfNotebookHuge();
        await setPreferenceObject(`${MEMORY_KEY_PREFIX}${username}`, memoryCache);
    }
    if (persistSilentDepth === 0) {
        memoryChangeListeners.forEach(handler => handler(username));
    }
};

/** Whole-store blob guard: Preferences keys have platform size limits. */
const NOTEBOOK_SIZE_WARN_CHARS = 1_000_000;
let lastSizeWarnedAt = 0;
const warnIfNotebookHuge = (): void => {
    try {
        const size = JSON.stringify(memoryCache).length;
        if (size > NOTEBOOK_SIZE_WARN_CHARS && size - lastSizeWarnedAt > 250_000) {
            lastSizeWarnedAt = size;
            console.warn(
                `[MemoryFiles] Notebook blob reached ${(size / 1_000_000).toFixed(1)} MB — ` +
                'every write rewrites it whole and Preferences may refuse it. Consider pruning notes/diaries.'
            );
        }
    } catch { /* guard must never break a persist */ }
};

let persistSilentDepth = 0;
const memoryChangeListeners = new Set<(username: string) => void>();

/** Subscribe to notebook writes. Returns unsubscribe. */
export const subscribeMemoryFilesChanged = (handler: (username: string) => void): (() => void) => {
    memoryChangeListeners.add(handler);
    return () => { memoryChangeListeners.delete(handler); };
};

/** @deprecated use subscribeMemoryFilesChanged */
export const setOnMemoryFilesChanged = (handler: ((username: string) => void) | null): void => {
    memoryChangeListeners.clear();
    if (handler) memoryChangeListeners.add(handler);
};

// ─── Write lock ─────────────────────────────────────────────────────────────
// Every notebook mutation is a read-modify-write over the shared cache, and
// writers run concurrently: fire-and-forget trade syncs, the awaited
// post-mortem sync, detached eval stamping, doctrine rewrites, UI edits.
// Mutations are therefore serialized through a single promise chain.
//
// DEADLOCK RULE: a function that acquires this lock (any public mutator or
// withNotebookWriteLock caller) must only call the *Unlocked variants of
// other mutators — never a locked public from inside the lock.
let writeChain: Promise<unknown> = Promise.resolve();

export const withNotebookWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = writeChain.then(fn, fn);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
};

/** Persist without notifying listeners (used when writing suggestions.md). */
export const withSilentMemoryPersist = async (fn: () => Promise<void>): Promise<void> => {
    persistSilentDepth += 1;
    try {
        await withNotebookWriteLock(fn);
    } finally {
        persistSilentDepth -= 1;
    }
};

export const SUGGESTIONS_FILE_NAME = 'suggestions.md';
export const NOTEBOOK_INDEX_FILE = 'index.md';

const SKIP_INDEX_DUMP = new Set(['pattern-memory.md', 'suggestions.md', 'index.md']);

/** First heading or first prose line — keeps the notebook map scannable. */
export const fileBlurb = (content: string, max = 72): string => {
    const withoutFm = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const heading = withoutFm.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const line = heading
        || withoutFm.split('\n').map(l => l.trim()).find(l => l.length > 8 && !l.startsWith('>') && !l.startsWith('---'))
        || '';
    return line.replace(/\s+/g, ' ').slice(0, max);
};

const folderNameOf = (file: MemoryFile): string =>
    memoryCache.folders.find(f => f.id === file.folderId)?.name ?? 'misc';

/**
 * Compact catalog + wiki-style links. Always injected (progressive disclosure)
 * so a new conversation still knows the notebook exists.
 */
export const buildNotebookMapMarkdown = (): string => {
    const enabled = memoryCache.files.filter(f =>
        f.enabled && f.content.trim() && !SKIP_INDEX_DUMP.has(f.name.toLowerCase())
    );
    if (enabled.length === 0) return '';

    const rows: string[] = [
        '**NOTEBOOK MAP** — you already have a trader notebook. This is the index; matching files are quoted below.',
        '',
        '| File | About |',
        '| --- | --- |',
    ];
    const sortedFolders = [...memoryCache.folders].sort((a, b) => a.order - b.order);
    for (const folder of sortedFolders) {
        const folderFiles = enabled
            .filter(f => f.folderId === folder.id)
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const f of folderFiles) {
            rows.push(`| ${folder.name}/${f.name} | ${fileBlurb(f.content)} |`);
        }
    }

    const links = new Map<string, Set<string>>();
    const addLink = (node: string, path: string): void => {
        const key = node.trim();
        if (!key) return;
        const set = links.get(key) ?? new Set<string>();
        set.add(path);
        links.set(key, set);
    };
    for (const f of enabled) {
        const path = `${folderNameOf(f)}/${f.name}`;
        const folder = folderNameOf(f);
        if (folder === 'trader-diary') {
            addLink(f.name.replace(/\.md$/i, '').toUpperCase(), path);
        }
        const coin = f.content.match(/^coin:\s*(.+)$/mi)?.[1]?.trim();
        const direction = f.content.match(/^direction:\s*(.+)$/mi)?.[1]?.trim();
        const family = f.content.match(/^family:\s*(.+)$/mi)?.[1]?.trim();
        const regime = f.content.match(/^regime:\s*(.+)$/mi)?.[1]?.trim();
        if (coin) addLink(coin.toUpperCase().replace(/USDT?$/, '') + 'USDT', path);
        if (direction) addLink(direction, path);
        if (family) addLink(family, path);
        if (regime) addLink(regime, path);
        if (/ranging/i.test(f.name)) addLink('ranging', path);
        if (/sweep|liquidity/i.test(f.name)) addLink('sweep', path);
    }

    const edgeLines = [...links.entries()]
        .filter(([, paths]) => paths.size > 0)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, 24)
        .map(([node, paths]) => `- **${node}** → ${[...paths].join(', ')}`);
    if (edgeLines.length > 0) {
        rows.push('', '**Graph** (topic → files):', ...edgeLines);
    }
    return rows.join('\n');
};

const upsertNotebookIndexInCache = (): void => {
    const profile = memoryCache.folders.find(f => f.name === 'profile');
    if (!profile) return;
    const map = buildNotebookMapMarkdown();
    const existingIdx = memoryCache.files.findIndex(f => f.folderId === profile.id && f.name === NOTEBOOK_INDEX_FILE);
    if (!map) {
        if (existingIdx >= 0) memoryCache.files.splice(existingIdx, 1);
        return;
    }
    const body = `# Notebook index

Auto-maintained map of this trader notebook. Readable markdown — every analysis also gets a compact copy so new conversations are not a blank slate.

${map}
`;
    const now = Date.now();
    if (existingIdx >= 0) {
        const existing = memoryCache.files[existingIdx];
        if (existing.content === body) return;
        memoryCache.files[existingIdx] = { ...existing, content: body, autoManaged: true, enabled: true, updatedAt: now };
        return;
    }
    memoryCache.files.push({
        id: uid(),
        folderId: profile.id,
        name: NOTEBOOK_INDEX_FILE,
        content: body,
        enabled: true,
        autoManaged: true,
        createdAt: now,
        updatedAt: now,
    });
};

// ─── Folder CRUD ────────────────────────────────────────────────────────────

export const createMemoryFolderUnlocked = async (name: string, username: string): Promise<MemoryFolder> => {
    const clean = slugifyName(name);
    if (!clean) throw new Error('Folder name is required');
    const existing = memoryCache.folders.find(f => f.name === clean);
    if (existing) return existing;
    const folder: MemoryFolder = { id: uid(), name: clean, order: memoryCache.folders.length };
    memoryCache.folders.push(folder);
    await persist(username);
    return folder;
};

/** Serialized public API — see withNotebookWriteLock. */
export const createMemoryFolder = (name: string, username: string): Promise<MemoryFolder> =>
    withNotebookWriteLock(() => createMemoryFolderUnlocked(name, username));

/** Rename a folder (slugified). Returns the new slug, or null if unknown. */
export const renameMemoryFolderUnlocked = async (id: string, name: string, username: string): Promise<string | null> => {
    const clean = slugifyName(name);
    if (!clean) throw new Error('Folder name is required');
    if (memoryCache.folders.some(f => f.id !== id && f.name === clean)) throw new Error(`Folder "${clean}" already exists`);
    const folder = memoryCache.folders.find(f => f.id === id);
    if (!folder) return null;
    folder.name = clean;
    await persist(username);
    return clean;
};

/** Serialized public API — see withNotebookWriteLock. */
export const renameMemoryFolder = (id: string, name: string, username: string): Promise<string | null> =>
    withNotebookWriteLock(() => renameMemoryFolderUnlocked(id, name, username));

/**
 * Move a folder to a new index in the sidebar (drag & drop). Order persists
 * and drives prompt-injection order (profile stays first until moved).
 */
export const moveMemoryFolderUnlocked = async (id: string, toIndex: number, username: string): Promise<void> => {
    const fromIndex = memoryCache.folders.findIndex(f => f.id === id);
    if (fromIndex < 0) return;
    const target = Math.max(0, Math.min(toIndex, memoryCache.folders.length - 1));
    if (fromIndex === target) return;
    const [moved] = memoryCache.folders.splice(fromIndex, 1);
    memoryCache.folders.splice(target, 0, moved);
    memoryCache.folders.forEach((f, i) => { f.order = i; });
    await persist(username);
};

/** Serialized public API — see withNotebookWriteLock. */
export const moveMemoryFolder = (id: string, toIndex: number, username: string): Promise<void> =>
    withNotebookWriteLock(() => moveMemoryFolderUnlocked(id, toIndex, username));

export const deleteMemoryFolderUnlocked = async (id: string, username: string): Promise<void> => {
    memoryCache.folders = memoryCache.folders.filter(f => f.id !== id);
    memoryCache.files = memoryCache.files.filter(f => f.folderId !== id);
    await persist(username);
};

/** Serialized public API — see withNotebookWriteLock. */
export const deleteMemoryFolder = (id: string, username: string): Promise<void> =>
    withNotebookWriteLock(() => deleteMemoryFolderUnlocked(id, username));

// ─── File CRUD ──────────────────────────────────────────────────────────────

export const createMemoryFileUnlocked = async (
    folderId: string,
    name: string,
    content: string,
    username: string,
    /** Harness-written files (diary, profile, recurring mistakes) label themselves "auto" in the UI. */
    autoManaged = false
): Promise<MemoryFile> => {
    const cleanName = name.trim().toLowerCase().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    if (!cleanName || cleanName === '.md') throw new Error('File name is required');
    if (memoryCache.files.some(f => f.folderId === folderId && f.name === cleanName)) {
        throw new Error(`"${cleanName}" already exists in this folder`);
    }
    const now = Date.now();
    const file: MemoryFile = { id: uid(), folderId, name: cleanName, content, enabled: true, autoManaged, createdAt: now, updatedAt: now };
    memoryCache.files.push(file);
    await persist(username);
    return file;
};

/** Serialized public API — see withNotebookWriteLock. */
export const createMemoryFile = (
    folderId: string,
    name: string,
    content: string,
    username: string,
    autoManaged = false
): Promise<MemoryFile> =>
    withNotebookWriteLock(() => createMemoryFileUnlocked(folderId, name, content, username, autoManaged));

/** Patch fields of an existing file (content edits, enable toggle). */
export const updateMemoryFileUnlocked = async (id: string, patch: Partial<MemoryFile>, username: string): Promise<void> => {
    const existing = memoryCache.files.findIndex(f => f.id === id);
    if (existing < 0) return;
    memoryCache.files[existing] = { ...memoryCache.files[existing], ...patch, updatedAt: Date.now() };
    await persist(username);
};

/** Serialized public API — see withNotebookWriteLock. */
export const updateMemoryFile = (id: string, patch: Partial<MemoryFile>, username: string): Promise<void> =>
    withNotebookWriteLock(() => updateMemoryFileUnlocked(id, patch, username));

export const deleteMemoryFileUnlocked = async (id: string, username: string): Promise<void> => {
    memoryCache.files = memoryCache.files.filter(f => f.id !== id);
    await persist(username);
};

/** Serialized public API — see withNotebookWriteLock. */
export const deleteMemoryFile = (id: string, username: string): Promise<void> =>
    withNotebookWriteLock(() => deleteMemoryFileUnlocked(id, username));

// ─── Prompt injection ───────────────────────────────────────────────────────

export type { MemoryRetrievalQuery } from './MemoryRetrievalService';
export { getMemoryFilesContext } from './MemoryRetrievalService';

/** UI stats: how many files are injected and at what total size. */
export const getMemoryFilesStats = (): { enabledCount: number; charCount: number } => {
    const enabled = memoryCache.files.filter(f => f.enabled && f.content.trim());
    return {
        enabledCount: enabled.length,
        charCount: enabled.reduce((sum, f) => sum + f.content.length, 0),
    };
};

// ─── Harness auto-writes ────────────────────────────────────────────────────

/**
 * Pull a one-line lesson out of a post-mortem report: the first "Lesson:" /
 * "Key takeaway:" style line if present, else the first meaningful sentence.
 * Mirrors the reflection-injection lesson style (DecisionReflectionService).
 *
 * Header-mining guard: post-mortems often format the lesson as a TITLE —
 * `**Lesson: 🩸 LOSS FORENSIC ANALYSIS…**` or `# Lesson: bold takeaway` —
 * with the substance on later lines. Matching the wrapper line stored the
 * title and dropped the lesson, so heading/bold-wrapped matches are
 * rejected, and captures that are themselves title-shaped (all-caps
 * forensics headers) are skipped in favor of the first real sentence.
 */
const LESSON_TITLE_PREFIX = /^(loss forensic|forensic analysis|key takeaway|post[- ]?mortem)/i;

/** True when the captured text reads as a section title, not a sentence. */
const isTitleShapedLesson = (text: string): boolean => {
    const t = text.trim();
    if (LESSON_TITLE_PREFIX.test(t)) return true;
    const words = t.match(/[A-Za-z]{2,}/g) ?? [];
    return words.length >= 2 && words.every(w => w === w.toUpperCase());
};

export const extractLessonFromPostMortem = (postMortem: string): string => {
    if (!postMortem) return '';
    const LESSON_PATTERN = /(?:key\s+)?(?:lesson|lesson\s+learned|takeaway|actionable\s+takeaway|key\s+insight|what\s+(?:should|to)\s+(?:i\s+)?do\s+(?:differently\s+)?(?:next|next\s+time)?)\s*[:\-–]\s*([^\n]{10,})/i;
    for (const rawLine of postMortem.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const isHeading = /^#{1,6}\s/.test(line);
        const isBoldWrapped = line.startsWith('**') && line.endsWith('**');
        // Strip heading/bold wrappers so a "Lesson:" inside them can match…
        const stripped = line.replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+?)\*\*$/, '$1').trim();
        const match = stripped.match(LESSON_PATTERN);
        if (!match) continue;
        // …but the wrapper line itself is a title — the substance is below.
        if (isHeading || isBoldWrapped) continue;
        const capture = match[1]
            .replace(/^[\s*_\-–:：]+/, '')
            .replace(/[*_]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (capture.length < 10 || isTitleShapedLesson(capture)) continue;
        return capture.slice(0, 200);
    }
    // Fallback: the first non-header, non-list line that looks like a
    // sentence. Label-shaped lines ("Lesson: …") are excluded too — if the
    // loop above rejected their capture, the label itself is not the lesson.
    const LESSON_LABEL = /^(?:key\s+)?(?:lesson(?:\s+learned)?|takeaway|actionable\s+takeaway|key\s+insight)\s*[:\-–]/i;
    const line = postMortem.split('\n').map(l => l.trim()).find(l =>
        l.length > 20 && !l.startsWith('#') && !l.startsWith('**') && !l.startsWith('-') && !l.startsWith('*') && !l.startsWith('>') && !LESSON_LABEL.test(l)
    );
    return line ? line.replace(/\s+/g, ' ').slice(0, 200) : '';
};

const buildDiaryEntry = (trade: LoggedTrade): string => {
    const a = trade.analysis ?? {};
    const outcomeLabel = trade.outcome === TradeOutcome.WIN ? 'WIN ✅' : 'LOSS ❌';
    const pnl = typeof trade.pnlPercent === 'number'
        ? ` (${trade.pnlPercent > 0 ? '+' : ''}${trade.pnlPercent}%)`
        : typeof trade.pnlAmount === 'number'
            ? ` (${trade.pnlAmount > 0 ? '+' : ''}$${trade.pnlAmount.toFixed(2)})`
            : '';
    const date = new Date(trade.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const lesson = extractLessonFromPostMortem(trade.postMortem ?? '');
    const lines = [`${date} · ${a.coinName ?? '?'} · ${a.direction ?? '?'} · ${outcomeLabel}${pnl}`];
    lines.push(`id: ${trade.id}`);
    if (lesson) lines.push(`What I learned: ${lesson}`);
    return lines.join('\n');
};

/**
 * Append one closed trade to trader-diary/<coin>.md (creating the file on
 * first entry). Only WIN/LOSS trades are logged — pending and entry-not-hit
 * runs carry no lesson. The file keeps the newest MAX_DIARY_ENTRIES entries.
 */
export const appendDiaryEntryUnlocked = async (trade: LoggedTrade, username: string): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    const folder = memoryCache.folders.find(f => f.name === 'trader-diary');
    if (!folder) return;
    const coin = (trade.analysis?.coinName ?? 'General').trim() || 'General';
    const safeName = `${coin.replace(/[^A-Za-z0-9_-]/g, '')}.md`;
    const entry = buildDiaryEntry(trade);
    const header = `# ${coin} Trade Diary (auto-maintained)\n> Keeps the last ${MAX_DIARY_ENTRIES} trades.`;

    const existing = memoryCache.files.find(f => f.folderId === folder.id && f.name === safeName);
    if (existing?.content.includes(`id: ${trade.id}`)) return;
    if (existing) {
        const entries = existing.content.split('\n## ').slice(1).filter(Boolean);
        const updated = [...entries, entry].slice(-MAX_DIARY_ENTRIES);
        await updateMemoryFileUnlocked(existing.id, { content: `${header}\n\n## ${updated.join('\n## ')}` }, username);
    } else {
        await createMemoryFileUnlocked(folder.id, safeName, `${header}\n\n## ${entry}`, username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock. */
export const appendDiaryEntry = (trade: LoggedTrade, username: string): Promise<void> =>
    withNotebookWriteLock(() => appendDiaryEntryUnlocked(trade, username));

/**
 * Regenerate profile/memory.md from the user's actual profile data — who the
 * trader is, what they trade, their settings. Fully harness-managed.
 */
export const syncProfileMemoryUnlocked = async (profile: UserProfile | null, username: string): Promise<void> => {
    const folder = memoryCache.folders.find(f => f.name === 'profile');
    if (!folder) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    if (!profile) {
        const fallback = `# About the Trader (auto-maintained by August)\n> Updated ${dateStr}\n\nNo profile data loaded yet.\n`;
        const existing = memoryCache.files.find(f => f.folderId === folder.id && f.name === 'memory.md');
        if (existing) {
            await updateMemoryFileUnlocked(existing.id, { content: fallback }, username);
        } else {
            await createMemoryFileUnlocked(folder.id, 'memory.md', fallback, username, true);
        }
        return;
    }

    const trades = profile.tradeLog ?? [];
    const closed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const wins = closed.filter(t => t.outcome === TradeOutcome.WIN).length;
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : null;

    const favorites = new Map<string, number>();
    trades.forEach(t => {
        const coin = t.analysis?.coinName;
        if (coin) favorites.set(coin, (favorites.get(coin) ?? 0) + 1);
    });
    const topCoins = [...favorites.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([c, n]) => `${c} (${n})`)
        .join(', ') || 'none yet';

    const prefs = profile.globalMemory?.userPreferences;
    const s = profile.settings ?? {};
    const flags = [
        s.isAccuracyModeEnabled ? 'Accuracy Mode' : null,
        s.isHybridIntelligenceEnabled ? 'Hybrid Intelligence' : null,
        s.isEnsembleEnabled ? 'Ensemble debate' : null,
        s.isStrategiesEnabled ? 'Strategy books' : null,
    ].filter(Boolean).join(', ') || 'standard setup';

    const lines: string[] = [
        '# About the Trader (auto-maintained by August)',
        `> Updated ${dateStr} — from your profile and trade log. The model reads this file first.`,
        '',
        `- **Trader:** ${profile.username || username}`,
        `- **Trades logged:** ${trades.length} (${wins} win / ${closed.length - wins} loss${trades.length - closed.length > 0 ? ` / ${trades.length - closed.length} pending` : ''})`,
        ...(winRate !== null ? [`- **Win rate:** ${winRate}% (completed trades)`] : []),
        `- **Favorite assets:** ${topCoins}`,
        ...(prefs?.leverageDefault ? [`- **Default leverage:** ${prefs.leverageDefault}x`] : []),
        ...(prefs?.preferredSetup ? [`- **Preferred setup:** ${prefs.preferredSetup}`] : []),
        `- **App setup:** ${flags}`,
        '',
        'This file is maintained automatically. Add your own knowledge in the other notebook files (market-conditions, rules, or a new folder).',
    ];
    const content = lines.join('\n') + '\n';

    const existing = memoryCache.files.find(f => f.folderId === folder.id && f.name === 'memory.md');
    if (existing) {
        await updateMemoryFileUnlocked(existing.id, { content }, username);
    } else {
        await createMemoryFileUnlocked(folder.id, 'memory.md', content, username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock. */
export const syncProfileMemory = (profile: UserProfile | null, username: string): Promise<void> =>
    withNotebookWriteLock(() => syncProfileMemoryUnlocked(profile, username));

const PATTERN_MEMORY_HEADINGS = [
    'Executive Summary',
    'Missed Win Analysis',
    'Extended SL Zone Breach Analysis',
    'Pattern Family Performance',
    'Confidence Calibration',
    'Winning Patterns',
    'Failure Patterns',
    'Behavioral Biases',
    'Statistical Tendencies',
    'Actionable Rules',
    'Conclusion',
];

/** Keep even when short — the rest of the essay can drop empty product sections. */
const PATTERN_MEMORY_KEEP = new Set([
    'executive summary',
    'actionable rules',
    'conclusion',
]);

const EMPTY_SECTION = /^(none\.?|n\/a\.?|n\/a|na\.?|not applicable\.?|no data\.?|nothing to report\.?|no missed wins?\.?|no breaches?\.?|-|—|–|\(none\))?\s*$/i;

export interface PatternMemoryStats {
    closed?: number;
    wins?: number;
    losses?: number;
}

export const patternMemoryStatsFromTrades = (trades: LoggedTrade[]): PatternMemoryStats => {
    const closed = trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
    const wins = closed.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = closed.filter(t => t.outcome === TradeOutcome.LOSS).length;
    return { closed: closed.length, wins, losses };
};

const patternMemoryHeader = (stats?: PatternMemoryStats): string => {
    const dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const lines = [
        '# Pattern Memory',
        '> Human synthesis — not injected into analyses. Live loop: `skills/` and `rules/recurring-mistakes.md`.',
        '',
    ];
    if (stats && typeof stats.closed === 'number' && stats.closed > 0) {
        const wins = stats.wins ?? 0;
        const losses = stats.losses ?? 0;
        const wr = Math.round((wins / stats.closed) * 100);
        lines.push(`- **Closed trades:** ${stats.closed} (${wins} win / ${losses} loss)`);
        lines.push(`- **Win rate:** ${wr}%`);
    }
    lines.push(`- **Updated:** ${dateStr}`);
    lines.push('');
    lines.push('See also: `skills/` (procedures with scores) and `rules/recurring-mistakes.md` (loss clusters).');
    lines.push('');
    return lines.join('\n');
};

const stripExistingPatternMemoryChrome = (text: string): string => {
    let body = text.trim();
    body = body.replace(/^#\s+pattern memory\b[^\n]*\n+/i, '');
    body = body.replace(/^(>\s.*\n)+/, '');
    body = body.replace(/^(-\s+\*\*[^*]+\*\*:.*\n)+/, '');
    body = body.replace(/^see also:.*\n+/i, '');
    return body.trim();
};

const promotePatternMemoryHeadings = (body: string): string => {
    const headingLookup = PATTERN_MEMORY_HEADINGS.map(h => [h.toLowerCase(), h] as const);
    return body.split('\n').map(line => {
        const stripped = line
            .replace(/^[#\s>*_\-`]+/, '')
            .replace(/[*_]/g, '')
            .replace(/^[^\w]+/, '')
            .trim()
            .toLowerCase();
        const hit = headingLookup.find(([key]) =>
            stripped === key || stripped === `${key}:` || stripped.startsWith(`${key}:`)
        );
        if (hit && stripped.length <= hit[0].length + 8) {
            return `## ${hit[1]}`;
        }
        return line;
    }).join('\n');
};

/** Drop product sections whose heading is a placeholder ("N/A", "None") or whose only content is None / N/A / blank. */
export const collapseEmptyPatternMemorySections = (markdown: string): string => {
    const lines = markdown.split('\n');
    const chunks: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
    for (const line of lines) {
        const h = line.match(/^##\s+(.+)\s*$/);
        if (h) {
            chunks.push({ heading: h[1], lines: [] });
        } else {
            chunks[chunks.length - 1].lines.push(line);
        }
    }
    const kept: string[] = [];
    for (const chunk of chunks) {
        if (!chunk.heading) {
            const preamble = chunk.lines.join('\n').trim();
            if (preamble) kept.push(preamble);
            continue;
        }
        const body = chunk.lines.join('\n').trim();
        const keepAlways = PATTERN_MEMORY_KEEP.has(chunk.heading.toLowerCase());
        if (!keepAlways && (!isMeaningfulLabel(chunk.heading) || EMPTY_SECTION.test(body))) continue;
        kept.push(`## ${chunk.heading}\n${chunk.lines.join('\n')}`.trimEnd());
    }
    return kept.join('\n\n').trim();
};

/** Turn a synthesis blob into a markdown document (headings → ##). */
export const toPatternMemoryMarkdown = (
    summary: string | null | undefined,
    stats?: PatternMemoryStats,
): string => {
    const header = patternMemoryHeader(stats);
    const stub = `${header}Log more trades to generate a performance synthesis.\n`;
    if (!summary || !summary.trim()) return stub;

    const promoted = promotePatternMemoryHeadings(stripExistingPatternMemoryChrome(summary));
    const collapsed = collapseEmptyPatternMemorySections(promoted);
    return `${header}${collapsed}\n`;
};

/**
 * Write profile/pattern-memory.md from the current synthesis (or a stub when
 * empty). Harness-managed — the History tab opens this as a document.
 */
export const syncPatternMemoryUnlocked = async (
    summary: string | null | undefined,
    username: string,
    trades?: LoggedTrade[],
): Promise<void> => {
    const folder = memoryCache.folders.find(f => f.name === 'profile');
    if (!folder) return;
    const stats = trades ? patternMemoryStatsFromTrades(trades) : undefined;
    const content = toPatternMemoryMarkdown(summary, stats);
    const existing = memoryCache.files.find(f => f.folderId === folder.id && f.name === 'pattern-memory.md');
    if (existing) {
        await updateMemoryFileUnlocked(existing.id, { content }, username);
    } else {
        await createMemoryFileUnlocked(folder.id, 'pattern-memory.md', content, username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock. */
export const syncPatternMemory = (
    summary: string | null | undefined,
    username: string,
    trades?: LoggedTrade[],
): Promise<void> =>
    withNotebookWriteLock(() => syncPatternMemoryUnlocked(summary, username, trades));

/**
 * Regenerate rules/recurring-mistakes.md from the trade log — deterministic,
 * code-side loss-cluster analysis (no AI): groups of 2+ losses on the same
 * coin + direction, worst first. The model reads this on every analysis, so
 * recurring failures become impossible to ignore.
 */
export const syncRecurringMistakesUnlocked = async (trades: LoggedTrade[], username: string): Promise<void> => {
    const folder = memoryCache.folders.find(f => f.name === 'rules');
    if (!folder) return;
    const content = buildRecurringMistakesContent(trades);
    const existing = memoryCache.files.find(f => f.folderId === folder.id && f.name === 'recurring-mistakes.md');
    if (existing) {
        await updateMemoryFileUnlocked(existing.id, { content }, username);
    } else {
        await createMemoryFileUnlocked(folder.id, 'recurring-mistakes.md', content, username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock. */
export const syncRecurringMistakes = (trades: LoggedTrade[], username: string): Promise<void> =>
    withNotebookWriteLock(() => syncRecurringMistakesUnlocked(trades, username));

/** Pure content builder for recurring-mistakes.md (exported for tests). */
export const buildRecurringMistakesContent = (trades: LoggedTrade[]): string => {
    const lines: string[] = [
        '# My Recurring Mistakes (auto-synced from my trade log)',
        '> Loss clusters of 2+ trades on the same coin + direction. These are the setups where I keep losing — I check this list before recommending any trade.',
        '',
    ];
    const losses = trades.filter(t => t.outcome === TradeOutcome.LOSS);
    if (losses.length === 0) {
        lines.push('No losses logged yet — this file lists my loss clusters once trades are logged.');
        return lines.join('\n');
    }

    const clusters = new Map<string, { count: number; pnlPct: number[]; last: string }>();
    losses.forEach(t => {
        const key = `${t.analysis?.coinName ?? 'UNKNOWN'} ${t.analysis?.direction ?? '?'}`;
        const c = clusters.get(key) ?? { count: 0, pnlPct: [], last: '' };
        c.count += 1;
        if (typeof t.pnlPercent === 'number') c.pnlPct.push(t.pnlPercent);
        if (!c.last || t.timestamp > c.last) c.last = t.timestamp;
        clusters.set(key, c);
    });

    const recurring = [...clusters.entries()]
        .filter(([, c]) => c.count >= 2)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    if (recurring.length === 0) {
        lines.push('No recurring loss clusters yet (needs 2+ losses on the same coin + direction).');
    } else {
        recurring.forEach(([key, c]) => {
            const avgPct = c.pnlPct.length > 0
                ? ` avg ${(c.pnlPct.reduce((a, b) => a + b, 0) / c.pnlPct.length).toFixed(1)}%`
                : '';
            const last = new Date(c.last).toLocaleDateString();
            lines.push(`- ⚠️ **${c.count}× ${key}**${avgPct} — last ${last}. I keep losing here; I need fresh confirmation before taking this setup again.`);
        });
    }
    return lines.join('\n');
};

// ─── Outcome-weighted lessons (journal Learning tab) ────────────────────────

export interface TopLesson {
    /** "BTCUSDT Short" — the coin + direction cluster. */
    label: string;
    count: number;
    /** Average pnlPercent across the cluster, when recorded. */
    avgPnl: number | null;
    last: string;
    kind: 'win' | 'loss';
}

/**
 * Outcome-weighted clusters from the trade log (2+ trades per coin +
 * direction): LOSS clusters first (the fix list), then WIN clusters (the
 * repeat list), each by count desc. Deterministic + testable — the journal
 * Learning tab renders these as "Top Lessons".
 */
export const computeTopLessons = (trades: LoggedTrade[], limit = 6): TopLesson[] => {
    const clusters = new Map<string, { label: string; count: number; pnl: number[]; last: string; kind: 'win' | 'loss' }>();
    for (const t of trades) {
        if (t.outcome !== TradeOutcome.WIN && t.outcome !== TradeOutcome.LOSS) continue;
        const label = `${t.analysis?.coinName ?? 'UNKNOWN'} ${t.analysis?.direction ?? '?'}`;
        const kind = t.outcome === TradeOutcome.WIN ? 'win' : 'loss';
        // Key includes the outcome — wins and losses on the same coin +
        // direction are separate clusters (repeat list vs fix list).
        const key = `${label}|${kind}`;
        const c = clusters.get(key) ?? { label, count: 0, pnl: [], last: '', kind };
        c.count += 1;
        if (typeof t.pnlPercent === 'number') c.pnl.push(t.pnlPercent);
        if (!c.last || t.timestamp > c.last) c.last = t.timestamp;
        clusters.set(key, c);
    }
    return [...clusters.values()]
        .filter(c => c.count >= 2)
        .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'loss' ? -1 : 1;
            return b.count - a.count;
        })
        .slice(0, limit)
        .map(c => ({
            label: c.label,
            count: c.count,
            avgPnl: c.pnl.length > 0 ? c.pnl.reduce((sum, v) => sum + v, 0) / c.pnl.length : null,
            last: c.last,
            kind: c.kind,
        }));
};

// ─── AI writer (the model creates folders + files itself) ───────────────────

/**
 * A note the AI wants to write into the notebook. The model decides the
 * decision AFTER reading the current notebook index (see
 * `getMemoryFilesIndex`): append to an existing file when the topic already
 * has a home, create a new file (and maybe folder) when it is new, or skip
 * when the lesson is already covered. A missing decision means 'create'
 * (backward compatible with older callers).
 */
export type ModelNoteDecision = 'skip' | 'append' | 'create';

export interface ModelNote {
    decision?: ModelNoteDecision;
    folder: string;
    fileName: string;
    content: string;
}

/**
 * Compact structure of the whole notebook for the model to read BEFORE it
 * writes: folder tree, file names, sizes, and a short excerpt of each file —
 * enough to decide append-vs-create and reuse-vs-new-folder without dumping
 * entire files into the prompt.
 */
export const getMemoryFilesIndex = (): string => {
    if (memoryCache.files.length === 0) return '(empty notebook — no files yet)';
    const lines: string[] = [];
    for (const folder of [...memoryCache.folders].sort((a, b) => a.order - b.order)) {
        const folderFiles = memoryCache.files
            .filter(f => f.folderId === folder.id)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (folderFiles.length === 0) continue;
        lines.push(`📁 ${folder.name}/`);
        for (const f of folderFiles) {
            const excerpt = fileBlurb(f.content, 120);
            lines.push(`   📄 ${f.name} (${f.content.length} chars)${excerpt ? ` — ${excerpt}` : ''}`);
        }
    }
    const map = buildNotebookMapMarkdown();
    const graph = map.split('**Graph**')[1];
    if (graph) {
        lines.push('', '**Graph**' + graph);
    }
    return lines.join('\n');
};

/**
 * Write an AI-generated note into the notebook. The model picks the folder —
 * if it does not exist yet it is created (the model can create folders, the
 * user can too). Names are slugified and existing files are NEVER overwritten:
 *  - decision 'append'  → the note becomes a NEW SECTION (--- separator) on
 *    an existing file (fuzzy name match: same stem, or one name contains the
 *    other). Falls back to creating the file when the target does not exist.
 *  - decision 'create'  → a new file; if the exact name is taken, it is
 *    suffixed -2, -3… instead of overwriting.
 * Files are marked "auto" like the other harness-managed ones.
 */
/** Max appended sections per AI-written note file (oldest trimmed). */
const MAX_NOTE_SECTIONS = 30;
/** Max harness-written note files per folder (oldest autoManaged file pruned). */
const MAX_NOTES_PER_FOLDER = 40;
const NOTE_SECTION_SEP = '\n\n---\n\n';

export const writeModelNoteUnlocked = async (note: ModelNote, username: string): Promise<MemoryFile> => {
    let cleanFolder = slugifyName(note.folder) || 'lessons';
    if (cleanFolder === 'skills') cleanFolder = 'lessons';
    const baseName = slugifyName(note.fileName.replace(/\.md$/i, '')) || 'note';
    const content = (note.content ?? '').trim();
    if (!content) throw new Error('Note content is empty');

    let folder = memoryCache.folders.find(f => f.name === cleanFolder);
    if (!folder) folder = await createMemoryFolderUnlocked(cleanFolder, username);

    // Append: extend an existing file when one matches (same stem, or one
    // name contains the other) — never overwrite, the note is a new section.
    if (note.decision === 'append') {
        const candidates = memoryCache.files.filter(f => f.folderId === folder.id);
        const target = candidates.find(f => f.name.replace(/\.md$/i, '') === baseName)
            ?? candidates.find(f =>
                f.name.replace(/\.md$/i, '').includes(baseName)
                || baseName.includes(f.name.replace(/\.md$/i, ''))
            );
        if (target) {
            // Bound append-mode growth: keep the file head (everything before
            // the first section separator) plus the newest sections only.
            const parts = target.content.split(NOTE_SECTION_SEP);
            const head = parts[0];
            const sections = [...parts.slice(1), content].slice(-MAX_NOTE_SECTIONS);
            const updated = `${[head, ...sections].join(NOTE_SECTION_SEP)}\n`;
            await updateMemoryFileUnlocked(target.id, { content: updated }, username);
            // Return the FRESH object from the cache — `target` is a stale
            // reference and would report the pre-append content.
            return memoryCache.files.find(f => f.id === target.id) ?? target;
        }
        // Target file does not exist yet — create it with the note as its content.
        await pruneModelNotesIfFull(folder.id, username);
        return createMemoryFileUnlocked(folder.id, `${baseName}.md`, content, username, true);
    }

    // Create: never overwrite — suffix -2, -3… when the name is taken.
    let name = `${baseName}.md`;
    let i = 2;
    while (memoryCache.files.some(f => f.folderId === folder.id && f.name === name)) {
        name = `${baseName}-${i}.md`;
        i += 1;
    }
    await pruneModelNotesIfFull(folder.id, username);
    return createMemoryFileUnlocked(folder.id, name, content, username, true);
};

/** Serialized public API — see withNotebookWriteLock. */
export const writeModelNote = (note: ModelNote, username: string): Promise<MemoryFile> =>
    withNotebookWriteLock(() => writeModelNoteUnlocked(note, username));

/**
 * Keep a folder's harness-written note count bounded: when at capacity,
 * drop the OLDEST autoManaged file before a new one lands. User-authored
 * files are never touched — only notes this service created.
 */
const pruneModelNotesIfFull = async (folderId: string, username: string): Promise<void> => {
    const auto = memoryCache.files.filter(f => f.folderId === folderId && f.autoManaged);
    if (auto.length < MAX_NOTES_PER_FOLDER) return;
    const oldest = [...auto].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) await deleteMemoryFileUnlocked(oldest.id, username);
};

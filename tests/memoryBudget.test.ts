import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The notebook byte budget: soft / trigger / hard, and what each tier does.
 *
 * The contract worth pinning is that pressure only ever REFUSES growth. This
 * store has nothing safe to evict — every byte is user-written, ledger-owned,
 * or derived from a source that is only rebuilt when its own trigger fires — so
 * a budget that "freed space" by deleting would be worse than one that throws
 * at a writer and tells a human where the bytes are.
 */

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    // initMemoryFiles reads the raw value (missing vs unparseable) — mirror it.
    getPreference: vi.fn(async (key: string) => {
        const v = store[key];
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? v : JSON.stringify(v);
    }),
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import {
    CLEANUP_DEDUP_WINDOW_MS,
    NOTEBOOK_CLEANUP_TRIGGER_BYTES,
    NOTEBOOK_HARD_LIMIT_BYTES,
    NOTEBOOK_SOFT_LIMIT_BYTES,
    bytesOf,
    cleanupIsDue,
    describePressure,
    measureNotebook,
    pressureForBytes,
} from '../utils/memoryBudget';
import {
    createMemoryFile,
    getMemoryFiles,
    getNotebookSize,
    initMemoryFiles,
    notebookPressureAllows,
    updateMemoryFile,
    writeModelNote,
} from '../services/learning/MemoryFilesService';
import { ingestIfThenFromTrade } from '../services/learning/SkillMemoryService';

describe('bytesOf', () => {
    it('counts UTF-16 code units at two bytes each', () => {
        expect(bytesOf('')).toBe(0);
        expect(bytesOf(null)).toBe(0);
        expect(bytesOf(undefined)).toBe(0);
        expect(bytesOf('abcd')).toBe(8);
        // A CJK char is one code unit here; an emoji is a surrogate PAIR, so it
        // is two units and must not be counted as one.
        expect(bytesOf('中文字')).toBe(6);
        expect(bytesOf('🚀')).toBe(4);
    });
});

describe('the three tiers', () => {
    it('are ordered and the trigger sits between the other two', () => {
        expect(NOTEBOOK_SOFT_LIMIT_BYTES)
            .toBeLessThan(NOTEBOOK_CLEANUP_TRIGGER_BYTES);
        expect(NOTEBOOK_CLEANUP_TRIGGER_BYTES)
            .toBeLessThan(NOTEBOOK_HARD_LIMIT_BYTES);
    });

    it('classify at the inclusive boundary of the tier they open', () => {
        expect(pressureForBytes(NOTEBOOK_SOFT_LIMIT_BYTES - 2)).toBe('ok');
        expect(pressureForBytes(NOTEBOOK_SOFT_LIMIT_BYTES)).toBe('soft');
        expect(pressureForBytes(NOTEBOOK_CLEANUP_TRIGGER_BYTES)).toBe('trigger');
        expect(pressureForBytes(NOTEBOOK_HARD_LIMIT_BYTES)).toBe('hard');
        expect(pressureForBytes(Number.POSITIVE_INFINITY)).toBe('hard');
    });

    it('reads a nonsense measurement as no pressure rather than as a crisis', () => {
        expect(pressureForBytes(Number.NaN)).toBe('ok');
        expect(pressureForBytes(-1)).toBe('ok');
    });

    it('refuses new files from the trigger up, and every write only at hard', () => {
        expect(notebookPressureAllows('newFiles')).toBe(true); // nothing loaded yet
        expect(notebookPressureAllows('all')).toBe(true);
    });
});

describe('cleanupIsDue', () => {
    it('treats a missing or garbage stamp as due', () => {
        expect(cleanupIsDue(undefined, 1000)).toBe(true);
        expect(cleanupIsDue(null, 1000)).toBe(true);
        expect(cleanupIsDue(Number.NaN, 1000)).toBe(true);
    });

    it('coalesces repeats inside the window and lets one through after it', () => {
        const now = 10 * CLEANUP_DEDUP_WINDOW_MS;
        expect(cleanupIsDue(now - 1000, now)).toBe(false);
        expect(cleanupIsDue(now - CLEANUP_DEDUP_WINDOW_MS, now)).toBe(true);
    });

    it('is long enough that a request survives to the weekly pass that reads it', () => {
        // The dedup window must never exceed the hygiene cadence, or a request
        // made just after a pass could be suppressed past the next one.
        expect(CLEANUP_DEDUP_WINDOW_MS).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    });
});

const files = [
    { folderId: 'a', name: 'big.md', content: 'x'.repeat(1000) },
    { folderId: 'a', name: 'small.md', content: 'y'.repeat(10) },
    { folderId: 'b', name: 'mid.md', content: 'z'.repeat(500) },
];
const folders = [{ id: 'a', name: 'profile' }, { id: 'b', name: 'rules' }];

describe('measureNotebook', () => {
    const size = measureNotebook(files, folders);

    it('attributes bytes to the folder that holds them, biggest first', () => {
        expect(size.byFolder[0].name).toBe('profile');
        expect(size.byFolder[0].files).toBe(2);
        expect(size.byFolder[1].name).toBe('rules');
    });

    it('has folder shares that account for the whole store', () => {
        const sum = size.byFolder.reduce((n, f) => n + f.bytes, 0);
        expect(sum).toBe(size.bytes);
        expect(size.byFolder.reduce((n, f) => n + f.fraction, 0)).toBeCloseTo(1, 6);
    });

    it('names the largest files and caps how many it returns', () => {
        expect(size.largest[0].path).toBe('profile/big.md');
        expect(size.largest).toHaveLength(3);
        expect(measureNotebook(files, folders, { maxFiles: 1 }).largest).toHaveLength(1);
    });

    it('counts an unknown folder by its id rather than dropping its bytes', () => {
        const orphan = measureNotebook(
            [{ folderId: 'ghost', name: 'x.md', content: 'hello' }], folders,
        );
        expect(orphan.byFolder[0].name).toBe('ghost');
        expect(orphan.bytes).toBeGreaterThan(0);
    });

    it('is empty and inside budget for an empty notebook', () => {
        const empty = measureNotebook([], folders);
        expect(empty.bytes).toBe(0);
        expect(empty.pressure).toBe('ok');
        expect(empty.byFolder[0]).toBeUndefined();
    });
});

describe('describePressure', () => {
    it('says nothing is wrong when nothing is', () => {
        expect(describePressure(measureNotebook([], folders))).toMatch(/inside every budget/);
    });

    it('names the folder holding the most bytes once there is a problem', () => {
        const fat = measureNotebook(files, folders);
        const line = describePressure({ ...fat, pressure: 'trigger' });
        expect(line).toMatch(/profile\/ holds \d+%/);
        // Scoped on purpose. The old string claimed ALL notebook file creation
        // had stopped, which was never true — only model-note creation did.
        // It now names the two kinds that actually stop and says the rest
        // keeps working, so the Health tab cannot overstate what the budget
        // does.
        expect(line).toMatch(/stopped adding new skills and model notes/);
        expect(line).toMatch(/existing skills still update/);
        expect(line).not.toMatch(/stopped creating new notebook files/);
    });
});

describe('the budget wired into the notebook', () => {
    const USER = 'budget-user';

    beforeEach(async () => {
        store = {};
        localStorage.clear();
        await initMemoryFiles(USER);
    });

    const folder = (name: string) => getMemoryFiles().folders.find(f => f.name === name)!;

    /** Grow the cache until the measurement crosses a tier, through the real
     *  write path so the number under test is the one `persist` computed. */
    const fillWith = async (bytes: number, name: string): Promise<void> => {
        const chars = Math.ceil(bytes / 2) + 4096; // UTF-16 → chars, plus slack
        await createMemoryFile(folder('market-conditions').id, name, 'a'.repeat(chars), USER, true);
    };

    it('reports ok, and allows everything, for a fresh notebook', async () => {
        const size = getNotebookSize();
        expect(size?.pressure).toBe('ok');
        expect(notebookPressureAllows('newFiles')).toBe(true);
        expect(notebookPressureAllows('all')).toBe(true);
    });

    it('refuses to CREATE a note at the trigger but still appends to one that exists', async () => {
        await writeModelNote({
            folder: 'lessons', fileName: 'already-here', decision: 'create',
            content: 'a lesson worth keeping',
        } as never, USER);
        // `lessons` is not a seeded folder — the writer created it above.
        const lessons = folder('lessons');
        await fillWith(NOTEBOOK_CLEANUP_TRIGGER_BYTES, 'fat.md');
        expect(getNotebookSize()?.pressure).toBe('trigger');
        expect(notebookPressureAllows('newFiles')).toBe(false);
        expect(notebookPressureAllows('all')).toBe(true);

        await expect(writeModelNote({
            folder: 'lessons', fileName: 'brand-new', decision: 'create', content: 'x',
        } as never, USER)).rejects.toThrow(/Cannot create a new notebook file/);

        // The loop keeps learning: an append to an existing file still lands.
        await writeModelNote({
            folder: 'lessons', fileName: 'already-here', decision: 'append',
            content: 'a second lesson',
        } as never, USER);
        expect(getMemoryFiles().files.find(f => f.folderId === lessons.id && f.name === 'already-here.md')!
            .content).toContain('a second lesson');
    });

    it('refuses every model note at the hard cap', async () => {
        await fillWith(NOTEBOOK_HARD_LIMIT_BYTES, 'huge.md');
        expect(getNotebookSize()?.pressure).toBe('hard');
        expect(notebookPressureAllows('newFiles')).toBe(false);
        expect(notebookPressureAllows('all')).toBe(false);

        await expect(writeModelNote({
            folder: 'lessons', fileName: 'already-here', decision: 'append', content: 'x',
        } as never, USER)).rejects.toThrow(/hard size budget/);
    });

    /**
     * Skill creation is the growth the model drives itself, and it is the
     * only kind it can re-derive by consolidating — so it is what the budget
     * stops at the trigger tier. Until this, only writeModelNote consulted the
     * budget and the harness kept minting skills while the Health tab claimed
     * it had stopped.
     */
    it('refuses a new SKILL at the trigger, but updates existing skills and leaves other folders alone', async () => {
        const skills = folder('skills');
        expect(skills).toBeTruthy();
        // One real skill, so we can prove the update path still works.
        const live = await createMemoryFile(skills.id, 'live-skill.md', '# Live\n\n**When:** BTC sweeps.\n', USER, true);
        await fillWith(NOTEBOOK_CLEANUP_TRIGGER_BYTES, 'fat.md');
        expect(getNotebookSize()?.pressure).toBe('trigger');

        await expect(createMemoryFile(skills.id, 'brand-new-skill.md', '# New\n', USER, true))
            .rejects.toThrow(/Cannot add a new skill/);

        // A non-skill folder is untouched — the refusal is scoped.
        await expect(createMemoryFile(folder('market-conditions').id, 'note.md', 'still fine', USER, true))
            .resolves.toBeTruthy();

        // And the existing library still learns: updates land at this tier.
        await updateMemoryFile(live.id, { content: '# Live\n\n**When:** BTC sweeps twice.\n' }, USER);
        expect(getMemoryFiles().files.find(f => f.id === live.id)!.content).toContain('twice');
    });

    /**
     * Regression guard. A refused skill write must cost ONE skill, not the
     * learning loop. `ingestIfThenFromTradeUnlocked` is awaited by
     * `syncClosedTradeToNotebook` OUTSIDE its own try block, so a throw
     * escaping the per-clause create used to abort the worth gate, the
     * consolidation pass and the auto-eval scheduler for every subsequent
     * trade — permanently, once the notebook crossed the trigger tier.
     */
    it('a refused skill write does not propagate out of the post-mortem ingest', async () => {
        await fillWith(NOTEBOOK_CLEANUP_TRIGGER_BYTES, 'fat.md');
        expect(getNotebookSize()?.pressure).toBe('trigger');
        const trade = {
            id: 'pressure-1',
            analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as never,
            outcome: 'LOSS' as never,
            postMortem: 'IF BTC reclaims the prior day high THEN stand aside from the short entirely',
            timestamp: new Date().toISOString(),
        };
        // Must RESOLVE, not reject: the clause is simply not created.
        await expect(ingestIfThenFromTrade(trade, USER)).resolves.toBeUndefined();
        // …and the rest of the learning tail is still reachable afterwards.
        await expect(ingestIfThenFromTrade({ ...trade, id: 'pressure-2' }, USER)).resolves.toBeUndefined();
    });

    it('allows new skills freely below the trigger tier', async () => {
        const skills = folder('skills');
        expect(getNotebookSize()?.pressure).toBe('ok');
        await expect(createMemoryFile(skills.id, 'early-skill.md', '# Early\n', USER, true))
            .resolves.toBeTruthy();
    });

    it('destroys nothing on the way: every pre-existing file survives a refusal', async () => {
        await writeModelNote({
            folder: 'lessons', fileName: 'keep-me', decision: 'create', content: 'still here',
        } as never, USER);
        /** `profile/index.md` is regenerated by `persist` on every write, so its
         *  bytes changing is the design, not a loss. */
        const substantive = (): string[] => getMemoryFiles().files
            .filter(f => f.name !== 'index.md')
            .map(f => `${f.name}:${f.content.length}`)
            .sort();
        const before = substantive();

        await fillWith(NOTEBOOK_HARD_LIMIT_BYTES, 'huge.md');
        await expect(writeModelNote({
            folder: 'lessons', fileName: 'nope', decision: 'create', content: 'x',
        } as never, USER)).rejects.toThrow();

        // Every file that existed before the refusal is still there at the same
        // length: the budget refused, it did not make room.
        const after = substantive();
        for (const row of before) expect(after).toContain(row);
        expect(getMemoryFiles().files.some(f => f.name === 'keep-me.md')).toBe(true);
    });

    it('measures the serialized payload, not just the content', async () => {
        const detail = measureNotebook(getMemoryFiles().files, getMemoryFiles().folders);
        const size = getNotebookSize()!;
        // The JSON envelope (keys, braces, escaped newlines) is real bytes the
        // platform has to hold, so the governing figure sits at or above the
        // sum of the content it wraps.
        expect(size.bytes).toBeGreaterThanOrEqual(detail.bytes);
        expect(size.byFolder.reduce((n, f) => n + f.bytes, 0)).toBe(detail.bytes);
    });

    it('re-measures on load, so pressure is known before anything writes', async () => {
        await fillWith(NOTEBOOK_CLEANUP_TRIGGER_BYTES, 'fat.md');
        expect(getNotebookSize()?.pressure).toBe('trigger');
        await initMemoryFiles(USER);
        expect(getNotebookSize()?.pressure).toBe('trigger');
    });
});

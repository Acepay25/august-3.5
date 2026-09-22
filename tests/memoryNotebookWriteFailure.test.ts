/**
 * A refused notebook write has to be LOUD, not survivable in silence.
 *
 * `setPreferenceObject` rejects when the origin's storage is full (and when a
 * native write fails). Before `MemoryFilesService` recorded that, every caller
 * caught it, logged it, and carried on — while the in-memory cache kept serving
 * the whole notebook as if it were saved. The app, the notebook UI and the
 * Health tab all read from that cache, so the trader watched memory pile up
 * that was already gone: the next reload returns to whatever last reached disk.
 *
 * These pin the three things that fix needs to keep true: the failure is
 * RECORDED (not swallowed), it is still THROWN (so no caller's error handling
 * quietly changes), and it REACHES the health report the Learn surface renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
/** When set, the next notebook write throws this instead of storing. */
let refuse: ((key: string) => Error) | null = null;

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        if (refuse) throw refuse(key);
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import {
    initMemoryFiles, createMemoryFile, getMemoryFiles, getNotebookWriteFailure,
} from '../services/learning/MemoryFilesService';
import { buildMemoryHealthReport } from '../services/learning/memoryHealth';

const USER = 'quota-user';

const quotaError = (): Error => {
    const e = new Error('Failed to execute \'setItem\' on \'Storage\': quota exceeded');
    e.name = 'QuotaExceededError';
    return e;
};

const addNote = async (name: string): Promise<void> => {
    const folder = getMemoryFiles().folders[0];
    await createMemoryFile(folder.id, name, `# ${name}\n\nHold the close, not the wick.`, USER);
};

/** The health report touches provider config; keep this suite keyless. */
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => []),
    getReadyProviders: vi.fn(async () => []),
}));

beforeEach(async () => {
    store = {};
    refuse = null;
    // A clean write is also how the recorded-failure state gets cleared, so the
    // fixture starts the same way a session does: one write that reached disk.
    await initMemoryFiles(USER);
    expect(getNotebookWriteFailure()).toBeNull();
});

describe('a notebook write the storage layer refuses', () => {
    it('is recorded, and still thrown to the caller', async () => {
        refuse = quotaError;
        await expect(addNote('refused-1.md')).rejects.toThrow(/quota exceeded/);

        const failure = getNotebookWriteFailure();
        expect(failure).not.toBeNull();
        expect(failure?.kind).toBe('quota');
        expect(failure?.streak).toBe(1);
        expect(failure?.bytes).toBeGreaterThan(0);
        expect(failure?.message).toMatch(/quota/i);
    });

    it('counts consecutive refusals and clears the moment one reaches disk', async () => {
        refuse = quotaError;
        await addNote('a.md').catch(() => {});
        await addNote('b.md').catch(() => {});
        expect(getNotebookWriteFailure()?.streak).toBe(2);

        refuse = null;
        await addNote('c.md');
        expect(getNotebookWriteFailure()).toBeNull();

        // A later failure starts its own count rather than resuming the old one.
        refuse = quotaError;
        await addNote('d.md').catch(() => {});
        expect(getNotebookWriteFailure()?.streak).toBe(1);
    });

    it('names a non-size failure as one, so the copy cannot promise free space', async () => {
        refuse = () => new Error('WebView process died during write');
        await addNote('other.md').catch(() => {});
        const failure = getNotebookWriteFailure();
        expect(failure?.kind).toBe('error');
        expect(failure?.message).toMatch(/WebView process died/);
    });

    it('keeps serving the cache, which is exactly why the failure must be visible', async () => {
        refuse = quotaError;
        await addNote('in-memory-only.md').catch(() => {});

        // The read path is unchanged — the file IS there as far as the app
        // knows. Nothing but the recorded failure separates this state from a
        // healthy one, and that is the whole point of recording it.
        expect(getMemoryFiles().files.some(f => f.name === 'in-memory-only.md')).toBe(true);
        expect(store[`memory_files_v1_${USER}`]).toBeDefined();
        expect(getNotebookWriteFailure()).not.toBeNull();
    });
});

describe('the health report', () => {
    it('leads with the fact that learning is not being saved', async () => {
        refuse = quotaError;
        await addNote('x.md').catch(() => {});

        const report = await buildMemoryHealthReport(USER);
        expect(report.notebook.writeFailure?.kind).toBe('quota');
        expect(report.flags[0]).toMatch(/NOT SAVING/);
        expect(report.flags[0]).toMatch(/only in this session|not from disk/);
    });

    it('says nothing about saving while writes are reaching disk', async () => {
        const report = await buildMemoryHealthReport(USER);
        expect(report.notebook.writeFailure).toBeNull();
        expect(report.flags.join(' ')).not.toMatch(/NOT SAVING/);
    });
});

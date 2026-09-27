/**
 * The pending-amendment queue is a MEMORY write, and it was the only one in
 * the loop with no owner when the storage layer refused it.
 *
 * `memoryAmendments.save()` wrapped its `setItem` in a bare `catch` that
 * ignored the quota.
 * That is the exact swallow AGENTS.md forbids: a model-proposed correction the
 * trader never got to approve simply ceased to exist, `load()` returned the
 * queue without it, and nothing anywhere said so — while the app went on
 * looking perfectly healthy, because the notebook blob and the queue are
 * different keys in the same origin.
 *
 * These pin the three things that fix has to keep true: the refusal is
 * RECORDED and still THROWN, it is recorded against the store that actually
 * failed, and it REACHES the health report ahead of everything else.
 *
 * The scoping matters as much as the recording. The queue and the notebook
 * blob share one origin quota, so both can be refused by the same full disk —
 * but they clear independently, and a successful queue write must never wipe
 * a notebook failure that is still standing (or the reverse). That is the bug
 * a single global failure record would have introduced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let prefs: Record<string, unknown> = {};
/** When it returns true, the notebook blob write refuses instead of storing. */
let refuseNotebook: boolean = false;

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreference: vi.fn(async (key: string) => {
        const v = prefs[key];
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? v : JSON.stringify(v);
    }),
    getPreferenceObject: vi.fn(async (key: string) => prefs[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string) => {
        const v = prefs[key];
        return Array.isArray(v) ? v : [];
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        if (refuseNotebook) {
            const e = new Error('Failed to execute \'setItem\' on \'Storage\': quota exceeded');
            e.name = 'QuotaExceededError';
            throw e;
        }
        prefs[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => { delete prefs[key]; }),
}));

/** The health report touches provider config; keep this suite keyless. */
vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => []),
    getReadyProviders: vi.fn(async () => []),
}));

import {
    initMemoryFiles, createMemoryFile, getMemoryFiles,
    getNotebookWriteFailure, clearMemoryWriteFailure,
} from '../services/learning/MemoryFilesService';
import { proposeAmendment, listAmendments } from '../services/learning/memoryAmendments';
import { buildMemoryHealthReport } from '../services/learning/memoryHealth';
import { MemoryFile } from '../types/learning';

const USER = 'amend-quota-user';
const AMENDMENT_KEY = 'memory_amendments_v1';

/** When it returns true, that localStorage key refuses instead of storing. */
let refuseKeys: ((key: string) => boolean) | null = null;

const quotaError = (): Error => {
    const e = new Error('Failed to execute \'setItem\' on \'Storage\': quota exceeded');
    e.name = 'QuotaExceededError';
    return e;
};

const realSetItem = Storage.prototype.setItem;

const files: MemoryFile[] = [];
const finder = (id: string): MemoryFile | null => files.find(f => f.id === id) ?? null;

const targetFile = (): MemoryFile => ({
    id: 'f1', folderId: 'lessons', name: 'my-edge.md',
    content: '# My edge\n\nold claim', enabled: true,
    createdAt: 1, updatedAt: 1,
});

const propose = (): void => {
    proposeAmendment('f1', 'edit', '# My edge\n\ncorrected claim', 'the old claim predates the regime shift', 'model:test', finder);
};

beforeEach(async () => {
    prefs = {};
    refuseNotebook = false;
    refuseKeys = null;
    window.localStorage.clear();
    files.length = 0;
    files.push(targetFile());
    // Both scopes start clean — this state is module-level by design (it has to
    // survive the call that failed), so the fixture has to reset it explicitly.
    clearMemoryWriteFailure('notebook');
    clearMemoryWriteFailure('amendments');
    await initMemoryFiles(USER);
    expect(getNotebookWriteFailure()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (refuseKeys?.(key)) throw quotaError();
        realSetItem.call(this, key, value);
    });
});

describe('a queue write the storage layer refuses', () => {
    it('is recorded against the queue, and still thrown to the caller', () => {
        refuseKeys = key => key === AMENDMENT_KEY;

        expect(() => propose()).toThrow(/quota exceeded/);

        const failure = getNotebookWriteFailure();
        expect(failure).not.toBeNull();
        // The scope is the point: the notebook blob is fine, and a report that
        // said otherwise would send the trader to delete the wrong thing.
        expect(failure?.scope).toBe('amendments');
        expect(failure?.kind).toBe('quota');
        expect(failure?.streak).toBe(1);
        expect(failure?.bytes).toBeGreaterThan(0);
    });

    it('counts consecutive refusals and clears the moment one reaches disk', () => {
        refuseKeys = key => key === AMENDMENT_KEY;
        expect(() => propose()).toThrow();
        expect(() => propose()).toThrow();
        expect(getNotebookWriteFailure()?.streak).toBe(2);

        refuseKeys = null;
        propose();
        expect(getNotebookWriteFailure()).toBeNull();

        refuseKeys = key => key === AMENDMENT_KEY;
        expect(() => propose()).toThrow();
        // A later failure counts its own, rather than resuming the old streak.
        expect(getNotebookWriteFailure()?.streak).toBe(1);
    });

    it('actually loses the proposal — the read path cannot hide the loss', () => {
        refuseKeys = key => key === AMENDMENT_KEY;
        expect(() => propose()).toThrow();
        expect(listAmendments('pending')).toHaveLength(0);

        // Which is exactly why the refusal has to be loud: the store is
        // consistent, the queue is just quietly empty.
    });
});

describe('the two memory stores do not share a failure record', () => {
    it('a queue write reaching disk does not clear a notebook failure still standing', async () => {
        refuseNotebook = true;
        const folder = getMemoryFiles().folders[0];
        await createMemoryFile(folder.id, 'refused.md', '# refused\n\nnever lands', USER)
            .catch(() => { /* the refusal is the fixture */ });
        expect(getNotebookWriteFailure()?.scope).toBe('notebook');

        // The queue is a different key and writes fine.
        refuseNotebook = false;
        refuseKeys = null;
        propose();
        expect(listAmendments('pending')).toHaveLength(1);

        expect(getNotebookWriteFailure()?.scope).toBe('notebook');
    });

    it('a notebook write reaching disk does not clear a queue failure still standing', async () => {
        refuseKeys = key => key === AMENDMENT_KEY;
        expect(() => propose()).toThrow();
        expect(getNotebookWriteFailure()?.scope).toBe('amendments');

        refuseKeys = null;
        const folder = getMemoryFiles().folders[0];
        await createMemoryFile(folder.id, 'fine.md', '# fine\n\nlands', USER);

        expect(getNotebookWriteFailure()?.scope).toBe('amendments');
    });
});

describe('the health report', () => {
    it('leads with the fact that the amendment queue is not being stored', async () => {
        refuseKeys = key => key === AMENDMENT_KEY;
        expect(() => propose()).toThrow();

        const report = await buildMemoryHealthReport(USER);
        expect(report.notebook.writeFailure?.scope).toBe('amendments');
        expect(report.flags[0]).toMatch(/NOT SAVING/);
        // It must name the store that failed, and must NOT claim the notebook
        // was refused when it was not.
        expect(report.flags[0]).toMatch(/amendment queue/);
        expect(report.flags[0]).not.toMatch(/MB notebook/);
    });

    it('still reports the notebook by its own name when the notebook is the one refusing', async () => {
        refuseNotebook = true;
        const folder = getMemoryFiles().folders[0];
        await createMemoryFile(folder.id, 'refused.md', '# refused\n\nnever lands', USER)
            .catch(() => { /* the refusal is the fixture */ });

        const report = await buildMemoryHealthReport(USER);
        expect(report.flags[0]).toMatch(/MB notebook/);
    });

    it('says nothing about saving while writes are reaching disk', async () => {
        const report = await buildMemoryHealthReport(USER);
        expect(report.notebook.writeFailure).toBeNull();
        expect(report.flags.join(' ')).not.toMatch(/NOT SAVING/);
    });
});

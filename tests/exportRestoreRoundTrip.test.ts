/**
 * The export/restore round trip for a store its owner writes to localStorage.
 *
 * The drift scan in `exportRawLocalStorage.test.ts` proves the key is on both
 * allow-lists. This proves the two halves actually WORK, because being on the
 * list is necessary and not sufficient — and the failure this pins was silent
 * in both directions:
 *
 *   - RESTORE. On Capacitor, `setPreferenceObject` writes SharedPreferences /
 *     UserDefaults while the owner reads the WebView's localStorage. A key
 *     missing from the allow-lists was therefore written where nothing looks.
 *     For `supervisor_auto_v1_<user>` that is not a lost cache: it is the
 *     trader's "supervisor OFF" CONSENT, whose default is `true`
 *     (`supervisorStore.ts:84`), so a restore silently switched a disabled LLM
 *     pass back on.
 *   - EXPORT. `readSweptValue` read Preferences FIRST for every key, so on
 *     native it shipped the one-time migration snapshot — older than the live
 *     localStorage bytes — and every backup after a restore carried stale
 *     data. The list gates which source wins, so a key absent from it did not
 *     merely fail to restore; it exported the WRONG value.
 *
 * So the store is modelled the way native actually behaves: Preferences and
 * localStorage are two different maps, which is the only arrangement in which
 * this bug is observable at all. On web they are the same place and any such
 * test passes vacuously.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Capacitor Preferences — one store, entirely separate from localStorage. */
const { nativeStore } = vi.hoisted(() => ({ nativeStore: new Map<string, string>() }));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/preferences', () => ({
    Preferences: {
        // Capacitor returns a RESULT OBJECT with a nullable value — never a
        // bare null for a missing key.
        get: vi.fn(async ({ key }: { key: string }) =>
            ({ value: nativeStore.get(key) ?? null })),
        set: vi.fn(async ({ key, value }: { key: string; value: string }) => { nativeStore.set(key, value); }),
        remove: vi.fn(async ({ key }: { key: string }) => { nativeStore.delete(key); }),
        keys: vi.fn(async () => ({ keys: [...nativeStore.keys()] })),
    },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(), canShare: vi.fn() } }));
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: { writeFile: vi.fn() }, Directory: {}, Encoding: {},
}));

import { exportPreferencesData, importPreferencesData, RAW_STRING_ENVELOPE } from '../services/infrastructure/ExportService';

const USER = 'roundtrip-user';
/** The sharpest case in the tree: a consent, not a cache. */
const CONSENT_KEY = `supervisor_auto_v1_${USER}`;

beforeEach(() => {
    nativeStore.clear();
    window.localStorage.clear();
});

describe('a raw-localStorage store on a native platform', () => {
    it('round-trips through export → clear → import', async () => {
        // The trader's live value: the supervisor is OFF.
        window.localStorage.setItem(CONSENT_KEY, 'false');

        const backup = await exportPreferencesData();
        // The EXPORT half. A Preferences-first read would put the migration
        // snapshot (or nothing) here instead of the live bytes. Parsed, because
        // the sweep hands the backup the value its owner would read.
        expect(backup[CONSENT_KEY]).toBe(false);

        // The destructive half of the round trip: everything is gone.
        window.localStorage.clear();
        expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();

        const report = await importPreferencesData(backup);
        expect(report.skippedKeys).not.toContain(CONSENT_KEY);
        expect(report.failedKeys).not.toContain(CONSENT_KEY);

        // …and it comes back to where its owner looks, not to Preferences.
        expect(window.localStorage.getItem(CONSENT_KEY)).toBe('false');
    });

    it('is restored to localStorage even when Preferences holds a stale copy', async () => {
        // Exactly the state a previous restore leaves behind: the mirror is
        // newer-looking to a Preferences-first reader than the owner's bytes.
        window.localStorage.setItem(CONSENT_KEY, 'false');
        nativeStore.set(CONSENT_KEY, 'true');

        const backup = await exportPreferencesData();
        // The owner's store wins, or consent flips back to ON on every export.
        expect(backup[CONSENT_KEY]).toBe(false);

        window.localStorage.clear();
        await importPreferencesData(backup);
        expect(window.localStorage.getItem(CONSENT_KEY)).toBe('false');
    });

    it('carries an object-valued learning store, not just a flag', async () => {
        // The amendments queue: a list whose loss is a lost correction queue.
        const queue = [{ id: 'a1', fileName: 'my-edge.md', status: 'pending' }];
        window.localStorage.setItem('memory_amendments_v1', JSON.stringify(queue));

        const backup = await exportPreferencesData();
        expect(backup.memory_amendments_v1).toEqual(queue);

        window.localStorage.clear();
        await importPreferencesData(backup);
        expect(JSON.parse(window.localStorage.getItem('memory_amendments_v1') ?? 'null')).toEqual(queue);
    });

    it('carries a PLAIN STRING store through the raw-string envelope (Q4)', async () => {
        // `last_active_user` is a bare username, not JSON. The old sweep could
        // not parse it, so the key vanished; a naive mirror would restore
        // `"alice"` (quotes included) where every reader compares the bare name.
        window.localStorage.setItem('last_active_user', 'alice');
        const backup = await exportPreferencesData();
        expect(backup.last_active_user).toEqual({ [RAW_STRING_ENVELOPE]: 'alice' });

        window.localStorage.clear();
        nativeStore.clear();
        await importPreferencesData(backup);
        expect(window.localStorage.getItem('last_active_user')).toBe('alice');
        expect(nativeStore.get('last_active_user')).toBe('alice');
    });

    it('carries a plain session id and the sidebar flag without quoting either (Q4)', async () => {
        window.localStorage.setItem(`trade_chat_active_v1_${USER}`, 's-1');
        window.localStorage.setItem('trade_sidebar_open_v1', '0');

        const backup = await exportPreferencesData();
        expect(backup[`trade_chat_active_v1_${USER}`]).toEqual({ [RAW_STRING_ENVELOPE]: 's-1' });
        expect(backup.trade_sidebar_open_v1).toBe(0); // JSON-parseable flag

        window.localStorage.clear();
        await importPreferencesData(backup);
        expect(window.localStorage.getItem(`trade_chat_active_v1_${USER}`)).toBe('s-1');
        expect(window.localStorage.getItem('trade_sidebar_open_v1')).toBe('0');
    });
});

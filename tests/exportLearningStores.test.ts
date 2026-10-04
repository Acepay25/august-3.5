import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The learning loop's stores write `localStorage` DIRECTLY, so on Capacitor
 * they are invisible to `PreferencesService` in BOTH directions: a backup read
 * through `getPreferenceObject` carried the one-time migration snapshot
 * (`PreferencesService.migrateLocalStorageToPreferences` copies every
 * localStorage key once) instead of the live bytes, and a restore wrote into
 * Preferences, where none of these owners ever looks.
 *
 * The sharpest one is `supervisor_auto_v1_<user>`: the trader's "supervisor
 * OFF" CONSENT, whose default is `true`. A restore that missed it did not lose
 * a cache — it turned back on an LLM pass the user had deliberately switched
 * off. The first test below is that exact bug, driven through the real
 * supervisorStore rather than through a `localStorage.getItem` assertion, so
 * the thing under test is the value the user sees, not the bytes.
 *
 * Native is simulated the way the platform behaves: the Preferences store is a
 * SEPARATE map, and the keys these owners use are absent from it. The
 * "migration" rows below seed the one-time snapshot a first native launch
 * would have left behind.
 */

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/share', () => ({
    Share: { share: vi.fn(), canShare: vi.fn(async () => ({ value: false })) },
}));
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: { writeFile: vi.fn() },
    Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/preferences', () => ({
    Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), keys: vi.fn() },
}));

/** The native Preferences store: a different map from the WebView's
 *  localStorage, which is the whole point of every assertion in this file. */
let prefStore: Record<string, unknown> = {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

vi.mock('../services/infrastructure/PreferencesService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    return {
        ...actual,
        getPreferenceObject: vi.fn(async (key: string) => (key in prefStore ? clone(prefStore[key]) : null)),
        getPreferenceArray: vi.fn(async (key: string) => (key in prefStore ? clone(prefStore[key]) : null) as unknown[]),
        setPreferenceObject: vi.fn(async (key: string, value: unknown) => { prefStore[key] = clone(value); }),
        getAllKeys: vi.fn(async () => Object.keys(prefStore)),
    };
});

import { exportPreferencesData, importPreferencesData, isRawLocalStorageKey, EXPORT_RAW_KEY_CAP_BYTES } from '../services/infrastructure/ExportService';
import * as supervisorStore from '../services/learning/supervisorStore';

const USER = 'alice';
const AUTO_KEY = `supervisor_auto_v1_${USER}`;

/** Every newly-registered namespace, with a value in the shape its owner
 *  actually writes. Written the way the owners write it, not the way the
 *  backup does: the counters and toggles are PLAIN strings. */
const LEARNING_STORE_KEYS: Array<[key: string, localValue: string]> = [
    // memoryAmendments — a JSON queue of pending corrections.
    ['memory_amendments_v1', JSON.stringify([{ id: 'a1', fileName: 'notebook', status: 'pending' }])],
    // harnessLessons — JSON.
    ['august_harness_lessons_v1', JSON.stringify([{ id: 'l1', scope: 'thinkingDefault' }])],
    // sessionSkillReview — four keys, JSON or plain string, `:`-scoped.
    ['session_review_counter_v1:alice', '4'],
    ['session_review_drafted_v1:alice', JSON.stringify(['draft-1', 'draft-2'])],
    ['session_review_open_theses_v1:alice', JSON.stringify([{ symbol: 'BTCUSDT' }])],
    ['session_review_resolver_v1:alice', '1726400000000'],
    // The supervisor consent, its throttle stamp, and the learner pair.
    [AUTO_KEY, '0'],
    [`supervisor_last_run_v1_${USER}`, '1726400000000'],
    ['trader_learning_v1:alice', '0'],
    ['trader_learner_counter_v1:alice', '2'],
    // The book-draft seed flag.
    ['book_drafts_seeded_v1', '1'],
];

/** Leave the one-time migration snapshot behind, the way a first native launch
 *  does: every localStorage key copied into Preferences once, and never
 *  updated again. Values here are deliberately WRONG so an export that reads
 *  the mirror instead of the owner fails loudly. */
const seedMigrationSnapshot = (): void => {
    for (const [key, value] of LEARNING_STORE_KEYS) prefStore[key] = value === '1' ? 0 : 'migration-time snapshot';
};

/** The trading surface, each key in the shape its OWNER writes, with the real
 *  scoping (note the two-underscore `…_alice_BTCUSDT` drawing key). */
const TRADING_STORE_KEYS: Array<[key: string, localValue: string]> = [
    ['trade_watches_v1_alice', JSON.stringify([{ id: 'w1', price: 64000, side: 'above' }])],
    ['trade_level_arms_v1_alice', JSON.stringify([{ id: 'a1', at: 1726400000000 }])],
    ['trade_level_hits_v1_alice', JSON.stringify(['l1', 'l2'])],
    ['trade_drawings_v1_alice_BTCUSDT', JSON.stringify([{ id: 'd1', points: [[1726400000000, 64000]] }])],
    ['trade_session_drawings_v1_alice_sess-1', JSON.stringify({ BTCUSDT: [{ id: 'd2' }] })],
    // A benign tool: the redaction path blanks secret header VALUES on purpose,
    // so byte equality is asserted on a row that carries none.
    ['desk_tools_forged_v1', JSON.stringify([{ id: 't1', name: 'fear-greed', url: 'https://example.test/x' }])],
    ['trading_checklist_v1', JSON.stringify({ items: [{ text: 'checked the funding rate', done: true }] })],
    ['trade_tf_bar_v1_alice', JSON.stringify(['15m', '1h', '4h'])],
    ['harness_settings_v1', JSON.stringify({ equityUsd: 5000, riskPercent: 0.5, skillLibraryCap: 18 })],
    ['skill_drafts_v1:alice', JSON.stringify([{ id: 'sk-1', tradeId: 'msg-1', coin: 'BTC', crafted: { name: 'Fade the reclaim', kind: 'avoid', ifCondition: 'a sweep then a failed reclaim on BTC', thenAction: 'skip the short' } }])],
    ['learning_proposals_v1:alice', JSON.stringify([{ id: 'lp-1', kind: 'rescope', text: 'narrow it', skillSlug: 'btc-sweep', fingerprint: 'rs-1' }])],
];

const readBack = (key: string): unknown => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
    prefStore = {};
    localStorage.clear();
    localStorage.setItem('last_active_user', USER);
    supervisorStore.__resetForTests();
});

describe('the learning stores are in the raw-localStorage allow-list', () => {
    it('registers every one of them as RAW, not merely as restorable', () => {
        // The restore allow-list alone is not enough, and this is why: a key
        // listed there but missing from RAW_LOCAL_STORAGE_PREFIXES restores
        // into Preferences (where no owner reads) and exports the stale
        // migration copy. The list that does both is the raw one.
        const NOT_RAW = LEARNING_STORE_KEYS
            .map(([key]) => key)
            .filter(key => !isRawLocalStorageKey(key));
        expect(NOT_RAW).toEqual([]);
    });

    it('recognises both scoping conventions, not just <ns>_<user>', () => {
        // The counters build `${KEY}:${username}`, so a matcher that only knew
        // the underscore left every one of them exported-but-not-mirrored —
        // the same mobile data loss as being absent from the list.
        expect(isRawLocalStorageKey('supervisor_auto_v1_alice')).toBe(true);
        expect(isRawLocalStorageKey('supervisor_auto_v1:alice')).toBe(true);
        expect(isRawLocalStorageKey('session_review_counter_v1:alice')).toBe(true);
        expect(isRawLocalStorageKey('trader_learner_counter_v1:alice')).toBe(true);
        // …and stays tight: a different namespace is still someone else's.
        expect(isRawLocalStorageKey('supervisor_automatic_v2_alice')).toBe(false);
        expect(isRawLocalStorageKey('session_review_counter_v2:alice')).toBe(false);
    });
});

describe('export on native reads the OWNER, not the migration snapshot', () => {
    it('carries the live value of every learning store', async () => {
        for (const [key, value] of LEARNING_STORE_KEYS) localStorage.setItem(key, value);
        seedMigrationSnapshot();

        const backup = await exportPreferencesData();
        for (const [key, value] of LEARNING_STORE_KEYS) {
            expect(readBack(key)).toEqual(JSON.parse(value));
            expect(backup[key]).toEqual(JSON.parse(value));
        }
    });

    it('still finds a key whose only copy is the Preferences one', async () => {
        // No localStorage copy at all (the owner never ran this session): the
        // fallback keeps it in the backup rather than dropping it.
        prefStore['session_review_drafted_v1:bob'] = ['draft-bob'];
        const backup = await exportPreferencesData();
        expect(backup['session_review_drafted_v1:bob']).toEqual(['draft-bob']);
    });
});

describe('restore on native puts the value where the owner reads it', () => {
    it('round-trips every learning store: write → export → clear → import → read', async () => {
        // 1. WRITE — the owner's live store, exactly as it is after a session.
        for (const [key, value] of LEARNING_STORE_KEYS) localStorage.setItem(key, value);
        // 2. EXPORT — a backup leaves the device.
        const backup = await exportPreferencesData();
        // 3. CLEAR — a fresh install: both stores empty.
        localStorage.clear();
        prefStore = {};
        localStorage.setItem('last_active_user', USER);
        expect(localStorage.getItem(AUTO_KEY)).toBeNull();
        // 4. IMPORT — the backup is restored.
        const report = await importPreferencesData(backup);
        expect(report.skippedKeys).toEqual([]);
        expect(report.failedKeys).toEqual([]);
        // 5. READ — byte-for-byte what the owner wrote in step 1.
        for (const [key, value] of LEARNING_STORE_KEYS) {
            expect(localStorage.getItem(key)).toBe(value);
        }
    });

    it('keeps the "supervisor OFF" consent OFF across a restore (the P0)', async () => {
        // Through the real store, so the assertion is the value the indicator
        // renders — not the bytes, which could agree while the owner does not.
        supervisorStore.setAutoEnabled(false);
        expect(supervisorStore.isAutoEnabled()).toBe(false);

        const backup = await exportPreferencesData();
        expect(backup[AUTO_KEY]).toBe(0); // '0' through the JSON sweep

        localStorage.clear();
        prefStore = {};
        localStorage.setItem('last_active_user', USER);
        supervisorStore.__resetForTests();
        expect(supervisorStore.isAutoEnabled()).toBe(true); // the default it reverted to

        await importPreferencesData(backup);
        supervisorStore.__resetForTests();
        expect(supervisorStore.isAutoEnabled()).toBe(false);
        // Leave the singleton how the suite found it.
        supervisorStore.setAutoEnabled(true);
    });

    it('restores supervisor_last_run_v1_<user>, which was in NEITHER list', async () => {
        // The export sweep found it in localStorage and wrote it into every
        // backup; import then dropped it as un-allow-listed. Harmless data, but
        // it is the same shape of bug as the six learning stores.
        const report = await importPreferencesData({ [`supervisor_last_run_v1_${USER}`]: 1726400000000 });
        expect(report.skippedKeys).toEqual([]);
        expect(localStorage.getItem(`supervisor_last_run_v1_${USER}`)).toBe('1726400000000');
    });

    it('does not give a Preferences-owned key a localStorage shadow copy', async () => {
        // The WebView origin quota is shared; a copy nothing reads is how
        // memory starts getting evicted (see utils/memoryBudget).
        await importPreferencesData({ 'memory_files_v1_alice': { version: 1, files: [] } });
        expect(prefStore['memory_files_v1_alice']).toBeDefined();
        expect(localStorage.getItem('memory_files_v1_alice')).toBeNull();
    });
});

// ─── Step 9: the trading surface ─────────────────────────────────────────────

describe('the trading stores are registered as RAW', () => {
    it('every one of them, so export reads the owner and restore mirrors it', () => {
        const NOT_RAW = TRADING_STORE_KEYS
            .map(([key]) => key)
            .filter(key => !isRawLocalStorageKey(key));
        expect(NOT_RAW).toEqual([]);
    });

    it('exports the live bytes when the Preferences store has nothing at all', async () => {
        // This is `harness_settings_v1`'s round trip, and the reason it is on the
        // raw list: it was assumed to be covered by the Preferences backup path.
        // With an empty Preferences store — exactly a native device whose owner
        // only ever wrote localStorage — the old code exported NO key at all.
        for (const [key, value] of TRADING_STORE_KEYS) localStorage.setItem(key, value);
        const backup = await exportPreferencesData();
        for (const [key, value] of TRADING_STORE_KEYS) {
            expect(backup[key]).toEqual(JSON.parse(value));
        }
    });

    it('round-trips byte for byte: write → export → clear → import → same bytes', async () => {
        for (const [key, value] of TRADING_STORE_KEYS) localStorage.setItem(key, value);
        const backup = await exportPreferencesData();
        localStorage.clear();
        prefStore = {};
        localStorage.setItem('last_active_user', USER);
        const report = await importPreferencesData(backup);
        expect(report.skippedKeys).toEqual([]);
        expect(report.failedKeys).toEqual([]);
        for (const [key, value] of TRADING_STORE_KEYS) {
            expect(localStorage.getItem(key)).toBe(value);
        }
    });
});

describe('trade_chat_sessions_v1 exports whole, WITHOUT image bytes', () => {
    const PNG = 'data:image/png;base64,' + 'A'.repeat(400_000);
    const session = (id: string) => [{
        id, title: 'Sweep reclaim chat', createdAt: 1, updatedAt: 2,
        entries: [
            { id: 'e1', role: 'user', text: 'look at this chart', tools: [], image: PNG, at: 3 },
            { id: 'e2', role: 'ai', text: 'the reclaim failed on the close', tools: [], at: 4 },
        ],
    }];
    const KEY = `trade_chat_sessions_v1_${USER}`;

    it('keeps text, order and metadata; replaces the payload with a stub', async () => {
        localStorage.setItem(KEY, JSON.stringify(session('s1')));
        const liveBefore = localStorage.getItem(KEY);
        const backup = await exportPreferencesData();
        const exported = backup[KEY] as Array<{ title: string; entries: Array<Record<string, unknown>> }>;

        expect(JSON.stringify(exported)).not.toContain('data:image/png');
        const e1 = exported[0].entries[0];
        expect(e1.image).toBeUndefined();
        expect(e1.imageOmitted).toEqual({ bytes: PNG.length, mime: 'image/png' });
        // Text and order survive untouched.
        expect(exported[0].entries.map(e => e.text)).toEqual(['look at this chart', 'the reclaim failed on the close']);
        expect(exported[0].title).toBe('Sweep reclaim chat');
        // And the transform never reaches back into the live store.
        expect(localStorage.getItem(KEY)).toBe(liveBefore);
    });

    it('is under the per-store cap once the images are gone', async () => {
        localStorage.setItem(KEY, JSON.stringify(session('s1')));
        const backup = await exportPreferencesData();
        const bytes = new TextEncoder().encode(JSON.stringify(backup[KEY])).length;
        expect(bytes).toBeLessThan(EXPORT_RAW_KEY_CAP_BYTES);
        // A cap skip would have removed the key and left a notice.
        expect(backup._backup_notices).toBeUndefined();
    });

    it('SKIPS a store still over the cap and says so in the backup', async () => {
        // Stripped, but the text alone blows the budget: a silent truncation here
        // would ship a backup that lost the transcripts and claimed otherwise.
        const big = 'x'.repeat(EXPORT_RAW_KEY_CAP_BYTES + 1000);
        localStorage.setItem(KEY, JSON.stringify([{
            id: 's2', title: 'Long', createdAt: 1, updatedAt: 2,
            entries: [{ id: 'e1', role: 'user', text: big, tools: [] }],
        }]));
        const backup = await exportPreferencesData();
        expect(backup[KEY]).toBeUndefined();
        expect(JSON.stringify(backup._backup_notices)).toContain(KEY);
        expect(localStorage.getItem(KEY)).not.toBeNull();
    });
});

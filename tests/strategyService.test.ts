import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock PreferencesService so strategy docs live in an in-memory, per-key
// store (avoids touching localStorage / Capacitor Preferences in tests).
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import {
  initStrategyDocs,
  getStrategyDocs,
  saveStrategyDoc,
  updateStrategyDoc,
  deleteStrategyDoc,
  getEnabledStrategiesText,
  StrategyDoc,
} from '../services/infrastructure/StrategyService';

const makeDoc = (overrides: Partial<StrategyDoc> = {}): StrategyDoc => ({
  id: 'doc-1',
  sourceName: 'Breakout Book.pdf',
  pageCount: 120,
  charCount: 50_000,
  createdAt: 1_000,
  updatedAt: 1_000,
  summary: '**Strategy: Breakout retest** — enter on retest of the broken level, SL below the range.',
  enabled: true,
  ...overrides,
});

describe('StrategyService', () => {
  beforeEach(async () => {
    store = {};
    // Reset the sync cache by (re)initializing against the empty store.
    await initStrategyDocs('test-user');
  });

  describe('initStrategyDocs', () => {
    it('starts empty for a user with nothing saved', async () => {
      expect(getStrategyDocs()).toEqual([]);
      expect(getEnabledStrategiesText()).toBe('');
    });

    it('loads the active user\'s docs into the cache', async () => {
      store['strategy_docs_v1_test-user'] = { version: 1, docs: [makeDoc()] };
      await initStrategyDocs('test-user');
      expect(getStrategyDocs()).toEqual([makeDoc()]);
    });

    it('isolates users — switching users swaps the cache', async () => {
      store['strategy_docs_v1_alice'] = { version: 1, docs: [makeDoc({ sourceName: 'Alice.pdf' })] };
      await initStrategyDocs('alice');
      expect(getStrategyDocs()[0].sourceName).toBe('Alice.pdf');
      store['strategy_docs_v1_bob'] = { version: 1, docs: [makeDoc({ sourceName: 'Bob.pdf' })] };
      await initStrategyDocs('bob');
      expect(getStrategyDocs()[0].sourceName).toBe('Bob.pdf');
    });
  });

  describe('saveStrategyDoc', () => {
    it('adds a new doc and persists it', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      expect(getStrategyDocs()).toHaveLength(1);
      // saveStrategyDoc stamps createdAt/updatedAt itself — assert the rest.
      expect(store['strategy_docs_v1_test-user']).toEqual({
        version: 1,
        docs: [expect.objectContaining({
          id: 'doc-1',
          sourceName: 'Breakout Book.pdf',
          pageCount: 120,
          charCount: 50_000,
          summary: '**Strategy: Breakout retest** — enter on retest of the broken level, SL below the range.',
          enabled: true,
        })],
      });
    });

    it('replaces an existing doc with the same id (keeps one entry)', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      await saveStrategyDoc(makeDoc({ summary: 'Updated summary.' }), 'test-user');
      expect(getStrategyDocs()).toHaveLength(1);
      expect(getStrategyDocs()[0].summary).toBe('Updated summary.');
      expect(getStrategyDocs()[0].updatedAt).toBeGreaterThanOrEqual(1_000);
    });

    it('persists each user under their own key', async () => {
      await saveStrategyDoc(makeDoc(), 'alice');
      expect(store['strategy_docs_v1_alice']).toBeTruthy();
      expect(store['strategy_docs_v1_bob']).toBeUndefined();
      await initStrategyDocs('bob');
      expect(getStrategyDocs()).toHaveLength(0);
      await initStrategyDocs('alice');
      expect(getStrategyDocs()).toHaveLength(1);
    });
  });

  describe('updateStrategyDoc', () => {
    it('patches fields (summary edits, enable toggle)', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      await updateStrategyDoc('doc-1', { enabled: false }, 'test-user');
      expect(getStrategyDocs()[0].enabled).toBe(false);
      await updateStrategyDoc('doc-1', { summary: 'Edited.' }, 'test-user');
      expect(getStrategyDocs()[0].summary).toBe('Edited.');
      expect(getStrategyDocs()[0].sourceName).toBe('Breakout Book.pdf');
    });

    it('is a no-op for an unknown id', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      await updateStrategyDoc('nope', { enabled: false }, 'test-user');
      expect(getStrategyDocs()[0].enabled).toBe(true);
    });
  });

  describe('deleteStrategyDoc', () => {
    it('removes the doc and clears storage when the list empties', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      await deleteStrategyDoc('doc-1', 'test-user');
      expect(getStrategyDocs()).toEqual([]);
      expect(store['strategy_docs_v1_test-user']).toBeUndefined();
    });
  });

  describe('getEnabledStrategiesText', () => {
    it('concatenates only enabled docs with summaries', async () => {
      await saveStrategyDoc(makeDoc(), 'test-user');
      await saveStrategyDoc(
        makeDoc({ id: 'doc-2', sourceName: 'Second.pdf', summary: '**Strategy: Range fade** — fade the edges.', enabled: true }),
        'test-user',
      );
      await saveStrategyDoc(
        makeDoc({ id: 'doc-3', sourceName: 'Disabled.pdf', summary: 'Hidden.', enabled: false }),
        'test-user',
      );
      const text = getEnabledStrategiesText();
      expect(text).toContain('Breakout Book.pdf');
      expect(text).toContain('Second.pdf');
      expect(text).not.toContain('Disabled.pdf');
    });

    it('returns empty when everything is disabled', async () => {
      await saveStrategyDoc(makeDoc({ enabled: false }), 'test-user');
      expect(getEnabledStrategiesText()).toBe('');
    });

    it('skips docs whose summary is blank', async () => {
      await saveStrategyDoc(makeDoc({ summary: '   ' }), 'test-user');
      expect(getEnabledStrategiesText()).toBe('');
    });
  });
});

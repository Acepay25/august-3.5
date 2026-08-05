import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal in-memory IndexedDB fake covering exactly what persistentCache uses
// (open → onupgradeneeded/onsuccess, transaction, get/put/count/openCursor/clear).
// Event-driven like the real API: handlers are assigned, then events fire async.
class FakeRequest {
  result: any = null;
  error: any = null;
  onsuccess: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onupgradeneeded: ((ev: any) => void) | null = null;

  succeed(result?: any) {
    this.result = result;
    this.onsuccess?.({ target: this });
  }
  fail() {
    this.onerror?.({ target: this });
  }
}

class FakeStore {
  constructor(private map: Map<string, any>) {}

  get(key: string) {
    const req = new FakeRequest();
    queueMicrotask(() => req.succeed(this.map.get(key) ?? null));
    return req;
  }

  put(entry: any) {
    this.map.set(entry.key, entry);
    const req = new FakeRequest();
    queueMicrotask(() => req.succeed());
    return req;
  }

  count() {
    const req = new FakeRequest();
    queueMicrotask(() => req.succeed(this.map.size));
    return req;
  }

  clear() {
    this.map.clear();
    const req = new FakeRequest();
    queueMicrotask(() => req.succeed());
    return req;
  }

  delete(key: string) {
    this.map.delete(key);
    const req = new FakeRequest();
    queueMicrotask(() => req.succeed());
    return req;
  }

  /** Iterates insertion order; each cursor.continue() advances. */
  openCursor() {
    const req = new FakeRequest();
    const entries = [...this.map.entries()];
    let i = 0;
    queueMicrotask(() => {
      const step = () => {
        if (i < entries.length) {
          const [key, value] = entries[i++];
          req.result = { key, value, continue: () => queueMicrotask(step) };
        } else {
          req.result = null;
        }
        req.onsuccess?.({ target: req });
      };
      step();
    });
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private store: FakeStore) {}
  objectStore() {
    return this.store;
  }
}

class FakeDB {
  constructor(private store: FakeStore) {}
  transaction() {
    const tx = new FakeTransaction(this.store);
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  }
}

const map = new Map<string, any>();
const db = new FakeDB(new FakeStore(map));

vi.stubGlobal('indexedDB', {
  open: (_name: string, _version: number) => {
    const req = new FakeRequest();
    queueMicrotask(() => {
      req.result = db;
      req.onsuccess?.({ target: req });
    });
    return req;
  },
});

import { persistentGet, persistentSet, persistentClear } from '../services/infrastructure/persistentCache';

describe('persistentCache (IndexedDB)', () => {
  beforeEach(() => {
    map.clear();
  });

  it('round-trips a value through the persistent store', async () => {
    await persistentSet('key-a', { direction: 'Long' }, Date.now());
    const entry = await persistentGet<{ direction: string }>('key-a');
    expect(entry?.value).toEqual({ direction: 'Long' });
    expect(typeof entry?.timestamp).toBe('number');
  });

  it('returns null for a missing key', async () => {
    expect(await persistentGet('missing')).toBeNull();
  });

  it('overwrites an existing key', async () => {
    await persistentSet('key-a', 'first', 1);
    await persistentSet('key-a', 'second', 2);
    expect((await persistentGet('key-a'))?.value).toBe('second');
  });

  it('clears the whole store', async () => {
    await persistentSet('key-a', 'x', 1);
    await persistentSet('key-b', 'y', 2);
    await persistentClear();
    expect(await persistentGet('key-a')).toBeNull();
    expect(await persistentGet('key-b')).toBeNull();
  });

  it('evicts the oldest entries beyond the cap', async () => {
    const now = Date.now();
    for (let i = 0; i < 205; i++) {
      await persistentSet(`key-${i}`, i, now);
    }
    // 205 writes with a 200-entry cap → the 5 oldest are evicted.
    expect(await persistentGet('key-0')).toBeNull();
    expect(await persistentGet('key-4')).toBeNull();
    expect((await persistentGet('key-204'))?.value).toBe(204);
  });

  it('survives "reloads" (module state persists across calls)', async () => {
    await persistentSet('persist-me', 'still-here', Date.now());
    expect((await persistentGet('persist-me'))?.value).toBe('still-here');
  });
});

describe('responseCache hydration from the persistent store', () => {
  beforeEach(() => {
    map.clear();
    vi.resetModules();
  });

  it('hydrates a memory miss from the persisted store', async () => {
    const { cacheResponse, getCachedResponse } = await import('../services/infrastructure/responseCache');
    cacheResponse(['no-images'], 'prompt-one', 'model-a', {
      thoughtProcess: 'thinking',
      analysis: { direction: 'Long' },
    });
    // Memory hit first.
    const hit = await getCachedResponse(['no-images'], 'prompt-one', 'model-a');
    expect(hit?.analysis).toEqual({ direction: 'Long' });

    // Simulate a reload: wipe the in-memory cache but keep the persisted store.
    const { clearAllCaches } = await import('../services/infrastructure/responseCache');
    clearAllCaches();
    const afterReload = await getCachedResponse(['no-images'], 'prompt-one', 'model-a');
    expect(afterReload?.analysis).toEqual({ direction: 'Long' });
  });

  it('does not hydrate expired entries (TTL)', async () => {
    // Write an entry with an old timestamp directly into the store.
    await persistentSet(
      'no-images:hash:model-a',
      { thoughtProcess: 't', analysis: { direction: 'Short' }, model: 'model-a', timestamp: Date.now() - 20 * 60 * 1000 },
      Date.now() - 20 * 60 * 1000,
    );
    const { getCachedResponse, hashString } = await import('../services/infrastructure/responseCache');
    const key = `no-images:${hashString('expired-prompt')}:model-a`;
    // Rebuild the key the same way the module does — put with the correct key:
    await persistentSet(
      key,
      { thoughtProcess: 't', analysis: { direction: 'Short' }, model: 'model-a', timestamp: Date.now() - 20 * 60 * 1000 },
      Date.now() - 20 * 60 * 1000,
    );
    const result = await getCachedResponse(['no-images'], 'expired-prompt', 'model-a');
    expect(result).toBeUndefined();
  });
});

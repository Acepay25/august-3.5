/**
 * Persistent key-value cache (IndexedDB).
 *
 * Backs caches that should survive reloads — the AI response cache in
 * particular. The in-memory caches are fast and session-scoped; this store
 * hydrates them on miss so a re-analysis of the same chart after a reload
 * hits instead of burning fresh API calls. Best-effort: every function
 * swallows failures (private mode, quota, non-browser) and returns a miss.
 */

const DB_NAME = 'august-cache';
const STORE_NAME = 'kv';
const MAX_ENTRIES = 200;
// AI response cache entries go stale fast (market context moves) — anything
// older than this is dead weight and evicted first under pressure.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PersistentEntry<T> {
  key: string;
  value: T;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  // Local const so the explicit type survives flow analysis — `dbPromise`
  // itself is widened (the catch closure reassigns it to null) and would
  // otherwise fail the final return type.
  const promise: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((err: unknown): never => {
    // Never cache a rejected promise: one transient failure (private mode,
    // version conflict, quota) would otherwise poison EVERY later read/write
    // for the rest of the session. Reset so the next call retries.
    dbPromise = null;
    throw err;
  });
  dbPromise = promise;
  return promise;
};

export const persistentGet = async <T>(key: string): Promise<PersistentEntry<T> | null> => {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as PersistentEntry<T>) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

export const persistentSet = async (key: string, value: unknown, timestamp: number): Promise<void> => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, value, timestamp } as PersistentEntry<unknown>);

      // Cap the store under pressure (count at/over the cap): evict TTL-expired
      // entries first, then the OLDEST remaining — by timestamp, not cursor
      // key order (hashed keys — openCursor walks in key order, not age).
      // Otherwise fresh entries (including the one just written) could be
      // evicted while expired junk survives.
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result <= MAX_ENTRIES) return;
        const collected: { key: IDBValidKey; timestamp: number }[] = [];
        const scanReq = store.openCursor();
        scanReq.onsuccess = () => {
          const cursor = scanReq.result;
          if (cursor) {
            collected.push({ key: cursor.key, timestamp: (cursor.value as { timestamp?: number })?.timestamp ?? 0 });
            cursor.continue();
          } else {
            const now = Date.now();
            const expired = collected.filter(entry => now - entry.timestamp > CACHE_TTL_MS);
            for (const entry of expired) store.delete(entry.key);
            const survivors = collected.filter(entry => now - entry.timestamp <= CACHE_TTL_MS);
            survivors.sort((a, b) => a.timestamp - b.timestamp);
            const overflow = survivors.length - (MAX_ENTRIES - expired.length);
            for (const entry of survivors.slice(0, Math.max(0, overflow))) store.delete(entry.key);
          }
        };
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // best-effort — persistence must never break the analysis flow
  }
};

export const persistentClear = async (): Promise<void> => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // best-effort
  }
};

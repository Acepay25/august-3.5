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

export interface PersistentEntry<T> {
  key: string;
  value: T;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
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

      // Cap the store: evict the OLDEST entries beyond MAX_ENTRIES.
      // openCursor walks in KEY order (hashed keys — not age), so collect all
      // entries first and delete the oldest by timestamp — otherwise fresh
      // entries (including the one just written) could be evicted while
      // expired junk survives.
      const countReq = store.count();
      countReq.onsuccess = () => {
        const overflow = countReq.result - MAX_ENTRIES;
        if (overflow > 0) {
          const collected: { key: IDBValidKey; timestamp: number }[] = [];
          const scanReq = store.openCursor();
          scanReq.onsuccess = () => {
            const cursor = scanReq.result;
            if (cursor) {
              collected.push({ key: cursor.key, timestamp: (cursor.value as { timestamp?: number })?.timestamp ?? 0 });
              cursor.continue();
            } else {
              collected.sort((a, b) => a.timestamp - b.timestamp);
              for (const entry of collected.slice(0, overflow)) store.delete(entry.key);
            }
          };
        }
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

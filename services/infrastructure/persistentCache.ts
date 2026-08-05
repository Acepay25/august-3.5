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

      // Cap the store: evict the oldest entries beyond MAX_ENTRIES.
      const countReq = store.count();
      countReq.onsuccess = () => {
        const overflow = countReq.result - MAX_ENTRIES;
        if (overflow > 0) {
          const cursorReq = store.openCursor();
          let toDelete = overflow;
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && toDelete > 0) {
              store.delete(cursor.key);
              toDelete--;
              cursor.continue();
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

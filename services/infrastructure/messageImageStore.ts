/**
 * messageImageStore.ts
 *
 * Out-of-band storage for chart screenshots (base64 dataURLs) attached to
 * user messages. The profile blob (IndexedDB record / SQLite row) used to
 * carry these images inline, which meant every profile save — including the
 * 15s mid-run heartbeat — re-serialized multi-MB of base64 on the main
 * thread. Moving them here keeps the hot save path small.
 *
 * Fail-safe contract: image loss is never acceptable. The store only reports
 * success after the IDB write commits; dbService strips images from the
 * profile payload ONLY for keys that stored successfully. On any failure the
 * images stay embedded in the profile (legacy behavior) and are still
 * persisted there.
 *
 * Best-effort like persistentCache: private-mode / quota failures degrade to
 * "not stored" and are reported so the caller can fall back.
 */

const DB_NAME = 'august-msg-images';
const STORE_NAME = 'images';
const KEY_SEP = '__';

export interface StoredMessageImages {
  key: string; // `${conversationId}${KEY_SEP}${messageId}`
  images: string[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
// Session cache: saves one IDB round-trip per key on the rehydration path.
const sessionCache = new Map<string, string[] | null>();

const makeKey = (conversationId: string, messageId: string): string =>
  `${conversationId}${KEY_SEP}${messageId}`;

const openDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  // Local const so the explicit type survives flow analysis (the catch
  // closure reassigns the module-level dbPromise to null).
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
    // Never cache a rejected promise: a transient failure would poison every
    // later access. Reset so the next call retries.
    dbPromise = null;
    throw err;
  });
  dbPromise = promise;
  return promise;
};

/**
 * Store one message's images. Returns true only after the write committed.
 */
export const putMessageImages = async (
  conversationId: string,
  messageId: string,
  images: string[]
): Promise<boolean> => {
  if (!conversationId || !messageId || images.length === 0) return true;
  const key = makeKey(conversationId, messageId);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key, images, updatedAt: Date.now() } as StoredMessageImages);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    sessionCache.set(key, images);
    return true;
  } catch {
    return false;
  }
};

/**
 * Read one message's images (session cache first, then IndexedDB).
 * Returns undefined when nothing was ever stored for this key.
 */
export const getMessageImages = async (
  conversationId: string,
  messageId: string
): Promise<string[] | undefined> => {
  if (!conversationId || !messageId) return undefined;
  const key = makeKey(conversationId, messageId);
  if (sessionCache.has(key)) return sessionCache.get(key) ?? undefined;
  try {
    const db = await openDb();
    const row = await new Promise<StoredMessageImages | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as StoredMessageImages | undefined);
      req.onerror = () => resolve(undefined);
    });
    const images = row?.images?.length ? row.images : undefined;
    sessionCache.set(key, images ?? null);
    return images;
  } catch {
    return undefined;
  }
};

/**
 * Read all stored images for one conversation (batch rehydration).
 * Returns messageId → images.
 */
export const getConversationImages = async (
  conversationId: string
): Promise<Record<string, string[]>> => {
  const result: Record<string, string[]> = {};
  if (!conversationId) return result;
  try {
    const db = await openDb();
    const rows = await new Promise<StoredMessageImages[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const range = IDBKeyRange.bound(`${conversationId}${KEY_SEP}`, `${conversationId}${KEY_SEP}\uffff`);
      const req = store.getAll(range);
      req.onsuccess = () => resolve((req.result as StoredMessageImages[]) || []);
      req.onerror = () => resolve([]);
    });
    for (const row of rows) {
      if (!row?.images?.length) continue;
      const messageId = row.key.slice(conversationId.length + KEY_SEP.length);
      result[messageId] = row.images;
      sessionCache.set(row.key, row.images);
    }
    return result;
  } catch {
    return result;
  }
};

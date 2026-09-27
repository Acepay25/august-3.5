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
// Bounded LRU — the values are base64 image payloads, so an unbounded Map
// grew for the whole session (every image ever viewed stayed resident).
// Map iteration order is insertion order, so re-inserting on read makes the
// first key the least-recently-used one, evictable when the cap is passed.
// Eviction only drops the in-memory mirror; the IndexedDB row is untouched.
const SESSION_CACHE_CAP = 100;
const sessionCache = new Map<string, string[] | null>();

// ── Write short-circuit: cheap payload fingerprints ─────────────────────────
// dbService.stripMessageImages re-PUTs every stored image on EVERY heavy
// profile save (1500ms data debounce + 15s mid-run heartbeat) even when the
// images have not changed, re-serializing multi-MB base64 each time. A tiny
// fingerprint per key lets putMessageImages skip the IndexedDB round-trip
// when the payload is byte-identical to what this module last committed (or
// last read back — reads seed the map too, so the first save after a reload
// short-circuits as well).
//
// The fingerprint is NOT a cryptographic hash: first + last 64 characters and
// the total length of the joined payload. A false match requires two
// DIFFERENT payloads to agree on head, tail AND length — for real base64
// image data that is vanishingly unlikely, and the failure mode is bounded
// (one stale row until the next actual change re-PUTs).
//
// Eviction: none, deliberately. An entry exists only for a key this module
// has written or read, so the map is bounded above by the rows that actually
// exist in the store (roughly one short string per stored message) — it can
// never grow past the data it mirrors. Deleting keys (the GC below) purges
// their fingerprints, and an LRU here could only lose short-circuits, never
// correctness.
const FINGERPRINT_HEAD_TAIL = 64;
const writeFingerprints = new Map<string, string>();

const fingerprintImages = (images: string[]): string => {
    const joined = images.join('\u0000');
    const len = joined.length;
    if (len <= FINGERPRINT_HEAD_TAIL * 2) return `${len}:${joined}`;
    return `${len}:${joined.slice(0, FINGERPRINT_HEAD_TAIL)}:${joined.slice(-FINGERPRINT_HEAD_TAIL)}`;
};

const cacheSet = (key: string, value: string[] | null): void => {
  if (sessionCache.has(key)) sessionCache.delete(key);
  sessionCache.set(key, value);
  while (sessionCache.size > SESSION_CACHE_CAP) {
    const oldest = sessionCache.keys().next().value;
    if (oldest === undefined) break;
    sessionCache.delete(oldest);
  }
};

const cacheGet = (key: string): string[] | null | undefined => {
  if (!sessionCache.has(key)) return undefined;
  const value = sessionCache.get(key) ?? null;
  // Re-insert so this key becomes the most-recently-used.
  sessionCache.delete(key);
  sessionCache.set(key, value);
  return value;
};

const makeKey = (conversationId: string, messageId: string): string =>
  `${conversationId}${KEY_SEP}${messageId}`;

const conversationRange = (conversationId: string): IDBKeyRange =>
  IDBKeyRange.bound(`${conversationId}${KEY_SEP}`, `${conversationId}${KEY_SEP}\uffff`);

/** Drop one conversation's keys from the in-memory mirrors (read cache +
 *  write fingerprints). Called by the GC so a later re-PUT of the SAME
 *  images (undo of a clear-all, restore of a backup) writes fresh instead of
 *  short-circuiting against a fingerprint whose row no longer exists. */
const purgeConversationSessionState = (conversationId: string): void => {
  const prefix = `${conversationId}${KEY_SEP}`;
  for (const key of [...sessionCache.keys()]) {
    if (key.startsWith(prefix)) sessionCache.delete(key);
  }
  for (const key of [...writeFingerprints.keys()]) {
    if (key.startsWith(prefix)) writeFingerprints.delete(key);
  }
};

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
  const fingerprint = fingerprintImages(images);
  // Short-circuit: this exact payload already committed to the store from
  // this session (or was read back from it). Skip the multi-MB put — the
  // heartbeat/debounced saves hit this path on every unchanged image.
  if (writeFingerprints.get(key) === fingerprint) {
    cacheSet(key, images); // keep the read cache warm (LRU may have evicted)
    return true;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key, images, updatedAt: Date.now() } as StoredMessageImages);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Record only after the write COMMITTED — a failed write must be retried
    // by the next save, not short-circuited away.
    writeFingerprints.set(key, fingerprint);
    cacheSet(key, images);
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
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const db = await openDb();
    const row = await new Promise<StoredMessageImages | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as StoredMessageImages | undefined);
      req.onerror = () => resolve(undefined);
    });
    const images = row?.images?.length ? row.images : undefined;
    cacheSet(key, images ?? null);
    // Seed the fingerprint from the row itself, so the next unchanged save
    // short-circuits even after a fresh page load.
    if (images) writeFingerprints.set(key, fingerprintImages(images));
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
      const req = store.getAll(conversationRange(conversationId));
      req.onsuccess = () => resolve((req.result as StoredMessageImages[]) || []);
      req.onerror = () => resolve([]);
    });
    for (const row of rows) {
      if (!row?.images?.length) continue;
      const messageId = row.key.slice(conversationId.length + KEY_SEP.length);
      result[messageId] = row.images;
      cacheSet(row.key, row.images);
      writeFingerprints.set(row.key, fingerprintImages(row.images));
    }
    return result;
  } catch {
    return result;
  }
};

// ── Garbage collection ──────────────────────────────────────────────────────
// The store previously had NO delete path: deleting a conversation (or a
// whole user) removed the profile rows but left every `convId__msgId` blob
// in this database forever. dbService calls these when conversations leave
// the profile — user deletion (after enumerating the conversations first)
// and profile saves whose conversation list no longer carries previously
// stored ids.

/**
 * Delete every stored image row for ONE conversation. Best-effort like the
 * rest of the module: failures resolve (never reject) and only leak, never
 * corrupt. In-memory mirrors (read cache + write fingerprints) are purged
 * first, so a later re-PUT of the same images writes fresh rows.
 */
export const deleteMessageImages = async (conversationId: string): Promise<void> => {
  if (!conversationId) return;
  purgeConversationSessionState(conversationId);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(conversationRange(conversationId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* best-effort GC — a failed delete only leaks bytes, never correctness */
  }
};

/**
 * Bulk variant: GC every conversation id in ONE transaction (used by profile
 * deletion and by saves that removed several sessions at once).
 */
export const deleteMessageImagesForConversations = async (conversationIds: string[]): Promise<void> => {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return;
  for (const id of ids) purgeConversationSessionState(id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) store.delete(conversationRange(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* best-effort GC */
  }
};

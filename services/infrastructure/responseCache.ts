/**
 * AI Response Cache
 *
 * Caches assembled prompt contexts and AI responses to avoid redundant
 * API calls when re-analyzing the same chart or re-sending identical prompts.
 *
 * Three cache layers:
 * 1. Context cache — the assembled prompt string (shared across analysts)
 * 2. Image hash cache — skip re-OCR for identical chart images
 * 3. Response cache — full AI responses keyed by (imageHash + promptHash + model)
 */

// =============================================================================
// TYPES
// =============================================================================

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
}

interface CachedResponse {
  thoughtProcess: string;
  finalOutput?: string;
  analysis: unknown;
  sources?: unknown[];
  model: string;
  timestamp: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONTEXT_CACHE_TTL = 5 * 60 * 1000;    // 5 minutes — context is session-scoped
const IMAGE_CACHE_TTL = 30 * 60 * 1000;     // 30 minutes — images don't change
const RESPONSE_CACHE_TTL = 10 * 60 * 1000;  // 10 minutes — market data goes stale
const MAX_CACHE_SIZE = 50;                   // Prevent unbounded growth

// =============================================================================
// GENERIC LRU-LIKE CACHE
// =============================================================================

class SimpleCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttl: number;
  private maxSize: number;

  constructor(ttl: number, maxSize: number = MAX_CACHE_SIZE) {
    this.ttl = ttl;
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key);
      return undefined;
    }

    entry.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest entries if at capacity
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// =============================================================================
// HASH UTILITIES
// =============================================================================

/**
 * Fast string hash (djb2). Not cryptographic — just for cache keys.
 */
export const hashString = (str: string): string => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
};

/**
 * Hash a base64 image data URL for deduplication.
 * Samples slices spread across the WHOLE string (first+last 1000 chars alone
 * let two large images sharing headers/footers collide) plus the total length
 * as a cheap discriminator.
 */
export const hashImage = (dataURL: string): string => {
  if (dataURL.length <= 4096) return hashString(dataURL);
  const sliceLen = 256;
  const slices: string[] = [];
  const step = Math.floor(dataURL.length / 8);
  for (let i = 0; i < 8; i++) {
    const start = Math.min(i * step, dataURL.length - sliceLen);
    slices.push(dataURL.slice(start, start + sliceLen));
  }
  slices.push(String(dataURL.length));
  return hashString(slices.join('|'));
};

// =============================================================================
// CACHE INSTANCES
// =============================================================================

import { persistentGet, persistentSet, persistentClear } from './persistentCache';

const contextCache = new SimpleCache<string>(CONTEXT_CACHE_TTL);
const imageHashCache = new SimpleCache<string>(IMAGE_CACHE_TTL);
const responseCache = new SimpleCache<CachedResponse>(RESPONSE_CACHE_TTL);

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Cache the assembled prompt context string.
 * Called once per analysis session, shared across all analysts.
 */
export const cacheContext = (sessionId: string, context: string): void => {
  contextCache.set(sessionId, context);
};

export const getCachedContext = (sessionId: string): string | undefined => {
  return contextCache.get(sessionId);
};

/**
 * Get or compute an image hash for deduplication.
 * The dedup map is keyed by a CHEAP hash of the full URL — keying by the raw
 * data URL pinned megabytes of base64 per entry (up to 50 entries ≈ 100+ MB).
 * The full URL would be the exact key, but a 32-bit hash collision between
 * two different images is far less likely than the memory cost of keeping
 * the raw strings alive.
 */
export const getImageHash = (dataURL: string): string => {
  const dedupKey = hashString(dataURL);
  const existing = imageHashCache.get(dedupKey);
  if (existing) return existing;

  const hash = hashImage(dataURL);
  imageHashCache.set(dedupKey, hash);
  return hash;
};

/**
 * Build a cache key for a full AI response.
 * `providerId` is REQUIRED in the key: two providers sharing a model id (two
 * OpenAI-compatible endpoints both listing `gpt-4o`) would otherwise serve
 * each other's cached analysis, and a disabled provider's output could be
 * returned for the same chart.
 * `contextKey` folds mode/role context (deep analysis, accuracy submode, lens
 * role prompt, custom ensemble prompt) into the key so a 10-minute-TTL hit can
 * never serve an analysis computed under a different mode for the same chart.
 */
const buildResponseKey = (imageHashes: string[], promptHash: string, model: string, providerId: string, contextKey?: string): string => {
  return `${imageHashes.sort().join('+')}:${promptHash}:${model}:${providerId}${contextKey ? `:${contextKey}` : ''}`;
};

/**
 * Check for a cached AI response.
 * Async: on a memory miss, hydrates from the IndexedDB-backed persistent
 * store so analyses survive reloads (the in-memory cache dies with the tab).
 */
export const getCachedResponse = async (
  imageHashes: string[],
  prompt: string,
  model: string,
  providerId: string,
  contextKey?: string
): Promise<CachedResponse | undefined> => {
  const key = buildResponseKey(imageHashes, hashString(prompt), model, providerId, contextKey);
  const hit = responseCache.get(key);
  if (hit) return hit;

  const persisted = await persistentGet<CachedResponse>(key);
  if (persisted && Date.now() - persisted.timestamp <= RESPONSE_CACHE_TTL) {
    responseCache.set(key, persisted.value); // rehydrate memory for this session
    return persisted.value;
  }
  return undefined;
};

/**
 * Cache an AI response (memory + persistent store).
 */
export const cacheResponse = (
  imageHashes: string[],
  prompt: string,
  model: string,
  response: { thoughtProcess: string; finalOutput?: string; analysis: unknown; sources?: unknown[] },
  providerId: string,
  contextKey?: string
): void => {
  const key = buildResponseKey(imageHashes, hashString(prompt), model, providerId, contextKey);
  const entry: CachedResponse = {
    ...response,
    model,
    timestamp: Date.now(),
  };
  responseCache.set(key, entry);
  // Best-effort persistence — never block the analysis flow on a write.
  void persistentSet(key, entry, entry.timestamp);
};

/**
 * Clear all caches (e.g., on user switch or manual reset).
 * Async: also clears the IndexedDB-backed persistent layer — without this a
 * "clear" only emptied memory and the next identical analysis rehydrated
 * stale (possibly another user's) entries from the persistent store.
 */
export const clearAllCaches = async (): Promise<void> => {
  contextCache.clear();
  imageHashCache.clear();
  responseCache.clear();
  try {
    await persistentClear();
  } catch (err) {
    console.warn('[ResponseCache] Failed to clear persistent cache:', err);
  }
};

/**
 * Get cache statistics for debugging.
 */
export const getCacheStats = (): { context: number; images: number; responses: number } => ({
  context: contextCache.size,
  images: imageHashCache.size,
  responses: responseCache.size,
});

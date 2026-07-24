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
 * Uses the first 1000 + last 1000 chars to avoid hashing megabytes.
 */
export const hashImage = (dataURL: string): string => {
  if (dataURL.length <= 2000) return hashString(dataURL);
  const sample = dataURL.slice(0, 1000) + dataURL.slice(-1000);
  return hashString(sample);
};

// =============================================================================
// CACHE INSTANCES
// =============================================================================

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
 */
export const getImageHash = (dataURL: string): string => {
  const existing = imageHashCache.get(dataURL.slice(0, 100));
  if (existing) return existing;

  const hash = hashImage(dataURL);
  imageHashCache.set(dataURL.slice(0, 100), hash);
  return hash;
};

/**
 * Build a cache key for a full AI response.
 */
const buildResponseKey = (imageHashes: string[], promptHash: string, model: string): string => {
  return `${imageHashes.sort().join('+')}:${promptHash}:${model}`;
};

/**
 * Check for a cached AI response.
 */
export const getCachedResponse = (
  imageHashes: string[],
  prompt: string,
  model: string
): CachedResponse | undefined => {
  const key = buildResponseKey(imageHashes, hashString(prompt), model);
  return responseCache.get(key);
};

/**
 * Cache an AI response.
 */
export const cacheResponse = (
  imageHashes: string[],
  prompt: string,
  model: string,
  response: { thoughtProcess: string; analysis: unknown; sources?: unknown[] }
): void => {
  const key = buildResponseKey(imageHashes, hashString(prompt), model);
  responseCache.set(key, {
    ...response,
    model,
    timestamp: Date.now(),
  });
};

/**
 * Clear all caches (e.g., on user switch or manual reset).
 */
export const clearAllCaches = (): void => {
  contextCache.clear();
  imageHashCache.clear();
  responseCache.clear();
};

/**
 * Get cache statistics for debugging.
 */
export const getCacheStats = (): { context: number; images: number; responses: number } => ({
  context: contextCache.size,
  images: imageHashCache.size,
  responses: responseCache.size,
});

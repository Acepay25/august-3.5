/**
 * Groq Key Pool
 *
 * Manages round-robin rotation across multiple Groq API keys to work around
 * per-key rate limits. Replaces the need for 3 separate Groq provider services
 * (groqService, groqNewService, groqAlt2Service) that duplicate ~1000 lines each.
 *
 * Usage:
 *   const pool = getGroqKeyPool();
 *   const client = pool.getClient();  // Returns OpenAI client with next available key
 *   pool.reportRateLimit();           // Call on 429 to advance to next key
 */

import OpenAI from 'openai';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/';

interface KeyEntry {
  key: string;
  label: string;
  rateLimitedUntil: number; // timestamp when rate limit expires
}

class GroqKeyPool {
  private keys: KeyEntry[] = [];
  private currentIndex = 0;
  private client: OpenAI | null = null;
  private clientKeyIndex = -1;

  constructor() {
    // Collect all available Groq keys from environment
    const keyConfigs = [
      { key: process.env.GROQ_API_KEY, label: 'Groq Primary' },
      { key: process.env.GROQ_NEW_API_KEY, label: 'Groq Alt' },
      { key: process.env.GROQ_ALT2_API_KEY, label: 'Groq Alt 2' },
    ];

    for (const config of keyConfigs) {
      if (config.key) {
        this.keys.push({
          key: config.key,
          label: config.label,
          rateLimitedUntil: 0,
        });
      }
    }

    if (this.keys.length === 0) {
      console.warn('[GroqKeyPool] No Groq API keys found in environment');
    } else {
      console.log(`[GroqKeyPool] Initialized with ${this.keys.length} key(s): ${this.keys.map(k => k.label).join(', ')}`);
    }
  }

  /** Number of available keys */
  get size(): number {
    return this.keys.length;
  }

  /** Whether any keys are configured */
  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  /**
   * Get an OpenAI client using the next available (non-rate-limited) key.
   * Reuses the client instance if the key hasn't changed.
   */
  getClient(): OpenAI {
    if (this.keys.length === 0) {
      throw new Error('No Groq API keys configured. Set GROQ_API_KEY in .env.local');
    }

    const now = Date.now();
    const startIndex = this.currentIndex;

    // Find the next key that isn't rate-limited
    do {
      const entry = this.keys[this.currentIndex];
      if (entry.rateLimitedUntil <= now) {
        // Found an available key
        if (this.clientKeyIndex !== this.currentIndex || !this.client) {
          this.client = new OpenAI({
            baseURL: GROQ_BASE_URL,
            apiKey: entry.key,
            dangerouslyAllowBrowser: true,
          });
          this.clientKeyIndex = this.currentIndex;
        }
        return this.client;
      }
      // This key is rate-limited, try next
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    } while (this.currentIndex !== startIndex);

    // All keys are rate-limited — use the one that expires soonest
    let soonestIndex = 0;
    let soonestTime = Infinity;
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i].rateLimitedUntil < soonestTime) {
        soonestTime = this.keys[i].rateLimitedUntil;
        soonestIndex = i;
      }
    }

    this.currentIndex = soonestIndex;
    const entry = this.keys[soonestIndex];
    const waitSeconds = Math.ceil((entry.rateLimitedUntil - now) / 1000);
    console.warn(`[GroqKeyPool] All keys rate-limited. Using ${entry.label} (available in ~${waitSeconds}s)`);

    if (this.clientKeyIndex !== soonestIndex || !this.client) {
      this.client = new OpenAI({
        baseURL: GROQ_BASE_URL,
        apiKey: entry.key,
        dangerouslyAllowBrowser: true,
      });
      this.clientKeyIndex = soonestIndex;
    }
    return this.client;
  }

  /**
   * Report a 429 rate limit on the current key.
   * Advances to the next key and marks the current one as rate-limited.
   *
   * @param retryAfterSeconds - Optional Retry-After header value
   */
  reportRateLimit(retryAfterSeconds?: number): void {
    const entry = this.keys[this.currentIndex];
    if (!entry) return;

    const cooldown = (retryAfterSeconds || 60) * 1000;
    entry.rateLimitedUntil = Date.now() + cooldown;
    console.warn(`[GroqKeyPool] ${entry.label} rate-limited for ${retryAfterSeconds || 60}s, rotating...`);

    // Advance to next key
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  /**
   * Get the label of the currently active key (for logging/display).
   */
  getActiveKeyLabel(): string {
    return this.keys[this.currentIndex]?.label || 'Unknown';
  }

  /**
   * Get pool status for debugging.
   */
  getStatus(): { label: string; rateLimited: boolean; availableIn?: number }[] {
    const now = Date.now();
    return this.keys.map(k => ({
      label: k.label,
      rateLimited: k.rateLimitedUntil > now,
      availableIn: k.rateLimitedUntil > now ? Math.ceil((k.rateLimitedUntil - now) / 1000) : undefined,
    }));
  }
}

// Singleton instance
let poolInstance: GroqKeyPool | null = null;

export const getGroqKeyPool = (): GroqKeyPool => {
  if (!poolInstance) {
    poolInstance = new GroqKeyPool();
  }
  return poolInstance;
};

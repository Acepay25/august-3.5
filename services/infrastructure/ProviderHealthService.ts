/**
 * ProviderHealthService — in-memory health telemetry for configured providers.
 *
 * Records per-provider call counts, latency and last errors so the Settings
 * provider list can show a live health view (and a Test button). Purely
 * additive instrumentation — it never throws into the provider path.
 *
 * Cooldown (opengrok F11): a provider that keeps failing PERSISTED requests
 * is benched for a window instead of burning a seat on every run. Only
 * PERSISTED errors count — the transports already retry transient blips
 * (429 backoff, network retry), so an error that reaches here survived
 * retries. 3+ persisted errors within 15 minutes → 10-minute cooldown,
 * cleared by the next success.
 */

export interface ProviderHealth {
  providerId: string;
  requestCount: number;
  errorCount: number;
  rateLimitCount: number;
  lastError?: string;
  lastSuccessAt?: string;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastCheckedAt?: string;
  /** Timestamps of persisted errors inside the rolling window. */
  recentErrorAts?: string[];
}

/** Cooldown law: ≥3 persisted errors inside the window → benched for COOLDOWN. */
export const COOLDOWN_ERROR_THRESHOLD = 3;
export const COOLDOWN_WINDOW_MS = 15 * 60 * 1000;
export const COOLDOWN_DURATION_MS = 10 * 60 * 1000;

const health = new Map<string, ProviderHealth>();

const entryFor = (providerId: string): ProviderHealth => {
  let entry = health.get(providerId);
  if (!entry) {
    entry = { providerId, requestCount: 0, errorCount: 0, rateLimitCount: 0, recentErrorAts: [] };
    health.set(providerId, entry);
  }
  return entry;
};

/** Drop window-expired error timestamps (mutates the entry's array). */
const pruneErrors = (entry: ProviderHealth, now = Date.now()): void => {
  if (!entry.recentErrorAts) entry.recentErrorAts = [];
  entry.recentErrorAts = entry.recentErrorAts.filter(
    ts => now - Date.parse(ts) < COOLDOWN_WINDOW_MS,
  );
};

export const recordProviderSuccess = (providerId: string, latencyMs: number): void => {
  const entry = entryFor(providerId);
  entry.requestCount++;
  entry.lastSuccessAt = new Date().toISOString();
  entry.lastLatencyMs = latencyMs;
  entry.avgLatencyMs = entry.avgLatencyMs
    ? Math.round((entry.avgLatencyMs * (entry.requestCount - 1) + latencyMs) / entry.requestCount)
    : latencyMs;
  entry.lastCheckedAt = new Date().toISOString();
  // A success proves the provider is back — clear the cooldown path.
  entry.recentErrorAts = [];
};

export const recordProviderError = (providerId: string, error: unknown): void => {
  const entry = entryFor(providerId);
  entry.requestCount++;
  entry.errorCount++;
  entry.lastCheckedAt = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  entry.lastError = message.slice(0, 200);
  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    entry.rateLimitCount++;
  }
  // Cooldown substrate only counts errors that survived the transports'
  // own retries (persisted at this layer).
  pruneErrors(entry);
  entry.recentErrorAts!.push(new Date().toISOString());
};

/**
 * Whether the provider is benched: ≥ COOLDOWN_ERROR_THRESHOLD persisted
 * errors in the last COOLDOWN_WINDOW_MS, and the bench window (starting at
 * the most recent error) has not elapsed. Consulted at roster build so a
 * failing provider loses its seat instead of sabotaging runs.
 */
export const isProviderOnCooldown = (providerId: string, now = Date.now()): boolean => {
  const entry = health.get(providerId);
  if (!entry) return false;
  pruneErrors(entry, now);
  if ((entry.recentErrorAts?.length ?? 0) < COOLDOWN_ERROR_THRESHOLD) return false;
  const lastErrorAt = Date.parse(entry.recentErrorAts![entry.recentErrorAts!.length - 1]);
  return now - lastErrorAt < COOLDOWN_DURATION_MS;
};

/** Remaining cooldown milliseconds (0 when not benched). */
export const providerCooldownRemainingMs = (providerId: string, now = Date.now()): number => {
  const entry = health.get(providerId);
  if (!entry) return 0;
  pruneErrors(entry, now);
  if ((entry.recentErrorAts?.length ?? 0) < COOLDOWN_ERROR_THRESHOLD) return 0;
  const lastErrorAt = Date.parse(entry.recentErrorAts![entry.recentErrorAts!.length - 1]);
  const elapsed = now - lastErrorAt;
  return elapsed < COOLDOWN_DURATION_MS ? COOLDOWN_DURATION_MS - elapsed : 0;
};

export const getProviderHealth = (providerId: string): ProviderHealth | undefined => health.get(providerId);

export const getAllProviderHealth = (): ProviderHealth[] => [...health.values()];

export const resetProviderHealth = (providerId?: string): void => {
  if (providerId) health.delete(providerId);
  else health.clear();
};

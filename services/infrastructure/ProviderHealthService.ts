/**
 * ProviderHealthService — in-memory health telemetry for configured providers.
 *
 * Records per-provider call counts, latency and last errors so the Settings
 * provider list can show a live health view (and a Test button). Purely
 * additive instrumentation — it never throws into the provider path.
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
}

const health = new Map<string, ProviderHealth>();

const entryFor = (providerId: string): ProviderHealth => {
  let entry = health.get(providerId);
  if (!entry) {
    entry = { providerId, requestCount: 0, errorCount: 0, rateLimitCount: 0 };
    health.set(providerId, entry);
  }
  return entry;
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
};

export const getProviderHealth = (providerId: string): ProviderHealth | undefined => health.get(providerId);

export const getAllProviderHealth = (): ProviderHealth[] => [...health.values()];

export const resetProviderHealth = (providerId?: string): void => {
  if (providerId) health.delete(providerId);
  else health.clear();
};

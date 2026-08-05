import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordProviderSuccess,
  recordProviderError,
  getProviderHealth,
  getAllProviderHealth,
  resetProviderHealth,
} from '../services/infrastructure/ProviderHealthService';

describe('ProviderHealthService', () => {
  beforeEach(() => {
    resetProviderHealth();
  });

  it('tracks request counts and latency averages', () => {
    recordProviderSuccess('prov-a', 100);
    recordProviderSuccess('prov-a', 300);

    const health = getProviderHealth('prov-a');
    expect(health?.requestCount).toBe(2);
    expect(health?.errorCount).toBe(0);
    expect(health?.avgLatencyMs).toBe(200);
    expect(health?.lastLatencyMs).toBe(300);
    expect(health?.lastSuccessAt).toBeDefined();
  });

  it('tracks errors and rate limits separately', () => {
    recordProviderError('prov-a', new Error('Rate limit exceeded (429)'));
    recordProviderError('prov-a', new Error('Network failure'));

    const health = getProviderHealth('prov-a');
    expect(health?.requestCount).toBe(2);
    expect(health?.errorCount).toBe(2);
    expect(health?.rateLimitCount).toBe(1);
    // lastError reflects the MOST RECENT failure.
    expect(health?.lastError).toContain('Network');
  });

  it('mixes successes and failures', () => {
    recordProviderSuccess('prov-a', 50);
    recordProviderError('prov-a', new Error('boom'));

    const health = getProviderHealth('prov-a');
    expect(health?.requestCount).toBe(2);
    expect(health?.errorCount).toBe(1);
    expect(health?.rateLimitCount).toBe(0);
  });

  it('returns undefined for providers with no recorded calls', () => {
    expect(getProviderHealth('never-called')).toBeUndefined();
  });

  it('lists all providers and resets per provider', () => {
    recordProviderSuccess('prov-a', 10);
    recordProviderSuccess('prov-b', 20);
    expect(getAllProviderHealth().map(h => h.providerId).sort()).toEqual(['prov-a', 'prov-b']);

    resetProviderHealth('prov-a');
    expect(getProviderHealth('prov-a')).toBeUndefined();
    expect(getProviderHealth('prov-b')).toBeDefined();
  });
});

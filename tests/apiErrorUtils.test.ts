import { describe, it, expect, vi } from 'vitest';
import {
  parseAPIError,
  getRetryDelay,
  withRetry,
  type ParsedAPIError,
} from '../utils/apiErrorUtils';

/** A 429 with an optional Retry-After header (Headers-object shape). */
const rateLimitError = (retryAfter?: string): any => {
  const err: any = new Error('Too Many Requests');
  err.status = 429;
  if (retryAfter !== undefined) {
    err.headers = { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) };
  }
  return err;
};

const parsedRateLimit = (retryAfterSeconds: number): ParsedAPIError => ({
  type: 'rate_limit',
  message: '',
  retryAfterSeconds,
  provider: 'P',
});

describe('apiErrorUtils — Retry-After parsing', () => {
  it('honors Retry-After: 0 as a NUMERIC value (not dropped by a truthiness check)', () => {
    const parsed = parseAPIError(rateLimitError('0'), 'P');
    expect(parsed.type).toBe('rate_limit');
    expect(parsed.retryAfterSeconds).toBe(0);
  });

  it('parses ordinary Retry-After seconds', () => {
    expect(parseAPIError(rateLimitError('12'), 'P').retryAfterSeconds).toBe(12);
  });

  it('falls back to 1s when the header is absent or garbage', () => {
    expect(parseAPIError(rateLimitError(), 'P').retryAfterSeconds).toBe(1);
    expect(parseAPIError(rateLimitError('soon'), 'P').retryAfterSeconds).toBe(1);
  });
});

describe('apiErrorUtils — getRetryDelay', () => {
  it('Retry-After: 0 yields an immediate (0ms) retry', () => {
    for (let i = 0; i < 50; i++) {
      expect(getRetryDelay(parsedRateLimit(0), 0)).toBe(0);
    }
  });

  it('Retry-After is honored as a MINIMUM but capped (30s) and jittered up to +50%', () => {
    // base = 10s → window [10s, 15s]
    for (let i = 0; i < 200; i++) {
      const d = getRetryDelay(parsedRateLimit(10), 0);
      expect(d).toBeGreaterThanOrEqual(10_000);
      expect(d).toBeLessThanOrEqual(15_000);
    }
    // huge header (600s) is capped to base 30s → window [30s, 45s]
    for (let i = 0; i < 200; i++) {
      const d = getRetryDelay(parsedRateLimit(600), 0);
      expect(d).toBeGreaterThanOrEqual(30_000);
      expect(d).toBeLessThanOrEqual(45_000);
    }
  });

  it('exponential backoff is jittered within [base/2, base] per attempt', () => {
    for (let attempt = 0; attempt <= 4; attempt++) {
      const base = Math.min(2000 * Math.pow(2, attempt), 30_000);
      const samples = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const d = getRetryDelay({ type: 'server', message: '', provider: 'P' }, attempt);
        expect(d).toBeGreaterThanOrEqual(Math.round(base / 2));
        expect(d).toBeLessThanOrEqual(base);
        samples.add(d);
      }
      // Jitter must actually vary — a lockstep herd is the bug class.
      expect(samples.size).toBeGreaterThan(1);
    }
    // Deep attempt stays capped at 30s (never above the old ceiling).
    const capped = Array.from({ length: 100 }, () => getRetryDelay({ type: 'server', message: '', provider: 'P' }, 12));
    for (const d of capped) {
      expect(d).toBeGreaterThanOrEqual(15_000);
      expect(d).toBeLessThanOrEqual(30_000);
    }
  });

  it('concurrent seats retrying the same 429 do NOT wake in lockstep', () => {
    const parsed = parsedRateLimit(30);
    const wakeTimes = new Set(Array.from({ length: 50 }, () => getRetryDelay(parsed, 0)));
    expect(wakeTimes.size).toBeGreaterThan(1);
  });
});

describe('apiErrorUtils — withRetry + Retry-After: 0', () => {
  it('retries without stalling when the server says Retry-After: 0', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitError('0'))
      .mockResolvedValueOnce('ok');
    const startedAt = Date.now();
    await expect(withRetry(fn, 'P', 3)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    // 0s must be respected as an immediate retry — a truthiness drop would
    // have fallen through to the exponential branch (≥1s here).
    expect(Date.now() - startedAt).toBeLessThan(900);
  });
});

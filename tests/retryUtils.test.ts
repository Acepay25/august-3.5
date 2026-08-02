import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../utils/apiErrorUtils';

const rateLimit = () => Object.assign(new Error('Rate limit reached'), { status: 429 });
const invalidKey = () => Object.assign(new Error('Invalid API key'), { status: 401 });

describe('withRetry', () => {
  it('retries transient errors with backoff and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimit())
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValue('ok');
    const result = await withRetry(fn, 'OpenAI', 4);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fails fast on non-retryable errors (invalid key)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(invalidKey());
    await expect(withRetry(fn, 'OpenAI', 4)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the signal is aborted (no backoff wait)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(rateLimit());
    const controller = new AbortController();
    const promise = withRetry(fn, 'Groq', 4, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).toHaveBeenCalledTimes(1); // no retry after abort
  });

  it('does not exceed maxAttempts on persistent failures', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimit());
    await expect(withRetry(fn, 'DeepSeek', 2)).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
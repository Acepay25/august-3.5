/**
 * API Error Utilities
 * Provides consistent error handling and user-friendly messages across all AI providers
 */

// Provider display names are runtime-configured (user-entered ProviderConfig
// names) — a fixed union would go stale (legacy 'Groq Alt' / 'Binance' entries)
// and lie for custom providers, so error branding takes a plain string.
export type ProviderName = string;

export interface ParsedAPIError {
    type: 'rate_limit' | 'quota_exceeded' | 'invalid_key' | 'network' | 'timeout' | 'server' | 'unknown';
    message: string;
    retryAfterSeconds?: number;
    provider: ProviderName;
}

/**
 * Parse API error into user-friendly message
 */
export const parseAPIError = (error: any, provider: ProviderName): ParsedAPIError => {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorStatus = error?.status || error?.response?.status;

    // Rate Limit (429)
    if (errorStatus === 429 || errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
        // Only trust a real Retry-After header. SDK errors expose headers as a
        // Headers object (no array access), and a missing/NaN value used to
        // fall back to 30s — stalling the pipeline for 30s per attempt. Use a
        // short 1s default so transient bursts recover quickly.
        const headers = error?.headers;
        const headerRaw = headers?.get ? headers.get('retry-after') : headers?.['retry-after'];
        const headerParsed = parseInt(headerRaw, 10);
        const retryAfterSeconds = Number.isFinite(headerParsed) && headerParsed >= 0 ? headerParsed : 1;
        return {
            type: 'rate_limit',
            message: `${provider} rate limit reached. Retrying in ${retryAfterSeconds}s...`,
            retryAfterSeconds,
            provider
        };
    }

    // Quota Exceeded (403 or specific message)
    if (errorStatus === 403 || errorMessage.includes('quota') || errorMessage.includes('billing') || errorMessage.includes('exceeded')) {
        return {
            type: 'quota_exceeded',
            message: `${provider} quota exceeded. Try switching to another AI provider in Settings.`,
            provider
        };
    }

    // Invalid API Key (401)
    if (errorStatus === 401 || errorMessage.includes('api key') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
        return {
            type: 'invalid_key',
            message: `${provider} API key is invalid or expired. Check your API key in Settings → Providers.`,
            provider
        };
    }

    // Timeout — a request that burned its full budget (or was aborted by the
    // Electron main-process timer) is wedged; retrying it immediately only
    // extends the stall. Previously these were classified 'network' and
    // retried 3× at 300s each → a ~15-minute hang on desktop.
    if (
        error?.name === 'TimeoutError'
        || errorMessage.includes('timed out')
        || errorMessage.includes('timeout')
        || errorMessage.includes('the operation was aborted') // Electron main-side abort of a hung request
    ) {
        return {
            type: 'timeout',
            message: `${provider} request timed out. The provider may be overloaded — try again shortly.`,
            provider
        };
    }

    // Network Error — connection-level failures (not timeouts), retryable.
    if (
        errorMessage.includes('network')
        || errorMessage.includes('fetch')
        || errorMessage.includes('econnrefused')
        || errorMessage.includes('enotfound')
        || errorMessage.includes('failed to connect')
        || errorMessage.includes('certificate')
        || errorMessage.includes('tls')
    ) {
        return {
            type: 'network',
            message: `Network error connecting to ${provider}. Check your internet connection.`,
            provider
        };
    }

    // Server Error (500+)
    if (errorStatus >= 500) {
        return {
            type: 'server',
            message: `${provider} server error. The service may be temporarily unavailable.`,
            provider
        };
    }

    // Unknown error — do not expose raw SDK/network text, which may contain
    // URLs, request payloads, or provider response bodies.
    return {
        type: 'unknown',
        message: `${provider} request failed. Check the provider settings and try again.`,
        provider
    };
};

/**
 * Get toast configuration for an error
 */
export const getErrorToastConfig = (parsedError: ParsedAPIError): {
    title: string;
    message: string;
    duration: number;
    action?: { label: string; onClick: () => void };
} => {
    switch (parsedError.type) {
        case 'rate_limit':
            return {
                title: 'Rate Limit',
                message: parsedError.message,
                duration: (parsedError.retryAfterSeconds || 30) * 1000
            };
        case 'quota_exceeded':
            return {
                title: 'Quota Exceeded',
                message: parsedError.message,
                duration: 10000
            };
        case 'invalid_key':
            return {
                title: 'Invalid API Key',
                message: parsedError.message,
                duration: 0 // Don't auto-dismiss
            };
        case 'network':
            return {
                title: 'Connection Error',
                message: parsedError.message,
                duration: 8000
            };
        case 'timeout':
            return {
                title: 'Timeout',
                message: parsedError.message,
                duration: 8000
            };
        case 'server':
            return {
                title: 'Server Error',
                message: parsedError.message,
                duration: 8000
            };
        default:
            return {
                title: 'Analysis Error',
                message: parsedError.message,
                duration: 6000
            };
    }
};

/**
 * Check if error should trigger a retry
 */
export const shouldRetry = (parsedError: ParsedAPIError): boolean => {
    // 'timeout' is deliberately non-retryable — a request that burned its full
    // budget is wedged, and immediate retries only extend the stall.
    return parsedError.type === 'rate_limit' || parsedError.type === 'network' || parsedError.type === 'server';
};

/**
 * Get retry delay in milliseconds
 */
export const getRetryDelay = (parsedError: ParsedAPIError, attempt: number): number => {
    if (parsedError.retryAfterSeconds) {
        // A real Retry-After header can be huge (e.g. 600s for quota resets) —
        // honor it but never let it stall the pipeline for minutes per attempt.
        return Math.min(parsedError.retryAfterSeconds, 30) * 1000;
    }
    // Exponential backoff: 2s, 4s, 8s, max 30s
    return Math.min(2000 * Math.pow(2, attempt), 30000);
};

/**
 * Sleep that rejects early if the AbortSignal fires.
 */
const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
        }

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
        };

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        signal?.addEventListener('abort', onAbort, { once: true });
    });
};

/**
 * Retry wrapper for AI provider API calls.
 *
 * - Classifies failures with `parseAPIError`.
 * - Retries only transient errors (rate_limit, network, server) up to `maxAttempts`.
 * - Fails fast on non-retryable errors (invalid_key, quota_exceeded, unknown).
 * - Aborts immediately (no retry, no backoff wait) when `signal` is aborted.
 *
 * @param fn          The async API call to execute.
 * @param provider    Provider label used for error classification and logging.
 * @param maxAttempts Total number of attempts (default 4).
 * @param signal      Optional AbortSignal to cancel in-flight retries/waits.
 */
export const withRetry = async <T>(
    fn: () => Promise<T>,
    provider: ProviderName,
    maxAttempts: number = 4,
    signal?: AbortSignal
): Promise<T> => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
        }

        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Caller cancelled - never retry or wait.
            if (signal?.aborted) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }

            const parsedError = parseAPIError(error, provider);

            // Fail fast on non-retryable errors or when out of attempts.
            if (!shouldRetry(parsedError) || attempt === maxAttempts - 1) {
                throw error;
            }

            const delay = getRetryDelay(parsedError, attempt);
            console.warn(
                `[${provider}] Attempt ${attempt + 1}/${maxAttempts} failed (${parsedError.type}): ` +
                `${parsedError.message} Retrying in ${Math.round(delay / 1000)}s...`
            );

            await abortableSleep(delay, signal);
        }
    }

    throw lastError;
};

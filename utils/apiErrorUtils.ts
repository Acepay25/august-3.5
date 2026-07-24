/**
 * API Error Utilities
 * Provides consistent error handling and user-friendly messages across all AI providers
 */

export type ProviderName =
    | 'Gemini'
    | 'OpenAI'
    | 'Groq'
    | 'Groq New'
    | 'Groq Alt'
    | 'Groq Alt 2'
    | 'OpenRouter'
    | 'Grok'
    | 'DeepSeek'
    | 'Zhipu'
    | 'Binance';

export interface ParsedAPIError {
    type: 'rate_limit' | 'quota_exceeded' | 'invalid_key' | 'network' | 'server' | 'unknown';
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
        const retryAfter = error?.headers?.['retry-after'] || 30;
        return {
            type: 'rate_limit',
            message: `${provider} rate limit reached. Retrying in ${retryAfter}s...`,
            retryAfterSeconds: parseInt(retryAfter),
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
            message: `${provider} API key is invalid or expired. Please check your .env.local file.`,
            provider
        };
    }

    // Network Error
    if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('econnrefused') || errorMessage.includes('timeout')) {
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

    // Unknown error
    return {
        type: 'unknown',
        message: `${provider} error: ${error?.message || 'Unknown error occurred'}`,
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
    return parsedError.type === 'rate_limit' || parsedError.type === 'network' || parsedError.type === 'server';
};

/**
 * Get retry delay in milliseconds
 */
export const getRetryDelay = (parsedError: ParsedAPIError, attempt: number): number => {
    if (parsedError.retryAfterSeconds) {
        return parsedError.retryAfterSeconds * 1000;
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

        let timer: ReturnType<typeof setTimeout>;

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
        };

        timer = setTimeout(() => {
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

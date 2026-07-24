/**
 * Structured Logger
 *
 * Tiny leveled logger with correlation IDs for tracing analysis runs
 * across providers. Replaces ad-hoc console.* calls with hand-prefixes.
 *
 * Usage:
 *   const log = createLogger('EnsembleService');
 *   const runLog = log.child({ runId: 'analysis-123' });
 *   runLog.info('Starting debate', { provider: 'gemini', model: 'gemini-2.5-pro' });
 *   runLog.error('Provider failed', { provider: 'groq', error: err.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

// Minimum level to emit (configurable at runtime)
let minLevel: LogLevel = 'info';

export const setLogLevel = (level: LogLevel): void => {
    minLevel = level;
};

interface LogContext {
    [key: string]: unknown;
}

interface Logger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
    /** Create a child logger with inherited + additional context (e.g. runId) */
    child(additionalContext: LogContext): Logger;
}

const formatContext = (prefix: string, context?: LogContext): string => {
    const parts = [`[${prefix}]`];
    if (context) {
        for (const [key, value] of Object.entries(context)) {
            if (value !== undefined && value !== null) {
                parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
            }
        }
    }
    return parts.join(' ');
};

const emit = (level: LogLevel, prefix: string, message: string, context?: LogContext): void => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

    const formatted = `${formatContext(prefix, context)} ${message}`;

    switch (level) {
        case 'debug':
            console.debug(formatted);
            break;
        case 'info':
            console.info(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        case 'error':
            console.error(formatted);
            break;
    }
};

/**
 * Create a logger with a module prefix.
 *
 * @param prefix - Module name, e.g. 'EnsembleService', 'dbService'
 * @param baseContext - Optional context included in every log line
 */
export const createLogger = (prefix: string, baseContext?: LogContext): Logger => {
    const log = (level: LogLevel, message: string, context?: LogContext): void => {
        emit(level, prefix, message, { ...baseContext, ...context });
    };

    return {
        debug: (msg, ctx) => log('debug', msg, ctx),
        info: (msg, ctx) => log('info', msg, ctx),
        warn: (msg, ctx) => log('warn', msg, ctx),
        error: (msg, ctx) => log('error', msg, ctx),
        child: (additionalContext: LogContext): Logger => {
            return createLogger(prefix, { ...baseContext, ...additionalContext });
        },
    };
};

/**
 * Generate a short correlation ID for an analysis run.
 * Thread this through all provider calls in a single analysis
 * so logs can be traced end-to-end.
 */
export const createRunId = (): string => {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
};

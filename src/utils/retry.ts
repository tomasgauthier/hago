import { logger } from './logger.js';

/**
 * Retry a function with exponential backoff.
 * Retries on transient errors (rate limits, network issues).
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { maxRetries?: number; label?: string } = {},
): Promise<T> {
    const maxRetries = opts.maxRetries ?? 3;
    const label = opts.label ?? 'operation';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const isRetryable = isTransientError(err);
            if (!isRetryable || attempt === maxRetries) {
                throw err;
            }
            const delayMs = getBackoffDelay(attempt, err);
            logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${err.message}`);
            await sleep(delayMs);
        }
    }
    throw new Error('Unreachable');
}

function isTransientError(err: any): boolean {
    const status = err.status || err.statusCode || err.code;

    // Rate limit
    if (status === 429) return true;

    // Server errors
    if (typeof status === 'number' && status >= 500) return true;

    // Network errors
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') ||
        msg.includes('socket hang up') || msg.includes('fetch failed') || msg.includes('network')) {
        return true;
    }

    // Anthropic overloaded
    if (status === 529 || msg.includes('overloaded')) return true;

    return false;
}

function getBackoffDelay(attempt: number, err: any): number {
    // Respect Retry-After header if present
    const retryAfter = err.headers?.['retry-after'];
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
    }
    // Exponential backoff: 1s, 2s, 4s (with jitter)
    const base = Math.pow(2, attempt) * 1000;
    const jitter = Math.random() * 500;
    return base + jitter;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

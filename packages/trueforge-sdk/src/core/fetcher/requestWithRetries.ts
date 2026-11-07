const INITIAL_RETRY_DELAY = 1000; // in milliseconds
const MAX_RETRY_DELAY = 60000; // in milliseconds
const DEFAULT_MAX_RETRIES = 2;
const JITTER_FACTOR = 0.2; // 20% random jitter

function isRetryableStatusCode(statusCode: number): boolean {
    return [408, 429].includes(statusCode) || statusCode >= 500;
}

function addPositiveJitter(delay: number): number {
    const jitterMultiplier = 1 + Math.random() * JITTER_FACTOR;
    return delay * jitterMultiplier;
}

function addSymmetricJitter(delay: number): number {
    const jitterMultiplier = 1 + (Math.random() - 0.5) * JITTER_FACTOR;
    return delay * jitterMultiplier;
}

function getRetryDelayFromHeaders(response: Response, retryAttempt: number): number {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
        const retryAfterSeconds = parseInt(retryAfter, 10);
        if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
            return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY);
        }

        const retryAfterDate = new Date(retryAfter);
        if (!Number.isNaN(retryAfterDate.getTime())) {
            const delay = retryAfterDate.getTime() - Date.now();
            if (delay > 0) {
                return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY);
            }
        }
    }

    const rateLimitReset = response.headers.get("X-RateLimit-Reset");
    if (rateLimitReset) {
        const resetTime = parseInt(rateLimitReset, 10);
        if (!Number.isNaN(resetTime)) {
            const delay = resetTime * 1000 - Date.now();
            if (delay > 0) {
                return addPositiveJitter(Math.min(delay, MAX_RETRY_DELAY));
            }
        }
    }

    return addSymmetricJitter(Math.min(INITIAL_RETRY_DELAY * 2 ** retryAttempt, MAX_RETRY_DELAY));
}

/**
 * Waits `ms` milliseconds, or rejects as soon as `abortSignal` aborts. The timer and
 * the abort listener are always removed, so a cancelled wait never keeps the process alive.
 */
function sleep(ms: number, abortSignal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(abortSignal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timeoutId);
            reject(abortSignal?.reason);
        };
        const timeoutId = setTimeout(() => {
            abortSignal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function requestWithRetries(
    requestFn: () => Promise<Response>,
    maxRetries: number = DEFAULT_MAX_RETRIES,
    abortSignal?: AbortSignal,
): Promise<Response> {
    let response: Response = await requestFn();

    for (let i = 0; i < maxRetries; ++i) {
        if (isRetryableStatusCode(response.status)) {
            const delay = getRetryDelayFromHeaders(response, i);

            await sleep(delay, abortSignal);
            response = await requestFn();
        } else {
            break;
        }
    }
    return response!;
}

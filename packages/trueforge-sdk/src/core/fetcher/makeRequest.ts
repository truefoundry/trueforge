import { anySignal, getTimeoutSignal, TIMEOUT } from "./signals.js";

/**
 * Cached result of checking whether the current runtime supports
 * the `cache` option in `Request`. Some runtimes (e.g. Cloudflare Workers)
 * throw a TypeError when this option is used.
 */
let _cacheNoStoreSupported: boolean | undefined;
export function isCacheNoStoreSupported(): boolean {
    if (_cacheNoStoreSupported != null) {
        return _cacheNoStoreSupported;
    }
    try {
        new Request("http://localhost", { cache: "no-store" });
        _cacheNoStoreSupported = true;
    } catch {
        _cacheNoStoreSupported = false;
    }
    return _cacheNoStoreSupported;
}

/**
 * Reset the cached result of `isCacheNoStoreSupported`. Exposed for testing only.
 */
export function resetCacheNoStoreSupported(): void {
    _cacheNoStoreSupported = undefined;
}

const responseTimeouts = new WeakMap<Response, ReturnType<typeof setTimeout>>();

/**
 * Clears the timeout that `makeRequest` kept running (with `keepTimeoutUntilBodyRead`) so that it also
 * covered reading the response body.
 */
export function clearResponseTimeout(response: Response): void {
    const timeoutId = responseTimeouts.get(response);
    if (timeoutId != null) {
        clearTimeout(timeoutId);
        responseTimeouts.delete(response);
    }
}

export const makeRequest = async (
    fetchFn: (url: string, init: RequestInit) => Promise<Response>,
    url: string,
    method: string,
    headers: Headers | Record<string, string>,
    requestBody: BodyInit | undefined,
    timeoutMs?: number,
    abortSignal?: AbortSignal,
    withCredentials?: boolean,
    duplex?: "half",
    disableCache?: boolean,
    keepTimeoutUntilBodyRead?: boolean,
): Promise<Response> => {
    const signals: AbortSignal[] = [];

    let timeoutAbortId: ReturnType<typeof setTimeout> | undefined;
    let timeoutSignal: AbortSignal | undefined;
    if (timeoutMs != null) {
        const { signal, abortId } = getTimeoutSignal(timeoutMs);
        timeoutAbortId = abortId;
        timeoutSignal = signal;
        signals.push(signal);
    }

    if (abortSignal != null) {
        signals.push(abortSignal);
    }
    const newSignals = anySignal(signals);
    let response: Response;
    try {
        response = await fetchFn(url, {
            method: method,
            headers,
            body: requestBody,
            signal: newSignals,
            credentials: withCredentials ? "include" : undefined,
            // @ts-ignore
            duplex,
            ...(disableCache && isCacheNoStoreSupported() ? { cache: "no-store" as RequestCache } : {}),
        });
    } catch (error) {
        if (timeoutAbortId != null) {
            clearTimeout(timeoutAbortId);
        }
        // Some runtimes (e.g. Node 18) reject with their own error instead of the abort reason.
        if (timeoutSignal?.aborted && !abortSignal?.aborted) {
            throw TIMEOUT;
        }
        throw error;
    }

    if (timeoutAbortId != null) {
        if (keepTimeoutUntilBodyRead) {
            responseTimeouts.set(response, timeoutAbortId);
        } else {
            clearTimeout(timeoutAbortId);
        }
    }

    return response;
};

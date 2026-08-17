import { createLogger, type LogConfig, type Logger } from "../logging/logger.js";
import { join } from "../url/join.js";
import { EndpointSupplier } from "./EndpointSupplier.js";
import { getFetchFn } from "./getFetchFn.js";
import { makeRequest } from "./makeRequest.js";
import { redactUrl } from "./redactUrl.js";
import { requestWithRetries } from "./requestWithRetries.js";
import { Supplier } from "./Supplier.js";

export declare namespace PassthroughRequest {
    /**
     * Per-request options that can override the SDK client defaults.
     */
    export interface RequestOptions {
        /** Override the default timeout for this request (in seconds). */
        timeoutInSeconds?: number;
        /** Override the default number of retries for this request. */
        maxRetries?: number;
        /** Additional headers to include in this request. */
        headers?: Record<string, string>;
        /** Abort signal for this request. */
        abortSignal?: AbortSignal;
    }

    /**
     * SDK client configuration used by the passthrough fetch method.
     */
    export interface ClientOptions {
        /** The base URL or environment for the client. */
        environment?: Supplier<string>;
        /** Override the base URL. */
        baseUrl?: Supplier<string>;
        /** Default headers to include in requests. */
        headers?: Record<string, unknown>;
        /** Default maximum time to wait for a response in seconds. */
        timeoutInSeconds?: number;
        /** Default number of times to retry the request. Defaults to 2. */
        maxRetries?: number;
        /** A custom fetch function. */
        fetch?: typeof fetch;
        /** Logging configuration. */
        logging?: LogConfig | Logger;
        /** A function that returns auth headers. */
        getAuthHeaders?: () => Promise<Record<string, string>>;
    }
}

/**
 * Makes a passthrough HTTP request using the SDK's configuration (auth, retry, logging, etc.)
 * while mimicking the standard `fetch` API.
 *
 * @param input - The URL, path, or Request object. If a relative path, it will be resolved against the configured base URL.
 * @param init - Standard RequestInit options (method, headers, body, signal, etc.)
 * @param clientOptions - SDK client options (auth, default headers, logging, etc.)
 * @param requestOptions - Per-request overrides (timeout, retries, extra headers, abort signal).
 * @returns A standard Response object.
 */
export async function makePassthroughRequest(
    input: Request | string | URL,
    init: RequestInit | undefined,
    clientOptions: PassthroughRequest.ClientOptions,
    requestOptions?: PassthroughRequest.RequestOptions,
): Promise<Response> {
    const logger = createLogger(clientOptions.logging);

    // Extract URL and default init properties from Request object if provided
    let url: string;
    let effectiveInit: RequestInit | undefined = init;
    if (input instanceof Request) {
        url = input.url;
        // If no explicit init provided, extract properties from the Request object
        if (init == null) {
            effectiveInit = {
                method: input.method,
                headers: Object.fromEntries(input.headers.entries()),
                body: input.body,
                signal: input.signal,
                credentials: input.credentials,
                cache: input.cache as RequestCache,
                redirect: input.redirect,
                referrer: input.referrer,
                integrity: input.integrity,
                mode: input.mode,
            };
        }
    } else {
        url = input instanceof URL ? input.toString() : input;
    }

    // Resolve the base URL
    const baseUrl =
        (clientOptions.baseUrl != null ? await Supplier.get(clientOptions.baseUrl) : undefined) ??
        (clientOptions.environment != null ? await Supplier.get(clientOptions.environment) : undefined);

    // Determine the full URL
    let fullUrl: string;
    if (url.startsWith("http://") || url.startsWith("https://")) {
        fullUrl = url;
    } else if (baseUrl != null) {
        fullUrl = join(baseUrl, url);
    } else {
        fullUrl = url;
    }

    // Merge headers: SDK default headers -> auth headers -> user-provided headers
    const mergedHeaders: Record<string, string> = {};

    // Apply SDK default headers (resolve suppliers)
    if (clientOptions.headers != null) {
        for (const [key, value] of Object.entries(clientOptions.headers)) {
            const resolved = await EndpointSupplier.get(value, { endpointMetadata: {} });
            if (resolved != null) {
                mergedHeaders[key.toLowerCase()] = `${resolved}`;
            }
        }
    }

    // Apply auth headers, but only when the resolved URL targets the configured base URL.
    // This prevents the SDK's credentials from leaking to an unrelated host when a caller
    // passes an absolute cross-origin URL into the passthrough fetch escape hatch.
    if (clientOptions.getAuthHeaders != null && targetsBaseUrl(fullUrl, baseUrl)) {
        const authHeaders = await clientOptions.getAuthHeaders();
        for (const [key, value] of Object.entries(authHeaders)) {
            mergedHeaders[key.toLowerCase()] = value;
        }
    }

    // Apply user-provided headers from init
    if (effectiveInit?.headers != null) {
        const initHeaders =
            effectiveInit.headers instanceof Headers
                ? Object.fromEntries(effectiveInit.headers.entries())
                : Array.isArray(effectiveInit.headers)
                  ? Object.fromEntries(effectiveInit.headers)
                  : effectiveInit.headers;
        for (const [key, value] of Object.entries(initHeaders)) {
            if (value != null) {
                mergedHeaders[key.toLowerCase()] = value;
            }
        }
    }

    // Apply per-request option headers (highest priority)
    if (requestOptions?.headers != null) {
        for (const [key, value] of Object.entries(requestOptions.headers)) {
            mergedHeaders[key.toLowerCase()] = value;
        }
    }

    const method = effectiveInit?.method ?? "GET";
    const body = effectiveInit?.body;
    const timeoutInSeconds = requestOptions?.timeoutInSeconds ?? clientOptions.timeoutInSeconds;
    const timeoutMs = timeoutInSeconds != null ? timeoutInSeconds * 1000 : undefined;
    const maxRetries = requestOptions?.maxRetries ?? clientOptions.maxRetries;
    const abortSignal = requestOptions?.abortSignal ?? effectiveInit?.signal ?? undefined;
    const fetchFn = clientOptions.fetch ?? (await getFetchFn());

    if (logger.isDebug()) {
        logger.debug("Making passthrough HTTP request", {
            method,
            url: redactUrl(fullUrl),
            hasBody: body != null,
        });
    }

    const response = await requestWithRetries(
        async () =>
            makeRequest(
                fetchFn,
                fullUrl,
                method,
                mergedHeaders,
                body ?? undefined,
                timeoutMs,
                abortSignal,
                effectiveInit?.credentials === "include",
                undefined, // duplex
                false, // disableCache
            ),
        maxRetries,
    );

    if (logger.isDebug()) {
        logger.debug("Passthrough HTTP request completed", {
            method,
            url: redactUrl(fullUrl),
            statusCode: response.status,
        });
    }

    return response;
}

/**
 * Returns true when the resolved request URL points at the same origin as the
 * configured base URL. Relative paths are always joined onto the base URL, so
 * they resolve to the base origin and return true. Absolute URLs only match when
 * their origin equals the base origin. When there is no base URL to compare
 * against, or either value is not a parseable absolute URL, this returns false so
 * auth headers are not attached.
 */
function targetsBaseUrl(fullUrl: string, baseUrl: string | undefined): boolean {
    if (baseUrl == null) {
        return false;
    }
    try {
        return new URL(fullUrl).origin === new URL(baseUrl).origin;
    } catch {
        return false;
    }
}

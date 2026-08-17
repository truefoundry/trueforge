import { toJson } from "../json.js";
import { createLogger, type LogConfig, type Logger } from "../logging/logger.js";
import type { APIResponse } from "./APIResponse.js";
import { createRequestUrl } from "./createRequestUrl.js";
import type { EndpointMetadata } from "./EndpointMetadata.js";
import { EndpointSupplier } from "./EndpointSupplier.js";
import { getErrorResponseBody } from "./getErrorResponseBody.js";
import { getFetchFn } from "./getFetchFn.js";
import { getRequestBody } from "./getRequestBody.js";
import { getResponseBody } from "./getResponseBody.js";
import { Headers } from "./Headers.js";
import { makeRequest } from "./makeRequest.js";
import { abortRawResponse, toRawResponse, unknownRawResponse } from "./RawResponse.js";
import { redactUrl, SENSITIVE_QUERY_PARAMS } from "./redactUrl.js";
import { requestWithRetries } from "./requestWithRetries.js";

export type FetchFunction = <R = unknown>(args: Fetcher.Args) => Promise<APIResponse<R, Fetcher.Error>>;

export declare namespace Fetcher {
    export interface Args {
        url: string;
        method: string;
        contentType?: string;
        headers?: Record<string, unknown>;
        /**
         * @deprecated Prefer `queryString` (produced by `core.url.queryBuilder()`).
         * Retained for backwards compatibility with custom fetchers and callers that
         * still construct request args with a query-parameter object.
         */
        queryParameters?: Record<string, unknown>;
        queryString?: string;
        body?: unknown;
        timeoutMs?: number;
        maxRetries?: number;
        withCredentials?: boolean;
        abortSignal?: AbortSignal;
        requestType?: "json" | "file" | "bytes" | "form" | "other";
        responseType?: "json" | "blob" | "sse" | "streaming" | "text" | "arrayBuffer" | "binary-response";
        duplex?: "half";
        endpointMetadata?: EndpointMetadata;
        fetchFn?: typeof fetch;
        logging?: LogConfig | Logger;
    }

    export type Error = FailedStatusCodeError | NonJsonError | BodyIsNullError | TimeoutError | UnknownError;

    export interface FailedStatusCodeError {
        reason: "status-code";
        statusCode: number;
        body: unknown;
    }

    export interface NonJsonError {
        reason: "non-json";
        statusCode: number;
        rawBody: string;
    }

    export interface BodyIsNullError {
        reason: "body-is-null";
        statusCode: number;
    }

    export interface TimeoutError {
        reason: "timeout";
        cause?: unknown;
    }

    export interface UnknownError {
        reason: "unknown";
        errorMessage: string;
        cause?: unknown;
    }
}

const SENSITIVE_HEADERS = new Set([
    "authorization",
    "www-authenticate",
    "x-api-key",
    "api-key",
    "apikey",
    "x-api-token",
    "x-auth-token",
    "auth-token",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "proxy-authenticate",
    "x-csrf-token",
    "x-xsrf-token",
    "x-session-token",
    "x-access-token",
]);

function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of headers instanceof Headers ? headers.entries() : Object.entries(headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
            filtered[key] = "[REDACTED]";
        } else {
            filtered[key] = value;
        }
    }
    return filtered;
}

function redactQueryParameters(
    queryParameters: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (queryParameters == null) {
        return undefined;
    }
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(queryParameters)) {
        redacted[key] = SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()) ? "[REDACTED]" : value;
    }
    return redacted;
}

async function getHeaders(args: Fetcher.Args): Promise<Headers> {
    const newHeaders: Headers = new Headers();

    newHeaders.set(
        "Accept",
        args.responseType === "json"
            ? "application/json"
            : args.responseType === "text"
              ? "text/plain"
              : args.responseType === "sse"
                ? "text/event-stream"
                : "*/*",
    );
    if (args.body !== undefined && args.contentType != null) {
        newHeaders.set("Content-Type", args.contentType);
    }

    if (args.headers == null) {
        return newHeaders;
    }

    for (const [key, value] of Object.entries(args.headers)) {
        const result = await EndpointSupplier.get(value, { endpointMetadata: args.endpointMetadata ?? {} });
        if (typeof result === "string") {
            newHeaders.set(key, result);
            continue;
        }
        if (result == null) {
            continue;
        }
        newHeaders.set(key, `${result}`);
    }
    return newHeaders;
}

export async function fetcherImpl<R = unknown>(args: Fetcher.Args): Promise<APIResponse<R, Fetcher.Error>> {
    let url = args.url;
    if (args.queryString != null && args.queryString.length > 0) {
        url = `${url}?${args.queryString}`;
    } else {
        url = createRequestUrl(args.url, args.queryParameters);
    }
    const requestBody: BodyInit | undefined = await getRequestBody({
        body: args.body,
        type: args.requestType ?? "other",
    });
    const fetchFn = args.fetchFn ?? (await getFetchFn());
    const headers = await getHeaders(args);
    const logger = createLogger(args.logging);

    if (logger.isDebug()) {
        const metadata = {
            method: args.method,
            url: redactUrl(url),
            headers: redactHeaders(headers),
            queryParameters: redactQueryParameters(args.queryParameters),
            hasBody: requestBody != null,
        };
        logger.debug("Making HTTP request", metadata);
    }

    try {
        const response = await requestWithRetries(
            async () =>
                makeRequest(
                    fetchFn,
                    url,
                    args.method,
                    headers,
                    requestBody,
                    args.timeoutMs,
                    args.abortSignal,
                    args.withCredentials,
                    args.duplex,
                    args.responseType === "streaming" || args.responseType === "sse",
                ),
            args.maxRetries,
        );

        if (response.status >= 200 && response.status < 400) {
            if (logger.isDebug()) {
                const metadata = {
                    method: args.method,
                    url: redactUrl(url),
                    statusCode: response.status,
                    responseHeaders: redactHeaders(response.headers),
                };
                logger.debug("HTTP request succeeded", metadata);
            }
            const body = await getResponseBody(response, args.responseType);
            return {
                ok: true,
                body: body as R,
                headers: response.headers,
                rawResponse: toRawResponse(response),
            };
        } else {
            if (logger.isError()) {
                const metadata = {
                    method: args.method,
                    url: redactUrl(url),
                    statusCode: response.status,
                    responseHeaders: redactHeaders(Object.fromEntries(response.headers.entries())),
                };
                logger.error("HTTP request failed with error status", metadata);
            }
            return {
                ok: false,
                error: {
                    reason: "status-code",
                    statusCode: response.status,
                    body: await getErrorResponseBody(response),
                },
                rawResponse: toRawResponse(response),
            };
        }
    } catch (error) {
        if (args.abortSignal?.aborted) {
            if (logger.isError()) {
                const metadata = {
                    method: args.method,
                    url: redactUrl(url),
                };
                logger.error("HTTP request was aborted", metadata);
            }
            return {
                ok: false,
                error: {
                    reason: "unknown",
                    errorMessage: "The user aborted a request",
                    cause: error,
                },
                rawResponse: abortRawResponse,
            };
        } else if (error instanceof Error && error.name === "AbortError") {
            if (logger.isError()) {
                const metadata = {
                    method: args.method,
                    url: redactUrl(url),
                    timeoutMs: args.timeoutMs,
                };
                logger.error("HTTP request timed out", metadata);
            }
            return {
                ok: false,
                error: {
                    reason: "timeout",
                    cause: error,
                },
                rawResponse: abortRawResponse,
            };
        } else if (error instanceof Error) {
            if (logger.isError()) {
                const metadata = {
                    method: args.method,
                    url: redactUrl(url),
                    errorMessage: error.message,
                };
                logger.error("HTTP request failed with error", metadata);
            }
            return {
                ok: false,
                error: {
                    reason: "unknown",
                    errorMessage: error.message,
                    cause: error,
                },
                rawResponse: unknownRawResponse,
            };
        }

        if (logger.isError()) {
            const metadata = {
                method: args.method,
                url: redactUrl(url),
                error: toJson(error),
            };
            logger.error("HTTP request failed with unknown error", metadata);
        }
        return {
            ok: false,
            error: {
                reason: "unknown",
                errorMessage: toJson(error),
                cause: error,
            },
            rawResponse: unknownRawResponse,
        };
    }
}

export const fetcher: FetchFunction = fetcherImpl;

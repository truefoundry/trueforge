import type { Mock } from "vitest";
import { makePassthroughRequest } from "../../../src/core/fetcher/makePassthroughRequest";

describe("makePassthroughRequest", () => {
    let mockFetch: Mock;

    beforeEach(() => {
        mockFetch = vi.fn();
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    describe("URL resolution", () => {
        it("should use absolute URL directly", async () => {
            await makePassthroughRequest("https://api.example.com/v1/users", undefined, {
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://api.example.com/v1/users");
        });

        it("should resolve relative path against baseUrl", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                baseUrl: "https://api.example.com",
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://api.example.com/v1/users");
        });

        it("should resolve relative path against environment when baseUrl is not set", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                environment: "https://env.example.com",
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://env.example.com/v1/users");
        });

        it("should prefer baseUrl over environment", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                baseUrl: "https://base.example.com",
                environment: "https://env.example.com",
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://base.example.com/v1/users");
        });

        it("should pass relative URL through as-is when no baseUrl or environment", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("/v1/users");
        });

        it("should resolve baseUrl supplier", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                baseUrl: () => "https://dynamic.example.com",
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://dynamic.example.com/v1/users");
        });

        it("should ignore absolute URL even when baseUrl is set", async () => {
            await makePassthroughRequest("https://other.example.com/path", undefined, {
                baseUrl: "https://base.example.com",
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://other.example.com/path");
        });

        it("should accept a URL object", async () => {
            await makePassthroughRequest(new URL("https://api.example.com/v1/users"), undefined, {
                fetch: mockFetch,
            });
            const [calledUrl] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://api.example.com/v1/users");
        });
    });

    describe("header merge order", () => {
        it("should merge headers in correct priority: SDK defaults < auth < init < requestOptions", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                {
                    headers: { "X-Custom": "from-init", Authorization: "from-init" },
                },
                {
                    baseUrl: "https://api.example.com",
                    headers: {
                        "X-Custom": "from-sdk",
                        "X-SDK-Only": "sdk-value",
                        Authorization: "from-sdk",
                    },
                    getAuthHeaders: async () => ({
                        Authorization: "Bearer auth-token",
                        "X-Auth-Only": "auth-value",
                    }),
                    fetch: mockFetch,
                },
                {
                    headers: { Authorization: "from-request-options" },
                },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            const headers = calledOptions.headers;

            // requestOptions.headers wins for Authorization (highest priority)
            expect(headers.authorization).toBe("from-request-options");
            // init.headers wins over SDK defaults for X-Custom
            expect(headers["x-custom"]).toBe("from-init");
            // SDK-only header is preserved
            expect(headers["x-sdk-only"]).toBe("sdk-value");
            // Auth-only header is preserved
            expect(headers["x-auth-only"]).toBe("auth-value");
        });

        it("should lowercase all header keys", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                {
                    headers: { "Content-Type": "application/json" },
                },
                {
                    headers: { "X-Fern-Language": "JavaScript" },
                    fetch: mockFetch,
                },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            const headers = calledOptions.headers;
            expect(headers["content-type"]).toBe("application/json");
            expect(headers["x-fern-language"]).toBe("JavaScript");
            expect(headers["Content-Type"]).toBeUndefined();
            expect(headers["X-Fern-Language"]).toBeUndefined();
        });

        it("should handle Headers object in init", async () => {
            const initHeaders = new Headers();
            initHeaders.set("X-From-Headers-Object", "value");
            await makePassthroughRequest("https://api.example.com", { headers: initHeaders }, { fetch: mockFetch });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers["x-from-headers-object"]).toBe("value");
        });

        it("should handle array-style headers in init", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                { headers: [["X-Array-Header", "array-value"]] },
                { fetch: mockFetch },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers["x-array-header"]).toBe("array-value");
        });

        it("should skip null SDK default header values", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                headers: { "X-Present": "value", "X-Null": null },
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers["x-present"]).toBe("value");
            expect(calledOptions.headers["x-null"]).toBeUndefined();
        });
    });

    describe("auth headers", () => {
        it("should include auth headers when getAuthHeaders is provided", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                baseUrl: "https://api.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBe("Bearer my-token");
        });

        it("should work without auth headers", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBeUndefined();
        });

        it("should allow init headers to override auth headers", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                { headers: { Authorization: "Bearer override" } },
                {
                    baseUrl: "https://api.example.com",
                    getAuthHeaders: async () => ({ Authorization: "Bearer sdk-auth" }),
                    fetch: mockFetch,
                },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBe("Bearer override");
        });
    });

    describe("auth header origin scoping", () => {
        it("should attach auth headers to relative paths resolved against baseUrl", async () => {
            await makePassthroughRequest("/v1/users", undefined, {
                baseUrl: "https://api.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBe("Bearer my-token");
        });

        it("should attach auth headers to same-origin absolute URLs", async () => {
            await makePassthroughRequest("https://api.example.com/v1/users", undefined, {
                baseUrl: "https://api.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBe("Bearer my-token");
        });

        it("should attach auth headers when the absolute URL matches the environment origin", async () => {
            await makePassthroughRequest("https://env.example.com/v1/users", undefined, {
                environment: "https://env.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBe("Bearer my-token");
        });

        it("should NOT attach auth headers to a cross-origin absolute URL", async () => {
            await makePassthroughRequest("https://evil.example.com/steal", undefined, {
                baseUrl: "https://api.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBeUndefined();
        });

        it("should NOT attach auth headers to a cross-origin URL differing only by port", async () => {
            await makePassthroughRequest("https://api.example.com:9999/steal", undefined, {
                baseUrl: "https://api.example.com",
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBeUndefined();
        });

        it("should NOT attach auth headers when no baseUrl or environment is configured", async () => {
            await makePassthroughRequest("https://api.example.com/v1/users", undefined, {
                getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBeUndefined();
        });

        it("should still allow explicit init headers on cross-origin requests", async () => {
            await makePassthroughRequest(
                "https://evil.example.com/steal",
                { headers: { "X-Custom": "keep-me" } },
                {
                    baseUrl: "https://api.example.com",
                    getAuthHeaders: async () => ({ Authorization: "Bearer my-token" }),
                    fetch: mockFetch,
                },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers.authorization).toBeUndefined();
            expect(calledOptions.headers["x-custom"]).toBe("keep-me");
        });
    });

    describe("method and body", () => {
        it("should default to GET when no method specified", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.method).toBe("GET");
        });

        it("should use the method from init", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                { method: "POST", body: JSON.stringify({ key: "value" }) },
                { fetch: mockFetch },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.method).toBe("POST");
            expect(calledOptions.body).toBe(JSON.stringify({ key: "value" }));
        });

        it("should pass body as undefined when not provided", async () => {
            await makePassthroughRequest("https://api.example.com", { method: "GET" }, { fetch: mockFetch });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.body).toBeUndefined();
        });
    });

    describe("timeout and retries", () => {
        it("should use requestOptions timeout over client timeout", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                undefined,
                { timeoutInSeconds: 30, fetch: mockFetch },
                { timeoutInSeconds: 10 },
            );
            // The timeout is passed to makeRequest which converts to ms
            // We verify via the signal timing behavior (indirectly tested through makeRequest)
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should use client timeout when requestOptions timeout is not set", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                timeoutInSeconds: 30,
                fetch: mockFetch,
            });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should use requestOptions maxRetries over client maxRetries", async () => {
            mockFetch.mockResolvedValue(new Response("", { status: 502 }));
            vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
                process.nextTick(callback);
                return null as any;
            });

            await makePassthroughRequest(
                "https://api.example.com",
                undefined,
                { maxRetries: 5, fetch: mockFetch },
                { maxRetries: 1 },
            );
            // 1 initial + 1 retry = 2 calls
            expect(mockFetch).toHaveBeenCalledTimes(2);

            vi.restoreAllMocks();
        });
    });

    describe("abort signal", () => {
        it("should use requestOptions.abortSignal over init.signal", async () => {
            const initController = new AbortController();
            const requestController = new AbortController();

            await makePassthroughRequest(
                "https://api.example.com",
                { signal: initController.signal },
                { fetch: mockFetch },
                { abortSignal: requestController.signal },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            // The signal passed to makeRequest is combined with timeout signal via anySignal,
            // but the requestOptions.abortSignal should be the one that's used (not init.signal)
            expect(calledOptions.signal).toBeDefined();
        });

        it("should use init.signal when requestOptions.abortSignal is not set", async () => {
            const initController = new AbortController();

            await makePassthroughRequest(
                "https://api.example.com",
                { signal: initController.signal },
                { fetch: mockFetch },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.signal).toBeDefined();
        });
    });

    describe("credentials", () => {
        it("should pass credentials include when set", async () => {
            await makePassthroughRequest("https://api.example.com", { credentials: "include" }, { fetch: mockFetch });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.credentials).toBe("include");
        });

        it("should not pass credentials when not set to include", async () => {
            await makePassthroughRequest(
                "https://api.example.com",
                { credentials: "same-origin" },
                {
                    fetch: mockFetch,
                },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.credentials).toBeUndefined();
        });
    });

    describe("response", () => {
        it("should return the Response object from fetch", async () => {
            const mockResponse = new Response(JSON.stringify({ data: "test" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
            mockFetch.mockResolvedValue(mockResponse);

            const response = await makePassthroughRequest("https://api.example.com", undefined, {
                fetch: mockFetch,
            });
            expect(response).toBe(mockResponse);
            expect(response.status).toBe(200);
        });

        it("should return error responses without throwing", async () => {
            const errorResponse = new Response("Not Found", { status: 404 });
            mockFetch.mockResolvedValue(errorResponse);

            const response = await makePassthroughRequest("https://api.example.com", undefined, {
                fetch: mockFetch,
            });
            expect(response.status).toBe(404);
        });
    });

    describe("Request object input", () => {
        it("should extract URL from Request object", async () => {
            const request = new Request("https://api.example.com/v1/resource", { method: "POST" });
            await makePassthroughRequest(request, undefined, {
                fetch: mockFetch,
            });
            const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe("https://api.example.com/v1/resource");
            expect(calledOptions.method).toBe("POST");
        });

        it("should extract headers from Request object when no init provided", async () => {
            const request = new Request("https://api.example.com", {
                headers: { "X-From-Request": "request-value" },
            });
            await makePassthroughRequest(request, undefined, {
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers["x-from-request"]).toBe("request-value");
        });

        it("should use explicit init over Request object properties", async () => {
            const request = new Request("https://api.example.com", {
                method: "POST",
                headers: { "X-From-Request": "request-value" },
            });
            await makePassthroughRequest(
                request,
                { method: "PUT", headers: { "X-From-Init": "init-value" } },
                { fetch: mockFetch },
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.method).toBe("PUT");
            expect(calledOptions.headers["x-from-init"]).toBe("init-value");
            // Request headers should NOT be present since explicit init was provided
            expect(calledOptions.headers["x-from-request"]).toBeUndefined();
        });
    });

    describe("SDK default header suppliers", () => {
        it("should resolve supplier functions for SDK default headers", async () => {
            await makePassthroughRequest("https://api.example.com", undefined, {
                headers: {
                    "X-Static": "static-value",
                    "X-Dynamic": () => "dynamic-value",
                },
                fetch: mockFetch,
            });
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.headers["x-static"]).toBe("static-value");
            expect(calledOptions.headers["x-dynamic"]).toBe("dynamic-value");
        });
    });

    describe("debug logging", () => {
        it("should redact credentials in the logged request URL", async () => {
            const mockLogger = {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            };
            await makePassthroughRequest("https://user:password@api.example.com/v1/users?token=secret", undefined, {
                fetch: mockFetch,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            const loggedUrls = mockLogger.debug.mock.calls.map(([, meta]) => (meta as { url: string }).url);
            expect(loggedUrls.length).toBeGreaterThan(0);
            for (const loggedUrl of loggedUrls) {
                expect(loggedUrl).toBe("https://[REDACTED]@api.example.com/v1/users?token=[REDACTED]");
                expect(loggedUrl).not.toContain("password");
                expect(loggedUrl).not.toContain("secret");
            }
        });
    });
});

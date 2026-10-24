import type { Mock } from "vitest";
import {
    clearResponseTimeout,
    isCacheNoStoreSupported,
    makeRequest,
    resetCacheNoStoreSupported,
} from "../../../src/core/fetcher/makeRequest";

describe("Test makeRequest", () => {
    const mockPostUrl = "https://httpbin.org/post";
    const mockGetUrl = "https://httpbin.org/get";
    const mockHeaders = { "Content-Type": "application/json" };
    const mockBody = JSON.stringify({ key: "value" });

    let mockFetch: Mock;

    beforeEach(() => {
        mockFetch = vi.fn();
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ test: "successful" }), { status: 200 }));
        resetCacheNoStoreSupported();
    });

    it("should handle POST request correctly", async () => {
        const response = await makeRequest(mockFetch, mockPostUrl, "POST", mockHeaders, mockBody);
        const responseBody = await response.json();
        expect(responseBody).toEqual({ test: "successful" });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
        expect(calledUrl).toBe(mockPostUrl);
        expect(calledOptions).toEqual(
            expect.objectContaining({
                method: "POST",
                headers: mockHeaders,
                body: mockBody,
                credentials: undefined,
            }),
        );
        expect(calledOptions.signal).toBeDefined();
        expect(calledOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("should handle GET request correctly", async () => {
        const response = await makeRequest(mockFetch, mockGetUrl, "GET", mockHeaders, undefined);
        const responseBody = await response.json();
        expect(responseBody).toEqual({ test: "successful" });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
        expect(calledUrl).toBe(mockGetUrl);
        expect(calledOptions).toEqual(
            expect.objectContaining({
                method: "GET",
                headers: mockHeaders,
                body: undefined,
                credentials: undefined,
            }),
        );
        expect(calledOptions.signal).toBeDefined();
        expect(calledOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("should not include cache option when disableCache is not set", async () => {
        await makeRequest(mockFetch, mockGetUrl, "GET", mockHeaders, undefined);
        const [, calledOptions] = mockFetch.mock.calls[0];
        expect(calledOptions.cache).toBeUndefined();
    });

    it("should not include cache option when disableCache is false", async () => {
        await makeRequest(
            mockFetch,
            mockGetUrl,
            "GET",
            mockHeaders,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
        );
        const [, calledOptions] = mockFetch.mock.calls[0];
        expect(calledOptions.cache).toBeUndefined();
    });

    it("should include cache: no-store when disableCache is true and runtime supports it", async () => {
        // In Node.js test environment, Request supports the cache option
        expect(isCacheNoStoreSupported()).toBe(true);
        await makeRequest(
            mockFetch,
            mockGetUrl,
            "GET",
            mockHeaders,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            true,
        );
        const [, calledOptions] = mockFetch.mock.calls[0];
        expect(calledOptions.cache).toBe("no-store");
    });

    it("should cache the result of isCacheNoStoreSupported", () => {
        const first = isCacheNoStoreSupported();
        const second = isCacheNoStoreSupported();
        expect(first).toBe(second);
    });

    it("should reset cache detection state with resetCacheNoStoreSupported", () => {
        // First call caches the result
        const first = isCacheNoStoreSupported();
        expect(first).toBe(true);

        // Reset clears the cache
        resetCacheNoStoreSupported();

        // After reset, it should re-detect (and still return true in Node.js)
        const second = isCacheNoStoreSupported();
        expect(second).toBe(true);
    });

    it("should not include cache option when runtime does not support it (e.g. Cloudflare Workers)", async () => {
        // Mock Request constructor to throw when cache option is passed,
        // simulating runtimes like Cloudflare Workers
        const OriginalRequest = globalThis.Request;
        globalThis.Request = class MockRequest {
            constructor(_url: string, init?: RequestInit) {
                if (init?.cache != null) {
                    throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.");
                }
            }
        } as unknown as typeof Request;

        try {
            // Reset so the detection runs fresh with the mocked Request
            resetCacheNoStoreSupported();
            expect(isCacheNoStoreSupported()).toBe(false);

            await makeRequest(
                mockFetch,
                mockGetUrl,
                "GET",
                mockHeaders,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                true,
            );
            const [, calledOptions] = mockFetch.mock.calls[0];
            expect(calledOptions.cache).toBeUndefined();
        } finally {
            // Restore original Request
            globalThis.Request = OriginalRequest;
            resetCacheNoStoreSupported();
        }
    });

    it("should clear the timeout once headers arrive by default", async () => {
        vi.useFakeTimers();
        try {
            await makeRequest(mockFetch, mockGetUrl, "GET", mockHeaders, undefined, 1000);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("should keep the timeout running until clearResponseTimeout when keepTimeoutUntilBodyRead is set", async () => {
        vi.useFakeTimers();
        try {
            const response = await makeRequest(
                mockFetch,
                mockGetUrl,
                "GET",
                mockHeaders,
                undefined,
                1000,
                undefined,
                undefined,
                undefined,
                undefined,
                true,
            );
            expect(vi.getTimerCount()).toBe(1);
            clearResponseTimeout(response);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("should clear the timeout when fetch rejects", async () => {
        vi.useFakeTimers();
        try {
            mockFetch.mockRejectedValue(new TypeError("fetch failed"));
            await expect(makeRequest(mockFetch, mockGetUrl, "GET", mockHeaders, undefined, 1000)).rejects.toThrow(
                "fetch failed",
            );
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("should reject with the timeout reason when the runtime rejects with its own error after the timeout fires", async () => {
        mockFetch.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new TypeError("invalid_argument")));
                }),
        );
        await expect(makeRequest(mockFetch, mockGetUrl, "GET", mockHeaders, undefined, 10)).rejects.toBe("timeout");
    });
});

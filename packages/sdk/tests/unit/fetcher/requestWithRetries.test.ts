import type { Mock, MockInstance } from "vitest";
import { requestWithRetries } from "../../../src/core/fetcher/requestWithRetries";

describe("requestWithRetries", () => {
    let mockFetch: Mock;
    let originalMathRandom: typeof Math.random;
    let setTimeoutSpy: MockInstance;

    beforeEach(() => {
        mockFetch = vi.fn();
        originalMathRandom = Math.random;

        Math.random = vi.fn(() => 0.5);

        vi.useFakeTimers({
            toFake: [
                "setTimeout",
                "clearTimeout",
                "setInterval",
                "clearInterval",
                "setImmediate",
                "clearImmediate",
                "Date",
                "performance",
                "requestAnimationFrame",
                "cancelAnimationFrame",
                "requestIdleCallback",
                "cancelIdleCallback",
            ],
        });
    });

    afterEach(() => {
        Math.random = originalMathRandom;
        vi.clearAllMocks();
        vi.clearAllTimers();
    });

    it("should retry on retryable status codes (legacy mode)", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        const retryableStatuses = [408, 429, 500, 501, 502, 503, 504, 505];
        let callCount = 0;

        mockFetch.mockImplementation(async () => {
            if (callCount < retryableStatuses.length) {
                return new Response("", { status: retryableStatuses[callCount++] });
            }
            return new Response("", { status: 200 });
        });

        const responsePromise = requestWithRetries(() => mockFetch(), retryableStatuses.length);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(mockFetch).toHaveBeenCalledTimes(retryableStatuses.length + 1);
        expect(response.status).toBe(200);
    });

    it("should retry on 500 Internal Server Error in legacy mode", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch
            .mockResolvedValueOnce(new Response("", { status: 500 }))
            .mockResolvedValueOnce(new Response("", { status: 200 }));

        const responsePromise = requestWithRetries(() => mockFetch(), 3);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });

    it("should respect maxRetries limit", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        const maxRetries = 2;
        mockFetch.mockResolvedValue(new Response("", { status: 503 }));

        const responsePromise = requestWithRetries(() => mockFetch(), maxRetries);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(mockFetch).toHaveBeenCalledTimes(maxRetries + 1);
        expect(response.status).toBe(503);
    });

    it("should retry on status 599 (upper boundary of retryable 5xx in legacy mode)", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch
            .mockResolvedValueOnce(new Response("", { status: 599 }))
            .mockResolvedValueOnce(new Response("", { status: 200 }));

        const responsePromise = requestWithRetries(() => mockFetch(), 3);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });

    it("should not retry on non-retryable client error (400)", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch.mockResolvedValueOnce(new Response("", { status: 400 }));

        const responsePromise = requestWithRetries(() => mockFetch(), 3);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(400);
    });

    it("should not retry on success status codes", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        const successStatuses = [200, 201, 202];

        for (const status of successStatuses) {
            mockFetch.mockReset();
            setTimeoutSpy.mockClear();
            mockFetch.mockResolvedValueOnce(new Response("", { status }));

            const responsePromise = requestWithRetries(() => mockFetch(), 3);
            await vi.runAllTimersAsync();
            await responsePromise;

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(setTimeoutSpy).not.toHaveBeenCalled();
        }
    });

    interface RetryHeaderTestCase {
        description: string;
        headerName: string;
        headerValue: string | (() => string);
        expectedDelayMin: number;
        expectedDelayMax: number;
    }

    const retryHeaderTests: RetryHeaderTestCase[] = [
        {
            description: "should respect retry-after header with seconds value",
            headerName: "retry-after",
            headerValue: "5",
            expectedDelayMin: 4000,
            expectedDelayMax: 6000,
        },
        {
            description: "should respect retry-after header with HTTP date value",
            headerName: "retry-after",
            headerValue: () => new Date(Date.now() + 3000).toUTCString(),
            expectedDelayMin: 2000,
            expectedDelayMax: 4000,
        },
        {
            description: "should respect x-ratelimit-reset header",
            headerName: "x-ratelimit-reset",
            headerValue: () => Math.floor((Date.now() + 4000) / 1000).toString(),
            expectedDelayMin: 3000,
            expectedDelayMax: 6000,
        },
    ];

    retryHeaderTests.forEach(({ description, headerName, headerValue, expectedDelayMin, expectedDelayMax }) => {
        it(description, async () => {
            setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
                process.nextTick(callback);
                return null as any;
            });

            const value = typeof headerValue === "function" ? headerValue() : headerValue;
            mockFetch
                .mockResolvedValueOnce(
                    new Response("", {
                        status: 429,
                        headers: new Headers({ [headerName]: value }),
                    }),
                )
                .mockResolvedValueOnce(new Response("", { status: 200 }));

            const responsePromise = requestWithRetries(() => mockFetch(), 1);
            await vi.runAllTimersAsync();
            const response = await responsePromise;

            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
            const actualDelay = setTimeoutSpy.mock.calls[0][1];
            expect(actualDelay).toBeGreaterThan(expectedDelayMin);
            expect(actualDelay).toBeLessThan(expectedDelayMax);
            expect(response.status).toBe(200);
        });
    });

    it("should apply correct exponential backoff with jitter", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch.mockResolvedValue(new Response("", { status: 502 }));
        const maxRetries = 3;
        const expectedDelays = [1000, 2000, 4000];

        const responsePromise = requestWithRetries(() => mockFetch(), maxRetries);
        await vi.runAllTimersAsync();
        await responsePromise;

        expect(setTimeoutSpy).toHaveBeenCalledTimes(expectedDelays.length);

        expectedDelays.forEach((delay, index) => {
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(index + 1, expect.any(Function), delay);
        });

        expect(mockFetch).toHaveBeenCalledTimes(maxRetries + 1);
    });

    it("should handle concurrent retries independently", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch
            .mockResolvedValueOnce(new Response("", { status: 502 }))
            .mockResolvedValueOnce(new Response("", { status: 502 }))
            .mockResolvedValueOnce(new Response("", { status: 200 }))
            .mockResolvedValueOnce(new Response("", { status: 200 }));

        const promise1 = requestWithRetries(() => mockFetch(), 1);
        const promise2 = requestWithRetries(() => mockFetch(), 1);

        await vi.runAllTimersAsync();
        const [response1, response2] = await Promise.all([promise1, promise2]);

        expect(response1.status).toBe(200);
        expect(response2.status).toBe(200);
    });

    it("should cap delay at MAX_RETRY_DELAY for large header values", async () => {
        setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation((callback: (args: void) => void) => {
            process.nextTick(callback);
            return null as any;
        });

        mockFetch
            .mockResolvedValueOnce(
                new Response("", {
                    status: 429,
                    headers: new Headers({ "retry-after": "120" }), // 120 seconds = 120000ms > MAX_RETRY_DELAY (60000ms)
                }),
            )
            .mockResolvedValueOnce(new Response("", { status: 200 }));

        const responsePromise = requestWithRetries(() => mockFetch(), 1);
        await vi.runAllTimersAsync();
        const response = await responsePromise;

        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
        expect(response.status).toBe(200);
    });
});

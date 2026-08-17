import { fetcherImpl } from "../../../src/core/fetcher/Fetcher";

function createMockLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

function mockSuccessResponse(data: unknown = { data: "test" }, status = 200, statusText = "OK") {
    global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(data), {
            status,
            statusText,
        }),
    );
}

function mockErrorResponse(data: unknown = { error: "Error" }, status = 404, statusText = "Not Found") {
    global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(data), {
            status,
            statusText,
        }),
    );
}

describe("Fetcher Logging Integration", () => {
    describe("Request Logging", () => {
        it("should log successful request at debug level", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: { test: "data" },
                contentType: "application/json",
                requestType: "json",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    method: "POST",
                    url: "https://example.com/api",
                    headers: expect.toContainHeaders({
                        "Content-Type": "application/json",
                    }),
                    hasBody: true,
                }),
            );

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "HTTP request succeeded",
                expect.objectContaining({
                    method: "POST",
                    url: "https://example.com/api",
                    statusCode: 200,
                }),
            );
        });

        it("should not log debug messages at info level for successful requests", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "info",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).not.toHaveBeenCalled();
            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        it("should log request with body flag", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "POST",
                body: { data: "test" },
                contentType: "application/json",
                requestType: "json",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    hasBody: true,
                }),
            );
        });

        it("should log request without body flag", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    hasBody: false,
                }),
            );
        });

        it("should not log when silent mode is enabled", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: true,
                },
            });

            expect(mockLogger.debug).not.toHaveBeenCalled();
            expect(mockLogger.info).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        it("should not log when no logging config is provided", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
            });

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });
    });

    describe("Error Logging", () => {
        it("should log 4xx errors at error level", async () => {
            const mockLogger = createMockLogger();
            mockErrorResponse({ error: "Not found" }, 404, "Not Found");

            const result = await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(result.ok).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request failed with error status",
                expect.objectContaining({
                    method: "GET",
                    url: "https://example.com/api",
                    statusCode: 404,
                }),
            );
        });

        it("should log 5xx errors at error level", async () => {
            const mockLogger = createMockLogger();
            mockErrorResponse({ error: "Internal error" }, 500, "Internal Server Error");

            const result = await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(result.ok).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request failed with error status",
                expect.objectContaining({
                    method: "GET",
                    url: "https://example.com/api",
                    statusCode: 500,
                }),
            );
        });

        it("should log aborted request errors", async () => {
            const mockLogger = createMockLogger();

            const abortController = new AbortController();
            abortController.abort();

            global.fetch = vi.fn().mockRejectedValue(new Error("Aborted"));

            const result = await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                abortSignal: abortController.signal,
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(result.ok).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request was aborted",
                expect.objectContaining({
                    method: "GET",
                    url: "https://example.com/api",
                }),
            );
        });

        it("should log timeout errors", async () => {
            const mockLogger = createMockLogger();

            const timeoutError = new Error("Request timeout");
            timeoutError.name = "AbortError";

            global.fetch = vi.fn().mockRejectedValue(timeoutError);

            const result = await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(result.ok).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request timed out",
                expect.objectContaining({
                    method: "GET",
                    url: "https://example.com/api",
                    timeoutMs: undefined,
                }),
            );
        });

        it("should log unknown errors", async () => {
            const mockLogger = createMockLogger();

            const unknownError = new Error("Unknown error");

            global.fetch = vi.fn().mockRejectedValue(unknownError);

            const result = await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(result.ok).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request failed with error",
                expect.objectContaining({
                    method: "GET",
                    url: "https://example.com/api",
                    errorMessage: "Unknown error",
                }),
            );
        });
    });

    describe("Logging with Redaction", () => {
        it("should redact sensitive data in error logs", async () => {
            const mockLogger = createMockLogger();
            mockErrorResponse({ error: "Unauthorized" }, 401, "Unauthorized");

            await fetcherImpl({
                url: "https://example.com/api?api_key=secret",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "error",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request failed with error status",
                expect.objectContaining({
                    url: "https://example.com/api?api_key=[REDACTED]",
                }),
            );
        });
    });

    describe("Different HTTP Methods", () => {
        it("should log GET requests", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    method: "GET",
                }),
            );
        });

        it("should log POST requests", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse({ data: "test" }, 201, "Created");

            await fetcherImpl({
                url: "https://example.com/api",
                method: "POST",
                body: { data: "test" },
                contentType: "application/json",
                requestType: "json",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    method: "POST",
                }),
            );
        });

        it("should log PUT requests", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "PUT",
                body: { data: "test" },
                contentType: "application/json",
                requestType: "json",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    method: "PUT",
                }),
            );
        });

        it("should log DELETE requests", async () => {
            const mockLogger = createMockLogger();
            global.fetch = vi.fn().mockResolvedValue(
                new Response(null, {
                    status: 200,
                    statusText: "OK",
                }),
            );

            await fetcherImpl({
                url: "https://example.com/api",
                method: "DELETE",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Making HTTP request",
                expect.objectContaining({
                    method: "DELETE",
                }),
            );
        });
    });

    describe("Status Code Logging", () => {
        it("should log 2xx success status codes", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse({ data: "test" }, 201, "Created");

            await fetcherImpl({
                url: "https://example.com/api",
                method: "POST",
                body: { data: "test" },
                contentType: "application/json",
                requestType: "json",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "HTTP request succeeded",
                expect.objectContaining({
                    statusCode: 201,
                }),
            );
        });

        it("should log 3xx redirect status codes as success", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse({ data: "test" }, 301, "Moved Permanently");

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                responseType: "json",
                maxRetries: 0,
                logging: {
                    level: "debug",
                    logger: mockLogger,
                    silent: false,
                },
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                "HTTP request succeeded",
                expect.objectContaining({
                    statusCode: 301,
                }),
            );
        });
    });
});

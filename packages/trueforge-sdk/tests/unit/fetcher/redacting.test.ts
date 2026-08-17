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

describe("Redacting Logic", () => {
    describe("Header Redaction", () => {
        it("should redact authorization header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { Authorization: "Bearer secret-token-12345" },
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
                    headers: expect.toContainHeaders({
                        Authorization: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact api-key header (case-insensitive)", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "X-API-KEY": "secret-api-key" },
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
                    headers: expect.toContainHeaders({
                        "X-API-KEY": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact cookie header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { Cookie: "session=abc123; token=xyz789" },
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
                    headers: expect.toContainHeaders({
                        Cookie: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact x-auth-token header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "x-auth-token": "auth-token-12345" },
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
                    headers: expect.toContainHeaders({
                        "x-auth-token": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact proxy-authorization header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "Proxy-Authorization": "Basic credentials" },
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
                    headers: expect.toContainHeaders({
                        "Proxy-Authorization": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact x-csrf-token header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "X-CSRF-Token": "csrf-token-abc" },
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
                    headers: expect.toContainHeaders({
                        "X-CSRF-Token": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact www-authenticate header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "WWW-Authenticate": "Bearer realm=example" },
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
                    headers: expect.toContainHeaders({
                        "WWW-Authenticate": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact x-session-token header", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: { "X-Session-Token": "session-token-xyz" },
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
                    headers: expect.toContainHeaders({
                        "X-Session-Token": "[REDACTED]",
                    }),
                }),
            );
        });

        it("should not redact non-sensitive headers", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Test/1.0",
                    Accept: "application/json",
                },
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
                    headers: expect.toContainHeaders({
                        "Content-Type": "application/json",
                        "User-Agent": "Test/1.0",
                        Accept: "application/json",
                    }),
                }),
            );
        });

        it("should redact multiple sensitive headers at once", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                headers: {
                    Authorization: "Bearer token",
                    "X-API-Key": "api-key",
                    Cookie: "session=123",
                    "Content-Type": "application/json",
                },
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
                    headers: expect.toContainHeaders({
                        Authorization: "[REDACTED]",
                        "X-API-Key": "[REDACTED]",
                        Cookie: "[REDACTED]",
                        "Content-Type": "application/json",
                    }),
                }),
            );
        });
    });

    describe("Response Header Redaction", () => {
        it("should redact Set-Cookie in response headers", async () => {
            const mockLogger = createMockLogger();

            const mockHeaders = new Headers();
            mockHeaders.set("Set-Cookie", "session=abc123; HttpOnly; Secure");
            mockHeaders.set("Content-Type", "application/json");

            global.fetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ data: "test" }), {
                    status: 200,
                    statusText: "OK",
                    headers: mockHeaders,
                }),
            );

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
                    responseHeaders: expect.toContainHeaders({
                        "set-cookie": "[REDACTED]",
                        "content-type": "application/json",
                    }),
                }),
            );
        });

        it("should redact authorization in response headers", async () => {
            const mockLogger = createMockLogger();

            const mockHeaders = new Headers();
            mockHeaders.set("Authorization", "Bearer token-123");
            mockHeaders.set("Content-Type", "application/json");

            global.fetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ data: "test" }), {
                    status: 200,
                    statusText: "OK",
                    headers: mockHeaders,
                }),
            );

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
                    responseHeaders: expect.toContainHeaders({
                        authorization: "[REDACTED]",
                        "content-type": "application/json",
                    }),
                }),
            );
        });

        it("should redact response headers in error responses", async () => {
            const mockLogger = createMockLogger();

            const mockHeaders = new Headers();
            mockHeaders.set("WWW-Authenticate", "Bearer realm=example");
            mockHeaders.set("Content-Type", "application/json");

            global.fetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: mockHeaders,
                }),
            );

            await fetcherImpl({
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

            expect(mockLogger.error).toHaveBeenCalledWith(
                "HTTP request failed with error status",
                expect.objectContaining({
                    responseHeaders: expect.toContainHeaders({
                        "www-authenticate": "[REDACTED]",
                        "content-type": "application/json",
                    }),
                }),
            );
        });
    });

    describe("Query Parameter Redaction", () => {
        it("should redact api_key query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { api_key: "secret-key" },
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
                    queryParameters: expect.objectContaining({
                        api_key: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact token query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { token: "secret-token" },
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
                    queryParameters: expect.objectContaining({
                        token: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact access_token query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { access_token: "secret-access-token" },
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
                    queryParameters: expect.objectContaining({
                        access_token: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact password query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { password: "secret-password" },
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
                    queryParameters: expect.objectContaining({
                        password: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact secret query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { secret: "secret-value" },
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
                    queryParameters: expect.objectContaining({
                        secret: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should redact session_id query parameter", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { session_id: "session-123" },
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
                    queryParameters: expect.objectContaining({
                        session_id: "[REDACTED]",
                    }),
                }),
            );
        });

        it("should not redact non-sensitive query parameters", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: {
                    page: "1",
                    limit: "10",
                    sort: "name",
                },
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
                    queryParameters: expect.objectContaining({
                        page: "1",
                        limit: "10",
                        sort: "name",
                    }),
                }),
            );
        });

        it("should not redact parameters containing 'auth' substring like 'author'", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: {
                    author: "john",
                    authenticate: "false",
                    authorization_level: "user",
                },
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
                    queryParameters: expect.objectContaining({
                        author: "john",
                        authenticate: "false",
                        authorization_level: "user",
                    }),
                }),
            );
        });

        it("should handle undefined query parameters", async () => {
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
                    queryParameters: undefined,
                }),
            );
        });

        it("should redact case-insensitive query parameters", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryParameters: { API_KEY: "secret-key", Token: "secret-token" },
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
                    queryParameters: expect.objectContaining({
                        API_KEY: "[REDACTED]",
                        Token: "[REDACTED]",
                    }),
                }),
            );
        });
    });

    describe("Query String Redaction", () => {
        it("should redact api_key in queryString via URL", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryString: "api_key=secret-key&page=1",
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
                    url: "https://example.com/api?api_key=[REDACTED]&page=1",
                }),
            );
        });

        it("should redact multiple sensitive params in queryString", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryString: "token=t&password=p&page=1",
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
                    url: "https://example.com/api?token=[REDACTED]&password=[REDACTED]&page=1",
                }),
            );
        });

        it("should not redact non-sensitive params in queryString", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryString: "page=1&limit=10&sort=name",
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
                    url: "https://example.com/api?page=1&limit=10&sort=name",
                }),
            );
        });

        it("should prefer queryString over queryParameters when both provided", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api",
                method: "GET",
                queryString: "page=1",
                queryParameters: { api_key: "secret-key" },
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
                    url: "https://example.com/api?page=1",
                    queryParameters: expect.objectContaining({
                        api_key: "[REDACTED]",
                    }),
                }),
            );
        });
    });

    describe("URL Redaction", () => {
        it("should redact credentials in URL", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://user:password@example.com/api",
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
                    url: "https://[REDACTED]@example.com/api",
                }),
            );
        });

        it("should redact api_key in query string", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?api_key=secret-key&page=1",
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
                    url: "https://example.com/api?api_key=[REDACTED]&page=1",
                }),
            );
        });

        it("should redact token in query string", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?token=secret-token",
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
                    url: "https://example.com/api?token=[REDACTED]",
                }),
            );
        });

        it("should redact password in query string", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?username=user&password=secret",
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
                    url: "https://example.com/api?username=user&password=[REDACTED]",
                }),
            );
        });

        it("should not redact non-sensitive query strings", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?page=1&limit=10&sort=name",
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
                    url: "https://example.com/api?page=1&limit=10&sort=name",
                }),
            );
        });

        it("should not redact URL parameters containing 'auth' substring like 'author'", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?author=john&authenticate=false&page=1",
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
                    url: "https://example.com/api?author=john&authenticate=false&page=1",
                }),
            );
        });

        it("should handle URL with fragment", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?token=secret#section",
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
                    url: "https://example.com/api?token=[REDACTED]#section",
                }),
            );
        });

        it("should redact URL-encoded query parameters", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?api%5Fkey=secret",
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
                    url: "https://example.com/api?api%5Fkey=[REDACTED]",
                }),
            );
        });

        it("should handle URL without query string", async () => {
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
                    url: "https://example.com/api",
                }),
            );
        });

        it("should handle empty query string", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?",
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
                    url: "https://example.com/api?",
                }),
            );
        });

        it("should redact multiple sensitive parameters in URL", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?api_key=secret1&token=secret2&page=1",
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
                    url: "https://example.com/api?api_key=[REDACTED]&token=[REDACTED]&page=1",
                }),
            );
        });

        it("should redact both credentials and query parameters", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://user:pass@example.com/api?token=secret",
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
                    url: "https://[REDACTED]@example.com/api?token=[REDACTED]",
                }),
            );
        });

        it("should use fast path for URLs without sensitive keywords", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?page=1&limit=10&sort=name&filter=value",
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
                    url: "https://example.com/api?page=1&limit=10&sort=name&filter=value",
                }),
            );
        });

        it("should handle query parameter without value", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?flag&token=secret",
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
                    url: "https://example.com/api?flag&token=[REDACTED]",
                }),
            );
        });

        it("should handle URL with multiple @ symbols in credentials", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://user@example.com:pass@host.com/api",
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
                    url: "https://[REDACTED]@host.com/api",
                }),
            );
        });

        it("should handle URL with @ in query parameter but not in credentials", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://example.com/api?email=user@example.com",
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
                    url: "https://example.com/api?email=user@example.com",
                }),
            );
        });

        it("should handle URL with both credentials and @ in path", async () => {
            const mockLogger = createMockLogger();
            mockSuccessResponse();

            await fetcherImpl({
                url: "https://user:pass@example.com/users/@username",
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
                    url: "https://[REDACTED]@example.com/users/@username",
                }),
            );
        });
    });
});

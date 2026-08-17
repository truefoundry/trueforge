import { getResponseBody } from "../../../src/core/fetcher/getResponseBody";

import { RUNTIME } from "../../../src/core/runtime";

describe("Test getResponseBody", () => {
    interface SimpleTestCase {
        description: string;
        responseData: string | Record<string, any>;
        responseType?: "blob" | "sse" | "streaming" | "text";
        expected: any;
        skipCondition?: () => boolean;
    }

    const simpleTestCases: SimpleTestCase[] = [
        {
            description: "should handle text response type",
            responseData: "test text",
            responseType: "text",
            expected: "test text",
        },
        {
            description: "should handle JSON response",
            responseData: { key: "value" },
            expected: { key: "value" },
        },
        {
            description: "should handle empty response",
            responseData: "",
            expected: undefined,
        },
        {
            description: "should handle non-JSON response",
            responseData: "invalid json",
            expected: {
                ok: false,
                error: {
                    reason: "non-json",
                    statusCode: 200,
                    rawBody: "invalid json",
                },
            },
        },
    ];

    simpleTestCases.forEach(({ description, responseData, responseType, expected, skipCondition }) => {
        it(description, async () => {
            if (skipCondition?.()) {
                return;
            }

            const mockResponse = new Response(
                typeof responseData === "string" ? responseData : JSON.stringify(responseData),
            );
            const result = await getResponseBody(mockResponse, responseType);
            expect(result).toEqual(expected);
        });
    });

    it("should handle blob response type", async () => {
        const mockBlob = new Blob(["test"], { type: "text/plain" });
        const mockResponse = new Response(mockBlob);
        const result = await getResponseBody(mockResponse, "blob");
        // @ts-expect-error
        expect(result.constructor.name).toBe("Blob");
    });

    it("should handle sse response type", async () => {
        if (RUNTIME.type === "node") {
            const mockStream = new ReadableStream();
            const mockResponse = new Response(mockStream);
            const result = await getResponseBody(mockResponse, "sse");
            expect(result).toBe(mockStream);
        }
    });

    it("should retain a reference to the parent Response for sse responses", async () => {
        if (RUNTIME.type === "node") {
            const mockStream = new ReadableStream();
            const mockResponse = new Response(mockStream);
            const result = (await getResponseBody(mockResponse, "sse")) as ReadableStream & {
                __fern_response_ref?: Response;
            };
            // Pins the parent Response so undici's FinalizationRegistry can't GC it and cancel the stream.
            expect(result.__fern_response_ref).toBe(mockResponse);
            // The pin must be non-enumerable so it does not leak through JSON.stringify or Object.keys.
            const descriptor = Object.getOwnPropertyDescriptor(result, "__fern_response_ref");
            expect(descriptor?.enumerable).toBe(false);
        }
    });

    it("should handle streaming response type", async () => {
        const encoder = new TextEncoder();
        const testData = "test stream data";
        const mockStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(testData));
                controller.close();
            },
        });

        const mockResponse = new Response(mockStream);
        const result = (await getResponseBody(mockResponse, "streaming")) as ReadableStream;

        expect(result).toBeInstanceOf(ReadableStream);

        const reader = result.getReader();
        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const streamContent = decoder.decode(value);
        expect(streamContent).toBe(testData);
    });

    it("should retain a reference to the parent Response for streaming responses", async () => {
        const mockStream = new ReadableStream();
        const mockResponse = new Response(mockStream);
        const result = (await getResponseBody(mockResponse, "streaming")) as ReadableStream & {
            __fern_response_ref?: Response;
        };
        expect(result.__fern_response_ref).toBe(mockResponse);
        const descriptor = Object.getOwnPropertyDescriptor(result, "__fern_response_ref");
        expect(descriptor?.enumerable).toBe(false);
    });
});

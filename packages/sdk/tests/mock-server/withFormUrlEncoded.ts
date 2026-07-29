import { type HttpResponseResolver, passthrough } from "msw";

import { toJson } from "../../src/core/json";

export interface WithFormUrlEncodedOptions {
    /**
     * List of field names to ignore when comparing request bodies.
     * This is useful for pagination cursor fields that change between requests.
     */
    ignoredFields?: string[];
}

/**
 * Creates a request matcher that validates if the request form-urlencoded body exactly matches the expected object
 * @param expectedBody - The exact body object to match against
 * @param resolver - Response resolver to execute if body matches
 * @param options - Optional configuration including fields to ignore
 */
export function withFormUrlEncoded(
    expectedBody: unknown,
    resolver: HttpResponseResolver,
    options?: WithFormUrlEncodedOptions,
): HttpResponseResolver {
    const ignoredFields = options?.ignoredFields ?? [];
    return async (args) => {
        const { request } = args;

        let clonedRequest: Request;
        let bodyText: string | undefined;
        let actualBody: Record<string, string>;
        try {
            clonedRequest = request.clone();
            bodyText = await clonedRequest.text();
            if (bodyText === "") {
                // Empty body is valid if expected body is also empty
                const isExpectedEmpty =
                    expectedBody != null &&
                    typeof expectedBody === "object" &&
                    Object.keys(expectedBody as Record<string, unknown>).length === 0;
                if (!isExpectedEmpty) {
                    console.error("Request body is empty, expected a form-urlencoded body.");
                    return passthrough();
                }
                actualBody = {};
            } else {
                const params = new URLSearchParams(bodyText);
                actualBody = {};
                for (const [key, value] of params.entries()) {
                    actualBody[key] = value;
                }
            }
        } catch (error) {
            console.error(`Error processing form-urlencoded request body:\n\tError: ${error}\n\tBody: ${bodyText}`);
            return passthrough();
        }

        const mismatches = findMismatches(actualBody, expectedBody);
        const filteredMismatches = Object.keys(mismatches).filter((key) => !ignoredFields.includes(key));
        if (filteredMismatches.length > 0) {
            console.error("Form-urlencoded body mismatch:", toJson(mismatches, undefined, 2));
            return passthrough();
        }

        return resolver(args);
    };
}

function findMismatches(actual: any, expected: any): Record<string, { actual: any; expected: any }> {
    const mismatches: Record<string, { actual: any; expected: any }> = {};

    if (typeof actual !== typeof expected) {
        return { value: { actual, expected } };
    }

    if (typeof actual !== "object" || actual === null || expected === null) {
        if (actual !== expected) {
            return { value: { actual, expected } };
        }
        return {};
    }

    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);

    const allKeys = new Set([...actualKeys, ...expectedKeys]);

    for (const key of allKeys) {
        if (!expectedKeys.includes(key)) {
            if (actual[key] === undefined) {
                continue;
            }
            mismatches[key] = { actual: actual[key], expected: undefined };
        } else if (!actualKeys.includes(key)) {
            if (expected[key] === undefined) {
                continue;
            }
            mismatches[key] = { actual: undefined, expected: expected[key] };
        } else if (actual[key] !== expected[key]) {
            mismatches[key] = { actual: actual[key], expected: expected[key] };
        }
    }

    return mismatches;
}

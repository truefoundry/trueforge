import { expect } from "vitest";

interface CustomMatchers<R = unknown> {
    toContainHeaders(expectedHeaders: Record<string, string>): R;
}

declare module "vitest" {
    interface Assertion<T = any> extends CustomMatchers<T> {}
    interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
    toContainHeaders(actual: unknown, expectedHeaders: Record<string, string>) {
        const isHeaders = actual instanceof Headers;
        const isPlainObject = typeof actual === "object" && actual !== null && !Array.isArray(actual);

        if (!isHeaders && !isPlainObject) {
            throw new TypeError("Received value must be an instance of Headers or a plain object!");
        }

        if (typeof expectedHeaders !== "object" || expectedHeaders === null || Array.isArray(expectedHeaders)) {
            throw new TypeError("Expected headers must be a plain object!");
        }

        const missingHeaders: string[] = [];
        const mismatchedHeaders: Array<{ key: string; expected: string; actual: string | null }> = [];

        for (const [key, value] of Object.entries(expectedHeaders)) {
            let actualValue: string | null = null;

            if (isHeaders) {
                // Headers.get() is already case-insensitive
                actualValue = (actual as Headers).get(key);
            } else {
                // For plain objects, do case-insensitive lookup
                const actualObj = actual as Record<string, string>;
                const lowerKey = key.toLowerCase();
                const foundKey = Object.keys(actualObj).find((k) => k.toLowerCase() === lowerKey);
                actualValue = foundKey ? actualObj[foundKey] : null;
            }

            if (actualValue === null || actualValue === undefined) {
                missingHeaders.push(key);
            } else if (actualValue !== value) {
                mismatchedHeaders.push({ key, expected: value, actual: actualValue });
            }
        }

        const pass = missingHeaders.length === 0 && mismatchedHeaders.length === 0;

        const actualType = isHeaders ? "Headers" : "object";

        if (pass) {
            return {
                message: () => `expected ${actualType} not to contain ${this.utils.printExpected(expectedHeaders)}`,
                pass: true,
            };
        } else {
            const messages: string[] = [];

            if (missingHeaders.length > 0) {
                messages.push(`Missing headers: ${this.utils.printExpected(missingHeaders.join(", "))}`);
            }

            if (mismatchedHeaders.length > 0) {
                const mismatches = mismatchedHeaders.map(
                    ({ key, expected, actual }) =>
                        `${key}: expected ${this.utils.printExpected(expected)} but got ${this.utils.printReceived(actual)}`,
                );
                messages.push(mismatches.join("\n"));
            }

            return {
                message: () =>
                    `expected ${actualType} to contain ${this.utils.printExpected(expectedHeaders)}\n\n${messages.join("\n")}`,
                pass: false,
            };
        }
    },
});

import { toQueryString } from "./qs.js";

/**
 * Creates a fluent builder for constructing URL query strings.
 *
 * Each `.add()` call serializes its value immediately (like C#'s builder),
 * so no format tracking is needed — the style is applied at add-time.
 *
 * Usage (generated code):
 *
 *     const qs = core.url.queryBuilder()
 *         .add("limit", limit)
 *         .add("tags", tags, { style: "comma" })   // explode: false
 *         .mergeAdditional(requestOptions?.queryParams)
 *         .build();
 */
export function queryBuilder(): QueryStringBuilder {
    return new QueryStringBuilder();
}

class QueryStringBuilder {
    private parts: Map<string, string> = new Map();

    /**
     * Adds a query parameter, serializing it immediately.
     *
     * By default arrays use "repeat" format (`key=a&key=b`).
     * Pass `{ style: "comma" }` for OpenAPI `explode: false` parameters
     * to get comma-separated values (`key=a,b,c`).
     *
     * Null / undefined values are silently skipped.
     */
    add(key: string, value: unknown, options?: { style?: "comma" }): this {
        if (value === undefined || value === null) {
            return this;
        }
        const serialized = toQueryString(
            { [key]: value },
            { arrayFormat: options?.style === "comma" ? "comma" : "repeat" },
        );
        if (serialized.length > 0) {
            this.parts.set(key, serialized);
        }
        return this;
    }

    /**
     * Adds multiple query parameters at once from a record.
     * All parameters use the default "repeat" array format.
     * Null / undefined values are silently skipped.
     */
    addMany(params: Record<string, unknown>): this {
        if (params != null) {
            for (const [key, value] of Object.entries(params)) {
                this.add(key, value);
            }
        }
        return this;
    }

    /**
     * Merges additional query parameters supplied at call-time via
     * `requestOptions.queryParams`. Overrides existing keys (last-write-wins).
     */
    mergeAdditional(additionalParams?: Record<string, unknown>): this {
        if (additionalParams != null) {
            for (const [key, value] of Object.entries(additionalParams)) {
                if (value === undefined || value === null) {
                    continue;
                }
                const serialized = toQueryString({ [key]: value }, { arrayFormat: "repeat" });
                if (serialized.length > 0) {
                    this.parts.set(key, serialized);
                }
            }
        }
        return this;
    }

    /**
     * Returns the assembled query string (without the leading `?`).
     * Returns an empty string when no parameters were added.
     */
    build(): string {
        return [...this.parts.values()].join("&");
    }
}

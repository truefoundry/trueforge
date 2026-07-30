/**
 * Spreads caller-supplied `additionalBodyParameters` (from `requestOptions.additionalBodyParameters`)
 * on top of the request body. Caller-supplied properties win over the endpoint body. When no
 * additional body parameters are provided, the original body is returned unchanged so serialization
 * is unaffected.
 *
 * The merge only applies to plain-object (JSON object) bodies. When the body is `null`/`undefined`
 * the additional parameters become the body; when the body is an array or a primitive JSON value it
 * is returned unchanged, since object properties cannot be spread into it. This mirrors the Python
 * SDK, which only merges additional body parameters into mapping bodies.
 */
export function mergeAdditionalBodyParameters(
    body: unknown,
    additionalBodyParameters: Record<string, unknown> | undefined,
): unknown {
    if (additionalBodyParameters == null) {
        return body;
    }
    if (body == null) {
        return { ...additionalBodyParameters };
    }
    if (typeof body === "object" && !Array.isArray(body)) {
        return { ...body, ...additionalBodyParameters };
    }
    return body;
}

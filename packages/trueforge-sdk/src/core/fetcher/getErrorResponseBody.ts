import { fromJson } from "../json.js";
import { getResponseBody, isResponseBodyError } from "./getResponseBody.js";

/** Parses a JSON error body, falling back to the raw text so the status and body are never lost. */
function parseJsonErrorBody(text: string): unknown {
    if (text.length === 0) {
        return undefined;
    }
    try {
        return fromJson(text);
    } catch {
        return text;
    }
}

export async function getErrorResponseBody(response: Response): Promise<unknown> {
    let contentType = response.headers.get("Content-Type")?.toLowerCase();
    if (contentType == null || contentType.length === 0) {
        const body = await getResponseBody(response);
        if (isResponseBodyError(body)) {
            return body.error.reason === "non-json" ? body.error.rawBody : undefined;
        }
        return body;
    }

    if (contentType.indexOf(";") !== -1) {
        contentType = contentType.split(";")[0]?.trim() ?? "";
    }
    switch (contentType) {
        case "application/hal+json":
        case "application/json":
        case "application/ld+json":
        case "application/problem+json":
        case "application/vnd.api+json":
        case "text/json":
            return parseJsonErrorBody(await response.text());
        default:
            if (contentType.startsWith("application/vnd.") && contentType.endsWith("+json")) {
                return parseJsonErrorBody(await response.text());
            }

            // Fallback to plain text if content type is not recognized
            // Even if no body is present, the response will be an empty string
            return await response.text();
    }
}

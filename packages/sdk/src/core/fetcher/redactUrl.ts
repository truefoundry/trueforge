export const SENSITIVE_QUERY_PARAMS: Set<string> = new Set([
    "api_key",
    "api-key",
    "apikey",
    "token",
    "access_token",
    "access-token",
    "auth_token",
    "auth-token",
    "password",
    "passwd",
    "secret",
    "api_secret",
    "api-secret",
    "apisecret",
    "key",
    "session",
    "session_id",
    "session-id",
]);

export function redactUrl(url: string): string {
    const protocolIndex = url.indexOf("://");
    if (protocolIndex === -1) return url;

    const afterProtocol = protocolIndex + 3;

    // Find the first delimiter that marks the end of the authority section
    const pathStart = url.indexOf("/", afterProtocol);
    let queryStart = url.indexOf("?", afterProtocol);
    let fragmentStart = url.indexOf("#", afterProtocol);

    const firstDelimiter = Math.min(
        pathStart === -1 ? url.length : pathStart,
        queryStart === -1 ? url.length : queryStart,
        fragmentStart === -1 ? url.length : fragmentStart,
    );

    // Find the LAST @ before the delimiter (handles multiple @ in credentials)
    let atIndex = -1;
    for (let i = afterProtocol; i < firstDelimiter; i++) {
        if (url[i] === "@") {
            atIndex = i;
        }
    }

    if (atIndex !== -1) {
        url = `${url.slice(0, afterProtocol)}[REDACTED]@${url.slice(atIndex + 1)}`;
    }

    // Recalculate queryStart since url might have changed
    queryStart = url.indexOf("?");
    if (queryStart === -1) return url;

    fragmentStart = url.indexOf("#", queryStart);
    const queryEnd = fragmentStart !== -1 ? fragmentStart : url.length;
    const queryString = url.slice(queryStart + 1, queryEnd);

    if (queryString.length === 0) return url;

    // FAST PATH: Quick check if any sensitive keywords present
    // Using indexOf is faster than regex for simple substring matching
    const lower = queryString.toLowerCase();
    const hasSensitive =
        lower.includes("token") ||
        lower.includes("key") ||
        lower.includes("password") ||
        lower.includes("passwd") ||
        lower.includes("secret") ||
        lower.includes("session") ||
        lower.includes("auth");

    if (!hasSensitive) {
        return url;
    }

    // SLOW PATH: Parse and redact
    const redactedParams: string[] = [];
    const params = queryString.split("&");

    for (const param of params) {
        const equalIndex = param.indexOf("=");
        if (equalIndex === -1) {
            redactedParams.push(param);
            continue;
        }

        const key = param.slice(0, equalIndex);
        let shouldRedact = SENSITIVE_QUERY_PARAMS.has(key.toLowerCase());

        if (!shouldRedact && key.includes("%")) {
            try {
                const decodedKey = decodeURIComponent(key);
                shouldRedact = SENSITIVE_QUERY_PARAMS.has(decodedKey.toLowerCase());
            } catch {}
        }

        redactedParams.push(shouldRedact ? `${key}=[REDACTED]` : param);
    }

    return url.slice(0, queryStart + 1) + redactedParams.join("&") + url.slice(queryEnd);
}

import { AnalyticsEvents } from './events.js';
import type { TrackAnalytics } from './types.js';

// Exact error class name the SDK sets when an HTTP call hits its request timeout (default ~60s).
const TRUEFORGE_TIMEOUT_ERROR_NAME = 'TrueForgeTimeoutError';
// SDK message shape: "Timeout exceeded when calling POST /v1/sessions." → capture method + path.
const SDK_TIMEOUT_MESSAGE_PATTERN = /^Timeout exceeded when calling (\S+) (.+?)\.?$/;

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (error != null && typeof error === 'object' && 'message' in error) {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string') {
      const trimmed = message.trim();
      return trimmed === '' ? undefined : trimmed;
    }
  }
  return undefined;
}

function readErrorName(error: unknown): string | undefined {
  if (error instanceof Error && error.name !== '') return error.name;
  if (error != null && typeof error === 'object' && 'name' in error) {
    const name = Reflect.get(error, 'name');
    if (typeof name === 'string' && name !== '') return name;
  }
  return undefined;
}

/**
 * `controller.abort("timeout")` can reject fetch with the raw string. The SDK then
 * `JSON.stringify`s that into the error message, so the toast text is `"timeout"`
 * (quotes included), not the word alone.
 *
 * e.g. `timeout`, `"timeout"`, `'timeout'` → true;
 */
function isTimeoutToken(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.toLowerCase() === 'timeout') return true;
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (!quoted) return false;
  return trimmed.slice(1, -1).trim().toLowerCase() === 'timeout';
}

/**
 * Guess whether this failure was an SDK HTTP timeout.
 * We check the error's name/text instead of `instanceof`, because the UI may see a
 * copy of the class from a different bundle where instanceof would fail.
 * Also treats a bare "timeout" string as a hit — that is what the toast sometimes shows.
 *
 * e.g. true for `TrueForgeTimeoutError`, `new Error('"timeout"')`,
 * `new Error('Timeout exceeded when calling GET /api/v1/agents.')`; false for `new Error('boom')`.
 */
export function isSdkHttpTimeoutError(error: unknown): boolean {
  const name = readErrorName(error);
  if (name === TRUEFORGE_TIMEOUT_ERROR_NAME) return true;

  const message = readErrorMessage(error);
  if (message == null) return false;
  if (isTimeoutToken(message)) return true;
  return SDK_TIMEOUT_MESSAGE_PATTERN.test(message);
}

let reportTimeout: TrackAnalytics | null = null;

/** AnalyticsProvider publishes the host sink so the shared SDK fetch can report timeouts. */
export function bindSdkHttpTimeoutTracking(track: TrackAnalytics | null): void {
  reportTimeout = track;
}

// e.g. `http://localhost:3000/api/v1/sessions/abc/events?limit=20` → `/api/v1/sessions/abc/events`
function requestPath(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

function isFetchTimeout(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.reason === 'timeout') return true;
  if (typeof error === 'string') return isTimeoutToken(error);
  if (error instanceof Error && isTimeoutToken(error.message)) return true;
  return false;
}

/**
 * Wrap the SDK fetch used by every Harness API (chat, settings, schedules, sessions, …).
 * A timeout is reported once here with the request endpoint, including calls that never toast.
 *
 * e.g. a timed-out `GET .../api/v1/sessions/abc/events?limit=20` sends
 * `trueforge.sdk.http_timeout` with `{ endpoint: 'GET /api/v1/sessions/abc/events' }`.
 */
export function withSdkHttpTimeoutTracking(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      return await baseFetch(input, init);
    } catch (error) {
      if (reportTimeout != null && isFetchTimeout(error, init?.signal ?? undefined)) {
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        reportTimeout(AnalyticsEvents.Sdk.HTTP_TIMEOUT, { endpoint: `${method} ${requestPath(input)}` });
      }
      throw error;
    }
  };
}

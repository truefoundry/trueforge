function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Reads a display string from API-shaped errors: `message`, then nested
 * `error.message`. When neither exists, stringifies the value.
 */
function messageFromErrorShaped(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const direct = readNonEmptyString(value.message);
  if (direct != null) return direct;
  if (isRecord(value.error)) {
    return readNonEmptyString(value.error.message);
  }
  return undefined;
}

function stringifyError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

/**
 * User-facing error text. Prefers HTTP body `{ error: { message } }` when
 * present (e.g. TrueForgeError), then `error.message` / `error.error.message`,
 * then `fallback`, then a string form of the value.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed !== '') return error;
    return fallback ?? error;
  }

  if (isRecord(error) && 'body' in error) {
    const fromBody = messageFromErrorShaped(error.body);
    if (fromBody != null) return fromBody;
    if (error.body != null) {
      if (typeof error.body === 'string') {
        const trimmed = error.body.trim();
        if (trimmed !== '') return error.body;
      } else {
        return stringifyError(error.body);
      }
    }
  }

  const fromShape = messageFromErrorShaped(error);
  if (fromShape != null) return fromShape;

  if (fallback != null) return fallback;
  return stringifyError(error);
}

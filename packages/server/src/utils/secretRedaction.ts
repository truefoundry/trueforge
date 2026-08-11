/**
 * Redact secret strings for settings API responses and detect/merge
 * redacted writebacks so clients can keep stored secrets without resending them.
 */

export const SECRET_REDACTION = '***REDACTED***';
/** Prefix/suffix mask needs more than 6 chars so first+last 3 do not reveal the whole secret. */
const MIN_LENGTH_FOR_PREFIX_SUFFIX = 7;

/** Response mask: prefix/suffix for longer secrets; full mask when too short to hide. */
export function toRedactedSecretValue(secret: string): string {
  if (secret.length < MIN_LENGTH_FOR_PREFIX_SUFFIX) {
    return SECRET_REDACTION;
  }
  return `${secret.slice(0, 3)}-${SECRET_REDACTION}-${secret.slice(-3)}`;
}

/**
 * True when the client sent a redacted stand-in from a prior GET.
 */
export function isRedactedSecretValue(value: string): boolean {
  return value.includes(SECRET_REDACTION);
}

/**
 * Resolve the secret to persist for a strict PUT field (always a non-empty string).
 * Real secrets are stored as-is; redacted stand-ins keep `existing` when present.
 */
export function resolveStoredSecretValue({
  incoming,
  existing,
}: {
  incoming: string;
  existing: string | undefined;
}): { ok: true; value: string } | { ok: false } {
  if (!isRedactedSecretValue(incoming)) {
    return { ok: true, value: incoming };
  }
  if (existing) {
    return { ok: true, value: existing };
  }
  return { ok: false };
}

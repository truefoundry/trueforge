/**
 * Redact secret strings for settings API responses and detect/merge
 * redacted writebacks so clients can keep stored secrets without resending them.
 */

export const SECRET_REDACTION = '***REDACTED***';
const MIN_PREFIX_SUFFIX_LENGTH = 6;

/** Response mask: prefix/suffix for longer secrets; full mask when too short to hide. */
export function toRedactedSecretValue(secret: string): string {
  if (secret.length < MIN_PREFIX_SUFFIX_LENGTH) {
    return SECRET_REDACTION;
  }
  return `${secret.slice(0, 3)}-${SECRET_REDACTION}-${secret.slice(-3)}`;
}

/**
 * True when the client sent a redacted stand-in from a prior GET. Callers must
 * handle omitted fields (`undefined`) themselves — empty strings are not keep.
 */
export function isRedactedSecretValue(value: string): boolean {
  return value.includes(SECRET_REDACTION);
}

/**
 * Resolve the secret to persist when the request body included a string field.
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

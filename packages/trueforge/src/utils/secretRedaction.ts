/**
 * Redact secret strings for settings API responses and detect/merge
 * redacted writebacks so clients can keep stored secrets without resending them.
 */

export const SECRET_REDACTION = '***REDACTED***';
/**
 * Below this, a suffix would be most of the secret, so nothing is shown at all.
 * A 10-character key used to be published as its first three and last three characters.
 */
const MIN_LENGTH_FOR_SUFFIX = 12;
/** How much of a long secret a response may show, matching what other providers publish. */
const SUFFIX_LENGTH = 4;
const MASK_SEPARATOR = '-';

/** Response mask: a bounded suffix for longer secrets; full mask when too short to hide. */
export function toRedactedSecretValue(secret: string): string {
  if (secret.length < MIN_LENGTH_FOR_SUFFIX) {
    return SECRET_REDACTION;
  }
  return `${SECRET_REDACTION}${MASK_SEPARATOR}${secret.slice(-SUFFIX_LENGTH)}`;
}

/** The prefix every suffix-bearing mask starts with, which is fixed. */
const MASK_PREFIX = `${SECRET_REDACTION}${MASK_SEPARATOR}`;

/**
 * Whole-value test for the suffix-bearing mask.
 *
 * Compared by length and prefix rather than by regular expression: the sentinel is full of regex
 * metacharacters, so a pattern built from it needs escaping to stay correct.
 */
function isMaskWithSuffix(value: string): boolean {
  return value.length === MASK_PREFIX.length + SUFFIX_LENGTH && value.startsWith(MASK_PREFIX);
}

/**
 * True when the client sent a redacted stand-in from a prior GET.
 *
 * Matched against the exact shapes `toRedactedSecretValue` produces rather than by substring. A
 * substring test classified any real secret that happened to contain the sentinel as "keep the
 * stored one", so the value the user typed was dropped without an error saying so — persisted as
 * the old secret, or failing a create with a message about a missing key.
 *
 * A secret whose whole value is exactly one of these shapes is still indistinguishable from a mask.
 * Nothing in-band can separate those two; only a field saying "keep" alongside the value could.
 */
export function isRedactedSecretValue(value: string): boolean {
  return value === SECRET_REDACTION || isMaskWithSuffix(value);
}

/**
 * Thrown when a redacted keep is requested but no stored secret exists
 * (create with redacted stand-in, or keep for a missing field/header).
 * Callers map this to a domain-specific 400 message.
 */
export class MissingStoredSecretError extends Error {
  constructor() {
    super('Missing stored secret');
    this.name = 'MissingStoredSecretError';
  }
}

/**
 * Resolve the secret to persist for a strict PUT field (always a non-empty string).
 * Real secrets are stored as-is; redacted stand-ins keep `existing` when present.
 * @throws {MissingStoredSecretError} when keep is requested with no stored secret
 */
export function resolveStoredSecretValue({
  incoming,
  existing,
}: {
  incoming: string;
  existing: string | undefined;
}): string {
  if (!isRedactedSecretValue(incoming)) {
    return incoming;
  }
  if (existing) {
    return existing;
  }
  throw new MissingStoredSecretError();
}

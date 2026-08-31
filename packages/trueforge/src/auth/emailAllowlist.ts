import type { OIDCConfig } from '../config';

/**
 * Thrown when OIDC_ALLOWED_EMAILS is set and the caller's email does not match.
 * Message is intentionally the generic `login_failed` so OAuth redirects never
 * reveal allowlist membership to the client.
 */
export class EmailNotAllowedError extends Error {
  constructor() {
    super('login_failed');
    this.name = 'EmailNotAllowedError';
  }
}

/**
 * Converts an allowlist entry to a anchored regex. `*` is a wildcard; other
 * regex metacharacters are matched literally. Case is handled by the caller.
 */
export function emailAllowlistPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'u');
}

/** True when `email` matches any allowlist entry (exact or glob). Empty allowlist → true. */
export function emailMatchesAllowlist(email: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }
  const normalized = email.trim().toLowerCase();
  if (normalized === '') {
    return false;
  }
  return patterns.some(pattern => {
    const trimmed = pattern.trim().toLowerCase();
    if (trimmed === '') {
      return false;
    }
    return emailAllowlistPatternToRegExp(trimmed).test(normalized);
  });
}

/**
 * When {@link OIDCConfig.OIDC_ALLOWED_EMAILS} is non-empty, requires a non-empty
 * ID-token `email` claim that matches at least one entry. No-op when unrestricted.
 */
export function assertEmailAllowed(claims: Record<string, unknown>, config: OIDCConfig): void {
  if (config.OIDC_ALLOWED_EMAILS.length === 0) {
    return;
  }
  const email = claims['email'];
  if (typeof email !== 'string' || email.trim() === '') {
    throw new EmailNotAllowedError();
  }
  if (!emailMatchesAllowlist(email, config.OIDC_ALLOWED_EMAILS)) {
    throw new EmailNotAllowedError();
  }
}

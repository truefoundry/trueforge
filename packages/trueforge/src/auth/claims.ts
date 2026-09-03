import type { OIDCConfig } from '../config';
import { assertEmailAllowed } from './emailAllowlist';
import type { RequestContext } from './identity';

/** Raw claims from a decoded ID token; values are untyped until read here. */
export type IdTokenClaims = Record<string, unknown>;

/**
 * Normalizes a claim value into a string list to check membership against.
 * OIDC doesn't fix the shape of claims like `groups`/`roles`: most IdPs
 * return an array, some collapse a single membership down to a bare string,
 * and a missing/misconfigured claim mapping can omit it entirely. Anything
 * else (number, object, null) is treated as "no values" rather than thrown -
 * a malformed claim should fail a user out of admin, not crash the request.
 */
export function claimValues(claim: unknown): string[] {
  if (Array.isArray(claim)) {
    return claim.filter((value): value is string => typeof value === 'string');
  }
  if (typeof claim === 'string') {
    return [claim];
  }
  return [];
}

/** Non-empty string claim, or undefined when absent / empty / wrong type. */
export function resolveOptionalStringClaim(claims: IdTokenClaims, claimName: string): string | undefined {
  const value = claims[claimName];
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  return value;
}

/**
 * The stable identity key for this caller. An identity that can't be resolved
 * means the token can't be trusted to identify anyone, so this throws.
 */
export function resolveUserRef(claims: IdTokenClaims, config: OIDCConfig): string {
  const value = resolveOptionalStringClaim(claims, config.OIDC_USER_REFERENCE_CLAIM);
  if (value === undefined) {
    throw new Error(
      `ID token is missing a non-empty "${config.OIDC_USER_REFERENCE_CLAIM}" claim (OIDC_USER_REFERENCE_CLAIM).`,
    );
  }
  return value;
}

/**
 * Admin iff the configured role claim's values include the configured admin
 * value, exact case-sensitive string match.
 */
export function resolveRole(claims: IdTokenClaims, config: OIDCConfig): 'admin' | 'user' {
  return claimValues(claims[config.OIDC_USER_ROLE_CLAIM]).includes(config.OIDC_ADMIN_ROLE_VALUE) ? 'admin' : 'user';
}

/** Map verified ID-token claims onto a {@link RequestContext}. */
export function toRequestContext(params: {
  claims: IdTokenClaims;
  config: OIDCConfig;
  authorization: string;
}): RequestContext {
  const { claims, config, authorization } = params;
  assertEmailAllowed(claims, config);
  const subjectId = resolveUserRef(claims, config);
  const role = resolveRole(claims, config);
  const displayName =
    resolveOptionalStringClaim(claims, config.OIDC_USER_DISPLAY_NAME_CLAIM) ?? subjectId;
  return {
    tenant_id: 'default',
    subject: {
      id: subjectId,
      type: 'user',
      display_name: displayName,
    },
    is_admin: role === 'admin',
    user_credential: { authorization },
  };
}

export interface AuthorizationRequestParams {
  scopes: string[];
  /** OIDC `claims` request parameter; pass through as-is. */
  claims: { id_token: Record<string, { essential: true }> };
}

/**
 * Scopes + `claims` parameter for the authorization request, derived
 * from configured claim names and {@link OIDCConfig.OIDC_SCOPES}.
 * `essential: true` on identity claims makes the IdP reject the
 * login outright if it can't actually produce that claim.
 * When an email allowlist is configured, `email` is also marked essential so
 * the IdP cannot complete login without a usable address to check.
 */
export function buildAuthorizationRequestParams(config: OIDCConfig): AuthorizationRequestParams {
  const idTokenClaims: Record<string, { essential: true }> = {
    [config.OIDC_USER_REFERENCE_CLAIM]: { essential: true },
    [config.OIDC_USER_ROLE_CLAIM]: { essential: true },
    [config.OIDC_USER_DISPLAY_NAME_CLAIM]: { essential: true },
  };
  if (config.OIDC_ALLOWED_EMAILS.length > 0) {
    idTokenClaims['email'] = { essential: true };
  }
  return {
    scopes: config.OIDC_SCOPES,
    claims: {
      id_token: idTokenClaims,
    },
  };
}

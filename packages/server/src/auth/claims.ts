import type { OIDCConfig } from '../config';

/** Raw claims from a decoded ID token; values are untyped until read here. */
export type IdTokenClaims = Record<string, unknown>;

export type Role = 'admin' | 'user';

export interface UserContext {
  userRef: string;
  role: Role;
}

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

/**
 * The stable identity key for this caller. An identity that can't be resolved
 * means the token can't be trusted to identify anyone, so this throws.
 */
export function resolveUserRef(claims: IdTokenClaims, config: OIDCConfig): string {
  const value = claims[config.OIDC_USER_REFERENCE_CLAIM];
  if (typeof value !== 'string' || value === '') {
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
export function resolveRole(claims: IdTokenClaims, config: OIDCConfig): Role {
  return claimValues(claims[config.OIDC_USER_ROLE_CLAIM]).includes(config.OIDC_ADMIN_ROLE_VALUE) ? 'admin' : 'user';
}

/** Everything `/callback` (and later `/me`, once sessions are real) needs from a set of claims. */
export function toUserContext(claims: IdTokenClaims, config: OIDCConfig): UserContext {
  return {
    userRef: resolveUserRef(claims, config),
    role: resolveRole(claims, config),
  };
}

export interface AuthorizationRequestParams {
  scopes: string[];
  /** OIDC `claims` request parameter; pass through as-is. */
  claims: { id_token: Record<string, { essential: true }> };
}

/**
 * Scopes + `claims` parameter for the authorization request, derived
 * from the configured claim names. Okta's `groups` claim additionally
 * requires the `groups` scope to be requested (Okta won't return it otherwise,
 * even once mapped on the custom authorization server); Azure AD returns
 * `roles`/`groups` without a matching scope, so requesting a `groups` scope
 * there is harmless but never required.
 * `essential: true` on the role claim makes the IdP reject the
 * login outright if it can't actually produce that claim (e.g. a broken
 * claim mapping) instead of silently omitting it and defaulting the user to
 * non-admin.
 */
export function buildAuthorizationRequestParams(config: OIDCConfig): AuthorizationRequestParams {
  const scopes = ['openid', 'profile', 'email'];
  if (config.OIDC_USER_ROLE_CLAIM === 'groups') {
    scopes.push('groups');
  }

  return {
    scopes,
    claims: {
      id_token: {
        [config.OIDC_USER_REFERENCE_CLAIM]: { essential: true },
        [config.OIDC_USER_ROLE_CLAIM]: { essential: true },
      },
    },
  };
}

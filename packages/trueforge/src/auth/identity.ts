import type { Context } from 'hono';
import { getOidcVerify } from './oidc';

export type Role = 'admin' | 'user';

export interface UserContext {
  userRef: string;
  role: Role;
}

/**
 * Fixed identity when no identity provider is configured (standalone / auth disabled).
 * Stamped onto sessions as `created_by` and used for ownership checks.
 */
export const LOCAL_USER_CONTEXT: UserContext = {
  userRef: 'trueforge-default',
  role: 'admin',
};

/** Auth disabled: always true. Auth enabled: admin role only. */
export function isAdmin(user: UserContext): boolean {
  if (!getOidcVerify()) {
    return true;
  }
  return user.role === 'admin';
}

/** Resolves the caller identity from the request context. Injected on session/turn routers. */
export type ResolveUserContext = (c: Context) => UserContext;

/**
 * Caller {@link UserContext} for the current request.
 * Requires auth middleware to have set `c.var.user`.
 */
export function resolveUserContext(c: Context): UserContext {
  const uc = c.get('user_context');
  if (uc === undefined) {
    throw new Error('UserContext missing; auth middleware did not run');
  }
  return uc;
}

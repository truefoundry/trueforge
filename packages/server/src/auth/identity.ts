import type { Context } from 'hono';

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

/** Resolves the caller identity from the request context. Injected on session/turn routers. */
export type ResolveUserContext = (c: Context) => UserContext;

/**
 * Caller {@link UserContext} for the current request.
 */
export function resolveUserContext(_c: Context): UserContext {
  // TODO: extract UserContext from `c` once auth middleware sets it (e.g. c.get('user')).
  void _c;
  return LOCAL_USER_CONTEXT;
}

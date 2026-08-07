import configuration, { isOidcConfigured } from '../config';
import type { UserContext } from './claims';

/**
 * Fixed identity when no identity provider is configured (standalone / auth disabled).
 * Stamped onto sessions as `created_by` and used for ownership checks.
 */
export const LOCAL_USER_CONTEXT: UserContext = {
  userRef: 'trueforge-default',
  role: 'admin',
};

/**
 * Caller {@link UserContext} for the current request.
 *
 * - Auth disabled (no OIDC): always {@link LOCAL_USER_CONTEXT}.
 * - Auth enabled: pass the verified context attached by auth middleware.
 */
export function resolveUserContext(verified?: UserContext): UserContext {
  if (!isOidcConfigured(configuration)) {
    return LOCAL_USER_CONTEXT;
  }
  if (verified === undefined) {
    throw new Error('UserContext is required when OIDC is configured');
  }
  return verified;
}

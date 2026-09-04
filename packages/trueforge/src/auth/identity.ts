import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';

import configuration, { getTrueForgeMode, isOidcConfigured, TrueForgeMode } from '../config';

/** Standalone / default TrueForge admin role string. */
export const STANDALONE_ADMIN_ROLE = 'admin';

export interface RequestSubject {
  id: string;
  type: string;
  display_name: string;
}

export interface RequestContext {
  tenant_id: string;
  subject: RequestSubject;
  roles: string[];
  /** Raw bearer token for the caller, or `null` when standalone has no credential. */
  user_credential: string | null;
}

export const STANDALONE_REQUEST_CONTEXT: RequestContext = {
  tenant_id: 'default',
  subject: {
    id: 'trueforge-default',
    type: 'user',
    display_name: 'trueforge-default',
  },
  roles: [STANDALONE_ADMIN_ROLE],
  user_credential: null,
};

export type ResolveRequestContext = (c: Context) => RequestContext;

declare module 'hono' {
  interface ContextVariableMap {
    request_context?: RequestContext;
  }
}

export function resolveRequestContext(c: Context): RequestContext {
  const requestContext = c.get('request_context');
  if (requestContext === undefined) {
    throw new Error('RequestContext missing; auth middleware did not run');
  }
  return requestContext;
}

/**
 * Whether the caller is treated as admin for settings, capabilities, and schedule bypass.
 * Mode and OIDC admin claim value come from process config ({@link getTrueForgeMode}).
 * - Standalone: `roles` includes `admin`
 * - OIDC: `roles` includes configured `OIDC_ADMIN_ROLE_VALUE`
 * - TrueFoundry: no tenant-wide TrueForge admin
 */
export function hasAdminRole(requestContext: Pick<RequestContext, 'roles'>): boolean {
  switch (getTrueForgeMode()) {
    case TrueForgeMode.TrueFoundry:
      return false;
    case TrueForgeMode.Oidc: {
      const adminValue = isOidcConfigured(configuration)
        ? configuration.OIDC.OIDC_ADMIN_ROLE_VALUE
        : STANDALONE_ADMIN_ROLE;
      return requestContext.roles.includes(adminValue);
    }
    case TrueForgeMode.Standalone:
      return requestContext.roles.includes(STANDALONE_ADMIN_ROLE);
  }
}

/** Persistable creator snapshot derived from the authenticated request. */
export function createdBySubjectFromRequestContext(ctx: RequestContext): CreatedBySubject {
  return {
    subject_id: ctx.subject.id,
    subject_type: ctx.subject.type,
    subject_display_name: ctx.subject.display_name,
  };
}

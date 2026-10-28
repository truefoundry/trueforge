import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';

import configuration, {
  getTrueForgeAuthMode,
  isOidcConfigured,
  isTrueFoundryModeEnabled,
  TrueForgeAuthMode,
} from '../config';
import { createTrueFoundryRequestContext } from '../truefoundry/accessToken';

/** Standalone / default TrueForge admin role string. */
export const STANDALONE_ADMIN_ROLE = 'admin';

export const TRUEFOUNDRY_TENANT_ADMIN_ROLE = 'tenant-admin';

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
 * Whether the caller is a TrueForge admin.
 * - Standalone: `roles` includes `admin`
 * - OIDC: `roles` includes configured `OIDC_ADMIN_ROLE_VALUE`
 * - TrueFoundry: `roles` includes `tenant-admin`
 */
export function hasAdminRole(requestContext: Pick<RequestContext, 'roles'>): boolean {
  switch (getTrueForgeAuthMode()) {
    case TrueForgeAuthMode.TrueFoundry:
      return requestContext.roles.includes(TRUEFOUNDRY_TENANT_ADMIN_ROLE);
    case TrueForgeAuthMode.Oidc: {
      if (!isOidcConfigured(configuration)) {
        // this is technically unreachable since case TrueForgeAuthMode.Oidc already ensures OIDC is configured
        return false;
      }
      return requestContext.roles.includes(configuration.OIDC.OIDC_ADMIN_ROLE_VALUE);
    }
    case TrueForgeAuthMode.Standalone:
      return requestContext.roles.includes(STANDALONE_ADMIN_ROLE);
  }
}

/**
 * Whether the caller may use `/api/v1/settings` and see settings in capabilities.
 * Always false in TrueFoundry (catalogs are platform-managed); otherwise same as {@link hasAdminRole}.
 */
export function canAccessSettings(requestContext: Pick<RequestContext, 'roles'>): boolean {
  if (getTrueForgeAuthMode() === TrueForgeAuthMode.TrueFoundry) {
    return false;
  }
  return hasAdminRole(requestContext);
}

/**
 * Create / update / delete sandbox environments (list/get stay open to all callers).
 * - Create (no `created_by_subject_id`): admin only
 * - Update / delete: admin or the environment creator
 */
export function canCreateOrEdit(
  requestContext: Pick<RequestContext, 'subject' | 'roles'>,
  created_by_subject_id?: string,
): boolean {
  return (
    hasAdminRole(requestContext) ||
    (created_by_subject_id !== undefined && requestContext.subject.id === created_by_subject_id)
  );
}

/** Update / delete / run-now a schedule (and admin/creator schedule reads). */
export function canEditSchedule(
  requestContext: Pick<RequestContext, 'subject' | 'roles'>,
  created_by_subject_id: string,
): boolean {
  return hasAdminRole(requestContext) || requestContext.subject.id === created_by_subject_id;
}

/** Subject rebuilt from a stored creator snapshot, for work that runs without a live request. */
export function requestSubjectFromCreatedBySubject(subject: CreatedBySubject): RequestSubject {
  return {
    id: subject.subject_id,
    type: subject.subject_type,
    display_name: subject.subject_display_name,
  };
}

/**
 * Request identity for store resolvers and other work that runs as a persisted creator
 * (schedule dispatch, etc.), not as the live HTTP caller.
 */
export function requestContextFromCreatedBySubject(params: {
  tenant_id: string;
  created_by_subject: CreatedBySubject;
}): RequestContext {
  const base: RequestContext = {
    tenant_id: params.tenant_id,
    subject: requestSubjectFromCreatedBySubject(params.created_by_subject),
    roles: [],
    user_credential: null,
  };
  return isTrueFoundryModeEnabled(configuration) ? createTrueFoundryRequestContext(base) : base;
}

/** Persistable creator snapshot derived from the authenticated request. */
export function createdBySubjectFromRequestContext(ctx: RequestContext): CreatedBySubject {
  return {
    subject_id: ctx.subject.id,
    subject_type: ctx.subject.type,
    subject_display_name: ctx.subject.display_name,
  };
}

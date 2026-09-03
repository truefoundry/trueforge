import type { Context } from 'hono';

export type RequestSubject = {
  id: string;
  type: string;
  display_name: string;
};

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
  roles: ['admin'],
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

/** Whether the caller holds the TrueForge admin role (`admin`). */
export function hasAdminRole(requestContext: Pick<RequestContext, 'roles'>): boolean {
  return requestContext.roles.includes('admin');
}

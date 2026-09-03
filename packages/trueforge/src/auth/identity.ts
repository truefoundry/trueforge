import type { Context } from 'hono';
import { z } from 'zod';

export const SubjectTypeSchema = z.enum(['user', 'virtualaccount']);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

export interface RequestSubject {
  id: string;
  type: SubjectType;
  display_name: string;
}

export interface UserCredential {
  authorization: string;
}

export interface RequestContext {
  tenant_id: string;
  subject: RequestSubject;
  is_admin: boolean;
  user_credential: UserCredential | null;
}

export const STANDALONE_REQUEST_CONTEXT: RequestContext = {
  tenant_id: 'default',
  subject: {
    id: 'trueforge-default',
    type: 'user',
    display_name: 'Admin',
  },
  is_admin: true,
  user_credential: null,
};

export type ResolveRequestContext = (c: Context) => RequestContext;

export function resolveRequestContext(c: Context): RequestContext {
  const requestContext = c.get('request_context');
  if (requestContext === undefined) {
    throw new Error('RequestContext missing; auth middleware did not run');
  }
  return requestContext;
}

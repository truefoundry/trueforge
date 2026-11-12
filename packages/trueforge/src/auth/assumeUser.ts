import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { updateLogContext } from '../logger';
import { requestContextFromCreatedBySubject, type RequestContext } from './identity';

export const ASSUME_USER_HEADER = 'assume-user';

/** Header values are assume roles (not raw user ids). More roles can be added later. */
export const AssumeUser = {
  SessionCreator: 'session-creator',
} as const;

export type AssumeUser = (typeof AssumeUser)[keyof typeof AssumeUser];

const ASSUME_USER_BY_VALUE: Record<string, AssumeUser> = {
  [AssumeUser.SessionCreator]: AssumeUser.SessionCreator,
};

/**
 * OpenAPI `parameters` entry (docs only). Prefer this over Zod `request.headers`:
 * a headers schema validates the header bag and must allow Authorization and other
 * client headers; Nest-style `@ApiHeader` / OpenAPI parameters document without that.
 */
export const ASSUME_USER_HEADER_PARAM = {
  name: ASSUME_USER_HEADER,
  in: 'header' as const,
  required: false,
  description:
    'Service API key only: assume role (not a user id). Today only session-creator; more roles may be added later.',
  schema: { type: 'string' as const, enum: [AssumeUser.SessionCreator] },
};

export function parseAssumeUserHeader(header: string | undefined): AssumeUser {
  const raw = header?.trim();
  if (!raw) {
    throw new HTTPException(400, { message: `Missing ${ASSUME_USER_HEADER} header` });
  }
  const assumed = ASSUME_USER_BY_VALUE[raw];
  if (!assumed) {
    throw new HTTPException(400, {
      message: `Invalid ${ASSUME_USER_HEADER}: only "${AssumeUser.SessionCreator}" is supported`,
    });
  }
  return assumed;
}

/** Load tenant + created_by for the assume role (session_id here, schedule_id later). */
export type ResolveAssumedCreatedBy = () => Promise<{
  tenant_id: string;
  created_by_subject: Subject;
  session_id?: string;
}>;

/**
 * Parse assume-user, resolve the assumed subject, and set `request_context` + `assume_user`
 * for handlers / token vending.
 */
export async function applyAssumeUserToContext(params: {
  c: Context;
  resolveCreatedBy: ResolveAssumedCreatedBy;
}): Promise<RequestContext> {
  const { c, resolveCreatedBy } = params;
  const assumed = parseAssumeUserHeader(c.req.header(ASSUME_USER_HEADER));
  const createdBy = await resolveCreatedBy();
  const requestContext = requestContextFromCreatedBySubject({
    tenant_id: createdBy.tenant_id,
    created_by_subject: createdBy.created_by_subject,
    user_credential: null,
  });
  c.set('request_context', requestContext);
  c.set('assume_user', assumed);
  updateLogContext({
    tenant_id: createdBy.tenant_id,
    ...(createdBy.session_id ? { session_id: createdBy.session_id } : {}),
  });
  return requestContext;
}

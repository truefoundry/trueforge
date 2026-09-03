/**
 * Subject identity from a TrueFoundry access token for MCP auth status / delete.
 */
import { HTTPException } from 'hono/http-exception';
import { decodeJwt } from 'jose';
import type { SfyMcpAuthSubjectType } from './mapSfyMcpServers';

export const EFFECTIVE_USER_ID_SEPARATOR = ':';

export interface AccessTokenSubject {
  /** JWT `sub` — raw subject id before effective-user composition. */
  subjectId: string;
  subjectType: SfyMcpAuthSubjectType;
  /** Present for external-identity flows; used in {@link getEffectiveUserIdFromAccessTokenSubject}. */
  subjectExternalIdentitySlug?: string;
}

/**
 * Decode the caller access token into a subject shape.
 * Type: `subjectType` || legacy `userType` || `user`.
 * Only `user` / `virtualaccount` are accepted for MCP auth disconnect / status.
 */
export function parseAccessTokenSubject(accessToken: string): AccessTokenSubject {
  let payload: ReturnType<typeof decodeJwt>;
  try {
    payload = decodeJwt(accessToken);
  } catch (error) {
    throw new HTTPException(401, { message: 'Invalid access token', cause: error });
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new HTTPException(401, { message: 'Access token is missing a subject (sub)' });
  }

  const rawType = payload['subjectType'] ?? payload['userType'];
  let subjectType: SfyMcpAuthSubjectType;
  if (rawType === undefined || rawType === 'user') {
    subjectType = 'user';
  } else if (rawType === 'virtualaccount') {
    subjectType = 'virtualaccount';
  } else {
    const typeLabel = typeof rawType === 'string' ? rawType : 'unknown';
    throw new HTTPException(401, {
      message: `Access token subject type "${typeLabel}" is not supported for MCP auth disconnect`,
    });
  }

  const slug = payload['subjectExternalIdentitySlug'];
  if (typeof slug === 'string' && slug.length > 0) {
    return { subjectId: payload.sub, subjectType, subjectExternalIdentitySlug: slug };
  }
  return { subjectId: payload.sub, subjectType };
}

/**
 * Id to send as `subjectId` on MCP auth status / delete.
 * Virtual account + external identity → `{id}:{slug}`; otherwise `subjectId`.
 */
export function getEffectiveUserIdFromAccessTokenSubject(subject: AccessTokenSubject): string {
  if (subject.subjectType === 'virtualaccount' && subject.subjectExternalIdentitySlug !== undefined) {
    return `${subject.subjectId}${EFFECTIVE_USER_ID_SEPARATOR}${subject.subjectExternalIdentitySlug}`;
  }
  return subject.subjectId;
}

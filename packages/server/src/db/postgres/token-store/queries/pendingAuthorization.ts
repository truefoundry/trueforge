import type { OAuthPendingAuthorization } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import { PENDING_AUTHORIZATION_TTL_MS, type OAuthPendingAuthorizationData } from '../../../mcpOAuthTypes';
import { json, now, nowMinusMs } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function savePendingAuthorization(
  db: Kysely<Database>,
  pending: OAuthPendingAuthorization,
): Promise<void> {
  // `state` and `id` are their own columns; only the remainder goes in the blob.
  const authData: OAuthPendingAuthorizationData = {
    codeVerifier: pending.codeVerifier,
    redirectUrl: pending.redirectUrl,
  };

  await db
    .insertInto('oauth_pending_authorization')
    .values({
      id: pending.state,
      oauth_server_id: pending.id,
      auth_data: json(authData),
      created_at: now(),
    })
    .execute();
}

export async function getPendingAuthorization(
  db: Kysely<Database>,
  params: { state: string },
): Promise<OAuthPendingAuthorization | undefined> {
  const row = await db
    .selectFrom('oauth_pending_authorization')
    .select(['id', 'oauth_server_id', 'auth_data'])
    .where('id', '=', params.state)
    .where('created_at', '>', nowMinusMs(PENDING_AUTHORIZATION_TTL_MS))
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    state: row.id,
    id: row.oauth_server_id,
    codeVerifier: row.auth_data.codeVerifier,
    redirectUrl: row.auth_data.redirectUrl,
  };
}

export async function deletePendingAuthorization(db: Kysely<Database>, params: { state: string }): Promise<void> {
  await db.deleteFrom('oauth_pending_authorization').where('id', '=', params.state).execute();
}

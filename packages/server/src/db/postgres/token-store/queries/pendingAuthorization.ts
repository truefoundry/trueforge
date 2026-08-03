import type { OAuthPendingAuthorization } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { McpOAuthPendingAuthorizationData } from '../../../mcpOAuthTypes';
import { json, now } from '../../sqlExpressions';
import type { Database } from '../../types';

function toAuthData(pending: OAuthPendingAuthorization): McpOAuthPendingAuthorizationData {
  return {
    codeVerifier: pending.codeVerifier,
    redirectUrl: pending.redirectUrl,
  };
}

export async function savePendingAuthorization(
  db: Kysely<Database>,
  pending: OAuthPendingAuthorization,
): Promise<void> {
  const authData = json(toAuthData(pending));
  await db
    .insertInto('oauth_pending_authorization')
    .values({
      id: pending.state,
      oauth_server_id: pending.id,
      auth_data: authData,
      created_at: now(),
    })
    .onConflict(oc =>
      oc.column('id').doUpdateSet({
        oauth_server_id: pending.id,
        auth_data: authData,
        created_at: now(),
      }),
    )
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

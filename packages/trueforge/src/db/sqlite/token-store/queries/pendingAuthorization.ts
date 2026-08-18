import { sql, type Kysely } from 'kysely';
import type { OAuthPendingAuthorization } from '../../../../mcp/auth/types';
import {
  fromStoredOAuthPendingAuthorizationData,
  PENDING_AUTHORIZATION_TTL_MS,
  toStoredOAuthPendingAuthorizationData,
  type OAuthPendingAuthorizationData,
} from '../../../mcpServerStore';
import { isoMsAgo, jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function savePendingAuthorization(
  db: Kysely<Database>,
  pending: OAuthPendingAuthorization,
): Promise<void> {
  const authData = toStoredOAuthPendingAuthorizationData(pending);

  await db
    .insertInto('oauth_pending_authorization')
    .values({
      id: pending.state,
      oauth_server_id: pending.id,
      user_id: pending.userRef,
      auth_data: jsonbBind(authData),
      created_at: nowIso(),
    })
    .execute();
}

/**
 * Single-use claim: DELETE … RETURNING under the TTL filter so only one concurrent
 * callback wins the row.
 */
export async function consumePendingAuthorization(
  db: Kysely<Database>,
  params: { state: string },
): Promise<OAuthPendingAuthorization | undefined> {
  const row = await db
    .deleteFrom('oauth_pending_authorization')
    .where('id', '=', params.state)
    .where('created_at', '>', isoMsAgo(PENDING_AUTHORIZATION_TTL_MS))
    .returning([
      'id',
      'oauth_server_id',
      'user_id',
      jsonText<OAuthPendingAuthorizationData>(sql.ref('auth_data')).as('auth_data'),
    ])
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    state: row.id,
    id: row.oauth_server_id,
    userRef: row.user_id,
    ...fromStoredOAuthPendingAuthorizationData(row.auth_data),
  };
}

export async function deletePendingAuthorizationsForServer(
  db: Kysely<Database>,
  params: { id: string },
): Promise<void> {
  await db.deleteFrom('oauth_pending_authorization').where('oauth_server_id', '=', params.id).execute();
}

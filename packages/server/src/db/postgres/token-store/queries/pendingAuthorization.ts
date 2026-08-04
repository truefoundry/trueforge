import type { OAuthPendingAuthorization } from '@truefoundry/utils-core/core';
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
    mcpServerUrl: pending.mcpServerUrl,
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
    .where('created_at', '>', nowMinusMs(PENDING_AUTHORIZATION_TTL_MS))
    .returning(['id', 'oauth_server_id', 'auth_data'])
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    state: row.id,
    id: row.oauth_server_id,
    mcpServerUrl: row.auth_data.mcpServerUrl,
    codeVerifier: row.auth_data.codeVerifier,
    redirectUrl: row.auth_data.redirectUrl,
  };
}
